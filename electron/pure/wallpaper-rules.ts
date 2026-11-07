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
 * The kinds of control a wallpaper's settings can expose.
 *
 * Wallpaper Engine's project editor writes these into `project.json` under
 * `general.properties`, and they are exactly the values the engine lets a user
 * change after subscribing: sliders, colours, switches, text fields and combos.
 */
export type WallpaperPropertyType = 'slider' | 'bool' | 'color' | 'textinput' | 'combo'

/**
 * One customizable option a wallpaper declares for itself.
 *
 * A Workshop wallpaper is third-party input: the keys, the labels (which are
 * full of author-written HTML) and the values are all unvalidated. This is the
 * shape after that input has been read once and checked here, so the renderer
 * can draw a control without re-validating anything.
 */
export interface WallpaperProperty {
  /** The `general.properties` key, for example `glow` or `_21`. */
  name: string
  type: WallpaperPropertyType
  /** The label shown next to the control, with the author's markup removed. */
  text: string
  /** The project's saved value: where the control starts. */
  value: boolean | number | string
  /** A slider's range, when the project declares one. */
  min?: number
  max?: number
  step?: number
  /** A combo's choices, in the order the author wrote them. */
  options?: { label: string; value: string }[]
}

/**
 * The only types that are controls.
 *
 * `text` (and `file`/`directory`/`group`) are dropped on purpose: `text` is the
 * author's HTML banner, not something to change, and the others are pickers this
 * app does not implement. Showing a control that cannot work is worse than not
 * showing it.
 */
const EDITABLE_PROPERTY_TYPES = new Set<string>(['slider', 'bool', 'color', 'textinput', 'combo'])

/**
 * Wallpaper Engine's own colour scheme, which is not a wallpaper setting.
 *
 * `schemecolor` colours the wallpaper's configuration window; the engine's editor
 * never offers it as a control, and it sorts first in real projects (order 100),
 * so keeping it would put a non-control at the top of the settings list.
 */
const SCHEME_COLOR_KEY = 'schemecolor'

/** The longest label that still fits the settings row next to its control. */
const MAX_LABEL_LENGTH = 60

/**
 * The controls a wallpaper declares, in the order the engine's editor shows them.
 *
 * The input is `general.properties` from a parsed `project.json` - any shape,
 * including missing, because a manifest is third-party input. Order comes from
 * the `order` field the engine writes, falling back to `index` and then to the
 * order of the keys in the file, which is the only ordering a hand-written
 * manifest has.
 *
 * Boundary: `condition` is not evaluated. A property whose `condition` is set
 * only appears when another property has a particular value, and that expression
 * language is Wallpaper Engine's; a control that is shown without its condition
 * being met would appear to do nothing. Those properties are dropped rather than
 * shown broken. For the same reason `schemecolor` is dropped - see above.
 */
export function editableProperties(raw: unknown): WallpaperProperty[] {
  const properties = asRecord(raw)
  if (!properties) return []

  const ordered: { property: WallpaperProperty; order: number }[] = []
  let position = 0
  for (const [name, entry] of Object.entries(properties)) {
    const property = readProperty(name, entry)
    if (property) ordered.push({ property, order: orderOf(asRecord(entry), position) })
    position += 1
  }

  // A stable sort: two properties the engine gave the same order keep the order
  // the manifest wrote them in, which is what the engine itself does.
  ordered.sort((a, b) => a.order - b.order)
  return ordered.map((item) => item.property)
}

/** One property, or null when it is not a control this app can show. */
function readProperty(name: string, entry: unknown): WallpaperProperty | null {
  const record = asRecord(entry)
  if (!record) return null
  if (name.toLowerCase() === SCHEME_COLOR_KEY) return null

  // A conditional property is only visible while some other value has a specific
  // setting; without evaluating that expression, showing it would be misleading.
  const condition = record.condition
  if (typeof condition === 'string' && condition.trim() !== '') return null

  const declared = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  if (!EDITABLE_PROPERTY_TYPES.has(declared)) return null
  const type = declared as WallpaperPropertyType

  const value = record.value
  if (value === undefined || value === null) return null

  const text = labelFor(name, record.text)
  // A label that is only the debris of an <img> tag is decoration, not a control
  // name; there is nothing useful to show next to the widget.
  if (text === null) return null

  switch (type) {
    case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      const property: WallpaperProperty = { name, type, text, value }
      const min = finiteNumber(record.min)
      const max = finiteNumber(record.max)
      const step = finiteNumber(record.step)
      if (min !== undefined) property.min = min
      if (max !== undefined) property.max = max
      if (step !== undefined) property.step = step
      return property
    }
    case 'bool':
      if (typeof value !== 'boolean') return null
      return { name, type, text, value }
    case 'color':
      // The engine stores a colour as three 0..1 floats in one string, and the
      // renderer turns that into an rgb(). Anything else is not a colour.
      if (typeof value !== 'string' || !isColorTriple(value)) return null
      return { name, type, text, value }
    case 'combo': {
      const options = readOptions(record.options)
      if (options.length === 0) return null
      return { name, type, text, value: String(value), options }
    }
    case 'textinput':
      // Authors sometimes write a number where a string is expected, and the
      // caller only needs to put it in an input's value.
      return { name, type, text, value: String(value) }
  }

  return null
}

/** The editor order of one property: `order`, then `index`, then file order. */
function orderOf(record: Record<string, unknown> | null, position: number): number {
  const order = finiteNumber(record?.order)
  if (order !== undefined) return order
  return finiteNumber(record?.index) ?? position
}

/** A finite number, or undefined for anything else (including NaN/Infinity). */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * True for the `"r g b"` triple Wallpaper Engine stores a colour as.
 *
 * The string is kept exactly as written; converting it to hex here would throw
 * away the precision the engine saved and the renderer needs no help splitting
 * three numbers.
 */
function isColorTriple(value: string): boolean {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 3) return false
  return parts.every((part) => {
    const channel = Number(part)
    return part !== '' && Number.isFinite(channel) && channel >= 0 && channel <= 1
  })
}

/** A combo's choices, keeping only the ones a control can show. */
function readOptions(value: unknown): { label: string; value: string }[] {
  if (!Array.isArray(value)) return []

  const options: { label: string; value: string }[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const optionValue =
      typeof record.value === 'string'
        ? record.value
        : typeof record.value === 'number'
          ? String(record.value)
          : null
    if (optionValue === null) continue
    // A combo without a label for one of its entries would render an empty row;
    // the value is a serviceable label because it is what the author wrote.
    const label =
      typeof record.label === 'string' && record.label.trim() !== '' ? record.label : optionValue
    options.push({ label, value: optionValue })
  }
  return options
}

/**
 * The label a control shows.
 *
 * Real projects write HTML into `text` (`<b>`, `<font>`, `<a>`, `<img>`,
 * `<br>`); the settings page renders plain text, so the markup is stripped here
 * rather than in every renderer. Authors also leave tags unterminated, so a tag
 * that runs to the end of the string is stripped as well. An empty result falls
 * back to the property name: a control with no label is unusable, and the name is
 * at least stable between restarts.
 *
 * Boundary: the 60 character cap is a plain truncation, not a word wrap, because
 * the settings row is a single line. The full label is not kept anywhere.
 */
function labelFor(name: string, text: unknown): string | null {
  if (typeof text !== 'string') return name

  const withoutTags = decodeEntities(text)
    .replace(/<[^>]*>/g, ' ')
    // An unterminated tag at the end of the author's string, e.g. `"<big"`.
    .replace(/<[a-zA-Z!/][^<>]*$/g, ' ')
  const collapsed = withoutTags.replace(/\s+/g, ' ').trim()
  // 剥完什么都不剩，而原文里本来就是一串图片/链接：这项的文案只有标记，没有话。
  if (collapsed === '') {
    return /img|src=|https?:|www\./i.test(text) ? null : name
  }
  /*
   * 有些作者把一张图片直接写成属性文案（`<img src="..." width=2000>`），而标签
   * 常常没闭合。上面的剥离会吃得干干净净，只剩 `imgsrchttp…width2000height2`
   * 这种压掉空格的残骸——它在设置页里是一行乱码，不是一个控件名。这种项直接
   * 不显示：真正能改的控件不会只有一个图片地址当名字。
   */
  if (looksLikeTagDebris(collapsed)) return null
  if (collapsed.length <= MAX_LABEL_LENGTH) return collapsed
  return collapsed.slice(0, MAX_LABEL_LENGTH)
}

/** 剥完标签的文案是不是一段 URL / 标签属性的残骸。 */
function looksLikeTagDebris(label: string): boolean {
  if (/[\u4e00-\u9fff]/.test(label)) return false
  const lower = label.toLowerCase()
  const mentionsMarkup =
    lower.includes('img') || lower.includes('src=') || lower.includes('http') || lower.includes('www.')
  if (!mentionsMarkup) return false
  // "Show image" 这种人写的短句仍然像话；只有又长又没空格、又全是 ASCII 词的才算残骸。
  return label.length > 24 && !label.includes(' ')
}

/** project.json 里的 `&nbsp;` 之类；设置页按纯文本渲染，实体留着就是字面量。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
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

