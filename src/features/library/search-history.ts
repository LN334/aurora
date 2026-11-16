/**
 * 搜索框最近用过的几个词。
 *
 * 搜索是主入口，但每次进来都要从零敲一遍——常用的其实是同几个词。这里只做
 * 一件小事：记住最近八条，聚焦且空着时摆出来。
 *
 * 存储交给调用方传进来：浏览器环境有 localStorage，测试里给个假的就行。
 * 键名带 `aurora.` 前缀，备份白名单只收这个前缀的 localStorage 项。
 */
const KEY = 'aurora.search-history'
const LIMIT = 8

type Store = Pick<Storage, 'getItem' | 'setItem'>

export function readSearchHistory(store?: Store): string[] {
  const storage = store ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (!storage) return []
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, LIMIT)
  } catch {
    return []
  }
}

export function rememberSearch(query: string, store?: Store): string[] {
  const storage = store ?? (typeof localStorage === 'undefined' ? null : localStorage)
  const text = query.trim()
  const current = readSearchHistory(storage ?? undefined)
  if (!text) return current

  // 同一个词再搜一次只是把它提到最前，不在列表里重复占位。
  const next = [text, ...current.filter((item) => item !== text)].slice(0, LIMIT)
  try {
    storage?.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存不下（隐私模式、配额满）就只是没有历史，不影响搜索本身。
  }
  return next
}
