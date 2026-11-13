import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { write } from '../startup-log'
import { classifyStreamFailure, describeFailure } from './reasons'
import { clearSession, hasSession, readState, writeState } from './session'
import {
  TIER_FORMATS,
  hashForTier,
  cookieHeader,
  readAccount,
  readAlbumDetail,
  readAlbumSongCount,
  readAlbumSongs,
  readArtistAlbums,
  readArtistAudios,
  readArtistDetail,
  readDailySongs,
  readFavoriteList,
  readNewSongs,
  readPlaylistCreator,
  readPlaylistRawSongs,
  readPlaylistTracks,
  readWriteOk,
  readQrCheck,
  readQrImage,
  readQrKey,
  readSearchSongs,
  readSongUrl,
  readTopPlaylists,
  readUpstreamFailure,
  readUserPlaylists,
  request,
  sessionFromCookies,
  setBaseUrl,
  tierLadder
} from './transport'
import type {
  KugouAccount,
  KugouAlbumBundle,
  KugouAlbumEntry,
  KugouArtistDetail,
  KugouPlaylistSummary,
  KugouQuality,
  KugouQrResult,
  KugouQrSession,
  KugouSearchResult,
  KugouSong,
  KugouStatusResult,
  KugouStreamResult
} from './types'

/**
 * 酷狗客户端：一个本地 vendor 服务的生命周期 + 五类能力（搜索、歌单、专辑与艺人、
 * 每日推荐、取流扫码）。
 *
 * 为什么不是「像 QQ 那样懒加载 SDK」：酷狗的第三方接口是一个独立的 Node 服务
 * （`vendor/KuGouMusicApi`，`node app.js` 起在某个端口），不是一个能从主进程
 * `require` 的模块。所以这里的第一职责是**把它管起来**：随机空闲端口、只监听
 * 回环、等就绪、进程跟着 Aurora 退出、失败时把原因留在 startup.log 里。
 *
 * 三条与 QQ 一致的原则，理由相同：
 * 1. **不向渲染层抛错**。每个方法都按契约形状作答，传输失败归到原因上——一次
 *    未处理的 `invoke` 拒绝会变成页面里一个空白的视图。
 * 2. **拒绝是一等答案**。酷狗对未登录请求一律 `20028`（实测），「没有地址，
 *    以及为什么」是常态，不是异常。
 * 3. **数字 id 只是界面钥匙**。取流要 `hash` + `album_id` + `album_audio_id`，
 *    所以本会话见过的每一首歌都记下来，数字 id 才能反查回真正的身份。
 */

let activeProfileId = 'default'

export function setActiveProfile(profileId: string): boolean {
  activeProfileId = String(profileId ?? '').trim() || 'default'
  return true
}

export function activeProfile(): string {
  return activeProfileId
}

export function profileHasSession(profileId: string): boolean {
  return hasSession(profileId)
}

// --- 本地服务 -----------------------------------------------------------

let child: ChildProcess | null = null
let serverUrl = ''
let serverDetail = ''
let boot: Promise<boolean> | null = null
let failedAt = 0
let cleanupWired = false

/** 失败后 30 秒内不再重拉，免得每次 status() 都 spawn 一次。 */
const RETRY_COOLDOWN_MS = 30_000
const READY_TIMEOUT_MS = 20_000

/**
 * vendor 目录在哪。
 *
 * 三条来源，按可信度排：
 *   * 环境变量：排障时能把服务指到别处；
 *   * `resourcesPath`：打包后 vendor 会作为 extraResources 落地（打包配置还没加，
 *     这是本次任务之外的一步，见简报）；
 *   * 仓库根的 `vendor`：开发时的真实位置，`dist-electron/../.. ` 与
 *     `app.getAppPath()` 都指向它。
 */
function findAppDir(): string | null {
  const candidates: string[] = []
  const fromEnv = process.env.AURORA_KUGOU_API_DIR
  if (fromEnv) candidates.push(fromEnv)
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'KuGouMusicApi'))
  try {
    candidates.push(path.join(app.getAppPath(), 'vendor', 'KuGouMusicApi'))
  } catch {
    // app 还没 ready 时没有 appPath；下面的 `__dirname` 分支兜着
  }
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'KuGouMusicApi'))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'app.js'))) return candidate
  }
  return null
}

/** 让操作系统给一个空闲端口：不写死 3210，免得撞上调试时自己起的那个。 */
function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('没有拿到空闲端口'))))
    })
  })
}

async function waitReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false
    try {
      const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return true
    } catch {
      // 还没起来：继续等，不刷日志（20 秒里会问几十次）
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function startServer(): Promise<boolean> {
  const dir = findAppDir()
  if (!dir) {
    serverDetail = '找不到 vendor/KuGouMusicApi'
    write(`[kugou] api directory not found`)
    return false
  }

  let port = 0
  try {
    port = await pickPort()
  } catch (error) {
    serverDetail = '没有可用端口'
    write(`[kugou] no free port: ${messageOf(error)}`)
    return false
  }

  const url = `http://127.0.0.1:${port}`
  // `process.execPath` 在 Electron 里是 electron.exe；`ELECTRON_RUN_AS_NODE=1`
  // 让它以 Node 身份跑 vendor，于是打包后的机器不需要另装 node。
  const command = process.env.AURORA_KUGOU_NODE || process.execPath
  const entry = path.join(dir, 'app.js')
  write(`[kugou] starting api: ${command} ${entry} (cwd=${dir}, port=${port})`)

  let proc: ChildProcess
  try {
    proc = spawn(command, [entry], {
      cwd: dir,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        ELECTRON_RUN_AS_NODE: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    serverDetail = `酷狗本地服务起不来：${messageOf(error)}`
    write(`[kugou] spawn failed: ${messageOf(error)}`)
    return false
  }

  child = proc
  proc.stdout?.on('data', (chunk: Buffer) => {
    write(`[kugou] ${chunk.toString('utf8').trimEnd()}`)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trimEnd()
    write(`[kugou:err] ${text}`)
    console.error('[aurora] kugou api:', text)
  })
  proc.on('error', (error) => {
    write(`[kugou] api process error: ${error.message}`)
  })
  proc.on('exit', (code, signal) => {
    write(`[kugou] api exited code=${code} signal=${signal}`)
    if (child === proc) child = null
    serverUrl = ''
    setBaseUrl('')
  })

  const ready = await waitReady(url, READY_TIMEOUT_MS)
  if (!ready) {
    serverDetail = '酷狗本地服务没有在 20 秒内就绪'
    write('[kugou] api never became ready')
    stopServer()
    return false
  }

  serverUrl = url
  setBaseUrl(url)
  serverDetail = ''
  write(`[kugou] api ready @ ${url}`)
  return true
}

function wireCleanup(): void {
  if (cleanupWired) return
  cleanupWired = true
  try {
    app.on('will-quit', () => stopServer())
  } catch {
    // 没有 app（纯 Node 测试）时不需要清理
  }
}

/** 起服务（幂等），返回是否可用。 */
export async function ensureServer(): Promise<boolean> {
  wireCleanup()
  if (serverUrl) return true
  if (Date.now() - failedAt < RETRY_COOLDOWN_MS) return false
  if (!boot) {
    boot = startServer()
      .catch((error: unknown) => {
        serverDetail = messageOf(error)
        write(`[kugou] startServer threw: ${serverDetail}`)
        return false
      })
      .then((ok) => {
        if (!ok) failedAt = Date.now()
        return ok
      })
      .finally(() => {
        boot = null
      })
  }
  return await boot
}

/** 停服务。随 app 退出调用，也供排障用。 */
function stopServer(): void {
  const proc = child
  child = null
  serverUrl = ''
  setBaseUrl('')
  if (proc && proc.exitCode === null) {
    try {
      proc.kill()
    } catch {
      // 已经死了
    }
  }
}

// --- 状态 ---------------------------------------------------------------

export async function kugouStatus(): Promise<KugouStatusResult> {
  const ready = await ensureServer()
  const loggedIn = ready && hasSession(activeProfileId)
  if (ready) return { ready, loggedIn }
  return { ready: false, loggedIn: false, detail: serverDetail || '酷狗本地服务不可用' }
}

// --- 见过的歌 -----------------------------------------------------------

/**
 * 数字 id -> 真正身份（hash / album_id / album_audio_id）。
 *
 * 渲染层的共享歌曲形状是数字 id，而取流要的是三个上游字段，所以搜索与歌单
 * 返回的每一首都记下来。有上限、在内存里：重开应用后重新搜索即可，和 QQ 的
 * `songIndex` 同一个取舍。
 */
const songIndex = new Map<number, KugouSong>()
const SONG_INDEX_LIMIT = 4000

function remember(song: KugouSong): void {
  if (!song.id) return
  if (songIndex.size >= SONG_INDEX_LIMIT) {
    const oldest = songIndex.keys().next()
    if (!oldest.done) songIndex.delete(oldest.value)
  }
  songIndex.set(song.id, song)
}

function rememberAll(songs: KugouSong[]): KugouSong[] {
  for (const song of songs) remember(song)
  return songs
}

function songOf(songId: string | number): KugouSong | null {
  const numeric = typeof songId === 'number' ? songId : Number(songId)
  if (!Number.isFinite(numeric)) return null
  return songIndex.get(numeric) ?? null
}

// --- 搜索 ---------------------------------------------------------------

export async function kugouSearch(
  keywords: string,
  type: 'song' | 'album' | 'artist',
  limit = 50
): Promise<KugouSearchResult> {
  // 上游只有歌曲搜索（`/search/song` 实测），参数收下但不改变查询。
  void type
  if (!(await ensureServer())) return { songs: [], albums: [], artists: [] }

  const response = await request('/search/song', {
    query: { keywords, page: 1, pagesize: limit }
  })
  const songs = rememberAll(readSearchSongs(response.body))
  return { songs, albums: [], artists: [] }
}

/**
 * 新歌速递。
 *
 * 上游 /top/song 不需要登录（实测匿名可读），所以首页的「新歌」块能在没登录
 * 的情况下也混进这一家；点播放仍然走取流那套，未登录会得到诚实的失败原因。
 */
export async function kugouNewSongs(limit = 20): Promise<KugouSong[]> {
  if (!(await ensureServer())) return []
  const response = await request('/top/song', { query: { page: 1, pagesize: limit } })
  return rememberAll(readNewSongs(response.body))
}

// --- 歌单 ---------------------------------------------------------------

/**
 * 歌单身份：`global_collection_id` 是字符串，而共享界面按正整数取歌单。
 *
 * 所以主进程给它发一个本次会话稳定的数字别名（`playlists` 里的 `id`），
 * 点开时反查回真身份。别名从 810000 起，避开上游自己那些百万级的数字 id。
 */
const playlistIds = new Map<number, string>()
const playlistAliases = new Map<string, number>()
let nextPlaylistId = 810_000

function aliasFor(globalId: string): number {
  const known = playlistAliases.get(globalId)
  if (known) return known
  const alias = nextPlaylistId
  nextPlaylistId += 1
  playlistAliases.set(globalId, alias)
  playlistIds.set(alias, globalId)
  return alias
}

function summarize(rows: { globalId: string; name: string; coverUrl: string | null; trackCount: number; creator: string }[]): KugouPlaylistSummary[] {
  return rows.map((row) => ({
    id: aliasFor(row.globalId),
    name: row.name,
    coverUrl: row.coverUrl,
    trackCount: row.trackCount,
    creator: row.creator
  }))
}

/**
 * 当前档案的歌单。
 *
 * 登录后读账号自己的歌单（`/user/playlist`）；未登录读公开榜单
 * （`/top/playlist`，实测可用）——这样没登录的人也能浏览歌单并把歌点开，
 * 而点播放时会得到「需要登录」的诚实回答。两张来源的形状不同，读取器分开。
 *
 * `/user/playlist` 的响应形状**尚未实测**（匿名 502），所以读不到时把原始 key
 * 列表写进 startup.log：真人扫一次码就能把路径收口。
 */
export async function kugouMyPlaylists(limit = 60): Promise<KugouPlaylistSummary[]> {
  if (!(await ensureServer())) return []
  const state = readState(activeProfileId)

  try {
    if (state.token) {
      const response = await request('/user/playlist', {
        method: 'POST',
        query: { pagesize: limit, page: 1 },
        cookie: cookieHeader(state)
      })
      const rows = readUserPlaylists(response.body)
      if (rows.length > 0) return summarize(rows)
      write(`[kugou] user/playlist returned nothing; raw keys=${describeKeys(response.body)}`)
      return []
    }

    const response = await request('/top/playlist', {
      method: 'POST',
      query: { pagesize: limit, page: 1 }
    })
    return summarize(readTopPlaylists(response.body))
  } catch (error) {
    write(`[kugou] playlist list failed: ${messageOf(error)}`)
    return []
  }
}

/** 一张歌单里的歌。`id` 是主进程发的数字别名。 */
export async function kugouPlaylistTracks(id: string | number): Promise<KugouSong[]> {
  const numeric = typeof id === 'number' ? id : Number(id)
  const globalId = playlistIds.get(numeric) ?? ''
  if (!globalId) {
    write(`[kugou] playlist ${String(id)} is not known in this session`)
    return []
  }
  if (!(await ensureServer())) return []

  try {
    const response = await request('/playlist/track/all', {
      query: { id: globalId, pagesize: 200, page: 1 }
    })
    return rememberAll(readPlaylistTracks(response.body))
  } catch (error) {
    write(`[kugou] playlist tracks failed: ${messageOf(error)}`)
    return []
  }
}

const playlistCreators = new Map<string, string>()

/**
 * 一张歌单的作者。`id` 是主进程发的数字别名。
 *
 * 详情把歌单挂在 `data["0"]` 上（`data` 不是数组），作者字段是 `list_create_username`。
 * 那个通用读取器还留作兜底——上游偶尔换个形状，它那几路能接住。
 */
export async function kugouPlaylistCreator(id: string | number): Promise<string> {
  const numeric = typeof id === 'number' ? id : Number(id)
  const globalId = playlistIds.get(numeric) ?? ''
  if (!globalId) return ''
  const cached = playlistCreators.get(globalId)
  if (cached) return cached
  if (!(await ensureServer())) return ''

  try {
    const response = await request('/playlist/detail', { query: { ids: globalId } })
    const slot = (response.body as { data?: Record<string, unknown> } | null)?.data?.['0'] as
      | Record<string, unknown>
      | undefined
    const raw = slot?.list_create_username ?? slot?.nickname
    const name = typeof raw === 'string' ? raw : readPlaylistCreator(response.body)
    if (name) playlistCreators.set(globalId, name)
    else write(`[kugou] playlist creator empty for ${globalId}`)
    return name
  } catch (error) {
    write(`[kugou] playlist creator failed: ${messageOf(error)}`)
    return ''
  }
}

// --- 我喜欢 -------------------------------------------------------------

const FAVORITE_TTL_MS = 5 * 60_000

let favoriteCache: { profileId: string; listId: string; globalId: string; at: number } | null = null

/**
 * 认出「我喜欢」那张歌单（两个 id 都要，见 transport 里的注释）。
 *
 * 只认一次、缓存 5 分钟：`/user/playlist` 是账号级读，每次点红心都问一遍没必要，
 * 但换账号（切换档案）必须重新认，所以缓存键带上 profileId。
 */
async function favoritePlaylist(): Promise<{ listId: string; globalId: string } | null> {
  const state = readState(activeProfileId)
  if (!state.token) return null
  if (
    favoriteCache &&
    favoriteCache.profileId === activeProfileId &&
    Date.now() - favoriteCache.at < FAVORITE_TTL_MS
  ) {
    return favoriteCache
  }
  if (!(await ensureServer())) return null

  try {
    const response = await request('/user/playlist', {
      method: 'POST',
      query: { pagesize: 100, page: 1 },
      cookie: cookieHeader(state)
    })
    const found = readFavoriteList(response.body)
    if (!found.listId) {
      write(`[kugou] favorite playlist not found; raw keys=${describeKeys(response.body)}`)
      return null
    }
    favoriteCache = { profileId: activeProfileId, ...found, at: Date.now() }
    return found
  } catch (error) {
    write(`[kugou] favorite playlist failed: ${messageOf(error)}`)
    return null
  }
}

/** 「我喜欢」里的歌。和歌单页同一个形状，收藏页直接复用。 */
export async function kugouLikes(limit = 200): Promise<KugouSong[]> {
  const favorite = await favoritePlaylist()
  if (!favorite) return []

  try {
    const response = await request('/playlist/track/all', {
      query: { id: favorite.globalId, pagesize: Math.min(Math.max(limit, 1), 500), page: 1 }
    })
    return rememberAll(readPlaylistTracks(response.body))
  } catch (error) {
    write(`[kugou] likes failed: ${messageOf(error)}`)
    return []
  }
}

/**
 * 点红心 / 取消红心。
 *
 * 三件事必须做对，否则上游会「回 200 但没改」：
 * 1. 加歌用 `/playlist/tracks/add`，参数 `data` 是 `歌名|hash|album_id|mixsongid`
 *    拼的一行（vendor 的服务按这个格式拆）；
 * 2. 删歌要用 `fileid`，而 `fileid` 只在歌单曲目行里有，所以要先把歌单读一遍；
 * 3. 写完再把歌单读回来核对——「已保存」只在上游真的变了之后才说。
 */
export async function kugouLike(songId: number, liked: boolean): Promise<boolean> {
  const song = songOf(songId)
  if (!song) {
    write(`[kugou] like missing song ${songId}`)
    return false
  }
  const favorite = await favoritePlaylist()
  if (!favorite) return false
  if (!(await ensureServer())) return false

  const state = readState(activeProfileId)
  if (!state.token) return false
  const cookie = cookieHeader(state)

  try {
    if (liked) {
      const data = [song.name, song.hash, song.albumId, song.albumAudioId].join('|')
      const response = await request('/playlist/tracks/add', {
        method: 'POST',
        query: { listid: favorite.listId, data },
        cookie
      })
      if (!readWriteOk(response.body)) {
        write(`[kugou] like add rejected; raw keys=${describeKeys(response.body)}`)
        return false
      }
    } else {
      const listed = await request('/playlist/track/all', {
        query: { id: favorite.globalId, pagesize: 500, page: 1 },
        cookie
      })
      const row = readPlaylistRawSongs(listed.body).find(
        (item) => String(item.hash ?? item.FileHash ?? '').toLowerCase() === song.hash.toLowerCase()
      )
      const fileId = String(row?.fileid ?? row?.fileId ?? '')
      if (!fileId) {
        // 不在「我喜欢」里，就是已经取消了——目标状态已成立。
        write(`[kugou] like remove: ${songId} not in favorite list`)
        return true
      }
      const response = await request('/playlist/tracks/del', {
        method: 'POST',
        query: { listid: favorite.listId, fileids: fileId },
        cookie
      })
      if (!readWriteOk(response.body)) {
        write(`[kugou] like remove rejected; raw keys=${describeKeys(response.body)}`)
        return false
      }
    }

    const after = await kugouLikes(500)
    return after.some((item) => item.hash.toLowerCase() === song.hash.toLowerCase()) === liked
  } catch (error) {
    write(`[kugou] like failed: ${messageOf(error)}`)
    return false
  }
}

// --- 专辑与艺人 ---------------------------------------------------------

/**
 * 一张专辑：头部 + 曲目。
 *
 * 两个请求：详情给名字、封面、简介与发行日期，曲目接口给曲目与总数——详情
 * 本身不报曲目数，只能用后者的 `total` 补上，否则页面会写「0 首」而下面是
 * 一列歌。
 *
 * 未登录也能读（实测），所以不等登录；取流仍然要。
 */
/** 曲目每页 50：实测 pagesize>50 上游直接 502 invalid param，只能分页拿。 */
const ALBUM_PAGE_SIZE = 50
/** 安全上限 20 页 = 1000 首；正常专辑远到不了，防上游 total 报错时无限翻页。 */
const ALBUM_PAGE_LIMIT = 20

export async function kugouAlbum(id: string | number): Promise<KugouAlbumBundle | null> {
  const numeric = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (!(await ensureServer())) return null

  const state = readState(activeProfileId)
  const cookie = state.token ? cookieHeader(state) : undefined

  try {
    const head = await request('/album/detail', { method: 'POST', query: { id: numeric }, cookie })
    const detail = readAlbumDetail(head.body)
    // 头部拿不到才是「没有这张专辑」；曲目挂了不该把头部一起扔掉——那样页面
    // 连名字封面都不显示，用户看到的是「这张专辑没有取到内容」，看不出区别。
    if (!detail) return null

    const songs: KugouSong[] = []
    let total = 0
    for (let page = 1; page <= ALBUM_PAGE_LIMIT; page += 1) {
      let body: unknown
      try {
        body = (
          await request('/album/songs', {
            method: 'POST',
            query: { id: numeric, page, pagesize: ALBUM_PAGE_SIZE },
            cookie
          })
        ).body
      } catch (error) {
        // 后页失败保住已拿到的页：几十首里挂一页，前面那些照样能播。
        write(`[kugou] album songs page ${page} failed: ${messageOf(error)}`)
        break
      }
      if (page === 1) total = readAlbumSongCount(body)
      const batch = readAlbumSongs(body)
      if (batch.length === 0) break
      songs.push(...batch)
      if (total > 0 && songs.length >= total) break
    }
    return { detail: { ...detail, songCount: total || songs.length }, songs: rememberAll(songs) }
  } catch (error) {
    write(`[kugou] album failed: ${messageOf(error)}`)
    return null
  }
}

/** 一个艺人的头部。曲目与专辑各自分页，不在这里顺手抓。 */
export async function kugouArtist(id: string | number): Promise<KugouArtistDetail | null> {
  const numeric = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (!(await ensureServer())) return null

  const state = readState(activeProfileId)
  const cookie = state.token ? cookieHeader(state) : undefined

  try {
    const response = await request('/artist/detail', {
      method: 'POST',
      query: { id: numeric },
      cookie
    })
    return readArtistDetail(response.body)
  } catch (error) {
    write(`[kugou] artist failed: ${messageOf(error)}`)
    return null
  }
}

/**
 * 一个艺人的歌。
 *
 * 上游按页给，而共享的 catalog 契约按 `limit + offset` 问，所以这里把 offset
 * 折算成页码：`page = floor(offset / limit) + 1`。页码不连续时（offset 不是
 * limit 的整数倍）会重复几首，界面按 id 去重不指望这里对齐。
 */
export async function kugouArtistSongs(
  id: string | number,
  limit = 100,
  offset = 0
): Promise<KugouSong[]> {
  const numeric = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(numeric) || numeric <= 0) return []
  if (!(await ensureServer())) return []

  const pagesize = Math.min(Math.max(Math.trunc(limit) || 100, 1), 200)
  const page = Math.floor(Math.max(offset, 0) / pagesize) + 1
  const state = readState(activeProfileId)
  const cookie = state.token ? cookieHeader(state) : undefined

  try {
    const response = await request('/artist/audios', {
      method: 'POST',
      query: { id: numeric, pagesize, page, sort: 'hot' },
      cookie
    })
    return rememberAll(readArtistAudios(response.body))
  } catch (error) {
    write(`[kugou] artist audios failed: ${messageOf(error)}`)
    return []
  }
}

/** 一个艺人的专辑，分页同上。 */
export async function kugouArtistAlbums(
  id: string | number,
  limit = 60,
  offset = 0
): Promise<KugouAlbumEntry[]> {
  const numeric = typeof id === 'number' ? id : Number(id)
  if (!Number.isFinite(numeric) || numeric <= 0) return []
  if (!(await ensureServer())) return []

  const pagesize = Math.min(Math.max(Math.trunc(limit) || 60, 1), 200)
  const page = Math.floor(Math.max(offset, 0) / pagesize) + 1
  const state = readState(activeProfileId)
  const cookie = state.token ? cookieHeader(state) : undefined

  try {
    const response = await request('/artist/albums', {
      method: 'POST',
      query: { id: numeric, pagesize, page, sort: 'hot' },
      cookie
    })
    return readArtistAlbums(response.body)
  } catch (error) {
    write(`[kugou] artist albums failed: ${messageOf(error)}`)
    return []
  }
}

// --- 每日推荐 ------------------------------------------------------------

/**
 * 每日推荐：`/recommend/songs`，30 首，**不用登录**。
 *
 * 这是酷狗唯一免登录就能拿到的推荐流，也是漫游池在酷狗那一侧的来源。登录后上游
 * 会按账号口味给，但接口与形状不变，所以这里不区分登录态。
 */
export async function kugouDailyRecommend(): Promise<KugouSong[]> {
  if (!(await ensureServer())) return []

  const state = readState(activeProfileId)
  const cookie = state.token ? cookieHeader(state) : undefined

  try {
    const response = await request('/recommend/songs', { method: 'POST', cookie })
    return rememberAll(readDailySongs(response.body))
  } catch (error) {
    write(`[kugou] daily recommend failed: ${messageOf(error)}`)
    return []
  }
}

// --- 取流 ---------------------------------------------------------------

/**
 * 解析播放地址。
 *
 * 先看登录态：酷狗现在对未登录请求一律答 `20028`（实测四种入参组合都试过），
 * 所以没 token 时直接给 `login-required`，不浪费一次注定失败的请求，也不让
 * 用户以为「点了没反应」。
 *
 * 登录后逐档下降：上游对拿不到的档位不是报错而是不给 `url`，只有在最后一档
 * 也被拒时才真正说明「这首歌放不了」。
 */
export async function kugouStreamUrl(
  songId: string | number,
  quality?: KugouQuality
): Promise<KugouStreamResult> {
  const state = readState(activeProfileId)
  const requested = quality ?? state.quality
  const song = songOf(songId)
  if (!song) {
    return {
      ok: false,
      reason: 'unknown',
      message: '本地还没有这首歌的酷狗信息，请重新搜索后再播放'
    }
  }
  if (!state.token) {
    return {
      ok: false,
      reason: 'login-required',
      message: '酷狗需要登录账号后才能取到播放地址'
    }
  }
  if (!(await ensureServer())) {
    return { ok: false, reason: 'service-unavailable', message: serverDetail || undefined }
  }

  let lastReason: KugouStreamResult | null = null

  for (const tier of tierLadder(requested)) {
    const hash = hashForTier(song, tier)
    if (!hash) {
      // 这一档上游没给 hash（例如只有 128k）：跳过去，但记住没成功过。
      lastReason = {
        ok: false,
        reason: 'unknown',
        message: '这首歌没有这一档的音质'
      }
      continue
    }

    let body: unknown
    try {
      const response = await request('/song/url', {
        query: {
          hash,
          album_id: song.albumId || undefined,
          album_audio_id: song.albumAudioId || undefined,
          quality: TIER_FORMATS[tier].quality
        },
        cookie: cookieHeader(state)
      })
      body = response.body
    } catch (error) {
      // 传输失败不是档位问题，继续下降只会把同一个失败重复三遍。
      const reason = classifyStreamFailure({ error })
      return { ok: false, reason, message: describeFailure(reason) }
    }

    const url = readSongUrl(body)
    if (url) {
      const format = TIER_FORMATS[tier]
      return {
        ok: true,
        url,
        quality: requested,
        level: tier,
        br: format.bitrate,
        lossless: format.lossless,
        trial: false
      }
    }

    const failure = readUpstreamFailure(body)
    const reason = classifyStreamFailure({
      errcode: failure.errcode,
      status: failure.status,
      upstreamMessage: failure.message,
      loggedIn: true
    })
    lastReason = { ok: false, reason, message: failure.message || describeFailure(reason) }
  }

  return (
    lastReason ?? {
      ok: false,
      reason: 'unknown',
      message: describeFailure('unknown')
    }
  )
}

// --- 扫码登录 -----------------------------------------------------------

/**
 * 待扫的二维码，按不透明 key 存在主进程。
 *
 * 渲染层只看得到 `key`，轮询要用的上游 `qrcode` 不必过一遍页面。一次只能开
 * 一个登录，所以是单槽而不是 map。
 */
let pendingQr: { key: string; qrcode: string; at: number } | null = null
const QR_TTL_MS = 5 * 60 * 1000

export async function kugouQrCreate(): Promise<KugouQrSession> {
  if (!(await ensureServer())) return { key: '', imageDataUrl: '' }

  const keyResponse = await request('/login/qr/key', { query: { type: 'web' } })
  const qrcode = readQrKey(keyResponse.body)
  if (!qrcode) return { key: '', imageDataUrl: '' }

  let imageDataUrl = ''
  try {
    const createResponse = await request('/login/qr/create', {
      query: { key: qrcode, qrimg: 1 }
    })
    imageDataUrl = readQrImage(createResponse.body)
  } catch (error) {
    write(`[kugou] qr create failed: ${messageOf(error)}`)
  }

  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  pendingQr = { key, qrcode, at: Date.now() }
  return { key, imageDataUrl }
}

export async function kugouQrCheck(key: string): Promise<KugouQrResult> {
  const pending = pendingQr
  if (!pending || pending.key !== key) {
    return { status: 'expired', message: '二维码已失效，请重新获取' }
  }
  if (Date.now() - pending.at > QR_TTL_MS) {
    pendingQr = null
    return { status: 'expired', message: '二维码已过期，请重新获取' }
  }
  if (!(await ensureServer())) {
    return { status: 'failed', message: serverDetail || '酷狗本地服务不可用' }
  }

  let checked: ReturnType<typeof readQrCheck>
  let setCookie: string[] = []
  try {
    const response = await request('/login/qr/check', { query: { key: pending.qrcode } })
    setCookie = response.setCookie
    checked = readQrCheck(response.body)
    // 每次轮询都留下状态，排障时能看出卡在等待还是待确认。
    write(`[kugou] qr check status=${checked.status}`)
  } catch (error) {
    write(`[kugou] qr check failed: ${messageOf(error)}`)
    return { status: 'waiting', message: '网络不太好，正在重试' }
  }

  const fromCookies = sessionFromCookies(setCookie)
  const token = checked.token || fromCookies.token
  const userid = checked.userid || fromCookies.userid

  // 4 = 成功（vendor login_qr_check.js 的语义：0 过期 / 1 等待 / 2 待确认 / 4 成功）
  if (checked.status === 4 || (token && checked.status !== 0)) {
    pendingQr = null
    writeState(activeProfileId, { token, userid, nickname: '', avatarUrl: null })
    const account = await kugouLoginStatus()
    return { status: 'confirmed', account: account ?? undefined }
  }
  if (checked.status === 0) {
    pendingQr = null
    return { status: 'expired', message: checked.message || '二维码已过期，请重新获取' }
  }
  if (checked.status === 2) return { status: 'scanned' }
  return { status: 'waiting', message: checked.message }
}

// --- 账号 ---------------------------------------------------------------

/**
 * 这个档案登录的是谁。
 *
 * 三种结果分开处理：
 *  - 上游答了账号 -> 合并进会话并返回；
 *  - 上游说「没有登录」-> null，但**保留 token**。只有 `logout()` 才忘掉凭据，
 *    一次被拒的探测不代表用户想退出登录；
 *  - 探测因为别的原因失败 -> 返回已知的账号（昵称头像），一次网络抖动不能让
 *    账号从界面上消失。
 */
export async function kugouLoginStatus(): Promise<KugouAccount | null> {
  return await accountOf(activeProfileId)
}

async function accountOf(profileId: string): Promise<KugouAccount | null> {
  const state = readState(profileId)
  if (!state.token) return null

  const stored: KugouAccount = {
    id: Number(state.userid) || 0,
    nickname: state.nickname || (state.userid ? `酷狗用户${state.userid}` : '酷狗用户'),
    avatarUrl: state.avatarUrl
  }
  if (!(await ensureServer())) return stored

  try {
    const response = await request('/user/detail', {
      method: 'POST',
      cookie: cookieHeader(state)
    })
    const account = readAccount(response.body, state.userid)
    const answerLooksEmpty = !account.nickname || account.nickname.startsWith('酷狗用户')
    if (answerLooksEmpty) {
      // /user/detail 的成功形状还没实测：把 key 写进日志，扫一次码就能收口。
      write(`[kugou] user/detail raw keys=${describeKeys(response.body)}`)
    }
    const next = writeState(profileId, {
      nickname: answerLooksEmpty ? state.nickname : account.nickname,
      avatarUrl: account.avatarUrl ?? state.avatarUrl
    })
    return {
      id: account.id || stored.id,
      nickname: next.nickname || stored.nickname,
      avatarUrl: next.avatarUrl
    }
  } catch (error) {
    write(`[kugou] account probe failed, keeping stored account: ${messageOf(error)}`)
    return stored
  }
}

/** 某个档案登录的是谁（给档案页用），不影响当前档案。 */
export async function kugouAccountFor(profileId: string): Promise<KugouAccount | null> {
  const previous = activeProfileId
  try {
    activeProfileId = String(profileId ?? '').trim() || 'default'
    return await accountOf(activeProfileId)
  } finally {
    activeProfileId = previous
  }
}

export function kugouLogout(): boolean {
  clearSession(activeProfileId)
  // 待扫的码属于刚退出的账号。
  pendingQr = null
  return true
}

export function kugouLogoutProfile(profileId: string): boolean {
  clearSession(profileId)
  if (profileId === activeProfileId) pendingQr = null
  return true
}

// --- 音质 ---------------------------------------------------------------

export function kugouGetQuality(): KugouQuality {
  return readState(activeProfileId).quality
}

export function kugouSetQuality(quality: KugouQuality): KugouQuality {
  return writeState(activeProfileId, { quality }).quality
}

// --- 小工具 -------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 未实测形状的排障用：只写第一层 key，不写值（里面有 token）。 */
function describeKeys(raw: unknown): string {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : {}
  return JSON.stringify({ root: Object.keys(root), data: Object.keys(data) })
}
