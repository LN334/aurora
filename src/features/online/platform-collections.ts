import { useEffect, useState } from 'react'
import { bridge } from '../../bridge'
import { useOnlineStore } from './store'
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
 * 进这一页时才把「登录过的那几家」的后端拉起来。
 *
 * 启动阶段现在只把会话指过去（rebind），不拉后端——这样游客冷启动不会为了
 * 一个用不到的平台付出上百 MB。但收藏页读的是账号里的关系，后端没起来时
 * `account` 是空的，页面就一直是「还没有收藏」。所以在这里按需 init：
 * 先用主进程的「谁登录过」（纯读会话、零加载）挑，再去 init，没登录过的
 * 平台一个都不碰。
 */
function useEnsureSignedInBackends(ids: string): void {
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

  useEffect(() => {
    if (!signed) return
    /* 依赖用拼出来的字符串，避免调用方每次渲染都传一个新数组、把 init 打上十遍。 */
    for (const id of ids.split(',') as ProviderId[]) {
      if (!signed[id]) continue
      void useOnlineStore(id)
        .getState()
        .init()
        .catch(() => undefined)
    }
  }, [ids, signed])
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

async function loadCollectedAlbums(neteaseId: number, qqId: number): Promise<CollectedAlbum[]> {
  const loads: Promise<CollectedAlbum[]>[] = []

  const netease = window.aurora?.netease
  if (neteaseId && netease?.albumSublist) {
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
  if (qqId && qq?.collectedAlbums) {
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
  useEnsureSignedInBackends('netease,qq')
  /*
   * 只认账号 id，不认账号对象。
   *
   * 以前依赖的是 account 这个对象本身：启动阶段 loginStatus 会写好几次状态，
   * 每次都换一个新对象，于是 effect 每次都重跑，一次冷启动能把 albumSublist
   * 打十几遍。id 变了才代表「换了一个人」，那才是真的需要重取。
   */
  const neteaseId = useOnlineStore('netease')((state) => state.account?.id ?? 0)
  const qqId = useOnlineStore('qq')((state) => state.account?.id ?? 0)
  const [rows, setRows] = useState<CollectedAlbum[]>([])

  useEffect(() => {
    let alive = true
    if (!neteaseId && !qqId) {
      setRows([])
      return
    }
    void sharedFetch('collected:' + neteaseId + ':' + qqId, () => loadCollectedAlbums(neteaseId, qqId))
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [neteaseId, qqId])

  return rows
}

/**
 * 关注的艺人。目前只有网易云有「关注歌手」这条通道：QQ 音乐没有对应接口，
 * 酷狗与汽水也没有这种关系——所以这里只问一家，拿不到就是空。
 */
export function useFollowedArtists(): FollowedArtist[] {
  useEnsureSignedInBackends('netease')
  const neteaseId = useOnlineStore('netease')((state) => state.account?.id ?? 0)
  const [rows, setRows] = useState<FollowedArtist[]>([])

  useEffect(() => {
    let alive = true
    const netease = window.aurora?.netease
    if (!neteaseId || !netease?.artistSublist) {
      setRows([])
      return
    }
    void sharedFetch('artists:' + neteaseId, () =>
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
  }, [neteaseId])

  return rows
}