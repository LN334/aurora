import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import rawChangelog from '../../CHANGELOG.md?raw'
import { bridge } from '../bridge'
import { parseChangelog } from '../features/updates/changelog'
import type { ChangelogEntry } from '../features/updates/changelog'
import { useLeave } from '../ui/presence'

/** 已经看过公告的版本。存在 localStorage 里，按档案分槽没有必要。 */
const SEEN_KEY = 'aurora.seenVersion'

/**
 * 升级之后第一次启动，把这一版改了什么摆出来。
 *
 * 三条规则：
 * - 只在新版本装好后的第一次启动出现一次，点掉就记下来；
 * - 第一次安装不弹——那时候没有「上一个版本」，弹出来只是把整份发布说明糊在
 *   新用户脸上；
 * - CHANGELOG 里找不到当前版本（忘了写）就不弹，宁可少说一句，也不拿上一版
 *   的改动冒充这一版。
 *
 * 内容直接读打包进来的 CHANGELOG.md，不联网、不多维护一份公告。
 */
export function WhatsNew() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null)
  const { leaving, leave } = useLeave(180)

  useEffect(() => {
    let alive = true
    void (async () => {
      const info = await bridge.info().catch(() => null)
      const version = info?.version
      if (!alive || !version) return
      const parsed = parseChangelog(rawChangelog, version)
      if (!alive || !parsed) return
      let seen: string | null = null
      try {
        seen = window.localStorage.getItem(SEEN_KEY)
      } catch {
        return
      }
      /* 第一次安装：记下这一版，不打扰。 */
      if (!seen) {
        try {
          window.localStorage.setItem(SEEN_KEY, version)
        } catch {
          /* 存不了就下次再说，不影响别的。 */
        }
        return
      }
      if (seen === version) return
      setEntry(parsed)
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!entry) return null

  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, entry.version)
    } catch {
      /* 同上。 */
    }
    leave(() => setEntry(null))
  }

  /* 挂到 body：`<main>` 有 backdrop-filter，会成为 fixed 的包含块，弹窗会偏。 */
  return createPortal(
    <>
      <div
        className={'nm__scrim' + (leaving ? ' is-closing' : '')}
        onPointerDown={close}
        role="presentation"
      />
      <div
        className={'nm wnew' + (leaving ? ' is-closing' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={`已更新到 ${entry.version}`}
      >
        <h2 className="nm__title">已更新到 {entry.version}</h2>
        <div className="wnew__body">
          {entry.sections.map((section) => (
            <section className="wnew__group" key={section.title}>
              <h3 className="wnew__head">{section.title}</h3>
              <ul className="wnew__list">
                {section.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="nm__acts">
          <button className="rh-btn rh-btn--main" type="button" onClick={close}>
            知道了
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
