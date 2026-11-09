export type AlbumProvider = 'netease' | 'qq' | 'kugou'

/** 同一张专辑在某一家的身份。合并之后一张卡可以挂好几家。 */
export interface AlbumOn {
  providerId: AlbumProvider
  providerLabel: string
  id: number
  artistId?: number
}

export interface AlbumCard {
  key: string
  providerId: AlbumProvider
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  /** 艺人 id：卡片上那行名字据此点进艺人页；缺了就只是文字。 */
  artistId?: number
  /** 发行年；0 表示这家没报（QQ/酷狗的新歌接口不带年份）。 */
  year: number
  /** 这张专辑在哪几家有。第一项是主行，点卡片就走它。 */
  platforms: AlbumOn[]
}

/*
 * 首页「推荐专辑」的去重规则。
 *
 * 抽成纯函数是有原因的：同一张专辑在几家各是一条记录（「去云上」在 QQ 和酷狗
 * 就是两条），交错摆出来像两张卡。合并规则只跟名字和艺人有关，跟 React、网络
 * 都无关，抽出来就能单测，改归并键时不必靠打开首页看。
 */

/** 主艺人：一行写了好几个人时，第一个才代表这张唱片是谁的。 */
export function firstArtist(text: string): string {
  return (text.split(/[/\u3001&]|\sfeat\.?/i)[0] ?? '').trim().toLowerCase()
}

/**
 * 归并键：专辑名 + 主艺人。
 *
 * 大小写、空白、全角括号都不该让同一张专辑分成两行（酷狗爱写「去云上（Live
 * 版）」，QQ 写「去云上(Live版)」）。这里只做这几项归一，别的不猜——名字本身
 * 不同就是不同专辑，硬合并会把两张真的不同的碟并掉。
 */
export function albumKeyOf(row: Pick<AlbumCard, 'name' | 'artistName'>): string {
  const name = row.name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
  return name + '|' + firstArtist(row.artistName)
}

/**
 * 主行按 网易云 → QQ → 酷狗 排。点卡片只会进一家，优先给信息最全的那家
 * （它带发行年和艺人 id）。
 */
export const PROVIDER_RANK: Record<AlbumProvider, number> = { netease: 0, qq: 1, kugou: 2 }

export function mergeAlbumCards(rows: AlbumCard[]): AlbumCard[] {
  const groups = new Map<string, AlbumCard[]>()
  for (const row of rows) {
    const key = albumKeyOf(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const merged: AlbumCard[] = []
  for (const bucket of groups.values()) {
    if (bucket.length === 1) {
      merged.push(bucket[0])
      continue
    }
    const order = [...bucket].sort((a, b) => PROVIDER_RANK[a.providerId] - PROVIDER_RANK[b.providerId])
    const head = order[0]
    const platforms: AlbumOn[] = []
    const seen = new Set<string>()
    for (const row of order) {
      if (seen.has(row.providerId)) continue
      seen.add(row.providerId)
      platforms.push({
        providerId: row.providerId,
        providerLabel: row.providerLabel,
        id: row.id,
        artistId: row.artistId
      })
    }
    merged.push({
      ...head,
      coverUrl: head.coverUrl ?? order.find((row) => row.coverUrl)?.coverUrl ?? null,
      year: head.year || order.find((row) => row.year)?.year || 0,
      platforms
    })
  }
  return merged
}