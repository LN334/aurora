import { useEffect, useState } from 'react'
import { bridge } from '../../bridge'
import { listAvailableProviders } from './registry'
import type { ProviderCollectedAlbum, ProviderFollowedArtist, ProviderId } from './types'

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
export function useSignedInPlatforms(): Record<string, boolean> | null {
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

interface CollectedAlbum extends ProviderCollectedAlbum {
  key: string
  providerId: ProviderId
  providerLabel: string
}

interface FollowedArtist extends ProviderFollowedArtist {
  key: string
  providerId: ProviderId
  providerLabel: string
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

/**
 * 收藏的专辑，各家平台合在一起。
 *
 * 遍历所有「有这条通道」的 provider：定义过 `collectedAlbums` 且这一家登录过，
 * 就取一份。哪家没有这种关系就自然不出现——不再按平台名字写分支，加一家平台
 * 只需要它在自己的 provider 里实现方法。
 */
async function loadCollectedAlbums(signed: Record<string, boolean>): Promise<CollectedAlbum[]> {
  const loads: Promise<CollectedAlbum[]>[] = []

  for (const provider of listAvailableProviders()) {
    if (!provider.collectedAlbums || !signed[provider.id]) continue
    loads.push(
      provider
        .collectedAlbums()
        .then((list) =>
          list.map((album) => ({
            key: provider.id + ':' + album.id,
            providerId: provider.id,
            providerLabel: provider.displayName,
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

  if (loads.length === 0) return []
  const groups = await Promise.all(loads)
  return groups.flat()
}

/**
 * 收藏的专辑，各家平台合在一起。
 *
 * 只有「定义过 collectedAlbums」的平台会给出东西，未登录的平台也交不出任何东西。
 * 拿不到的平台直接不出现，而不是占一块写着「暂无」的空位——那会让「本来就没有」
 * 看起来像「没加载出来」。
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
  const [rows, setRows] = useState<CollectedAlbum[]>([])

  useEffect(() => {
    let alive = true
    if (!signed || !Object.values(signed).some(Boolean)) {
      setRows([])
      return
    }
    const key = Object.keys(signed)
      .filter((id) => signed[id])
      .sort()
      .join(',')
    void sharedFetch('collected:' + key, () => loadCollectedAlbums(signed))
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [signed])

  return rows
}

/**
 * 关注的艺人，各家平台合在一起。
 *
 * 同收藏专辑：遍历「定义过 followedArtists」的 provider，登录过才取。
 */
async function loadFollowedArtists(signed: Record<string, boolean>): Promise<FollowedArtist[]> {
  const loads: Promise<FollowedArtist[]>[] = []

  for (const provider of listAvailableProviders()) {
    if (!provider.followedArtists || !signed[provider.id]) continue
    loads.push(
      provider
        .followedArtists()
        .then((list) =>
          list.map((artist) => ({
            key: provider.id + ':' + artist.id,
            providerId: provider.id,
            providerLabel: provider.displayName,
            ...artist
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
 * 关注的艺人，各家平台合在一起。
 *
 * 有这条通道的平台都算（当前是网易云与 QQ）；酷狗和汽水没有这种关系，未登录的
 * 平台交不出任何东西，所以直接不出现。
 */
export function useFollowedArtists(): FollowedArtist[] {
  const signed = useSignedInPlatforms()
  const [rows, setRows] = useState<FollowedArtist[]>([])

  useEffect(() => {
    let alive = true
    if (!signed || !Object.values(signed).some(Boolean)) {
      setRows([])
      return
    }
    const key = Object.keys(signed)
      .filter((id) => signed[id])
      .sort()
      .join(',')
    void sharedFetch('artists:' + key, () => loadFollowedArtists(signed))
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [signed])

  return rows
}

/**
 * 有这条通道的平台里，有没有哪一家登录了。
 *
 * 空态文案据此分两种说法：一家都没登录说「还没有登录」，登录了却仍然空说「可能
 * 是登录过期」。只看「有通道」的那几家——酷狗登录了也交不出关注艺人，不能算数。
 */
export function anySourceSigned(
  kind: 'collectedAlbums' | 'followedArtists',
  signed: Record<string, boolean> | null
): boolean {
  if (!signed) return false
  return listAvailableProviders().some((provider) => {
    const has = kind === 'collectedAlbums' ? provider.collectedAlbums : provider.followedArtists
    return typeof has === 'function' && Boolean(signed[provider.id])
  })
}