import { useEffect, useState } from 'react'
import { listAvailableProviders } from '../../../features/online/registry'
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
            切歌时前一首淡出、后一首淡入的重叠时长。0 表示直接切换。
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

      <Row label="均衡器" hint="开关本身在这里；10 段推子在播放界面按 E 打开。">
        <Toggle
          checked={eqEnabled}
          label="均衡器"
          onChange={(next) => setEqEnabled(next)}
        />
      </Row>

      <PlatformQualityRows />

      <Row
        label="在线歌词"
        hint="本地没有 .lrc 时，把歌名与歌手发送到 lrclib.net 查询。关闭后歌词完全来自本机文件。"
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
      <Row label="在线音质" hint="这一版没有可用的在线平台，所以没有音质可选。">
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
          : `${provider.displayName}还没有回答当前档位；上游给不了所选档位时会自动回退，并在播放提示里说明。`
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
