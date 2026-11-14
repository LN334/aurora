import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { appSettings, loadSettings, saveSettings, type UpdateInterval } from './settings'
import { applyUpdaterProxy } from './proxy'
import { write } from './startup-log'
import { isNewer } from './pure/version'
import { repositoryTarget } from './pure/release-target'
import { downloadReleaseFile, type DownloadSource } from './update-download'

// `UpdateInterval` is declared alongside the settings that store it; re-exported
// so callers of this module do not need to know where it lives.
export type { UpdateInterval }

/**
 * Update checking against GitHub Releases.
 *
 * Two paths, one source of truth for "is there a newer version" - the GitHub
 * check below - so the news and the binary can never disagree.
 *
 * - Manual: check, then download, then install. Every step is a user action.
 *   Nothing in this module starts one of them on its own.
 * - Automatic: the scheduled check downloads by itself, and
 *   `src/features/updates/auto-restart.ts` installs once nothing is playing.
 *   Every result this module pushes carries `origin`, so the renderer can tell
 *   the two downloads apart and never auto-install a file the user fetched by
 *   hand.
 *
 * Installation is still never decided here: `autoInstallOnAppQuit` stays off,
 * and quitting does not replace the running build.
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
 * `origin` on `ready` says which path produced the file. Only `'auto'` may be
 * installed without a press; a manual download always waits for the button.
 */
export type UpdateResult =
  | { state: 'current'; current: string; checkedAt: number }
  | { state: 'available'; current: string; checkedAt: number; info: UpdateInfo }
  | { state: 'unconfigured'; current: string; message: string }
  | {
      state: 'error'
      current: string
      checkedAt: number
      message: string
      /** 出错时也带着这一版的信息，界面才有地方把发布页交出去。 */
      info?: UpdateInfo
    }
  | {
      state: 'downloading'
      current: string
      info: UpdateInfo
      percent: number
      transferred: number
      total: number
    }
  | { state: 'ready'; current: string; info: UpdateInfo; origin: 'auto' | 'manual' }
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
    if (shouldAutoDownload(result)) void downloadInBackground(result, 'auto')
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
 function shouldAutoDownload(result: UpdateResult): boolean {
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

/** The bits of electron-updater's check result we actually read. */
interface UpdateCheckResultLike {
  updateInfo?: {
    files?: Array<{ url: string; sha512?: string }>
  }
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
  checkForUpdates(): Promise<UpdateCheckResultLike | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
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

/** Downloaded but not yet installed. Cleared when the installer runs. */
let readyVersion: string | null = null
/** The checked file itself; `readyVersion` alone cannot tell us where it is. */
let readyPath: string | null = null

/**
 * 下载线路。直连 GitHub 在国内经常被 RST；后面两条是公共的 GitHub 反代。
 * 它们只代理文件，不代理 API，所以检查更新仍然走 GitHub。校验值来自
 * GitHub 那边的 latest.yml，镜像就算换了包也过不了 sha512。
 */
const DOWNLOAD_SOURCES: DownloadSource[] = [
  { name: 'GitHub', prefix: '' },
  { name: 'gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { name: 'ghfast.top', prefix: 'https://ghfast.top/' }
]

 async function downloadInBackground(
  result: UpdateResult,
  origin: 'auto' | 'manual'
): Promise<void> {
  if (installing || result.state !== 'available') return
  // Narrowed once, so the progress callback and the failure path below cannot
  // lose track of which member of the union they are working with.
  const pending = result
  installing = true
  try {
    const updater = await loadUpdater()
    if (!updater) return
    /*
     * 检查仍然交给 electron-updater：latest.yml 只有几百字节，GitHub 的 API 与
     * raw 域名通常是通的。真正下不动的是 136 MB 的安装包，那一段交给下面的
     * downloadReleaseFile——它会直连失败后换加速源，并且从断点继续。
     */
    await applyUpdaterProxy()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false

    // Tells the settings page to switch to its progress form before the first chunk.
    broadcast({
      state: 'downloading',
      current: pending.current,
      info: pending.info,
      percent: 0,
      transferred: 0,
      total: 0
    })

    const check = await updater.checkForUpdates()
    const file = check?.updateInfo?.files?.[0]
    if (!file || !file.sha512) throw new Error('发布信息里没有可用的安装包')
    const target = publishTarget()
    if (!target) throw new Error('不知道这个构建来自哪个仓库')
    const tag = tagOf(pending.info.url) ?? 'v' + pending.info.version
    const name = fileNameOf(file.url)
    if (!name) throw new Error('发布信息里的文件名不可用')
    const url =
      'https://github.com/' +
      target.owner +
      '/' +
      target.repo +
      '/releases/download/' +
      encodeURIComponent(tag) +
      '/' +
      encodeURIComponent(name)

    const localPath = await downloadReleaseFile({
      url,
      fileName: name,
      sha512: file.sha512,
      dir: path.join(app.getPath('temp'), 'aurora-update'),
      sources: DOWNLOAD_SOURCES,
      onProgress: (progress) => {
        broadcast({
          state: 'downloading',
          current: pending.current,
          info: pending.info,
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total
        })
      }
    })

    readyPath = localPath
    readyVersion = pending.info.version
    broadcast({ state: 'ready', current: pending.current, info: pending.info, origin })
  } catch (error) {
    /*
     * 断网、代理半失效、加速源也连不上，最后都落在这里。
     *
     * 这里以前悄悄退回 available，界面于是又出现一个「下载」，用户点一次失败
     * 一次，看上去像按钮坏了。下载失败必须有一句人话，并且把「用浏览器下载」
     * 这条路一起交出去。
     */
    console.error('[aurora] update download failed', error)
    broadcast({
      state: 'error',
      current: pending.current,
      checkedAt: Date.now(),
      message: '下载没完成，像是连不上下载服务器。改用浏览器下载安装包覆盖安装，效果一样。',
      info: pending.info
    })
  } finally {
    installing = false
  }
}

/** 从发布页地址里取 tag；取不到就用版本号拼。 */
function tagOf(releaseUrl: string): string | null {
  try {
    const match = /\/releases\/tag\/([^/?#]+)/.exec(new URL(releaseUrl).pathname)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** latest.yml 里的 url 可能是完整地址，也可能只是文件名。 */
function fileNameOf(fileUrl: string): string {
  const clean = fileUrl.split('?')[0].split('#')[0]
  return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1))
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

  void downloadInBackground(pending, 'manual')
  return true
}


/** Run the downloaded installer and quit. Only meaningful after `ready`. */
export async function installPendingUpdate(): Promise<boolean> {
  if (!app.isPackaged) return false
  if (!readyVersion || !readyPath) return false
  // 点下去到进程退出之间有一两秒，界面上得先有个「在装了」，否则像是点了没反应。
  const pending = pendingRelease
  try {
    if (pending) {
      broadcast({ state: 'installing', current: pending.current, info: pending.info })
    }
    /*
     * 参数与 electron-updater 的 quitAndInstall(true, true) 一致：更新模式、
     * 静默安装、装完启动。安装器是我们自己的一键 NSIS，customInstall 会在
     * --updated 这条路上补回缺失的快捷方式。
     */
    const child = spawn(readyPath, ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    app.quit()
    return true
  } catch (error) {
    console.error('[aurora] could not start the installer', error)
    return false
  }
}

/**
 * 清掉 electron-updater 自己的下载缓存。
 *
 * 真正用来安装的包由 downloadInBackground 下到临时目录，和这个缓存无关。
 * 这里留着的是旧版本留下的 pending（安装包 + update-info.json）：升级之后
 * 它不会自己消失，下一次检查有可能把「上次已经下好」当成「这次也下好了」，
 * 于是版本号一直说还有新版、装却装不上。启动时清一次；缓存本来也只服务一次
 * 检查，不需要跨启动保留。目录名与 app-update.yml 的 updaterCacheDirName 对应。
 */
export function sweepUpdaterCache(): void {
  if (!app.isPackaged) return
  const local = process.env.LOCALAPPDATA
  if (!local) return
  const root = path.join(local, 'aurora-player-updater')
  for (const junk of [path.join(root, 'pending'), path.join(root, 'installer.exe')]) {
    try {
      fs.rmSync(junk, { recursive: true, force: true })
    } catch {
      // 正被占用就下次再说；清不掉缓存不是启动失败的理由
    }
  }
}

/** Hand the release page to the real browser, never to an in-app window. */
export async function openReleasePage(url: string): Promise<void> {
  if (!/^https:\/\/github\.com\//.test(url)) return
  await shell.openExternal(url)
}
