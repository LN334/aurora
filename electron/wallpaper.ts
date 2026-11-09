import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import {
  classifyKind,
  decodeId,
  editableProperties,
  encodeId,
  isImageFile,
  isInside,
  isVideoFile,
  isWebFile,
  mimeFor,
  parseLibraryFolders,
  pickEntry,
  selectedWallpaperFiles,
  type WallpaperKind,
  type WallpaperProperty
} from './pure/wallpaper-rules'

/**
 * Wallpaper Engine as the app's backdrop.
 *
 * Three jobs live here:
 *
 * 1. **Find the engine.** It is a Steam application, so the install is not at a
 *    fixed path - it can be on any library drive. `libraryfolders.vdf` is the
 *    authority, with the registry and the usual paths as the way to find Steam
 *    itself.
 * 2. **List what the user has.** The settings page shows a tiled library, so the
 *    scanner walks every project Wallpaper Engine knows about (workshop items and
 *    loose local projects) and reads each `project.json`.
 * 3. **Serve those files.** `aurora-wallpaper://wp/<id>/<file>` maps one path
 *    segment back to a scanned project directory and refuses anything that
 *    escapes it, so the renderer can fetch a `scene.pkg` or a preview without
 *    ever being handed a filesystem path.
 *
 * Everything here is read-only. Aurora never writes to, moves or "repairs" the
 * engine directory: it is another application's installation and the user's
 * wallpapers are not ours to touch. Scanning is lazy for the same reason it is
 * cheap - a Steam library can be a slow drive and most launches show no
 * wallpaper, so nothing is read until the settings page or the backdrop asks.
 *
 * The registry probe below is Windows-only, and so is the feature: Wallpaper
 * Engine does not exist elsewhere, where the scan simply finds nothing and the
 * renderer is told so.
 */

const WALLPAPER_SCHEME = 'aurora-wallpaper'

/**
 * The wallpaper's own settings, re-exported here because this module is what the
 * main process and the preload type import reach for; nothing outside should
 * have to name `pure/` to talk about them.
 */
export type { WallpaperProperty, WallpaperPropertyType } from './pure/wallpaper-rules'

/** How long a scan is reused before the disk is read again. */
const SCAN_TTL_MS = 30_000

/** One project, as the settings page needs it. */
export interface WallpaperEntry {
  id: string
  title: string
  kind: WallpaperKind
  /** A URL for a preview image, or null when the project ships none. */
  previewUrl: string | null
  /** The project's base URL; the scene engine loads everything from here. */
  sourceUrl: string
  /** The playable file, for everything that is not a scene. */
  entryUrl: string | null
  /** A scene that ships a `scene.pkg` container rather than loose JSON. */
  hasPackage: boolean
  /**
   * The wallpaper's own sliders, colours and switches, in the order the engine's
   * editor shows them. Empty when the project declares none.
   */
  properties: WallpaperProperty[]
  /** Whether this is the wallpaper assigned to a monitor right now. */
  current: boolean
}

/** What the backdrop needs: the one project currently on the desktop. */
export interface WallpaperInfo {
  found: boolean
  kind: WallpaperKind | 'none'
  title: string
  /** The URL to load, or null when nothing was found. */
  src: string | null
  /** The current wallpaper's own settings; empty when it declares none. */
  properties: WallpaperProperty[]
  /** A sentence for the settings page when `found` is false. */
  note: string
  engineDir: string | null
}

/** One scanned project, before it is projected into an entry or an info. */
interface ScannedProject {
  id: string
  dir: string
  title: string
  kind: WallpaperKind
  entry: string | null
  preview: string | null
  /** The wallpaper's own controls, read from `general.properties`. */
  properties: WallpaperProperty[]
  declaredType: string | null
}

interface ScanState {
  at: number
  engineDir: string | null
  projects: ScannedProject[]
  /**
   * Lower-cased directories of the wallpapers assigned to monitors, in monitor
   * order. A machine can run a different wallpaper per display, so this is a
   * list; the backdrop follows the first one, which is `Monitor0`.
   */
  currentDirs: string[]
}

let scanCache: ScanState | null = null

/**
 * Scanned projects by id, kept across scans.
 *
 * The protocol handler resolves a project id on every file request - fifty-two
 * previews for the settings page, a range per video loop - and a request must
 * not pay for a library walk. A hit here answers immediately; a miss (a project
 * installed while the player was open) still goes through `scan()`, which
 * respects its own TTL, so a bogus id does not re-walk the disk either.
 */
let projectById = new Map<string, ScannedProject>()

/**
 * Steam's own install path, from the registry.
 *
 * Three keys because Steam's installer has changed over the years: a per-user
 * install, a per-machine 32-bit one, and the 64-bit view that WOW6432Node
 * redirects. Reading the wrong one is the normal case, so each failure just
 * moves on to the next.
 *
 * Boundary: `reg` is a Windows binary. Anywhere else `execFileSync` throws
 * immediately and this returns an empty list, which is the right answer - there
 * is no Wallpaper Engine there. The 4 s timeout is what keeps a hung `reg` (a
 * locked profile hive, say) from parking the main process behind a settings read.
 */
function steamRootsFromRegistry(): string[] {
  const roots: string[] = []
  const keys: [string, string][] = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\Software\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\Software\\Valve\\Steam', 'InstallPath']
  ]

  for (const [key, value] of keys) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', value], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000
      })
      const match = /REG_SZ\s+(.+)/i.exec(out)
      // One of these keys stores the path with forward slashes.
      const found = match?.[1]?.trim().replace(/\//g, path.sep)
      if (found) roots.push(found)
    } catch {
      /* key absent: try the next one */
    }
  }

  return roots
}

/**
 * The Steam paths that are true for almost everybody.
 *
 * The fallback for the one case the registry cannot answer: a portable Steam
 * install, or a hive the current user cannot read. A missing drive costs one
 * failed `existsSync`, which is cheaper than not finding the engine.
 */
function commonSteamRoots(): string[] {
  const roots: string[] = []
  // Not a valid identifier, hence the bracket access.
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) roots.push(path.join(programFilesX86, 'Steam'))
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'Steam'))
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Steam'))

  for (const drive of ['C', 'D', 'E', 'F', 'S', 'G']) {
    roots.push(`${drive}:\\Steam`)
    roots.push(`${drive}:\\Program Files (x86)\\Steam`)
  }
  return roots
}

/**
 * Every Steam library root visible from one Steam install.
 *
 * The root itself is included even when the vdf is unreadable, because a default
 * install keeps its library where Steam is.
 */
function libraryFolders(steamRoot: string): string[] {
  const roots = new Set<string>([steamRoot])
  const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  try {
    for (const library of parseLibraryFolders(fs.readFileSync(vdf, 'utf8'))) roots.add(library)
  } catch {
    /* no vdf: the root alone is enough */
  }
  return [...roots]
}

/**
 * Every Steam library root this install can see, de-duplicated.
 *
 * A Workshop item is installed into the library that owns the app, and a user
 * with several libraries can have Wallpaper Engine's subscriptions split across
 * them, so the workshop scan asks every root instead of only the one the engine
 * happens to live in. The registry says where Steam is; each root's
 * `libraryfolders.vdf` says where the libraries are.
 */
function steamLibraries(): string[] {
  const libraries: string[] = []
  const seen = new Set<string>()

  // A root can be reported twice (the registry and the common paths overlap),
  // and a vdf can list a library that is also a root, so this de-duplicates on
  // the lower-cased resolved path before the disk is asked anything.
  const add = (dir: string): void => {
    const resolved = path.resolve(dir)
    const key = resolved.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    libraries.push(resolved)
  }

  for (const root of [...steamRootsFromRegistry(), ...commonSteamRoots()]) {
    for (const library of libraryFolders(path.resolve(root))) add(library)
  }
  return libraries
}

/**
 * The installed engine directory, or null when Wallpaper Engine is not installed.
 *
 * The engine sits in exactly one library; `config.json` and the user's own
 * projects are read from there, while the Workshop scan below walks all of them.
 */
function findEngineDir(libraries: string[]): string | null {
  for (const library of libraries) {
    const candidate = path.join(library, 'steamapps', 'common', 'wallpaper_engine')
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate
  }
  return null
}

/**
 * The wallpaper files `config.json` names, or nothing.
 *
 * Best effort, for the same reason the engine lookup is: the config belongs to
 * another application and can be missing, mid-write while Wallpaper Engine saves,
 * or shaped differently by a version this app has never seen. Each of those means
 * "no wallpaper", not an error the settings page should display. The rules for
 * reading it - exact path first, never a `recent` entry - live in
 * `selectedWallpaperFiles`.
 */
function configWallpaperFiles(engineDir: string): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(engineDir, 'config.json'), 'utf8'))
    return selectedWallpaperFiles(raw)
  } catch {
    return []
  }
}

/**
 * The project directory a wallpaper file belongs to.
 *
 * `config.json` names a file, not a project: the current wallpaper is
 * `.../431960/<id>/scene.pkg` for a Workshop item and
 * `.../projects/myprojects/<name>/video.mp4` for a local one. Walking up to the
 * directory that holds `project.json` is the direct answer. A project that ships
 * no manifest still has its Workshop id in the path, and that id is what the scan
 * used to list it, so the scanned project is found from the id.
 *
 * The walk stops after a few levels and at the root: the file may point outside
 * every library the scan looked at (an uninstalled item, a moved folder), and
 * climbing to `C:\` to find nothing is not useful.
 */
function projectDirForFile(file: string, projects: ScannedProject[]): string | null {
  let dir = path.dirname(path.resolve(file))
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'project.json'))) return dir.toLowerCase()
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const workshop = /(?:^|[\\/])431960[\\/]([^\\/]+)/.exec(file)
  const listed = workshop ? projects.find((project) => project.id === workshop[1]) : undefined
  return listed ? listed.dir.toLowerCase() : null
}

/** One string field of a JSON document, or null when it is absent or another type. */
function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * A project's `project.json`, or null.
 *
 * A missing manifest is the normal case for a loose media folder the user
 * dropped into `projects`, so it is not an error; a corrupt one simply makes the
 * project unusable and drops it from the list.
 */
function readManifest(dir: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
    // A manifest that is not an object exposes no fields, and treating it as
    // absent is the same outcome as reading every field as undefined.
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The customizable properties a manifest declares.
 *
 * Wallpaper Engine puts them at `general.properties`; every other shape is one
 * this app has never seen, and for a third-party manifest that means "no
 * properties" rather than an error the settings page should show.
 */
function manifestProperties(manifest: Record<string, unknown>): WallpaperProperty[] {
  const general = manifest.general
  if (!general || typeof general !== 'object' || Array.isArray(general)) return []
  return editableProperties((general as Record<string, unknown>).properties)
}

/**
 * Turn one project directory into an entry.
 *
 * The order of the fallbacks matters and comes from the real library: a scene
 * project may declare `file: "scene.json"` while shipping only `scene.pkg` (the
 * loose JSON is stripped by the Workshop publisher), and a video wallpaper may
 * declare nothing at all.
 */
function readProject(dir: string, id: string): ScannedProject | null {
  const manifest = readManifest(dir)

  if (!manifest) {
    // No manifest at all: only a loose media folder can still be useful.
    const media = firstDirectoryMedia(dir)
    if (!media) return null
    return {
      id,
      dir,
      title: path.basename(dir),
      // The no-manifest branch is its own rule, not classifyKind: a loose folder
      // is either a video or a still, never a web scene.
      kind: isVideoFile(media) ? 'video' : 'image',
      entry: media,
      preview: null,
      // A loose media folder has no manifest, so it has nothing to configure.
      properties: [],
      declaredType: null
    }
  }

  const declaredType = stringField(manifest, 'type')
  const preset =
    manifest.preset && typeof manifest.preset === 'object'
      ? (manifest.preset as Record<string, unknown>)
      : null

  const entry = pickEntry(
    dir,
    [
      stringField(manifest, 'file'),
      'scene.pkg',
      'scene.json',
      ...firstDirectoryMediaCandidates(dir)
    ],
    fs.existsSync
  )
  const preview =
    pickEntry(
      dir,
      [
        stringField(manifest, 'preview'),
        stringField(preset, 'background'),
        'preview.jpg',
        'preview.png',
        'preview.gif'
      ],
      fs.existsSync
    ) ?? firstDirectoryImage(dir)

  return {
    id,
    dir,
    title: stringField(manifest, 'title') ?? path.basename(dir),
    kind: classifyKind(declaredType, entry),
    // A scene entry is the .pkg/scene.json; keeping it lets the protocol
    // distinguish "container" from "media" without re-reading the manifest.
    entry,
    preview,
    // Filled from the manifest already in hand: listing 52 wallpapers must not
    // re-open 52 project.json files just to learn their settings.
    properties: manifestProperties(manifest),
    declaredType: declaredType ? declaredType.toLowerCase() : null
  }
}

/** Loose media files in a project directory, in directory order. */
function firstDirectoryMediaCandidates(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (isVideoFile(entry.name) || isWebFile(entry.name)))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** The first loose media file in a project directory, or null. */
function firstDirectoryMedia(dir: string): string | null {
  const candidates = firstDirectoryMediaCandidates(dir)
  return candidates.length > 0 ? candidates[0] : null
}

/** The first still image in a project directory, or null. */
function firstDirectoryImage(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && isImageFile(entry.name)) return entry.name
    }
  } catch {
    /* unreadable directory */
  }
  return null
}

/** The subdirectories of one directory, as absolute paths. */
function listDirectories(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
  } catch {
    return []
  }
}

/**
 * Every project the engine knows about.
 *
 * Two sources, both read-only: the Workshop subscriptions and the loose
 * projects the user built or imported. A directory can be reachable through both
 * when someone also keeps a copy under `projects`, so the first id that resolved
 * wins and the directory is only read once.
 */
function scanEngine(engineDir: string, libraries: string[]): ScannedProject[] {
  const projects: ScannedProject[] = []
  const seen = new Set<string>()

  const add = (dir: string, id: string): void => {
    const key = dir.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const project = readProject(dir, id)
    if (project) projects.push(project)
  }

  // Workshop subscriptions: one directory per item, named by its published id,
  // under `steamapps/workshop/content/431960` in whichever library holds them.
  // Steam can spread one subscription set across libraries, so every library is
  // walked; `add` de-duplicates a project that is somehow reachable twice.
  for (const library of libraries) {
    const workshopRoot = path.join(library, 'steamapps', 'workshop', 'content', '431960')
    for (const dir of listDirectories(workshopRoot)) add(dir, path.basename(dir))
  }

  // Loose projects the user built or imported themselves.
  for (const folder of ['myprojects', 'defaultprojects', 'projects']) {
    for (const dir of listDirectories(path.join(engineDir, 'projects', folder))) {
      add(dir, `local-${path.basename(dir)}`)
    }
  }

  // Chinese titles arrive in pinyin and ASCII ones in place; zh-Hans-CN is the
  // locale this app is written for.
  projects.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  return projects
}

/**
 * The scan cache.
 *
 * The settings page and the backdrop both ask for this, and the backdrop asks
 * again whenever the window regains focus, so the TTL keeps a focus change from
 * re-walking a Steam library. `force` is what the renderer uses when the user
 * clicks refresh, and when the wallpaper may have changed while the player
 * stayed open.
 */
function scan(force = false): ScanState {
  const now = Date.now()
  if (!force && scanCache && now - scanCache.at < SCAN_TTL_MS) return scanCache

  // Resolved once: the registry probe and the vdf reads are the expensive part,
  // and the engine lookup and the Workshop walk must agree on the same roots.
  const libraries = steamLibraries()
  const engineDir = findEngineDir(libraries)
  let projects: ScannedProject[] = []
  const currentDirs: string[] = []

  if (engineDir) {
    projects = scanEngine(engineDir, libraries)
    // One file per monitor, and two displays may show the same wallpaper, so the
    // directory list is de-duplicated before any entry is marked current.
    for (const file of configWallpaperFiles(engineDir)) {
      const dir = projectDirForFile(file, projects)
      if (dir !== null && !currentDirs.includes(dir)) currentDirs.push(dir)
    }
  }

  scanCache = { at: now, engineDir, projects, currentDirs }
  projectById = new Map(projects.map((project) => [project.id, project]))
  return scanCache
}

/**
 * `aurora-wallpaper://wp/<id>/<path>` for one file of a project.
 *
 * The id is escaped as one segment and each path segment is percent-encoded, so
 * an entry that lives in a subdirectory still works. A project's base URL (no
 * file) is what the scene engine is given: a scene resolves everything else
 * relative to it.
 */
function toUrl(id: string, file: string | null): string {
  const base = `${WALLPAPER_SCHEME}://wp/${encodeId(id)}`
  if (!file) return base
  const rel = file.split(/[\\/]/).map(encodeURIComponent).join('/')
  return `${base}/${rel}`
}

/**
 * Everything the settings page needs: one row per project, with a preview the
 * renderer can put in an `<img>` and a base URL it can hand to the scene engine.
 */
export function wallpaperList(force = false): WallpaperEntry[] {
  const { projects, currentDirs } = scan(force)
  return projects.map((project) => ({
    id: project.id,
    title: project.title,
    kind: project.kind,
    previewUrl: project.preview ? toUrl(project.id, project.preview) : null,
    sourceUrl: toUrl(project.id, null),
    entryUrl: project.kind !== 'scene' && project.entry ? toUrl(project.id, project.entry) : null,
    hasPackage: project.kind === 'scene' && project.entry !== null && /\.pkg$/i.test(project.entry),
    properties: project.properties,
    current: currentDirs.includes(project.dir.toLowerCase())
  }))
}

/** What to put behind the app right now: one wallpaper, or a reason there is none. */
export function wallpaperInfo(force = false): WallpaperInfo {
  const { engineDir, projects, currentDirs } = scan(force)

  if (!engineDir) {
    return {
      found: false,
      kind: 'none',
      title: '',
      src: null,
      properties: [],
      note: '没有找到 Wallpaper Engine 的安装（Steam 库中没有 wallpaper_engine 目录）。',
      engineDir: null
    }
  }

  // The backdrop is one image behind one window, so the first monitor's
  // wallpaper is the one it shows; the settings page still sees every current
  // entry, because wallpaperList marks them all.
  let current: ScannedProject | undefined
  for (const dir of currentDirs) {
    current = projects.find((project) => project.dir.toLowerCase() === dir)
    if (current) break
  }

  if (!current) {
    return {
      found: false,
      kind: 'none',
      title: '',
      src: null,
      properties: [],
      note: '找到了 Wallpaper Engine，但配置里没有当前壁纸。',
      engineDir
    }
  }

  return {
    found: true,
    kind: current.kind,
    title: current.title,
    // A scene is rendered from its preview until the engine has loaded the
    // container; a video or web wallpaper plays its entry directly.
    src: toUrl(current.id, current.kind === 'scene' ? current.preview : current.entry),
    // The settings page may only ever call info, so the current wallpaper's
    // controls come with it instead of forcing a second list call.
    properties: current.properties,
    note: '',
    engineDir
  }
}

/**
 * Resolve an id to its project directory.
 *
 * The index first: a scanned project's directory does not move, so serving a
 * preview does not need a fresh scan. Only an id that was never seen - a project
 * installed after the last scan - falls through to `scan()`, which then reads
 * the library at most once per TTL.
 */
function projectDirectory(id: string): ScannedProject | null {
  const known = projectById.get(id)
  if (known) return known
  const { projects } = scan()
  return projects.find((project) => project.id === id) ?? null
}

/** The slice of Electron's protocol module this file uses. */
interface ElectronProtocol {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
}

/**
 * Electron is loaded lazily, here, for the same reason the remote proxy does it:
 * it keeps the scanner importable from a plain Node process, where a top-level
 * `import { protocol } from 'electron'` resolves to a path string and throws.
 */
function electronProtocol(): { protocol: ElectronProtocol } {
  return require('electron') as { protocol: ElectronProtocol }
}

/**
 * Register the wallpaper scheme as standard, secure, CORS-enabled and streaming.
 *
 * Must run before `app.ready`, exactly like the media and remote schemes: the
 * privileges are what make range requests work, and a looping video wallpaper
 * issues one range request per loop.
 */
export function registerWallpaperScheme(): void {
  const { protocol } = electronProtocol()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/**
 * Bytes kept in front of the disk.
 *
 * Everything the protocol serves is small except the scene container: previews,
 * `scene.json`, a web wallpaper's assets. Those small files are what the
 * settings page asks for again and again - one request per tile, and every
 * re-mount of the pane asks for every tile again - so the last five minutes of
 * them are held in memory. The scene container is the exception: it runs to
 * hundreds of megabytes and is always streamed. Re-reading it is not what makes
 * a scene slow - decoding it is - and the operating system's page cache already
 * serves a second read, so a copy in this process would cost memory for nothing.
 */
const FILE_CACHE_TTL_MS = 5 * 60_000
const FILE_CACHE_MAX_FILE_BYTES = 8 * 1024 * 1024
// A large library's previews add up to a few tens of megabytes (fifty-two here,
// thirty-seven in total), so the budget is sized to hold a whole pane once rather
// than to evict it halfway through the next mount.
const FILE_CACHE_MAX_TOTAL_BYTES = 48 * 1024 * 1024

interface CachedFile {
  at: number
  data: Buffer
}

const fileCache = new Map<string, CachedFile>()
let fileCacheBytes = 0

/** Windows paths are case-insensitive, so two spellings must hit the same entry. */
function cacheKey(file: string): string {
  return file.toLowerCase()
}

/**
 * The cached bytes for a file, or null when there are none or they have expired.
 *
 * A hit deliberately does not stat the file: the whole point is to answer a
 * thumbnail without touching the disk. The price is that a project edited in
 * place can be served stale for up to the TTL, which is the trade the five
 * minute window makes.
 */
function cachedFile(file: string): Buffer | null {
  const key = cacheKey(file)
  const entry = fileCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at >= FILE_CACHE_TTL_MS) {
    fileCache.delete(key)
    fileCacheBytes -= entry.data.byteLength
    return null
  }
  return entry.data
}

/** Store one small file, evicting the oldest entries once the budget is full. */
function rememberFile(file: string, data: Buffer): void {
  if (data.byteLength > FILE_CACHE_MAX_TOTAL_BYTES) return
  const key = cacheKey(file)
  const previous = fileCache.get(key)
  if (previous) {
    fileCacheBytes -= previous.data.byteLength
    fileCache.delete(key)
  }
  fileCache.set(key, { at: Date.now(), data })
  fileCacheBytes += data.byteLength
  // A Map iterates in insertion order, so the first keys are the oldest.
  for (const [oldKey, old] of fileCache) {
    if (fileCacheBytes <= FILE_CACHE_MAX_TOTAL_BYTES) break
    if (oldKey === key) break
    fileCache.delete(oldKey)
    fileCacheBytes -= old.data.byteLength
  }
}

const WALLPAPER_HEADERS = {
  'access-control-allow-origin': '*',
  'accept-ranges': 'bytes'
}

/**
 * Images are the tiled library: fifty-two `<img>` requests every time the pane
 * mounts. Letting Chromium keep them for the same five minutes the memory cache
 * uses means a re-mount does not even reach the protocol handler. Everything
 * else stays uncached - a video wallpaper loops with range requests, and the
 * scene container is large enough that a stale copy would be worse than a read.
 */
const IMAGE_CACHE_CONTROL = 'public, max-age=300'

/** The response headers every status of this scheme carries. */
function headersFor(type: string, cacheable: boolean): Record<string, string> {
  return {
    ...WALLPAPER_HEADERS,
    'content-type': type,
    'cache-control': cacheable && type.startsWith('image/') ? IMAGE_CACHE_CONTROL : 'no-store'
  }
}

/**
 * One megabyte per read instead of Node's 64 KiB default.
 *
 * The scene container is the one file that is always streamed and always big, so
 * the default chunk size turns every mount into a couple of thousand tiny
 * allocations: measurable V8 heap-page growth and external Buffer churn, even
 * though the bytes themselves are collectable at once. A larger read cuts that
 * by an order of magnitude. It stays a rounding error against the response, and
 * a range request shorter than the chunk still reads only the bytes it asked for,
 * so the 206 path is unaffected.
 */
const STREAM_CHUNK_BYTES = 1024 * 1024

/** A file as a web stream, which is what a `Response` body takes. */
function bodyOf(file: string, start?: number, end?: number): WebReadableStream {
  const options: { highWaterMark: number; start?: number; end?: number } = {
    highWaterMark: STREAM_CHUNK_BYTES
  }
  if (start !== undefined) options.start = start
  if (end !== undefined) options.end = end
  return Readable.toWeb(fs.createReadStream(file, options)) as WebReadableStream
}

type RangeResolution =
  | { kind: 'whole' }
  | { kind: 'invalid' }
  | { kind: 'partial'; start: number; end: number }

/**
 * `bytes=start-end`, where either side may be omitted.
 *
 * The suffix form (`bytes=-N`) counts from the end, which is what a media
 * element asks for when it wants the header of a video without downloading it.
 */
function resolveRange(request: Request, size: number): RangeResolution {
  const range = request.headers.get('range')
  if (!range) return { kind: 'whole' }

  const match = /bytes=(\d*)-(\d*)/.exec(range)
  if (!match || (match[1] === '' && match[2] === '')) return { kind: 'invalid' }

  let start: number
  let end: number
  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number.parseInt(match[2], 10)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number.parseInt(match[1], 10)
    end = match[2] === '' ? size - 1 : Math.min(Number.parseInt(match[2], 10), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { kind: 'invalid' }
  }
  return { kind: 'partial', start, end }
}

function rangeNotSatisfiable(type: string, size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { ...headersFor(type, false), 'content-range': `bytes */${size}` }
  })
}

/** Answer from memory: a small file is sliced without touching the disk. */
function bufferedResponse(target: string, request: Request, data: Buffer): Response {
  const type = mimeFor(target)
  const range = resolveRange(request, data.byteLength)

  if (range.kind === 'invalid') return rangeNotSatisfiable(type, data.byteLength)

  if (range.kind === 'whole') {
    return new Response(data, {
      status: 200,
      headers: { ...headersFor(type, true), 'content-length': String(data.byteLength) }
    })
  }

  const slice = data.subarray(range.start, range.end + 1)
  return new Response(slice, {
    status: 206,
    headers: {
      ...headersFor(type, false),
      'content-length': String(slice.byteLength),
      'content-range': `bytes ${range.start}-${range.end}/${data.byteLength}`
    }
  })
}

/**
 * Stream one large file out of a project, honouring a range request.
 *
 * A video wallpaper loops and Chromium asks for a range per loop, and a scene
 * container is hundreds of megabytes, so buffering either per request would be
 * both slow and dangerous.
 */
function streamedResponse(target: string, request: Request, size: number): Response {
  const type = mimeFor(target)
  const range = resolveRange(request, size)

  if (range.kind === 'invalid') return rangeNotSatisfiable(type, size)

  if (range.kind === 'whole') {
    return new Response(bodyOf(target), {
      status: 200,
      headers: { ...headersFor(type, false), 'content-length': String(size) }
    })
  }

  return new Response(bodyOf(target, range.start, range.end), {
    status: 206,
    headers: {
      ...headersFor(type, false),
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${size}`
    }
  })
}

/**
 * Serve one file: from memory when it is small and was read recently, from the
 * disk otherwise. A miss stats once and reads a small file whole; a file over
 * the per-file limit is never read into memory and is streamed instead.
 */
async function serveFile(target: string, request: Request): Promise<Response> {
  const cached = cachedFile(target)
  if (cached) return bufferedResponse(target, request, cached)

  let size: number
  try {
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) return new Response('not a file', { status: 404 })
    size = stat.size
  } catch {
    return new Response('not found', { status: 404 })
  }

  if (size > FILE_CACHE_MAX_FILE_BYTES) return streamedResponse(target, request, size)

  let data: Buffer
  try {
    data = await fs.promises.readFile(target)
  } catch {
    return new Response('not found', { status: 404 })
  }
  rememberFile(target, data)
  return bufferedResponse(target, request, data)
}

/**
 * Serve `aurora-wallpaper://wp/<id>/<relative path>`.
 *
 * The renderer never sees a file system path: it names a project id and a
 * relative path, and this resolves the pair back to a file. The containment
 * check is the whole security model - a Workshop project is third-party input,
 * and a path that escapes its own project directory is refused before the file
 * system is asked about it.
 */
export function handleWallpaperProtocol(): void {
  const { protocol } = electronProtocol()
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('bad url', { status: 400 })
    }

    if (url.host !== 'wp') return new Response('not found', { status: 404 })

    const segments = url.pathname.replace(/^\/+/, '').split('/')
    const id = decodeId(segments.shift() ?? '')
    if (!id) return new Response('bad request', { status: 400 })

    const project = projectDirectory(id)
    if (!project) return new Response('unknown wallpaper', { status: 404 })

    // Each segment was percent-encoded by toUrl, so it is decoded again here. An
    // empty remainder is the project's base URL: that resolves to the directory,
    // which the containment rule allows and the file check refuses.
    const dir = project.dir
    const rel = segments.map((segment) => decodeURIComponent(segment)).join('/')
    const target = rel ? path.resolve(dir, rel) : path.resolve(dir)
    if (!isInside(dir, target)) return new Response('forbidden', { status: 403 })

    return serveFile(target, request)
  })
}
