import { useState } from 'react'
import { setMod, useModsEnabled } from '../features/mods/store'

/**
 * 扩展：装进来的东西都在这页，开关也在这一页。
 *
 * 参考 Folia 的 Folium：一个扩展只声明它要改哪个位置（歌词样式 / 音源 /
 * 背景 / 进度图层 / 首页卡片），外壳负责把它放进去。这一页就是那份声明的
 * 清单——不另开设置分区，否则「我装了什么」要翻三个地方才能拼出来。
 *
 * 开关由 features/mods/store 持久化：刷新、重启后还是上次的样子。真正的加载
 * 要主进程读 mods 目录并执行，等接口好了接在这一层后面，页面结构不用动。
 */

interface ModEntry {
  id: string
  name: string
  group: string
  note: string
  version: string
  perms: string[]
  update?: boolean
}

const INITIAL: ModEntry[] = [
  { id: 'snow', name: '落雪', group: '歌词样式', note: '逐字呼吸，雪落在字上', version: 'v1.2.0', perms: ['读取播放', '读取歌词', '存储'] },
  { id: 'stars', name: '星图', group: '歌词样式', note: '每句连成星座', version: 'v0.6.0', perms: ['读取播放', '读取歌词', '存储'] },
  { id: 'lattice', name: '晶格', group: '背景与视觉', note: '随低频跳动的三维点阵', version: 'v0.9.1', perms: ['读取播放', '存储'] },
  { id: 'quote', name: '每日一句', group: '页面与命令', note: '首页卡片：从当天听过的歌里挑一句词', version: 'v1.0.0', perms: ['读取播放', '读取歌词'] },
  { id: 'wordlyric', name: '逐字翻译', group: '页面与命令', note: '歌词逐字对齐译文', version: 'v1.4.2', perms: ['读取播放', '读取歌词', '网络'], update: true }
]

const GROUPS = ['歌词样式', '背景与视觉', '页面与命令'] as const

export function ModsView() {
  const [online, setOnline] = useState(false)
  const disabled = useModsEnabled()

  const enabled = (id: string) => !disabled.includes(id)
  const current = INITIAL.filter((mod) => enabled(mod.id)).length

  return (
    <div className="mods">
      <header className="rh-sec__head">
        <h3>已装 {INITIAL.length} 个</h3>
        <span className="pl-head__count">{current} 个在跑</span>
        <span className="pl-head__sp" />
        <button
          className={'srch-chip' + (online ? ' is-on' : '')}
          onClick={() => setOnline((value) => !value)}
          aria-pressed={online}
        >
          {online ? '在线：开' : '在线：关'}
        </button>
      </header>

      {GROUPS.map((group) => {
        const items = INITIAL.filter((mod) => mod.group === group)
        if (items.length === 0) return null
        return (
          <section key={group} className="mods__group">
            <h3 className="mods__stitle">
              {group}
              <span className="mods__gcount">{items.filter((mod) => enabled(mod.id)).length}/{items.length}</span>
            </h3>
            {items.map((mod) => {
              const on = enabled(mod.id)
              return (
                <div key={mod.id} className="mod-row">
                  <div className="mod-row__main">
                    <div className="mod-row__name">
                      {mod.name}
                      {mod.update ? <span className="mod-row__new">可更新</span> : null}
                    </div>
                    <div className="mod-row__note">{mod.note}</div>
                    <div className="mod-row__perms">
                      {mod.perms.map((perm) => (
                        <span key={perm} className="perm">
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mod-row__side">
                    <span className="mod-row__ver">{mod.version}</span>
                    <button
                      className={'switch' + (on ? ' is-on' : '')}
                      role="switch"
                      aria-checked={on}
                      aria-label={mod.name}
                      onClick={() => setMod(mod.id, !on)}
                    >
                      <span className="switch__dot" />
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
