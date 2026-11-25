import { useEffect, useState } from 'react'
import { getProvider, listAvailableProviders, listProviders } from '../../../features/online/registry'
import { applyQuality } from '../../../features/online/quality'
import { useOnlineStore } from '../../../features/online/store'
import { moveSource, useSourceOrder } from '../../../features/settings/source-order'
import {
  QUALITY_LABELS as TIER_LABELS,
  type OnlineMusicProvider,
  type QualityTier,
  tierAllowed
} from '../../../features/online/types'
import { Note, Row, Rows, SettingsCard } from '../parts'

/**
 * 音源与音质。
 *
 * 上半是「同一首歌几家都有时，先问谁」，下半是「问到了用哪一档」。两件事都会
 * 直接改到正在播的那一首，所以放在同一页：用户改完能立刻听出区别。
 */
export function QualityPane() {
  return (
    <>
      <SettingsCard
        title="音源顺序"
        hint="列表从上到下就是取流顺序；同一首歌只有一家有时，这一项不起作用。"
      >
        <SourceOrderRows />
      </SettingsCard>

      <SettingsCard
        title="各平台音质"
        hint="每家平台各存各的档。会员档位按账号权限显示，没登录时只列得到公开档。"
      >
        <PlatformQualityRows />
      </SettingsCard>

      <Note>换档只影响之后取流；正在播的这首要重新点播放才会按新档重取。会员到期后高音质会退回可用档。</Note>
    </>
  )
}

/**
 * 一个平台一行音质。
 *
 * 音质是按平台分开的：每个平台存自己那一档（QQ 账号的权限与网易云无关），
 * 不声明档位的平台不占一行。这里没有「是哪个平台」的分支——名字、档位与文案都来自 provider。
 *
 * 用全量 provider 而不是「此刻可用」的那些：后端还没连上时，这一行也该在，
 * 只是按钮按不了。让它整行消失，用户看到的就是「没有地方能调音质」。
 */
function PlatformQualityRows() {
  const providers = listProviders().filter(
    (provider) =>
      (provider.qualityTiers?.length ?? 0) > 0 && provider.getQuality && provider.setQuality
  )

  if (providers.length === 0) {
    return (
      <Rows>
        <Row label="在线音质" desc="这个构建里没有声明音质档位的平台。">
          <span className="settings__number">—</span>
        </Row>
      </Rows>
    )
  }

  return (
    <Rows>
      {providers.map((provider) => (
        <PlatformQualityRow key={provider.id} provider={provider} />
      ))}
    </Rows>
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

  /*
   * 明确是非会员时，把需要会员的档收起来。判断放在渲染这一层而不是数据层，
   * 因为「有没有会员」是账号状态，会变；档位表是构建期固定的。
   *
   * 这里订阅而不是 getState()：在这一页登录/退出之后，会员档位要马上跟着
   * 出现或消失。读一次快照的话，用户得切走再切回来才看得到变化。
   */
  const account = useOnlineStore(provider.id)((state) => state.account)
  const tiers = (provider.qualityTiers ?? []).filter((tier) =>
    tierAllowed(provider, tier, account?.vip ?? null)
  )

  /*
   * 改档要同时落到两处：平台后端（主进程存盘、下次启动读它）和平台的播放
   * store（ensureStream 取流时读的就是后者）。只写后端的话，这一局里所有歌
   * 仍然按旧档取流 —— 用户的感受就是「改了没用」。
   */
  const applyTier = (tier: QualityTier): void => {
    setQuality(tier)
    void applyQuality(provider, tier).then((applied) => {
      if (applied) setQuality(applied)
    })
  }

  const needsVip = tiers.some((tier) => tier === 'lossless' || tier === 'exhigh')

  return (
    <Row
      label={provider.displayName}
      desc={needsVip ? '带 VIP 标记的档要对应平台会员；账号没登或没会员时不可选。' : '按平台给到的档位取流。'}
      id={`quality-${provider.id}`}
      stack
    >
      <div className="seg">
        {tiers.map((tier) => (
          <button
            key={tier}
            className={quality === tier ? 'is-active' : ''}
            onClick={() => applyTier(tier)}
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
 * 得有一个用户能改的答案——默认平台在前、本机最后（这产品是各平台的客户端，
 * 本机只是其中一个来源）。往上挪一位就到列表前面，播放与主版本一起跟着换。
 *
 * 只列这个构建真能用的平台：装了没登录也算可用（它仍能出流），没接入的不占位。
 */
function SourceOrderRows() {
  const order = useSourceOrder()
  const usable = new Set(['local', ...listAvailableProviders().map((provider) => provider.id)])
  const shown = order.filter((id) => usable.has(id))

  if (shown.length < 2) {
    return (
      <Rows>
        <Row label="音源优先级" desc="只有一个来源可用，顺序没有意义。" id="quality-order">
          <span className="settings__number">—</span>
        </Row>
      </Rows>
    )
  }

  return (
    <Rows>
      <Row
        label="先问哪一家"
        desc="本机音乐排在哪一档，就按这一档决定「本地有文件时还要不要去平台取」。"
        id="quality-order"
        stack
      >
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
      </Row>
    </Rows>
  )
}
