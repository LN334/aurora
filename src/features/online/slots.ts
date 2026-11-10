/**
 * 推荐位的槽位表。
 *
 * 这里写的是产品规格：每个区块一共展示多少条，只由这张表决定。它和「推荐来源」
 * 里勾了哪几家平台没有关系——关掉一家平台，它让出来的位置由别家补上，总数不变。
 *
 * 三样东西刻意分开，谁也推不出谁：
 *   1. 开关   features/player/roam-sources.ts —— 只存「哪几家可以推」，一个平台集合；
 *   2. 槽位   本文件 —— 编译期常量，不存状态、不随开关变；
 *   3. 条数   池子里够不够的结果 —— 只有所有平台都见底时才会少于槽位。
 *
 * 曾经的写法是「每家固定出 N 张/首」，总数 = N × 勾选平台数，于是勾掉一家首页
 * 就少一截。约定改到这里之后，「总数」有了唯一答案。
 */
export const SLOTS = {
  /** 今天听什么：一天一批，和网易云日推同一个量。 */
  daily: 30,
  /** 首页推荐歌单：四行六列。 */
  playlist: 24,
  /** 首页推荐专辑：一行四列横条，左右可翻（小方图在左、名字在右，不与歌单的封面墙同形）。 */
  album: 12,
  /** 首页新歌：一屏十二行，够看出一份榜单的走向。 */
  fresh: 12,
  /**
   * 漫游：一趟先要这么多，快放完再补一半。
   *
   * 60 首要一次太多——每家平台翻好几页，头一批出得慢，而漫游的本意是
   * 「点了就有声」。20 首是一小时上下，补批提前量够用。
   */
  roam: 20
} as const

/** 按某个键分组，保持首次遇到的顺序。 */
export function groupRows<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return groups
}

/**
 * 把若干家平台的桶轮转着填满 `slots` 个位置。
 *
 * 一轮一家出一样：第一轮每家各占一格，第二轮再各占一格。这样即使某一家只有
 * 两张，也只是它自己先耗尽，剩下的位置由别家继续填——而不是整排缺口。
 * 所有桶都见底就提前收，不拿重复项凑数。
 */
export function fillSlots<T>(groups: Iterable<readonly T[]>, slots: number): T[] {
  const lists = [...groups].filter((rows) => rows.length > 0)
  const out: T[] = []
  if (lists.length === 0 || slots <= 0) return out
  for (let round = 0; out.length < slots; round += 1) {
    let moved = false
    for (const rows of lists) {
      const next = rows[round]
      if (next === undefined) continue
      out.push(next)
      moved = true
      if (out.length >= slots) break
    }
    if (!moved) break
  }
  return out
}
