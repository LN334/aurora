import { useEffect, useState } from 'react'
import { usePushPlatforms } from './push-platforms'

/**
 * 首页「推荐专辑」。
 *
 * 推荐位要的是「平台在推什么」：网易云有新碟榜（top_album，不用账号）；QQ 与
 * 酷狗没有公开的新碟榜，只有新歌速递（实测也不用账号），新碟上市都伴随新歌，
 * 就把新歌所属的专辑抽出来当卡片。汽水没有专辑页（catalog.album 缺失），卡片
 * 点进去只会报「这个平台还没有专辑页」，所以这排不带它，免得出现死链。
 */
import { mergeAlbumCards, type AlbumCard } from './album-merge'

/**
 * 一家能贡献什么：各自去重、各自失败当空，最后统一交错。
 *
 * 只有网易云的新碟榜能翻页；QQ 与酷狗是从新歌榜里抽专辑，榜单接口没有 offset，
 * 所以 offset 是可选的——它们多要一些，靠池子轮转来换批。
 */
type AlbumSource = (limit: number, offset?: number) => Promise<AlbumCard[]>

const neteaseAlbums: AlbumSource = async (limit, offset) => {
  const api = window.aurora?.netease
  if (!api?.topAlbums) return []
  const list = await api.topAlbums(limit, offset)
  return (list ?? [])
    .filter((row) => row.id > 0 && row.name)
    .map((row) => ({
      key: 'netease:' + row.id,
      providerId: 'netease' as const,
      providerLabel: '网易云音乐',
      id: row.id,
      name: row.name,
      coverUrl: row.coverUrl,
      artistName: row.artistName,
      artistId: row.artistId,
      year: row.year,
      platforms: [
        {
          providerId: 'netease' as const,
          providerLabel: '网易云音乐',
          id: row.id,
          artistId: row.artistId
        }
      ]
    }))
}

/** QQ/酷狗新歌行的共同部分（两家字段名一样，专辑 id 的类型不一样）。 */
interface NewSongRow {
  album?: { id?: number | string; name?: string; picUrl?: string | null }
  artists?: { id?: number; name?: string }[]
}

function albumsFromSongs(
  providerId: 'qq' | 'kugou',
  providerLabel: string,
  songs: NewSongRow[] | undefined,
  limit: number
): AlbumCard[] {
  const rows: AlbumCard[] = []
  const seen = new Set<string>()
  for (const song of songs ?? []) {
    // 酷狗的专辑 id 是数字字符串；两家都可能有缺专辑信息的老歌，没有正整数 id
    // 的卡点进去是空白页，跳过。
    const albumId = Number(song.album?.id)
    const name = song.album?.name ?? ''
    if (!Number.isInteger(albumId) || albumId <= 0 || !name) continue
    const key = providerId + ':' + albumId
    if (seen.has(key)) continue
    seen.add(key)
    const artist = song.artists?.[0]
    rows.push({
      key,
      providerId,
      providerLabel,
      id: albumId,
      name,
      coverUrl: song.album?.picUrl ?? null,
      artistName: artist?.name ?? '',
      artistId: artist?.id && artist.id > 0 ? artist.id : undefined,
      year: 0,
      platforms: [
        {
          providerId,
          providerLabel,
          id: albumId,
          artistId: artist?.id && artist.id > 0 ? artist.id : undefined
        }
      ]
    })
    if (rows.length >= limit) break
  }
  return rows
}

const qqAlbums: AlbumSource = async (limit) => {
  const api = window.aurora?.qq
  if (!api?.newSongs) return []
  // 一张专辑常对应好几首新歌，多取几首才够去重后的张数；封顶 60 免得一次拉太多。
  const songs = await api.newSongs(Math.min(limit * 3, 60))
  return albumsFromSongs('qq', 'QQ 音乐', songs, limit)
}

const kugouAlbums: AlbumSource = async (limit) => {
  const api = window.aurora?.kugou
  if (!api?.newSongs) return []
  const songs = await api.newSongs(Math.min(limit * 3, 60))
  return albumsFromSongs('kugou', '酷狗音乐', songs, limit)
}

/**
 * 轮转交错：网易云、QQ、酷狗、网易云…… 三家条数不齐时短的那家先耗尽，其余接着
 * 补位。固定从网易云起步，因为只有它是真的「新碟榜」，先亮出来最不误导人。
 */
function interleave(groups: AlbumCard[][], limit: number): AlbumCard[] {
  const rows: AlbumCard[] = []
  const longest = groups.reduce((most, group) => Math.max(most, group.length), 0)
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      if (rows.length >= limit) return rows
      const row = group[index]
      if (row) rows.push(row)
    }
  }
  return rows
}

/**
 * 从池子里取一屏。
 *
 * 到尾巴就绕回开头，不拿空位收场——换一批走到池子末端时，用户该看到下一批，
 * 而不是一块短了一截的网格。
 */
function takeWindow<T>(rows: T[], start: number, size: number): T[] {
  if (rows.length <= size) return rows
  const at = start % rows.length
  const out = rows.slice(at, at + size)
  if (out.length < size) out.push(...rows.slice(0, size - out.length))
  return out
}

/** 这一排要的东西，连同「可以画了没有」。 */
interface RecommendedAlbums {
  rows: AlbumCard[]
  /** 三家（按勾选）都问过一遍了。 */
  ready: boolean
}

export function useRecommendedAlbums(limit = 8, tick = 0): RecommendedAlbums {
  const [rows, setRows] = useState<AlbumCard[]>([])
  /*
   * 三家并发取，一个 Promise.all 落地，本来就只 set 一次。这里补一个 ready
   * 是为了跟推荐歌单对齐：两排要等齐了同一次画出来，不能一排先出现。
   * 这一点在专辑这排尤其要紧：网易云的新碟榜最先回来，先画就是「一整排网易云」，
   * 过一秒另外两家才补进来——看起来就是「来源单一」，其实是画早了。
   */
  const [ready, setReady] = useState(false)
  /*
   * 推荐来源是全局的一处开关（设置 → 推荐来源），推荐歌单、每日推荐、漫游都
   * 已经照它走；这排本来漏了，关掉 QQ / 酷狗之后它们还会从专辑这里冒回来。
   * 没选的平台连请求都不发，省一次往返。
   */
  /*
   * 与每日推荐、推荐歌单同一个判断：勾着且登录着的平台才问（push-platforms）。
   * 还没问完时不画，免得先出一排网易云、过一秒才补齐另外两家。
   */
  const chosen = usePushPlatforms()
  const list = chosen ?? []
  const chosenKey = list.join(',')

  useEffect(() => {
    if (!chosen) return
    let alive = true
    // 勾选变了要重新等，先把上一轮的放行收回。
    setReady(false)
    void (async () => {
      try {
        /*
         * 一次取三屏。合并会把同一张专辑的两三条并成一条，所以每家按三倍要。
         *
         * 换一批：网易云那边真往后翻页（它有 offset），QQ 与酷狗的新歌榜没有
         * 翻页参数，只能重问一遍——所以池子在这里轮转，让每次停下的一屏都不是
         * 上一屏。三批走完绕回开头，同时重新问一次，榜单换了的自然就冒出来。
         */
        const want = limit * 3
        const offset = (tick % 3) * want
        // 并发取，各家失败只算自己没内容：一家的接口抖一下不该让整排空掉。
        const groups = await Promise.all([
          list.includes('netease') ? neteaseAlbums(want, offset).catch(() => []) : Promise.resolve([]),
          list.includes('qq') ? qqAlbums(want).catch(() => []) : Promise.resolve([]),
          list.includes('kugou') ? kugouAlbums(want).catch(() => []) : Promise.resolve([])
        ])
        const pool = mergeAlbumCards(interleave(groups, want * 3))
        if (alive) setRows(takeWindow(pool, tick * limit, limit))
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
    // chosen 是每份快照都会新建的数组，用 join 后的字符串当依赖。
  }, [limit, tick, chosenKey])

  // 还没定下问哪几家时不要放行：放了就是先画一排再换。
  return { rows: chosen === null ? [] : rows, ready: chosen === null ? false : ready }
}
