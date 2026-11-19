import { useEffect, useRef, useState } from 'react'
import { getProvider } from '../../features/online/registry'
import { applyQuality } from '../../features/online/quality'
import { QUALITY_LABELS, type QualityTier } from '../../features/online/types'
import { usePlayer } from '../../features/player/store'

/**
 * 播放条上的音质键。
 *
 * 只在放到在线歌时出现：本地文件没有「档位」这回事，摆一个点不动的键只会让人
 * 以为播放器坏了。档位跟着这首歌所属平台走——音质是按平台存的，在 QQ 的歌上调
 * 档不该改到网易云的设置。
 *
 * 换档从下一首起生效：正在播的那条流不会因为改设置而重取，所以弹出层里写着
 * 这句话，否则按下去听不出差别，看起来像没生效。
 */

export function QualityMenu() {
  const track = usePlayer((state) => state.current())
  const source = track?.source ?? ''
  const provider = source && source !== 'local' ? getProvider(source) : null
  const tiers = provider?.qualityTiers ?? []

  const [tier, setTier] = useState<QualityTier | null>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 问一次当前档位。后端答不出来就留空，不替账号宣称一个未必在的档。
  useEffect(() => {
    if (!provider?.getQuality) {
      setTier(null)
      return
    }
    let alive = true
    void provider
      .getQuality()
      .then((value) => {
        if (alive) setTier(value)
      })
      .catch(() => {
        if (alive) setTier(null)
      })
    return () => {
      alive = false
    }
  }, [provider])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!provider || tiers.length === 0) return null

  /*
   * 向上弹，用 fixed 定位：播放条贴着窗口底边，绝对定位会被外面的滚动容器裁掉。
   * 坐标只在打开那一刻量一次，不做滚动跟随——这个菜单只活几秒。
   */
  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setAnchor({
        bottom: window.innerHeight - rect.top + 8,
        right: Math.max(12, window.innerWidth - rect.right)
      })
    }
    setOpen(true)
  }

  const choose = async (next: QualityTier): Promise<void> => {
    setOpen(false)
    setTier(next)
    const applied = await applyQuality(provider, next)
    if (applied) setTier(applied)
  }

  const short = tier ? QUALITY_LABELS[tier].split(' ')[0] : '音质'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'pb-btn pb-btn--ghost pb-quality' + (open ? ' is-on' : '')}
        onClick={toggle}
        title={provider.displayName + ' 的取流档位，换档从下一首起生效'}
        aria-label={'音质：' + (tier ? QUALITY_LABELS[tier] : provider.displayName)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="pb-quality__text">{short}</span>
      </button>

      {open && anchor ? (
        <div
          ref={menuRef}
          className="pb-quality__menu"
          style={{ bottom: anchor.bottom, right: anchor.right }}
          role="menu"
          aria-label={provider.displayName + ' 音质'}
        >
          <p className="pb-quality__title">{provider.displayName}音质</p>
          {tiers.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={tier === item}
              className={'pb-quality__item' + (tier === item ? ' is-active' : '')}
              onClick={() => void choose(item)}
            >
              {QUALITY_LABELS[item]}
            </button>
          ))}
          <p className="pb-quality__note">换档从下一首起生效</p>
        </div>
      ) : null}
    </>
  )
}
