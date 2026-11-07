/**
 * 我喜欢的歌曲。
 *
 * 收藏是「人做的判断」，不是磁盘事实：一首歌可能来自本地文件，也可能只有
 * 一个在线曲目号。所以这里存的是整条 Track 快照（和播放历史同一个理由）——
 * 只存 id 的话，在线歌曲在曲库里根本查不到，收藏页会是空的。
 *
 * 存储按档案分槽（profile-scoped），和歌单一样：换档案就是换一个人，
 * 他的喜欢不该跟着别人走。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
/*
 * 显式 .ts 扩展：和 playlists/store.ts 同样的原因——tests 用 Node 直接加载
 * 这些模块时，ESM 解析器不会像 Vite 那样猜扩展名。
 */
import { createProfileScopedStorage } from '../accounts/profile-storage.ts'
import type { Track } from '../../types'

const KEY = 'aurora.favorites'

export interface LikeEntry {
  id: string
  /** 什么时候喜欢的，用来按时间倒序。 */
  at: number
  /** 整条曲目快照，收藏页直接拿它渲染和播放。 */
  track: Track
}

interface FavoritesState {
  liked: LikeEntry[]
  has(id: string): boolean
  /** 喜欢 / 取消喜欢，返回操作后是不是「已喜欢」。 */
  toggle(track: Track): boolean
  remove(id: string): void
  clear(): void
}

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      liked: [],

      has(id) {
        return get().liked.some((entry) => entry.id === id)
      },

      toggle(track) {
        const already = get().liked.some((entry) => entry.id === track.id)
        if (already) {
          set((state) => ({ liked: state.liked.filter((entry) => entry.id !== track.id) }))
          return false
        }
        /* 新喜欢的排最前：最近挑的应该最先看到。指纹信息以最新一次为准。 */
        set((state) => ({
          liked: [{ id: track.id, at: Date.now(), track }, ...state.liked.filter((entry) => entry.id !== track.id)]
        }))
        return true
      },

      remove(id) {
        set((state) => ({ liked: state.liked.filter((entry) => entry.id !== id) }))
      },

      clear() {
        set({ liked: [] })
      }
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => createProfileScopedStorage())
    }
  )
)

/** 收藏里可播放的曲目，最新在前。 */
export function likedTracks(entries: LikeEntry[]): Track[] {
  return entries.map((entry) => entry.track)
}
