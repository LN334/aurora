import path from 'node:path'

/**
 * The decisions behind the Wallpaper Engine backdrop, separated from the I/O.
 *
 * `electron/wallpaper.ts` is the half that touches the disk, the Windows
 * registry and Chromium. Everything here is a pure function, which is what makes
 * the rules testable under `node --test` on a machine with no Wallpaper Engine,
 * no Steam library and no Electron runtime.
 *
 * The split is not cosmetic. Two of these rules are security boundaries - "an
 * entry path must stay inside its project" and "a served path must stay inside
 * its project" - and a boundary is exactly the thing that has to be tested
 * against the strings an attacker would send, not only against the happy path a
 * protocol handler makes easy to reach.
 */

/** What kind of thing a project is, as far as the renderer is concerned. */
export type WallpaperKind = 'video' | 'web' | 'image' | 'scene'

/**
 * The extensions Wallpaper Engine projects actually ship.
 *
 * These live here, not in the scanner, because `classifyKind` and the directory
 * probes in `wallpaper.ts` have to agree: a `.webm` counted as a video in one
 * place and as an unknown in the other would make a project playable but
 * invisible, or the reverse.
 */
const VIDEO_EXT = /\.(mp4|webm|mkv|avi|mov|m4v)$/i
const WEB_EXT = /\.(html?|js)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i

/** True when this name is a video Wallpaper Engine can play directly. */
export function isVideoFile(name: string): boolean {
  return VIDEO_EXT.test(name)
}

/** True when this name is a web scene (a document or the script it loads). */
export function isWebFile(name: string): boolean {
  return WEB_EXT.test(name)
}

/** True when this name is a still image, which is also a preview candidate. */
export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}

/** Every content type a project can contain, by extension. */
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.pkg': 'application/octet-stream',
  '.tex': 'application/octet-stream',
  '.ktx2': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
}

/**
 * The content type for a served file.
 *
 * The renderer decides how to consume a response from this header alone: a
 * `scene.pkg` has to arrive as an opaque byte stream, a `.js` scene as script,
 * a `.html` scene as a document. The table is deliberately closed - an unknown
 * extension becomes `application/octet-stream`, so Chromium hands the bytes to
 * the caller instead of guessing a type and refusing to sniff.
 */
export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * What a project is, given what its manifest declared and what was found on disk.
 *
 * The priority is the real library's, not an ideal one:
 *
 *  1. an explicit `type` of `video`/`web`, or `image`/`gif`, wins outright - the
 *     manifest is the only thing that knows a scene container is a video
 *     wallpaper;
 *  2. otherwise the entry file's extension decides - a video wallpaper often
 *     declares nothing at all;
 *  3. otherwise it is a scene, because that is what the engine renders.
 *
 * Boundary: `entry` arrives already resolved (fetching it is I/O), so this only
 * looks at the name. It is null when the project ships no readable entry, and a
 * project with no entry is still a scene - the engine may render it from the
 * package next to it.
 */
export function classifyKind(declaredType: string | null, entry: string | null): WallpaperKind {
  // Manifests are hand-written, so their spelling is not trusted.
  const declared = declaredType ? declaredType.toLowerCase() : null
  if (declared === 'video' || declared === 'web') return declared
  if (declared === 'image' || declared === 'gif') return 'image'

  if (entry) {
    if (isVideoFile(entry)) return 'video'
    if (isWebFile(entry)) return 'web'
    if (isImageFile(entry)) return 'image'
  }

  return 'scene'
}

/**
 * Whether `target` is `dir` itself or lives under it.
 *
 * This is the containment rule behind `aurora-wallpaper://`: the renderer names
 * a path segment and this decides whether the main process will open it at all.
 * The comparison is case-insensitive because Windows paths are, and `dir` itself
 * is allowed because a project's own directory is a legal base for a request
 * (which then fails the "is a file" check, not this one).
 *
 * Boundary: this is string arithmetic, not a file system check. Both arguments
 * must already be resolved - `path.resolve` collapses `..` before the call, and
 * handing an unresolved `..` to this function would defeat it, because
 * `.../demo/../../x` still starts with `.../demo/`. Only this platform's
 * separator is recognised.
 */
export function isInside(dir: string, target: string): boolean {
  const base = dir.toLowerCase()
  const candidate = target.toLowerCase()
  if (candidate === base) return true

  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  return candidate.startsWith(prefix)
}

/**
 * The first candidate that exists and stays inside `dir`, or null.
 *
 * `project.json` names its entry and its preview by relative path, and a
 * Workshop project is third-party input: `"file": "../../../Windows/win.ini"`
 * must never become a file this app serves. Every candidate is therefore
 * resolved and checked against `dir` *before* its existence is asked about, so a
 * hostile path never reaches the file system.
 *
 * `exists` is a parameter rather than `fs.existsSync` so the rule can be tested
 * without a file system, and so the caller keeps the single place that touches
 * the disk.
 *
 * The candidate comes back exactly as it was written (separators included), not
 * as the resolved path: the caller turns it into a URL, and re-encoding a
 * normalised path would change the shape of that URL.
 *
 * Boundary: unlike `isInside`, the directory itself never counts as an entry.
 * That is the reference implementation's `firstExisting` behaviour - a candidate
 * of `.` resolves to the project directory and must be skipped rather than
 * returned as the thing to play.
 */
export function pickEntry(
  dir: string,
  candidates: readonly (string | null | undefined)[],
  exists: (target: string) => boolean
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue

    const target = path.resolve(dir, candidate)
    if (!isInside(dir, target)) continue
    if (target.toLowerCase() === dir.toLowerCase()) continue
    if (exists(target)) return candidate
  }
  return null
}

/**
 * Encode a project id as one URL path segment.
 *
 * Workshop ids are numeric, but a local project's id is `local-<folder name>`,
 * so spaces, brackets and non-ASCII characters can appear. Everything outside
 * `[A-Za-z0-9_-]` is percent-escaped; those characters need no escape and are
 * left alone, which keeps the common ids readable in a URL and in a log.
 *
 * Boundary: the escape writes one `%XXXX` per UTF-16 code unit, while
 * `decodeURIComponent` reads `%XX` as *bytes*. An ASCII id therefore round-trips
 * exactly and a non-ASCII one does not - `中` becomes `%4E2D` and comes back as
 * `N2D`. That is inherited from 0.3.6 verbatim. The ids that reach a URL in
 * practice are numeric Workshop ids and `local-` plus an ASCII folder name; the
 * limitation is documented and pinned by a test instead of being fixed here,
 * because changing the escape would change the URL shape the renderer builds.
 */
export function encodeId(id: string): string {
  return id
    .split('')
    .map((char) =>
      /[a-zA-Z0-9_-]/.test(char) ? char : `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    )
    .join('')
}

/**
 * Decode one id path segment back to the project id.
 *
 * A segment that is not valid percent-encoding is returned unchanged: it can
 * only come from a hand-edited URL or a stale link, and the project lookup will
 * simply miss rather than the request throwing.
 */
export function decodeId(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * The library paths listed in a Steam `libraryfolders.vdf`.
 *
 * Wallpaper Engine ships as Steam app 431960, so it can sit on any drive the
 * user keeps a Steam library on; this file is the authority for which drives
 * those are. Only the `"path"` values are wanted, so this is a targeted regex
 * rather than a VDF parser - VDF has no escaping beyond the doubled backslashes
 * a Windows path brings with it, and those are restored here.
 *
 * Boundary: the caller does the read (that is I/O) and adds the Steam root
 * itself. This returns only what the file lists, in file order, with duplicates
 * removed - an unreadable or absent file is the caller's empty result, not an
 * error here.
 */
export function parseLibraryFolders(vdfText: string): string[] {
  const found = new Set<string>()
  for (const match of vdfText.matchAll(/"path"\s*"([^"]+)"/gi)) {
    found.add(match[1].replace(/\\\\/g, '\\'))
  }
  return [...found]
}

/**
 * The wallpaper files assigned to a monitor, from a parsed `config.json`.
 *
 * Wallpaper Engine keeps them at
 * `<account>.general.wallpaperconfig.selectedwallpapers`, one entry per monitor
 * (`Monitor0`, `Monitor1`...), and each entry's `file` is the path of the
 * wallpaper on disk. The account segment is a Windows user name or a numeric
 * Steam account id, and there is no list of valid names, so every top-level
 * object is tried.
 *
 * The precise path matters. The same document also holds
 * `general.wallpaperconfigrecent` - the ten most recent wallpapers - and each of
 * those carries its own `selectedwallpapers` map. A blind depth-first walk
 * therefore reports a wallpaper the user switched away from as if it were on the
 * desktop right now. The walk exists only as a fallback for a document whose
 * shape differs from the one this machine has, and it skips any subtree whose key
 * mentions `recent`.
 *
 * Boundary: the 5000-node guard bounds a file owned by another application - a
 * corrupt or hostile config must not turn a settings read into an unbounded walk.
 * Duplicate paths are dropped, and the order is account order then monitor order,
 * so `Monitor0` is first for the one display the backdrop follows.
 */
export function selectedWallpaperFiles(config: unknown, maxNodes = 5000): string[] {
  const files: string[] = []
  const seen = new Set<string>()

  const push = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) return
    if (seen.has(value)) return
    seen.add(value)
    files.push(value)
  }

  // One `selectedwallpapers` map: every monitor in the order the engine wrote it.
  const collect = (selected: unknown): void => {
    const record = asRecord(selected)
    if (!record) return
    for (const monitor of Object.values(record)) push(asRecord(monitor)?.file)
  }

  // The exact path first: <account>.general.wallpaperconfig.selectedwallpapers.
  // Profile-named sections are read before numeric ones: JavaScript enumerates
  // integer-like keys first, so a numeric Steam-account section would otherwise
  // come before the section the engine writes for the Windows user, and the
  // backdrop would follow the other account's monitor.
  for (const account of orderedAccounts(asRecord(config) ?? {})) {
    const general = asRecord(account.general)
    collect(asRecord(asRecord(general?.wallpaperconfig)?.selectedwallpapers))
  }
  if (files.length > 0) return files

  // Fallback: look for the same shape anywhere, never inside a "recent" subtree.
  const stack: unknown[] = [config]
  let guard = 0
  while (stack.length > 0 && guard < maxNodes) {
    guard += 1
    const record = asRecord(stack.pop())
    if (!record) continue

    for (const [key, value] of Object.entries(record)) {
      const name = key.toLowerCase()
      if (name.includes('recent')) continue
      if (name === 'selectedwallpapers') {
        collect(value)
        continue
      }
      if (asRecord(value)) stack.push(value)
    }
  }

  return files
}

/**
 * The account sections of a config, the Windows-profile one first.
 *
 * Boundary: which section belongs to the account that is logged in cannot be
 * read from the file; this is an ordering heuristic, not a judgement about the
 * user. Every section is still read, so a machine whose only section is numeric
 * behaves exactly the same.
 */
function orderedAccounts(config: Record<string, unknown>): Record<string, unknown>[] {
  const isNumeric = (name: string): boolean => /^\d+$/.test(name)
  return Object.entries(config)
    .sort(([a], [b]) => Number(isNumeric(a)) - Number(isNumeric(b)))
    .map(([, value]) => asRecord(value) ?? {})
}

/** The same value as an object, or null when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

