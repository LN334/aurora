import { useOnlineStore } from './store'
import type { OnlineMusicProvider, QualityTier } from './types'

/**
 * 改一个平台的取流档位。
 *
 * 两处都要落：平台后端（主进程存盘，下次启动读它）与平台的播放 store
 * （`ensureStream` 取流时读的是后者）。只写后端的话，这一局里所有歌仍然按旧档
 * 取流 —— 用户感受就是「改了没用」。
 *
 * 返回真正生效的档位；两处都答不出来时回 null，调用方据此别把界面改成一个
 * 未必成立的档。
 */
export async function applyQuality(
  provider: Pick<OnlineMusicProvider, 'id' | 'setQuality'>,
  tier: QualityTier
): Promise<QualityTier | null> {
  const store = useOnlineStore(provider.id)
  if (!store) {
    try {
      return (await provider.setQuality?.(tier)) ?? null
    } catch {
      return null
    }
  }
  try {
    await store.getState().setQuality(tier)
    return store.getState().quality
  } catch {
    return null
  }
}
