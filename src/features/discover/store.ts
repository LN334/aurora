import { create } from 'zustand'
import type { NeteaseDiscoverPlaylist, NeteaseSong } from '../../env'
import { neteaseDiscover } from '../netease/api'
import { normalizePlaylists, normalizeSongs, type DiscoverKind } from './pure'

/**
 * 「发现」页的数据层。
 *
 * 三个栏目各自缓存：切平台/切栏目再切回来不该重新发请求（上游这三个接口都
 * 有频率限制，而它们的内容以小时计变化）。同一栏目并发的两次加载合并成一次，
 * 否则首屏渲染的 effect 与用户点击会各发一份。
 *
 * 失败也记在缓存里，不抛给调用方：页面据此显示「读取失败 + 重试」，而不是
 * 一个空白区——这是启动首屏，空白会被当成应用坏了。
 */

export type DiscoverStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface DiscoverBlock {
  status: DiscoverStatus
  songs: NeteaseSong[]
  playlists: NeteaseDiscoverPlaylist[]
  /** 失败时给用户看的一句话；成功时为空串。 */
  error: string
  /** 加载成功的时间，用于 TTL。 */
  at: number
}

/** 与在线平台其它缓存同一量级：十分钟足够，再长就看不到新推荐了。 */
const TTL_MS = 10 * 60 * 1000

/**
 * 一次取多少条。
 *
 * 和主进程的默认页一致：偏移量按这个步长前进，「换一批」才不会和上一批
 * 重叠。24 条在宽窗口里正好铺满三行四列。
 */
export const DISCOVER_PAGE = 24

function blankBlock(): DiscoverBlock {
  return { status: 'idle', songs: [], playlists: [], error: '', at: 0 }
}

function blankBlocks(): Record<DiscoverKind, DiscoverBlock> {
  return { playlists: blankBlock(), newsongs: blankBlock(), quality: blankBlock() }
}

/** 正在进行的请求，按栏目保存，保证同一栏目只有一个。 */
const inFlight: Partial<Record<DiscoverKind, Promise<void>>> = {}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '网络请求失败'
}

interface DiscoverStore {
  tab: DiscoverKind
  blocks: Record<DiscoverKind, DiscoverBlock>
  /**
   * 每个栏目已经翻到第几条。
   *
   * 「换一批」以前只是重发一次请求，而「推荐新歌」一天只有一份：重发拿回的是
   * 同一个列表，看起来就是按钮没反应。现在每次前进一页，主进程按 offset 换到
   * 下一个榜单 / 下一页歌单。
   */
  offsets: Record<DiscoverKind, number>
  setTab(kind: DiscoverKind): void
  load(kind: DiscoverKind, options?: { force?: boolean }): Promise<void>
  /** 换一批：游标前进一页再重取。 */
  next(kind: DiscoverKind): Promise<void>
}

export const useDiscover = create<DiscoverStore>((set, get) => ({
  tab: 'newsongs',
  blocks: blankBlocks(),
  offsets: { playlists: 0, newsongs: 0, quality: 0 },

  setTab: (kind) => set({ tab: kind }),

  next: (kind) => {
    set((state) => ({
      offsets: { ...state.offsets, [kind]: state.offsets[kind] + DISCOVER_PAGE }
    }))
    return get().load(kind, { force: true })
  },

  load: (kind, options) => {
    const block = get().blocks[kind]
    const fresh =
      block.status === 'ready' && Date.now() - block.at < TTL_MS && block.error === ''
    if (!options?.force && fresh) return Promise.resolve()

    const pending = inFlight[kind]
    if (pending) return pending

    set((state) => ({
      blocks: {
        ...state.blocks,
        [kind]: { ...state.blocks[kind], status: 'loading', error: '' }
      }
    }))

    const run = (async () => {
      try {
        const result = await neteaseDiscover(kind, DISCOVER_PAGE, get().offsets[kind])
        set((state) => ({
          blocks: {
            ...state.blocks,
            [kind]: {
              status: 'ready',
              songs: normalizeSongs(result.songs),
              playlists: normalizePlaylists(result.playlists),
              error: '',
              at: Date.now()
            }
          }
        }))
      } catch (error) {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [kind]: {
              ...state.blocks[kind],
              status: 'failed',
              error: errorText(error)
            }
          }
        }))
      } finally {
        delete inFlight[kind]
      }
    })()

    inFlight[kind] = run
    return run
  }
}))

/** 在 React 之外预取（例如启动时先把首屏那一栏读起来）。 */
export function loadDiscover(kind: DiscoverKind, force = false): Promise<void> {
  return useDiscover.getState().load(kind, { force })
}
