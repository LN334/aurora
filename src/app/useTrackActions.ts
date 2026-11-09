import { useCallback } from 'react'
import { player } from '../features/player/actions'
import type { Track } from '../types'

/**
 * 「把这一整份东西从头放一遍」。
 *
 * 剩下一条：专辑按它自己的曲序放，不按曲库顺序。艺人、文件夹、歌单的「播全部」
 * 现在分别由各自的页面自己做——它们本来就知道自己那一份是哪几首，绕一圈回到
 * 这里反而多一层参数。
 */
export function useTrackActions(options: {
  albums: { id: string; trackIds: string[] }[]
  trackById: Map<string, Track>
}) {
  const { albums, trackById } = options

  /** An album plays in its own order, not in library order. */
  const playAlbum = useCallback(
    (albumId: string) => {
      const album = albums.find((item) => item.id === albumId)
      if (!album) return
      const queue = album.trackIds
        .map((id) => trackById.get(id))
        .filter((item): item is Track => Boolean(item))
      player.playQueue(queue, 0)
    },
    [albums, trackById]
  )

  return { playAlbum }
}
