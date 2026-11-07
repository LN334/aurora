import { useEffect, useState } from 'react'
import { getProvider, listAvailableProviders } from '../../../features/online/registry'
import { moveSource, useSourceOrder } from '../../../features/settings/source-order'
import {
  QUALITY_LABELS as TIER_LABELS,
  type OnlineMusicProvider,
  type QualityTier
} from '../../../features/online/types'
import { usePlayer } from '../../../features/player/store'
import { useSettingsPage } from '../../../features/settings/store'
import { Row, Rows, Toggle } from '../parts'

/**
 * 02 播放与音质。
 *
 * 分区的顺序就是一个人真正会先问到的顺序：怎么切歌（交叉淡化）、要不要染色（均衡器）、
 * 在线听什么档（各平台自己的音质档）、歌词从哪来（在线歌词）。在线音质仍然由平台注册表
 * 生成，不在这里分支——每个平台自己声明档位。
 */
export function PlaybackPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const crossfadeSec = usePlayer((state) => state.crossfadeSec)
  const setCrossfade = usePlayer((state) => state.setCrossfade)
  const eqEnabled = usePlayer((state) => state.eqEnabled)
  const setEqEnabled = usePlayer((state) => state.setEqEnabled)
  const { onlineLyrics } = page.settings

  return (
    <Rows>
      <div className="settings__row settings__row--stacked">
        <div className="settings__text">
          <div className="settings__label">交叉淡化</div>
          <p className="settings__hint">
            切歌时两首歌重叠的秒数，0 为直接切换。
          </p>
        </div>
        <div className="settings__slider">
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={crossfadeSec}
            aria-label="交叉淡化时长（秒）"
            onChange={(event) => setCrossfade(Number(event.target.value))}
          />
          <span className="settings__number">{crossfadeSec} 秒</span>
        </div>
      </div>

      <Row label="均衡器" hint="10 段推子在播放界面按 E 打开。">
        <Toggle
          checked={eqEnabled}
          label="均衡器"
          onChange={(next) => setEqEnabled(next)}
        />
      </Row>

      <SourceOrderRows />

      <PlatformQualityRows />

      <Row
        label="在线歌词"
        hint="本地没有歌词时向 lrclib.net 查询。"
      >
        <Toggle
          checked={onlineLyrics}
          disabled={page.busy}
          label="在线歌词查询"
          onChange={(next) => void page.setOnlineLyrics(next)}
        />
      </Row>
    </Rows>
  )
}

/**
 * 一个平台一行音质。
 *
 * 音质是按平台分开的：每个平台存自己那一档（QQ 账号的权限与网易云无关），
 * 不声明档位的平台不占一行。这里没有「是哪个平台」的分支——名字、档位与文案都来自 provider。
 */
function PlatformQualityRows() {
  const providers = listAvailableProviders().filter(
    (provider) =>
      (provider.qualityTiers?.length ?? 0) > 0 && provider.getQuality && provider.setQuality
  )

  if (providers.length === 0) {
    return (
      <Row label="在线音质" hint="当前没有可用的在线平台。">
        <span className="settings__number">—</span>
      </Row>
    )
  }

  return (
    <>
      {providers.map((provider) => (
        <PlatformQualityRow key={provider.id} provider={provider} />
      ))}
    </>
  )
}

function PlatformQualityRow({ provider }: { provider: OnlineMusicProvider }) {
  const [quality, setQuality] = useState<QualityTier | null>(null)

  useEffect(() => {
    let alive = true
    void provider
      .getQuality?.()
      .then((value) => {
        if (alive) setQuality(value)
      })
      .catch(() => {
        // 后端答不出来就留空，不要替账号宣称一个未必在的档位。
        if (alive) setQuality(null)
      })
    return () => {
      alive = false
    }
  }, [provider])

  const tiers = provider.qualityTiers ?? []

  return (
    <Row
      label={`${provider.displayName}音质`}
      hint={
        quality
          ? TIER_LABELS[quality]
          : `${provider.displayName}还没有回答当前档位，给不了时会自动回退。`
      }
    >
      <div className="seg">
        {tiers.map((tier) => (
          <button
            key={tier}
            className={quality === tier ? 'is-active' : ''}
            onClick={() => void provider.setQuality?.(tier).then(setQuality)}
          >
            {TIER_LABELS[tier].split(' ')[0]}
          </button>
        ))}
      </div>
    </Row>
  )
}

/**
 * 音源优先级：同一首歌有几家都有时，先问谁。
 *
 * 这是「多平台统一」唯一的开关。列表把重复的合成一行，但一行里到底用谁的声音，
 * 得有一个用户能改的答案——默认本机在前（不联网、不要会员），然后是网易云、
 * QQ、酷狗。往上挪一位就到列表前面，播放与主版本一起跟着换。
 *
 * 只列这个构建真能用的平台：装了没登录也算可用（它仍能出流），没接入的不占位。
 */
function SourceOrderRows() {
  const order = useSourceOrder()
  const usable = new Set(['local', ...listAvailableProviders().map((provider) => provider.id)])
  const shown = order.filter((id) => usable.has(id))

  if (shown.length < 2) {
    return (
      <Row label="音源优先级" hint="只有一个可用音源时不需要排序。">
        <span className="settings__number">—</span>
      </Row>
    )
  }

  return (
    <div className="settings__row settings__row--stacked">
      <div className="settings__text">
        <div className="settings__label">音源优先级</div>
        <p className="settings__hint">
          同一首歌在几个平台都有时，按这个顺序挑第一个能放的。本机不需要联网，放在最前面通常最稳。
        </p>
      </div>
      <ol className="settings__order">
        {shown.map((id, index) => (
          <li key={id} className="settings__order-item">
            <span className="settings__order-index tnum">{index + 1}</span>
            <span className="settings__order-name">
              {id === 'local' ? '本机音乐' : (getProvider(id)?.displayName ?? id)}
            </span>
            <span className="settings__order-acts">
              <button
                type="button"
                className="settings__order-move"
                disabled={index === 0}
                onClick={() => moveSource(id, -1)}
                aria-label={`把${id}提前一位`}
              >
                ↑
              </button>
              <button
                type="button"
                className="settings__order-move"
                disabled={index === shown.length - 1}
                onClick={() => moveSource(id, 1)}
                aria-label={`把${id}退后一位`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
