/**
 * 把三处「人做过的事」拼成画像：最近播放、我喜欢的、每日收听统计。
 *
 * 单独一个文件因为 taste.ts 是纯函数（node --test 直接加载），而这里要碰 store。
 */
import { useMemo } from 'react'
import { useHistory } from '../player/history-store'
import { useFavorites } from '../favorites/store'
import { buildTaste, type TasteProfile } from './taste'

export function useTasteProfile(): TasteProfile {
  const recent = useHistory((state) => state.history.recent)
  const days = useHistory((state) => state.history.days)
  const liked = useFavorites((state) => state.liked)
  return useMemo(
    () => buildTaste({ recent, days, liked: liked.map((entry) => entry.track) }),
    [recent, days, liked]
  )
}
