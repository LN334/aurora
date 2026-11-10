import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { sourceOrder } from '../settings/source-order'
import { getProvider } from './registry'
import { usePushPlatforms } from './push-platforms'
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

/**
 * 问哪几家跟着「推荐来源」的勾选走。
 *
 * 首页这几块推送位（每日推荐、推荐歌单、推荐专辑、最近新歌）与漫游共用同一个
 * 勾选：用户关掉一家，是「别拿它来推给我」，这几块一起不再问它。
 *
 * 另外还过一道 push-platforms：默认只问登录着的平台（见那里的注释）。网易云与
 * 酷狗的新歌榜游客也能读，但「游客能读的榜单」不等于「给你的推荐」。
 */
async function loadPlatformNewSongs(limit = 20, platforms?: ProviderId[]): Promise<Track[]> {
  const wanted = platforms === undefined ? null : new Set(platforms)
  const ids = SOURCES.filter((id) => wanted === null || wanted.has(id))
  if (ids.length === 0) return []
  const rounds = await Promise.all(ids.map((id) => shelfNewSongs(id, limit)))
  return mergeVersions(rounds.flat(), sourceOrder())
}

/**
 * `tick` 变了就重取一次。
 *
 * 首页那块「最近新歌」要有换一批：只换本地切片的话，两次点的还是平台同一份
 * 榜单；只重取不换切片的话，两个平台的新歌榜几小时才动一次，看起来又是没反应。
 * 所以按钮同时做两件事——这里靠 tick 重取，页面上再向前挪一格切片。
 */
export function usePlatformNewSongs(limit = 20, tick = 0): Track[] {
  const chosen = usePushPlatforms()
  const chosenKey = chosen ? chosen.join(',') : ''
  const [rows, setRows] = useState<Track[]>([])

  useEffect(() => {
    // 还没问出「哪几家登录着」，先别取：先取一版再收紧，看起来就是内容在换。
    if (!chosen) return
    let alive = true
    void loadPlatformNewSongs(limit, chosen)
      .then((next) => {
        if (alive) setRows(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // chosen 每份快照都会新建，用 join 后的字符串当依赖。
  }, [limit, tick, chosenKey])

  return rows
}
