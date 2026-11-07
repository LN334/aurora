import { useEffect, useMemo, useState } from 'react'
import { useOnlineStore } from './store'
import type { ProviderId } from './types'

/**
 * 平台上的「收藏」：收藏的专辑与收藏的歌单。
 *
 * 与「我的歌单」不是一回事：那个是自己在平台上建的，这里是别人那里收的。
 * 收藏关系只存在于平台账号里，所以这一页的数据一律按账号来，未登录就是空。
 */
const PLATFORMS: { id: ProviderId; label: string }[] = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'qq', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' },
  { id: 'qishui', label: '汽水音乐' }
]

export interface CollectedAlbum {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  year: number
  songCount: number
}

export interface CollectedPlaylist {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

/** 收藏的专辑。目前只有网易云有这条通道，其它平台未登录也给不出收藏。 */
export function useCollectedAlbums(): CollectedAlbum[] {
  const account = useOnlineStore('netease')((state) => state.account)
  const [rows, setRows] = useState<CollectedAlbum[]>([])

  useEffect(() => {
    let alive = true
    const api = window.aurora?.netease
    if (!api?.albumSublist) {
      setRows([])
      return
    }
    void api
      .albumSublist()
      .then((list) => {
        if (!alive) return
        setRows(
          list.map((album) => ({
            key: 'netease:' + album.id,
            providerId: 'netease' as ProviderId,
            providerLabel: '网易云音乐',
            id: album.id,
            name: album.name,
            coverUrl: album.coverUrl,
            artistName: album.artistName,
            year: album.year,
            songCount: album.songCount
          }))
        )
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [account])

  return rows
}

/** 收藏的歌单：各平台账号里 subscribed 的那些。 */
export function useCollectedPlaylists(): CollectedPlaylist[] {
  const netease = useOnlineStore('netease')()
  const qq = useOnlineStore('qq')()
  const kugou = useOnlineStore('kugou')()
  const qishui = useOnlineStore('qishui')()

  useEffect(() => {
    for (const platform of PLATFORMS) {
      void useOnlineStore(platform.id).getState().init().catch(() => {})
    }
  }, [])

  return useMemo(() => {
    const rows: CollectedPlaylist[] = []
    const push = (platform: { id: ProviderId; label: string }, list: typeof netease.playlists) => {
      for (const playlist of list) {
        if (!playlist.subscribed) continue
        rows.push({
          key: platform.id + ':' + playlist.id,
          providerId: platform.id,
          providerLabel: platform.label,
          id: playlist.id,
          name: playlist.name,
          coverUrl: playlist.coverUrl,
          trackCount: playlist.trackCount,
          creator: playlist.creator
        })
      }
    }
    push(PLATFORMS[0], netease.playlists)
    push(PLATFORMS[1], qq.playlists)
    push(PLATFORMS[2], kugou.playlists)
    push(PLATFORMS[3], qishui.playlists)
    return rows
  }, [netease.playlists, qq.playlists, kugou.playlists, qishui.playlists])
}