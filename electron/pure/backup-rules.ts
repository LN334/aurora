/**
 * Shared storage of the backup file.
 *
 * The file is the one piece of this app that leaves the machine, so the shape is
 * fixed and versioned here rather than decided at the call site: a stamped name,
 * a handful of JSON files, and the renderer's persisted keys.
 *
 * Session files are deliberately absent. They hold platform cookies, they are
 * useless on another machine, and a backup that carries them is a credential
 * dump pretending to be a convenience.
 */

export const BACKUP_FORMAT = 'aurora-backup'
export const BACKUP_VERSION = 1

/** Files in the data directory that belong to the person, not to the runtime. */
export const BACKUP_FILES = [
  'settings.json',
  'library.json',
  'window-state.json',
  'qishui-refs.json'
] as const

/** A backup above this size is either corrupt or not ours. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024

interface BackupBundle {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string
  /** File name in the data directory -> its exact contents. */
  files: Record<string, string>
  /** localStorage key -> value. */
  storage: Record<string, string>
}

interface BackupParseError {
  ok: false
  reason: string
}

type BackupParseResult = { ok: true; bundle: BackupBundle } | BackupParseError

/** `aurora-backup-20261116-0130.json` — sortable, and never overwrites silently. */
export function backupName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `aurora-backup-${date}-${time}.json`
}

export function buildBackup(
  files: Record<string, string>,
  storage: Record<string, string>,
  now: Date
): BackupBundle {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    files: onlyStrings(files),
    storage: onlyStrings(storage)
  }
}

/**
 * Read a backup file back.
 *
 * Anything suspicious is a refusal rather than a best effort: a half-understood
 * payload that overwrites live data is worse than no import at all.
 */
export function parseBackup(text: string): BackupParseResult {
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, reason: '这个文件太大，不像是备份' }
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: '这不是 JSON 文件' }
  }

  if (!isRecord(value)) return { ok: false, reason: '备份内容不是对象' }
  if (value.format !== BACKUP_FORMAT) return { ok: false, reason: '这不是 Aurora 的备份文件' }

  const version = typeof value.version === 'number' ? value.version : 0
  if (!Number.isFinite(version) || version < 1) return { ok: false, reason: '备份缺少版本号' }
  if (version > BACKUP_VERSION) return { ok: false, reason: '这份备份来自更新的版本，请升级后再导入' }

  const files = value.files
  const storage = value.storage
  if (!isRecord(files) || !isRecord(storage)) return { ok: false, reason: '备份里没有可导入的内容' }

  const keptFiles = onlyStrings(files)
  const keptStorage = onlyStrings(storage)
  if (Object.keys(keptFiles).length === 0 && Object.keys(keptStorage).length === 0) {
    return { ok: false, reason: '备份是空的' }
  }

  return {
    ok: true,
    bundle: {
      format: BACKUP_FORMAT,
      version,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      files: keptFiles,
      storage: keptStorage
    }
  }
}

/** One line for the dialog: what the file actually carries. */
export function describeBackup(bundle: BackupBundle): string {
  const fileCount = Object.keys(bundle.files).length
  const keyCount = Object.keys(bundle.storage).length
  const at = bundle.createdAt ? new Date(bundle.createdAt) : null
  const when =
    at && Number.isFinite(at.getTime())
      ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      : '时间未知'
  return `${when} · ${keyCount} 项本地数据 · ${fileCount} 个文件`
}

/** Only the file names we own are written back; a stray key cannot invent a path. */
export function filesToRestore(bundle: BackupBundle): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of BACKUP_FILES) {
    const value = bundle.files[name]
    if (typeof value === 'string') out[name] = value
  }
  return out
}

function onlyStrings(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && key.length > 0) out[key] = value
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
