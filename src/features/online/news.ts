import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { sourceOrder } from '../settings/source-order'
import { getProvider } from './registry'
import type { PlatformBackend } from './store'
import { mergeVersions } from './unify'
import type { ProviderId } from './types'

/**
 * 各平台的新歌速递。
 *
 * 首页那块「新歌」原先只问网易云一家，另外三家其实是有的：QQ 与酷狗的新歌
 * 榜都不需要登录（实测匿名可读）。这里把它们并进来，同一首在两家榜单上都出现
 * 时由 mergeVersions 合成一行、两个平台徽章并排，播的时候仍按设置里的音源
 * 优先级挑一个。
 *
 * 汽水的推荐流要有账号才有内容，先不进来：宁可少一行，不要一行空着。
 */
const SOURCES: ProviderId[] = ['qq', 'kugou']

async function shelfNewSongs(id: ProviderId, limit: number): Promise<Track[]> {
  const backend = (getProvider(id)?.backend as PlatformBackend | undefined) ?? null
  if (!backend) return []
  const api = window.aurora
  if (!api) return []

  try {
    const songs = id === 'qq' ? await api.qq.newSongs(limit) : await api.kugou.newSongs(limit)
    const toTrack = backend.toTrack as (song: never) => Track
    return (songs ?? []).map((song) => toTrack(song as never))
  } catch {
    // 一家挂了不该让整块消失：另外还有网易云那一份。
    return []
  }
}

export async function loadPlatformNewSongs(limit = 20): Promise<Track[]> {
  const rounds = await Promise.all(SOURCES.map((id) => shelfNewSongs(id, limit)))
  return mergeVersions(rounds.flat(), sourceOrder())
}

export function usePlatformNewSongs(limit = 20): Track[] {
  const [rows, setRows] = useState<Track[]>([])

  useEffect(() => {
    let alive = true
    void loadPlatformNewSongs(limit)
      .then((next) => {
        if (alive) setRows(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [limit])

  return rows
}
