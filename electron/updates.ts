import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { loadSettings, saveSettings, type UpdateInterval } from './settings'
import { applyUpdaterProxy } from './proxy'
import { write } from './startup-log'
import { isNewer } from './pure/version'
import { repositoryTarget } from './pure/release-target'
import {
  downloadReleaseFile,
  fetchReleaseText,
  type DownloadSource,
  type ProxyEndpoint
} from './update-download'
import { parseLatestYml, type LatestFile } from './pure/latest-yml'

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
 * - Automatic: the scheduled check only *reports*. It never fetches the file
 *   and never replaces the running build; those two stay user decisions, the
 *   same way LightC and Ghost Downloader do it.
 *
 * Installation is still never decided here: `autoInstallOnAppQuit` stays off,
 * and quitting does not replace the running build.
 */

/** Mirrors the `UpdatePrefs` block in `src/env.d.ts`. */
export interface UpdatePrefs {
  interval: UpdateInterval
  lastCheck: number
}

export async function updatePrefs(): Promise<UpdatePrefs> {
  const settings = loadSettings()
  return {
    interval: settings.updateInterval,
    lastCheck: settings.lastUpdateCheck
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
  /** 安装包字节数；发布页没附安装包时为 0，界面上就不写大小。 */
  size: number
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

/** 安装包大小：发布页上第一个 `.exe` 附件的字节数，没有就是 0。 */
function setupSize(assets: GithubRelease['assets']): number {
  const setup = assets?.find((asset) => /\.exe$/i.test(asset.name ?? ''))
  const size = Number(setup?.size ?? 0)
  return Number.isFinite(size) && size > 0 ? size : 0
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
  /** 发布页上的附件；安装包大小就取这里，界面上要写「多大」。 */
  assets?: Array<{ name?: string; size?: number }>
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
        publishedAt: release.published_at ?? '',
        size: setupSize(release.assets)
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
    /*
     * 只报到，不下载。
     *
     * 更新走的是「查到 → 用户按下载 → 下好 → 用户按重启」这条线，和 LightC、
     * Ghost Downloader 一致：后台悄悄把 136 MB 拉回来、再找时机把进程换掉，
     * 用户既不知道发生了什么，也没法拒绝一次具体的替换。自动这件事只做到
     * 「替你查一下」为止。
     */
  } finally {
    checkInFlight = false
  }
}

/**
 * Download the pending release and hand it to the installer.
 *
 * `electron-updater` is loaded dynamically so that a user who never opens the
 * update page does not pay for loading it at startup. It is a real dependency
 * now, but the dynamic form stays: a packaged build can still be missing it, and
 * the failure has to be a message instead of a throw at import time.
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

let installing = false

/** Downloaded but not yet installed. Cleared when the installer runs. */
let readyVersion: string | null = null
/** The checked file itself; `readyVersion` alone cannot tell us where it is. */
let readyPath: string | null = null

/**
 * 下载线路：直连 + 一串公共反代。
 *
 * 名单只决定「参与测速的候选」，不决定顺序——每次下载前并发测一批，按实测
 * 吞吐排。国内网络里它们的可用性和速度变化很大，2026-11 在校园网实测：直连
 * 拿不到数据（000），gh-proxy.com 是唯一通的一条，其余几条连 DNS 都解析不出来。
 * 死了的线路留在表里不碍事，测速会把它排到最后，不会先让它占着队列等超时。
 *
 * 反代只代理文件，不代理 API，所以检查更新仍走 GitHub。校验值来自 latest.yml，
 * 镜像换了包也过不了 sha512。
 */
const DOWNLOAD_SOURCES: DownloadSource[] = [
  { name: 'GitHub', prefix: '' },
  { name: 'gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { name: 'ghfast.top', prefix: 'https://ghfast.top/' },
  { name: 'ghproxy.net', prefix: 'https://ghproxy.net/' },
  { name: 'gitmirror', prefix: 'https://hub.gitmirror.com/' },
  { name: 'ghp.ci', prefix: 'https://ghp.ci/' },
  { name: 'gh.llkk.cc', prefix: 'https://gh.llkk.cc/' },
  { name: 'moeyy', prefix: 'https://github.moeyy.xyz/' }
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
    /*
     * 路由先定下来：有代理就走隧道，没有就直连。测速会带着这个设置跑，
     * 否则量出来的不是用户实际会走的那条路。
     */
    const route = await applyUpdaterProxy()

    // Tells the settings page to switch to its progress form before the first chunk.
    broadcast({
      state: 'downloading',
      current: pending.current,
      info: pending.info,
      percent: 0,
      transferred: 0,
      total: 0
    })

    const base = releaseBase(pending.info)
    /*
     * 代理只是一条候选，直连一起交给下载器。
     *
     * 代理客户端在听、上游却断了的时候，只给代理会让每一条线路都判死，
     * 进度停在 0% 不动；把直连也放进候选，实测谁通就走谁。
     */
    const routes: Array<ProxyEndpoint | null> = route.endpoint ? [route.endpoint, null] : [null]
    const manifest = await resolveManifest(base, routes)
    const name = fileNameOf(manifest.url)
    if (!name) throw new Error('发布信息里的文件名不可用')

    const localPath = await downloadReleaseFile({
      url: base + '/' + encodeURIComponent(name),
      fileName: name,
      sha512: manifest.sha512,
      expectedSize: manifest.size || pending.info.size,
      dir: path.join(app.getPath('temp'), 'aurora-update'),
      sources: DOWNLOAD_SOURCES,
      proxy: route.endpoint,
      proxyCandidates: routes,
      onNote: (note) => write('updates: ' + note),
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

/** 某一版附件的公共前缀，形如 .../releases/download/v1.0.0。 */
function releaseBase(info: UpdateInfo): string {
  const target = publishTarget()
  if (!target) throw new Error('不知道这个构建来自哪个仓库')
  const tag = tagOf(info.url) ?? 'v' + info.version
  return (
    'https://github.com/' +
    target.owner +
    '/' +
    target.repo +
    '/releases/download/' +
    encodeURIComponent(tag)
  )
}

/**
 * 这一版的清单：安装包文件名、sha512、大小。
 *
 * 优先走镜像取 latest.yml。它只有几百字节，通一条线路就够；而 electron-updater
 * 取同一份文件的地址在 github.com 上，会 302 到 release-assets.githubusercontent.com
 * ——校园网里那个域名整段不通，于是下载还没开始就死在「没有可用的安装包」。
 * 只有镜像全都拿不到时才回到 electron-updater 那条路。
 */
async function resolveManifest(
  base: string,
  routes: Array<ProxyEndpoint | null>
): Promise<LatestFile> {
  try {
    const text = await fetchReleaseText({
      url: base + '/latest.yml',
      sources: DOWNLOAD_SOURCES,
      proxies: routes
    })
    const parsed = parseLatestYml(text)
    if (parsed && parsed.sha512) {
      write('updates: 清单取自镜像线路')
      return parsed
    }
    write('updates: 清单里没有 sha512')
  } catch (error) {
    write('updates: 镜像取清单失败 ' + (error instanceof Error ? error.message : String(error)))
  }

  const updater = await loadUpdater()
  if (!updater) throw new Error('取不到更新清单，也加载不了更新组件')
  const check = await updater.checkForUpdates()
  const file = check?.updateInfo?.files?.[0]
  if (!file || !file.sha512) throw new Error('发布信息里没有可用的安装包')
  return { url: file.url, sha512: file.sha512, size: 0 }
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
