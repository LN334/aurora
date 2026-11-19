import type { Track } from '../../types'
import { trackKey } from '../online/unify.ts'

/**
 * 漫游的纯算术：这一趟走到哪、还能接多少首。
 *
 * 放在这里而不是组件里，是因为这两件事都要在测试里算准：
 * 「已听几首」决定轨道上那行字，「还能接几首」决定尾巴卡写 +20 还是「已经到底」。
 */

export interface RoamProgress {
  /** 当前这首在这一趟里的位次；不在这一趟里就是 -1。 */
  index: number
  /** 这一趟一共多少首。 */
  total: number
  /** 已经听过多少首。 */
  heard: number
  /** 当前之后还有多少首没走。 */
  ahead: number
}

export function roamProgress(
  tracks: readonly Track[],
  current: Track | null,
  heard: ReadonlySet<string>
): RoamProgress {
  const total = tracks.length
  const index = current ? tracks.findIndex((track) => trackKey(track) === trackKey(current)) : -1
  let count = 0
  for (const track of tracks) {
    if (heard.has(trackKey(track))) count += 1
  }
  return { index, total, heard: count, ahead: index < 0 ? total : Math.max(0, total - index - 1) }
}

/**
 * 把新要到的一批接在旧列表后面。
 *
 * 三件事都在这里做：去掉列表里已有的（同一首在两家平台都有时 mergeVersions 已经
 * 并过一行，但两次请求之间平台会重复推）、去掉用户划掉过的、保持原来的先后。
 * 返回空数组就是「这批全是重复」，调用方该说一句话而不是默默不动。
 */
export function appendFresh(
  existing: readonly Track[],
  incoming: readonly Track[],
  hidden: ReadonlySet<string>
): Track[] {
  const seen = new Set(existing.map((track) => trackKey(track)))
  const out: Track[] = []
  for (const track of incoming) {
    const key = trackKey(track)
    if (seen.has(key) || hidden.has(key)) continue
    seen.add(key)
    out.push(track)
  }
  return out
}

/** 从这一趟里摘掉一首（划掉）。队列那边的摘除由调用方决定。 */
export function withoutTrack(tracks: readonly Track[], target: Track): Track[] {
  const key = trackKey(target)
  return tracks.filter((track) => trackKey(track) !== key)
}

/**
 * 换池子时把「已听」里还对得上的留下。
 *
 * 这一趟的列表会被整份换掉：快池换成整池、平台又推来一批、或者重开一趟。
 * `heard` 是按 trackKey 记的，跟着列表一起清空的话，「已听 N 首」会在用户
 * 明明听了七八首之后跳回 1——那行字说的是「这一趟听了多少」，不是「这一批
 * 里听过多少」。所以只清掉新列表里已经不存在的那些，剩下的留着。
 */
export function carryHeard(
  heard: Readonly<Record<string, true>>,
  tracks: readonly Track[]
): Record<string, true> {
  const keys = new Set(tracks.map((track) => trackKey(track)))
  const out: Record<string, true> = {}
  for (const key of Object.keys(heard)) {
    if (keys.has(key)) out[key] = true
  }
  return out
}

/**
 * 快放到这一趟的尾巴了吗。
 *
 * 漫游不主动停止：剩下几首的时候就把下一批要过来，接在队列后面。留出这一段
 * 提前量是因为要歌要过网络——等到最后一首才开始要，中间会断一口气。
 * left 是「当前之后还有几首」；负数当作已经到了末尾。
 */
export function shouldPullMore(left: number, ahead: number): boolean {
  return left <= ahead
}

/**
 * 从这一首之后到这一趟结尾还有多少秒。
 *
 * 补批的提前量该按「还能听多久」算，而不是「还剩几首」：6 首短歌二十分钟不到，
 * 6 首现场版能撑到四十分钟。时长元数据缺失（本机扫描失败、平台没给）时按 0
 * 计，调用方据此退回首数判据。index 不在这一趟里就是 -1，返回 0。
 */
export function remainingSeconds(tracks: readonly Track[], index: number): number {
  if (index < 0) return 0
  let total = 0
  for (let i = index + 1; i < tracks.length; i += 1) {
    const seconds = tracks[i]?.duration
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) total += seconds
  }
  return total
}

/** 艺人字段可能是「甲 / 乙」，拆开比：整串相等会漏掉合作曲。 */
function artistNames(track: Track): Set<string> {
  const out = new Set<string>()
  for (const part of track.artist.split(/[/、,，&]/)) {
    const name = part.trim().toLowerCase()
    if (name) out.add(name)
  }
  return out
}

function sharesArtist(track: Track, seed: Track): boolean {
  if (typeof seed.artistId === 'number' && track.artistId === seed.artistId) return true
  const mine = artistNames(track)
  if (mine.size === 0) return false
  for (const name of artistNames(seed)) {
    if (mine.has(name)) return true
  }
  return false
}

/**
 * 从种子那首往外排：同专辑 > 同艺人 > 同名 > 其他。
 *
 * 「从这首出发」没法算音频相似度——漫游池就是平台推过来的几十首，手上只有元数据。
 * 能用的关系只有三层：同一张专辑里的别的歌、同一个艺人别的歌、恰好同名（翻唱、
 * Live、别的平台的同曲）。排完取前几十首，这一趟就从头到尾都离那首歌不远。
 *
 * 档内保持传进来的先后，所以调用方先 shuffle 再调这里：档与档之间有关系，档内
 * 是随机的。种子自己永远排第一，同曲的另一个平台版本也算种子（trackKey 不认 id）。
 */
export function rankBySeed(tracks: readonly Track[], seed: Track): Track[] {
  const seedKey = trackKey(seed)
  const album = seed.album.trim()
  const artist = seed.artist.trim()
  const scored = tracks.map((track, index) => {
    let rank = 4
    if (trackKey(track) === seedKey) rank = 0
    else if (album && track.album === album && track.albumArtist === seed.albumArtist) rank = 1
    else if (artist && sharesArtist(track, seed)) rank = 2
    else if (seed.title && track.title === seed.title) rank = 3
    return { track, index, rank }
  })
  // 显式比 index，不指望 sort 的稳定性：同档里的顺序就是调用方 shuffle 的结果。
  scored.sort((left, right) => left.rank - right.rank || left.index - right.index)
  return scored.map((row) => row.track)
}

/**
 * 漫游的三种取用偏好。
 *
 * 平台那边的「漫游模式」是服务端算法参数，Aurora 调不到；这里能做的是在同一批
 * 私人漫游的歌上换一种取法——三个名字与原生客户端对齐，含义按各自能做到的说清。
 */
export type RoamTaste = 'default' | 'familiar' | 'explore'

/** 认识什么：出现过的艺人名与专辑。收藏、播放历史、本机库一起并进来。 */
export interface KnownTaste {
  artists: Set<string>
  albums: Set<string>
}

/** 艺人字段常写成「甲 / 乙」，拆开逐个比；整串相等会漏掉合作曲。 */
function artistKeys(track: Track): string[] {
  return track.artist
    .split(/[/、,，&]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function albumKey(track: Track): string {
  const album = track.album.trim().toLowerCase()
  if (!album) return ''
  return album + '\u0000' + track.albumArtist.trim().toLowerCase()
}

/** 从一堆曲目里抽出「认识谁、认识哪张专辑」。 */
export function knownFrom(tracks: readonly Track[]): KnownTaste {
  const artists = new Set<string>()
  const albums = new Set<string>()
  for (const track of tracks) {
    for (const key of artistKeys(track)) artists.add(key)
    const album = albumKey(track)
    if (album) albums.add(album)
  }
  return { artists, albums }
}

function isKnown(track: Track, known: KnownTaste): boolean {
  if (artistKeys(track).some((key) => known.artists.has(key))) return true
  const album = albumKey(track)
  return album !== '' && known.albums.has(album)
}

/**
 * 按偏好重排一批歌。长度不变，只改先后——调用方随后 `slice` 多少就是它的事。
 *
 * - `default`：原样。调用方已经洗过牌。
 * - `familiar`：认识的排前面，其余垫后。挑不出认得的就退回原序，不会少歌。
 * - `explore`：不认识的、且同一个艺人只留第一首的排前面；其余垫后。这样前几十
 *   首不会连着同一张专辑。
 *
 * 不删歌：池子只有二十首时，按偏好过滤会把一趟削短；垫后既保住了长度，也让
 * 「探索模式听到的仍然是私人漫游推的歌」。
 */
export function tasteOrder(
  tracks: readonly Track[],
  taste: RoamTaste,
  known: KnownTaste
): Track[] {
  if (taste === 'default') return tracks.slice()
  const front: Track[] = []
  const back: Track[] = []
  if (taste === 'familiar') {
    for (const track of tracks) (isKnown(track, known) ? front : back).push(track)
    return [...front, ...back]
  }
  const seen = new Set<string>()
  for (const track of tracks) {
    const keys = artistKeys(track)
    const stranger = keys.every((key) => !known.artists.has(key))
    const firstOfArtist = keys.every((key) => !seen.has(key))
    if (stranger && firstOfArtist) {
      front.push(track)
      for (const key of keys) seen.add(key)
    } else {
      back.push(track)
    }
  }
  return [...front, ...back]
}
