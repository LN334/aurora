import { create } from 'zustand'
import { bridge, isNative } from '../../bridge'
import type { DownloadFormat, DownloadPrefs, DownloadRequest, DownloadView } from '../../env'
import type { Track } from '../../types'

interface DownloadStore {
  views: DownloadView[]
  prefs: DownloadPrefs | null
  open: boolean
  enqueue(request: DownloadRequest): Promise<boolean>
  cancel(id: string): void
  clear(): void
  reveal(id: string): void
  openFolder(): void
  setFormat(format: DownloadFormat): Promise<void>
  setBitrate(bitrate: number): Promise<void>
  pickDir(): Promise<void>
  setOpen(open: boolean): void
}

/**
 * Download queue as the renderer sees it.
 *
 * The list is owned by the main process (a download must outlive the panel that
 * started it), so this store is a mirror: commands go out, whole snapshots come
 * back on `downloads:state`.
 */
export const useDownloads = create<DownloadStore>((set) => ({
  views: [],
  prefs: null,
  open: false,

  async enqueue(request) {
    if (!isNative) return false
    const view = await bridge.downloads.enqueue(request)
    set((state) => ({
      // 主进程会广播一份完整列表；先本地插一条，面板立刻有反应。
      views: state.views.some((item) => item.id === view.id) ? state.views : [view, ...state.views]
    }))
    return true
  },

  cancel(id) {
    void bridge.downloads.cancel(id)
  },

  clear() {
    void bridge.downloads.clear().then(() => {
      const finished = new Set(['done', 'failed', 'canceled'])
      set((state) => ({ views: state.views.filter((view) => !finished.has(view.state)) }))
    })
  },

  reveal(id) {
    void bridge.downloads.reveal(id)
  },

  openFolder() {
    void bridge.downloads.openFolder()
  },

  async setFormat(format) {
    const prefs = await bridge.downloads.setPrefs({ format })
    set({ prefs })
  },

  async setBitrate(bitrate) {
    const prefs = await bridge.downloads.setPrefs({ bitrate })
    set({ prefs })
  },

  async pickDir() {
    const picked = await bridge.downloads.pickFolder()
    if (!picked) return
    const prefs = await bridge.downloads.setPrefs({ dir: picked })
    set({ prefs })
  },

  setOpen(open) {
    set({ open })
  }
}))

// 截图与手动验证要能在 DevTools 里塞几条任务；生产里没人读它，留着无副作用。
;(window as unknown as Record<string, unknown>).__auroraDownloads = useDownloads

let bound = false

/** Called once from App: subscribe after the first paint, not during it. */
export function bindDownloadEvents(): void {
  if (bound || !isNative) return
  bound = true
  bridge.downloads.onState((views) => {
    useDownloads.setState({ views })
  })
  void bridge.downloads.list().then((views) => useDownloads.setState({ views }))
  void bridge.downloads.getPrefs().then((prefs) => useDownloads.setState({ prefs }))
}

/**
 * 转成主进程认识的下载请求。
 *
 * 各平台的曲目 id 是「平台:上游 id」的形式，前缀既是去重键也是路由键；主进程
 * 取流只要冒号后面那一段。本机文件没有上游可取，返回 null 让调用方说明原因。
 */
export function downloadRequestOf(track: Track): DownloadRequest | null {
  const source = track.source
  if (source !== 'netease' && source !== 'qq' && source !== 'kugou' && source !== 'qishui') {
    return null
  }
  const trackId = track.id.slice(source.length + 1)
  if (!trackId) return null
  const artists = track.artistRefs?.map((artist) => artist.name).filter(Boolean)
  return {
    provider: source,
    trackId,
    title: track.title,
    artists: artists && artists.length > 0 ? artists : [track.artist],
    album: track.album,
    duration: track.duration
  }
}
