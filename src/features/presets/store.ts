import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createProfileScopedStorage } from '../accounts/profile-storage.ts'
import { nextName, withPreset, withoutPreset } from './saved'
import type { SavedPreset } from './saved'

const KEY = 'aurora.presets'

/**
 * 存在本机的「我的预设」。
 *
 * 只装声音：增益、开关。外观不进来——Aurora 的配色本来就跟着封面走，没有一套
 * 可存的主题，硬塞一个只会让「应用预设」变成改了别处的两三个开关。
 *
 * 与设置了同一个 persist：用户调出满意的一条曲线，隔天打开还在。
 */

interface PresetStore {
  list: SavedPreset[]
  /** 存当前曲线，返回自动起的名字，界面拿它报一句。 */
  save(eqEnabled: boolean, gains: number[]): string
  remove(id: string): void
}

export const usePresets = create<PresetStore>()(
  persist(
    (set, get) => ({
      list: [],

      save(eqEnabled, gains) {
        const list = get().list
        const preset: SavedPreset = {
          /*
           * 时间戳加一段随机：同一毫秒里连点两次也不会撞 id，那会让「删一条」
           * 变成删两条。
           */
          id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          name: nextName(list),
          eqEnabled,
          gains: [...gains],
          at: Date.now()
        }
        set({ list: withPreset(list, preset) })
        return preset.name
      },

      remove(id) {
        set({ list: withoutPreset(get().list, id) })
      }
    }),
    {
      name: KEY,
      version: 1,
      /* 和收藏、歌单一样按档案分槽：换档案就是换一个人，他的预设不该跟着走。 */
      storage: createJSONStorage(() => createProfileScopedStorage())
    }
  )
)
