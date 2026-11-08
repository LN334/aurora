/**
 * Filesystem-safe form of a profile id.
 *
 * Profile ids are generated in the renderer (`acc_...`) and arrive here over
 * IPC, so they are untrusted input on their way into a file name. Only the
 * characters that cannot escape a directory survive; everything else becomes an
 * underscore.
 *
 * Cleaning alone is not enough: `a/b` and `a_b` would both become `a_b` and
 * two profiles would share one library file. Whenever anything was replaced, a
 * stable hash of the *original* id is appended, so distinct ids always produce
 * distinct names.
 */

const MAX_LENGTH = 48

export function profileFileStem(id: string | null | undefined): string {
  const raw = typeof id === 'string' ? id.trim() : ''
  if (!raw) return 'default'

  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '_')
  if (cleaned === raw && raw.length <= MAX_LENGTH) return cleaned

  const head = cleaned.slice(0, MAX_LENGTH) || 'profile'
  return `${head}-${hash36(raw)}`
}

/** FNV-1a, the same helper the daily pick uses. Deterministic across runs. */
function hash36(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** The profile every install starts on, and the fallback for an empty id. */
export const DEFAULT_PROFILE = 'default'
