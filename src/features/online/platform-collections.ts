import { useEffect, useState } from 'react'
import { bridge } from '../../bridge'
import type { ProviderId } from './types'

/**
 * 平台上的「收藏」：专辑与关注的艺人。
 *
 * 歌单不在这里。歌单有归属之分（自己建的 / 从别人那里收的 / 平台分不出来的），
 * 那套判定连同卡片形状一起搬进了 `playlist-cards.ts`；这里只剩账号里的关系：
 * 收藏的专辑、关注的艺人。它们没有归属问题——收藏来的就是收藏来的。
 *
 * 关系只存在于平台账号里，所以这些数据一律按账号来，未登录就是空。
 */

/**
 * 问主进程「谁登录过」。
 *
 * 纯读会话、不拉起任何后端，所以页面一挂载就能问。收藏页按这个结果决定问哪
 * 几家；以前是等渲染层的 init 把账号取回来，等于多等一个登录状态往返，页面
 * 就会先空上几秒。
 */
function useSignedInPlatforms(): Record<string, boolean> | null {
  const [signed, setSigned] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    let alive = true
    void bridge.platforms
      .signedIn()
      .then((map) => {
        if (alive) setSigned(map)
      })
      .catch(() => {
        if (alive) setSigned({})
      })
    return () => {
      alive = false
    }
  }, [])

  return signed
}

interface CollectedAlbum {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  /** 艺人 id：卡片上那行名字据此点进艺人页；缺了就只是文字。 */
  artistId?: number
  year: number
  songCount: number
}

interface FollowedArtist {
  key: string
  providerId: ProviderId
  id: number
  name: string
  avatarUrl: string | null
  albumCount: number
  musicCount: number
}

/*
 * 外壳只为左栏那个数字取一次，页面要整份收藏又取一次——同一个 hook 的两处调用
 * 不该各问一遍平台。六十秒内共用同一次请求：一个是数字，一个是同一批数据。
 * 失败立刻作废，下一次重新问；收藏真变了，六十秒后也会重取。
 */
const SHARED_MS = 60_000
const shared = new Map<string, { at: number; promise: Promise<unknown> }>()

function sharedFetch<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = shared.get(key)
  if (hit && Date.now() - hit.at < SHARED_MS) return hit.promise as Promise<T>
  const promise = load()
  shared.set(key, { at: Date.now(), promise })
  promise.catch(() => {
    if (shared.get(key)?.promise === promise) shared.delete(key)
  })
  return promise
}

async function loadCollectedAlbums(withNetease: boolean, withQq: boolean): Promise<CollectedAlbum[]> {
  const loads: Promise<CollectedAlbum[]>[] = []

  const netease = window.aurora?.netease
  if (withNetease && netease?.albumSublist) {
    loads.push(
      netease
        .albumSublist()
        .then((list) =>
          list.map((album) => ({
            key: 'netease:' + album.id,
            providerId: 'netease' as ProviderId,
            providerLabel: '网易云音乐',
            id: album.id,
            name: album.name,
            coverUrl: album.coverUrl,
            artistName: album.artistName,
            artistId: album.artistId,
            year: album.year,
            songCount: album.songCount
          }))
        )
        .catch(() => [])
    )
  }

  const qq = window.aurora?.qq
  if (withQq && qq?.collectedAlbums) {
    loads.push(
      qq
        .collectedAlbums()
        .then((list) =>
          list.map((album) => ({
            key: 'qq:' + album.id,
            providerId: 'qq' as ProviderId,
            providerLabel: 'QQ 音乐',
            id: album.id,
            name: album.name,
            coverUrl: album.coverUrl,
            artistName: album.artistName,
            /* QQ 只回艺人 mid，没有数字 id，而艺人页按数字 id 打开：
               这一家的收藏卡上名字先只是文字，等按 mid 反查接通再补。 */
            year: album.year ?? 0,
            songCount: album.songCount
          }))
        )
        .catch(() => [])
    )
  }

  if (loads.length === 0) return []
  const groups = await Promise.all(loads)
  return groups.flat()
}

/**
 * 收藏的专辑，各家平台合在一起。
 *
 * 只有网易云和 QQ 有这条通道：酷狗和汽水没有「收藏专辑」这种关系，未登录的
 * 平台也交不出任何东西。拿不到的平台直接不出现，而不是占一块写着「暂无」的
 * 空位——那会让「本来就没有」看起来像「没加载出来」。
 */
export function useCollectedAlbums(): CollectedAlbum[] {
  const signed = useSignedInPlatforms()
  /*
   * 不等渲染层的账号对象。
   *
   * 收藏列表在平台上，主进程拿到会话就能回答；等 store 把 account 拉回来再取，
   * 等于白白多等一次登录状态往返，页面先空几秒。这里只问「有没有登录过」——
   * 那句话是读本地会话，几十毫秒就回来了。
   */
  const withNetease = Boolean(signed?.netease)
  const withQq = Boolean(signed?.qq)
  const [rows, setRows] = useState<CollectedAlbum[]>([])

  useEffect(() => {
    let alive = true
    if (!signed || (!withNetease && !withQq)) {
      setRows([])
      return
    }
    void sharedFetch('collected:' + withNetease + ':' + withQq, () =>
      loadCollectedAlbums(withNetease, withQq)
    )
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [signed, withNetease, withQq])

  return rows
}

/**
 * 关注的艺人。目前只有网易云有「关注歌手」这条通道：QQ 音乐没有对应接口，
 * 酷狗与汽水也没有这种关系——所以这里只问一家，拿不到就是空。
 */
export function useFollowedArtists(): FollowedArtist[] {
  const signed = useSignedInPlatforms()
  const withNetease = Boolean(signed?.netease)
  const [rows, setRows] = useState<FollowedArtist[]>([])

  useEffect(() => {
    let alive = true
    const netease = window.aurora?.netease
    if (!withNetease || !netease?.artistSublist) {
      setRows([])
      return
    }
    void sharedFetch('artists', () =>
      netease
        .artistSublist()
        .then((list) =>
          list.map((artist) => ({
            key: 'netease:' + artist.id,
            providerId: 'netease' as ProviderId,
            id: artist.id,
            name: artist.name,
            avatarUrl: artist.avatarUrl,
            albumCount: artist.albumCount,
            musicCount: artist.musicCount
          }))
        )
    )
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [withNetease])

  return rows
}