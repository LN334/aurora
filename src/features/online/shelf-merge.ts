import type { ProviderId } from './types'

/**
 * 书架上的同名合并。
 *
 * 网易云与 QQ 里关注了同一个人、收藏了同一张专辑是常态。两张卡并排站着，
 * 头像一样、名字一样，只是底下一行来源不同——读起来像重复渲染，用户第一反应
 * 是「这页坏了」。所以按名字收成一行，把平台收进 `providers`，卡片上换成
 * 一颗颗色点：几张平台有它，就挂几颗。
 *
 * 合并只按名字，不按 id：各家的 id 本来就不同（网易云是数字、QQ 是 mid），
 * 拿 id 合并等于不合并。名字归一化去掉空白与大小写差异，别让一个尾随空格
 * 把同一张专辑拆成两条。
 */
/*
 * 排名字用：中文按拼音、英文按字母、数字按大小（「第 2 张」排在「第 10 张」前）。
 * 不排的话顺序是平台遍历顺序——网易云的 290 张全垫在前面，QQ 与酷狗的十几张
 * 沉在最后，看起来像三个互不相干的列表拼起来。
 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function mergeShelves<T extends { name: string; providerId: ProviderId }>(
  items: readonly T[],
  /*
   * 认哪条算「同一张」。默认只比名字（艺人同名即同一人，这是安全的）；
   * 专辑要把歌手一起比 —— 两张都叫《精选集》的不同歌手专辑并成一行，
   * 点进去只会放其中一张，另一张就此消失，比不合并坏得多。
   */
  keyOf: (item: T) => string = (item) => normalizeTitle(item.name)
): (T & { providers: ProviderId[] })[] {
  const merged = new Map<string, T & { providers: ProviderId[] }>()
  for (const item of items) {
    const key = keyOf(item)
    const seen = merged.get(key)
    if (!seen) {
      merged.set(key, { ...item, providers: [item.providerId] })
      continue
    }
    if (!seen.providers.includes(item.providerId)) seen.providers.push(item.providerId)
  }
  return [...merged.values()].sort((a, b) => collator.compare(a.name, b.name))
}

/** 比名字时用的归一化：去掉所有空白、统一小写。中文用不上大小写，但专辑名里常夹英文。 */
export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}
