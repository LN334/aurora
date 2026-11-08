import { app, net, shell } from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { appSettings, loadSettings, saveSettings, type UpdateInterval } from './settings'
import { applyUpdaterProxy } from './proxy'
import { write } from './startup-log'
import { isNewer } from './pure/version'
import { repositoryTarget } from './pure/release-target'

// `UpdateInterval` is declared alongside the settings that store it; re-exported
// so callers of this module do not need to know where it lives.
export type { UpdateInterval }

/**
 * Update checking against GitHub Releases.
 *
 * Two decisions are deliberately separate:
 *
 * - Fetching the file can be automatic (on by default). It costs bandwidth,
 *   not trust: nothing about the running app changes.
 * - Replacing the running app always asks. The builds are unsigned, so there is
 *   no signature to verify before swapping the executable; the user presses
 *   restart, and the release page stays the fallback when a download fails.
 *
 * Both halves share one source of truth for "is there a newer version" - the
 * GitHub check below - so the news and the binary can never disagree.
 */

/** Mirrors the `UpdatePrefs` block in `src/env.d.ts`. */
export interface UpdatePrefs {
  interval: UpdateInterval
  lastCheck: number
  autoInstall: boolean
  /**
   * Whether automatic installation can work *in this build*.
   *
   * False in a dev checkout and false when the optional `electron-updater`
   * package is not installed. The settings page uses it to disable the switch
   * rather than offering something that silently does nothing.
   */
  autoInstallAvailable: boolean
}

export async function updatePrefs(): Promise<UpdatePrefs> {
  const settings = loadSettings()
  return {
    interval: settings.updateInterval,
    lastCheck: settings.lastUpdateCheck,
    autoInstall: settings.autoInstallUpdates,
    autoInstallAvailable: await autoInstallAvailable()
  }
}

/** Pushes every state transition to the renderer's settings page. */
let broadcast: (result: UpdateResult) => void = () => undefined

export function onUpdateStatus(handler: (result: UpdateResult) => void): void {
  broadcast = handler
}

const INTERVAL_MS: Record<UpdateInterval, number> = {
  manual: Number.POSITIVE_INFINITY,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
}


export interface UpdateInfo {
  version: string
  name: string
  notes: string
  url: string
  publishedAt: string
}

/**
 * Mirrors the `UpdateResult` union in `src/env.d.ts`.
 *
 * The three `install*` states only ever appear when the user has switched
 * automatic installation on; without it the flow still stops at `available`.
 */
export type UpdateResult =
  | { state: 'current'; current: string; checkedAt: number }
  | { state: 'available'; current: string; checkedAt: number; info: UpdateInfo }
  | { state: 'unconfigured'; current: string; message: string }
  | { state: 'error'; current: string; checkedAt: number; message: string }
  | {
      state: 'downloading'
      current: string
      info: UpdateInfo
      percent: number
      transferred: number
      total: number
    }
  | { state: 'ready'; current: string; info: UpdateInfo }
  | { state: 'installing'; current: string; info: UpdateInfo }

const REQUEST_TIMEOUT_MS = 9000

/**
 * The repository this build came from, read from the packaged `package.json`.
 *
 * The decision itself lives in `release-target.ts`, which is pure and tested:
 * the packaged file has no `build` block (electron-builder strips it), so the
 * target has to come from `repository.url`.
 */
function publishTarget(): { owner: string; repo: string } | null {
  try {
    const raw = fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')
    return repositoryTarget(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Markdown to something readable in a narrow panel. Approximate on purpose. */
function plainNotes(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200)
}

interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
}

/** The release the last check found, so a manual download can reuse it. */
let pendingRelease: Extract<UpdateResult, { state: 'available' }> | null = null

export async function checkForUpdate(): Promise<UpdateResult> {
  // One wrapper, so every early return below maintains the same invariant:
  // `pendingRelease` is exactly what the newest check said was available.
  const result = await probeRelease()
  pendingRelease = result.state === 'available' ? result : null
  return result
}

async function probeRelease(): Promise<UpdateResult> {
  const current = app.getVersion()
  const target = publishTarget()

  if (!target) {
    return {
      state: 'unconfigured',
      current,
      message: '这个构建还没有配置发布仓库（package.json 里的 build.publish）'
    }
  }

  const checkedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await net.fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/releases/latest`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'Aurora-Player'
        },
        signal: controller.signal
      }
    )

    if (response.status === 404) {
      // No releases yet is a normal state for a young repository.
      saveSettings({ lastUpdateCheck: checkedAt })
      return { state: 'current', current, checkedAt }
    }
    if (!response.ok) {
      return {
        state: 'error',
        current,
        checkedAt,
        message: `GitHub 返回 ${response.status}${response.status === 403 ? '（可能是接口访问频率限制）' : ''}`
      }
    }

    const release = (await response.json()) as GithubRelease
    if (release.draft) {
      saveSettings({ lastUpdateCheck: checkedAt })
      return { state: 'current', current, checkedAt }
    }

    const latest = (release.tag_name ?? '').replace(/^v/i, '')
    const url = release.html_url ?? `https://github.com/${target.owner}/${target.repo}/releases`

    saveSettings({ lastUpdateCheck: checkedAt })

    if (!latest || !isNewer(latest, current)) {
      return { state: 'current', current, checkedAt }
    }

    return {
      state: 'available',
      current,
      checkedAt,
      info: {
        version: latest,
        name: release.name?.trim() || `Aurora ${latest}`,
        notes: plainNotes(release.body ?? ''),
        url,
        publishedAt: release.published_at ?? ''
      }
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      state: 'error',
      current,
      checkedAt,
      message: aborted ? '检查更新超时，稍后再试' : '无法连接到 GitHub'
    }
  } finally {
    clearTimeout(timer)
  }
}

/** True when a background check is due (never twice at once). */
let checkInFlight = false

 function shouldAutoCheck(): boolean {
  if (checkInFlight) return false
  const settings = loadSettings()
  const interval = INTERVAL_MS[settings.updateInterval]
  if (!Number.isFinite(interval)) return false
  return Date.now() - (settings.lastUpdateCheck ?? 0) > interval
}

export async function autoCheck(onResult: (result: UpdateResult) => void): Promise<void> {
  if (!shouldAutoCheck()) return
  checkInFlight = true
  try {
    const result = await checkForUpdate()
    if (result.state !== 'available') return
    onResult(result)
    // The settings page shows progress, so it needs the same news the toast got.
    broadcast(result)
    if (shouldAutoInstall(result)) void downloadAndInstall(result)
  } finally {
    checkInFlight = false
  }
}

/**
 * Should this result be downloaded and installed without asking?
 *
 * Both conditions matter. `autoInstallUpdates` is the user's explicit consent,
 * and `app.isPackaged` is the difference between a real installation and a dev
 * checkout, where there is no installer to replace and the updater would only
 * produce errors.
 */
 function shouldAutoInstall(result: UpdateResult): boolean {
  return result.state === 'available' && appSettings().autoInstallUpdates && app.isPackaged
}

/**
 * Download the pending release and hand it to the installer.
 *
 * `electron-updater` is loaded dynamically so that a user who never turns the
 * option on does not pay for loading it at startup. It is a real dependency now,
 * so `autoInstallAvailable` normally reports true - but the dynamic form stays,
 * because a packaged build can still be missing it and the settings page must be
 * able to say so instead of throwing.
 *
 * The GitHub check above remains the source of truth for *whether* there is an
 * update; this only fetches the file. That is why the update info shown here is
 * the info the check produced, not whatever the updater's own feed says.
 */

/** The slice of `electron-updater` this file uses. */
type ProgressInfo = { percent: number; transferred: number; total: number }

interface FeedOptions {
  provider: string
  owner: string
  repo: string
}

interface UpdateLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
}

interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  /**
   * Where electron-updater's own diagnostics go.
   *
   * Its default sink is the console, which a packaged Windows build has no
   * window for, so the one line that says whether the differential path was
   * taken - or why it was abandoned - used to be invisible. The startup log is
   * the file users are already asked to send.
   */
  logger: UpdateLogger | null
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): unknown
  on(event: 'update-downloaded', listener: () => void): unknown
  setFeedURL(options: FeedOptions): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

/**
 * `require`, not `import()`.
 *
 * A real ESM `import()` goes through Node's ESM loader, and that loader has no
 * idea `app.asar` is a readable directory: inside a packaged build it fails
 * with ERR_MODULE_NOT_FOUND, this function then returned null, and the
 * settings switch stayed greyed out claiming the dependency was missing - on
 * every installed copy, while `require('electron-updater')` resolved fine.
 * `require` goes through Electron's patched `fs`, so it finds the same file
 * packed and unpacked. It is still lazy: nothing runs until the settings page
 * or an update check asks for it.
 */
const requireFromHere = createRequire(__filename)

/**
 * Point the updater at GitHub when the builder left no `app-update.yml`.
 *
 * An NSIS build writes that file next to the asar; an unpacked (`--dir`) or
 * hand-assembled folder does not, and without it the download step has no feed
 * to read. Injecting the same repository the check already used keeps the two
 * halves agreeing about where updates come from.
 */
function ensureFeed(updater: AutoUpdaterLike): void {
  try {
    if (fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return
    const target = publishTarget()
    if (!target) return
    updater.setFeedURL({ provider: 'github', owner: target.owner, repo: target.repo })
    console.log('[aurora] updates: feed -> github:' + target.owner + '/' + target.repo)
  } catch (error) {
    // A bad injection should cost the download, not the whole switch.
    console.error('[aurora] could not point electron-updater at a feed', error)
  }
}

async function loadUpdater(): Promise<AutoUpdaterLike | null> {
  try {
    const module = requireFromHere('electron-updater') as { autoUpdater: AutoUpdaterLike }
    const updater = module.autoUpdater ?? null
    if (updater) {
      updater.logger = {
        info: (message) => write(`updater: ${message}`),
        warn: (message) => write(`updater warn: ${message}`),
        error: (message) => write(`updater error: ${message}`),
        debug: (message) => write(`updater debug: ${message}`)
      }
      ensureFeed(updater)
    }
    return updater
  } catch (error) {
    console.error('[aurora] electron-updater is unavailable', error)
    return null
  }
}

/** Whether this build can download and install by itself. */
export async function autoInstallAvailable(): Promise<boolean> {
  if (!app.isPackaged) return false
  return (await loadUpdater()) !== null
}

let installing = false

 async function downloadAndInstall(result: UpdateResult): Promise<void> {
  if (installing || result.state !== 'available') return
  // Narrowed once, so the progress callback and the failure path below cannot
  // lose track of which member of the union they are working with.
  const pending = result
  installing = true
  try {
    const updater = await loadUpdater()
    if (!updater) return
    /*
     * GitHub's download hosts are unreachable on many networks, and
     * electron-updater downloads through a session of its own, which never sees
     * a proxy that the desktop client only exposes as a local port. Find one
     * that really reaches GitHub before asking for the first byte.
     */
    await applyUpdaterProxy()
    /*
     * `autoDownload = false` plus an explicit `downloadUpdate()` is the ordering
     * the API expects: check first, then download. The alternative -
     * `checkForUpdatesAndNotify()` - downloads without asking, which would make
     * the setting's default a lie.
     */
    /*
     * Install only when the user asks. Quitting must not silently replace the
     * running build: these installers are unsigned, and a bad release would
     * arrive with no way back. The download itself is the part that can be
     * automatic without taking that decision away.
     */
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false

    // Tells the banner to switch to its progress form before the first chunk.
    broadcast({
      state: 'downloading',
      current: pending.current,
      info: pending.info,
      percent: 0,
      transferred: 0,
      total: 0
    })

    updater.on('update-downloaded', () => {
      broadcast({ state: 'ready', current: pending.current, info: pending.info })
    })

    updater.on('download-progress', (progress) => {
      broadcast({
        state: 'downloading',
        current: pending.current,
        info: pending.info,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total
      })
    })

    await updater.checkForUpdates()
    await updater.downloadUpdate()
    broadcast({ state: 'ready', current: pending.current, info: pending.info })
  } catch (error) {
    // Failing to download must not look like failing to check: the user still
    // has a release page they can open by hand.
    console.error('[aurora] automatic update failed', error)
    broadcast({
      state: 'available',
      current: pending.current,
      checkedAt: Date.now(),
      info: pending.info
    })
  } finally {
    installing = false
  }
}

/**
 * Fetch the release the last check reported, at the user's request.
 *
 * The settings page used to hand this step to the browser. Doing it in-process
 * is what makes the banner's progress and "restart to install" real: the file
 * ends up where `quitAndInstall()` looks, not in the Downloads folder.
 */
export async function downloadAvailable(): Promise<boolean> {
  if (!app.isPackaged) return false

  if (!pendingRelease) {
    const result = await checkForUpdate()
    if (result.state !== 'available') return false
  }
  const pending = pendingRelease
  if (!pending) return false

  void downloadAndInstall(pending)
  return true
}

/** Quit and run the downloaded installer. Only meaningful after `ready`. */
export async function installPendingUpdate(): Promise<boolean> {
  if (!app.isPackaged) return false
  // 点下去到进程退出之间有一两秒，界面上得先有个「在装了」，否则像是点了没反应。
  const pending = pendingRelease
  try {
    const updater = await loadUpdater()
    if (!updater) return false
    if (pending) {
      broadcast({ state: 'installing', current: pending.current, info: pending.info })
    }
    updater.quitAndInstall()
    return true
  } catch (error) {
    console.error('[aurora] could not start the installer', error)
    return false
  }
}

/** Hand the release page to the real browser, never to an in-app window. */
export async function openReleasePage(url: string): Promise<void> {
  if (!/^https:\/\/github\.com\//.test(url)) return
  await shell.openExternal(url)
}
