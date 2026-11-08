import { useEffect, useState } from 'react'
import { useRoamPlatforms } from '../player/roam-sources'

/**
 * 首页「推荐专辑」。
 *
 * 推荐位要的是「平台在推什么」：网易云有新碟榜（top_album，不用账号）；QQ 与
 * 酷狗没有公开的新碟榜，只有新歌速递（实测也不用账号），新碟上市都伴随新歌，
 * 就把新歌所属的专辑抽出来当卡片。汽水没有专辑页（catalog.album 缺失），卡片
 * 点进去只会报「这个平台还没有专辑页」，所以这排不带它，免得出现死链。
 */
export interface AlbumCard {
  key: string
  providerId: 'netease' | 'qq' | 'kugou'
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  /** 艺人 id：卡片上那行名字据此点进艺人页；缺了就只是文字。 */
  artistId?: number
  /** 发行年；0 表示这家没报（QQ/酷狗的新歌接口不带年份）。 */
  year: number
}

/** 一家能贡献什么：各自去重、各自失败当空，最后统一交错。 */
type AlbumSource = (limit: number) => Promise<AlbumCard[]>

const neteaseAlbums: AlbumSource = async (limit) => {
  const api = window.aurora?.netease
  if (!api?.topAlbums) return []
  const list = await api.topAlbums(limit)
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
      year: row.year
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
      year: 0
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

export function useRecommendedAlbums(limit = 18): AlbumCard[] {
  const [rows, setRows] = useState<AlbumCard[]>([])
  /*
   * 推荐来源是全局的一处开关（设置 → 推荐来源），推荐歌单、每日推荐、漫游都
   * 已经照它走；这排本来漏了，关掉 QQ / 酷狗之后它们还会从专辑这里冒回来。
   * 没选的平台连请求都不发，省一次往返。
   */
  const chosen = useRoamPlatforms()
  const chosenKey = chosen.join(',')

  useEffect(() => {
    let alive = true
    void (async () => {
      // 并发取，各家失败只算自己没内容：一家的接口抖一下不该让整排空掉。
      const groups = await Promise.all([
        chosen.includes('netease') ? neteaseAlbums(limit).catch(() => []) : Promise.resolve([]),
        chosen.includes('qq') ? qqAlbums(limit).catch(() => []) : Promise.resolve([]),
        chosen.includes('kugou') ? kugouAlbums(limit).catch(() => []) : Promise.resolve([])
      ])
      if (alive) setRows(interleave(groups, limit))
    })()
    return () => {
      alive = false
    }
    // chosen 是每份快照都会新建的数组，用 join 后的字符串当依赖。
  }, [limit, chosenKey])

  return rows
}
