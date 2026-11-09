import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROFILE, profileFileStem } from './pure/profile-id'

/**
 * The part of the app that belongs to one profile rather than to the machine.
 *
 * Music folders are the obvious one: two profiles are two libraries, and a
 * shared folder list would mean adding a folder in one place silently changes
 * what the other profile sees. The list lives in its own file per profile so
 * that switching profiles cannot half-apply.
 */
interface LibraryPaths {
  /** Folders included in the library. */
  roots: string[]
  /** Paths skipped inside those folders. */
  excluded: string[]
  /**
   * Whether the one-time discovery pass has run for this profile.
   *
   * Without it an empty folder list on the next launch would look like "never
   * looked" and folders the user deliberately removed would come back.
   */
  rootsDiscovered: boolean
}

const EMPTY: LibraryPaths = { roots: [], excluded: [], rootsDiscovered: false }

let activeProfile = DEFAULT_PROFILE
let cache: LibraryPaths | null = null
/**
 * Whether the renderer has said which profile is active yet.
 *
 * Startup reads happen before the renderer knows its own account id, and one of
 * them would otherwise let the placeholder profile consume the pre-profile
 * library. Once the renderer has spoken, the placeholder is a real profile and
 * may claim it.
 */
let bound = false

function profilesDir(): string {
  return path.join(app.getPath('userData'), 'profiles')
}

function pathsFileFor(profile: string): string {
  return path.join(profilesDir(), `${profileFileStem(profile)}.json`)
}

/** Where this profile's scan cache lives. Kept beside its folder list. */
export function libraryIndexFile(profile: string = activeProfile): string {
  return path.join(profilesDir(), `${profileFileStem(profile)}.library.json`)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readProfileFile(profile: string): LibraryPaths | null {
  try {
    const raw = JSON.parse(fs.readFileSync(pathsFileFor(profile), 'utf8')) as Record<string, unknown>
    return {
      roots: strings(raw.roots),
      excluded: strings(raw.excluded),
      rootsDiscovered: raw.rootsDiscovered === true
    }
  } catch {
    return null
  }
}

function writeProfileFile(profile: string, value: LibraryPaths): void {
  const file = pathsFileFor(profile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/**
 * Hand the pre-profile library over to the first profile that asks.
 *
 * Builds before profiles kept one folder list for the whole machine in
 * settings.json. Whichever profile is active after the upgrade inherits that
 * list; profiles created afterwards start empty. The caller only reaches this
 * once the renderer has named its profile, because a read that happens before
 * that belongs to nobody and must not move anything.
 */
function adoptLegacyLibrary(profile: string): LibraryPaths | null {
  const marker = path.join(profilesDir(), '.library-adopted')
  if (fs.existsSync(marker)) return null

  const settingsFile = path.join(app.getPath('userData'), 'settings.json')
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
  } catch {
    raw = {}
  }

  const adopted: LibraryPaths = {
    roots: strings(raw.roots),
    excluded: strings(raw.excluded),
    rootsDiscovered: raw.rootsDiscovered === true
  }
  const hadLegacy = 'roots' in raw || 'excluded' in raw || 'rootsDiscovered' in raw

  // The folder list always moves; the old scan cache only moves when there is
  // one to move, and it stays usable because the folder list it was built from
  // is the same list.
  if (adopted.roots.length > 0 || adopted.excluded.length > 0 || adopted.rootsDiscovered) {
    writeProfileFile(profile, adopted)
  }

  if (hadLegacy) {
    delete raw.roots
    delete raw.excluded
    delete raw.rootsDiscovered
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(raw, null, 2), 'utf8')
    } catch {
      /* read-only settings file: the marker still stops us repeating this */
    }
    const legacyIndex = path.join(app.getPath('userData'), 'library.json')
    if (fs.existsSync(legacyIndex)) {
      try {
        fs.mkdirSync(profilesDir(), { recursive: true })
        fs.renameSync(legacyIndex, libraryIndexFile(profile))
      } catch {
        /* a locked index is not worth failing the first launch over */
      }
    }
  }

  try {
    fs.mkdirSync(profilesDir(), { recursive: true })
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
  } catch {
    /* the marker is an optimisation, not a correctness requirement */
  }

  return hadLegacy ? adopted : null
}

/** The folder list of the active profile. */
export function libraryPaths(): LibraryPaths {
  if (cache) return cache

  const own = readProfileFile(activeProfile)
  if (own) {
    cache = own
    return cache
  }

  const adopted = bound ? adoptLegacyLibrary(activeProfile) : null
  cache = adopted ?? { ...EMPTY }
  return cache
}

export function saveLibraryPaths(patch: Partial<LibraryPaths>): LibraryPaths {
  const next: LibraryPaths = { ...libraryPaths(), ...patch }
  cache = next
  try {
    writeProfileFile(activeProfile, next)
  } catch (error) {
    console.error('[aurora] could not persist the library paths', error)
  }
  return next
}

/**
 * Point the folder list at a profile.
 *
 * Nothing is loaded here: the next `libraryPaths()` call reads that profile's
 * file, which keeps a switch cheap and lets the first call do the one-time
 * adoption.
 */
export function setLibraryProfile(profile: string | null): void {
  const next = profileFileStem(profile)
  // First binding invalidates the cache even when the profile name matches: the
  // cached value may have been read before adoption was allowed.
  const rebinding = !bound
  bound = true
  if (next === activeProfile && !rebinding && cache !== null) return
  activeProfile = next
  cache = null
}

/** Whether the renderer has told the main process which profile it is on. */
export function isLibraryProfileBound(): boolean {
  return bound
}
