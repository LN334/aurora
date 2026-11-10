import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { useAvailableProviders } from '../features/online/hooks'
import { useOnlineStore } from '../features/online/store'
import type { OnlineMusicProvider } from '../features/online/types'
import { useOverlayStatus } from '../features/overlay/status'
import { setRoamPlatform, useRoamPlatforms } from '../features/player/roam-sources'
import { setAccentFromArt, useAccentFromArt } from '../features/settings/accent'
import { setPushSignedOnly, usePushSignedOnly } from '../features/settings/push-signed'
import { Toggle } from './settings/parts'
import { openPlatformLogin } from './settings/panes/PlatformSignIn'

/**
 * 第一次启动时那一道设置。
 *
 * 两页：先问从哪几家要推荐，再摆一下听歌的样子（桌面歌词、界面取色）。
 * 前者是必须问的——勾选与登录是两回事，勾选是「别拿它推给我」，登录是
 * 「能不能给」；后者是顺手，开一眼就知道差别。都不喜欢可以「稍后再设」，
 * 之后在设置页里改。
 */
export function Onboarding({ onDone }: { onDone(): void }) {
  const [step, setStep] = useState(0)
  const providers = useAvailableProviders()
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const lastOne = chosen.length <= 1

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="先设置一下">
      <div className="onb__panel">
        <p className="onb__kicker">
          {'第一次使用 · '}
          <span className="onb__step">{step + 1} / 2</span>
        </p>

        {step === 0 ? (
          <PushStep providers={providers} chosen={chosen} signedOnly={signedOnly} lastOne={lastOne} />
        ) : (
          <LookStep />
        )}

        <div className="onb__acts">
          <p className="onb__hint">
            {step === 0
              ? chosen.length === 0
                ? '至少留一家：全关就没有推荐可看了。'
                : '下一页顺手摆一下听歌的样子。'
              : '这些随时能在设置页里改。'}
          </p>
          <div className="onb__btns">
            {step === 0 ? (
              <>
                <button className="rh-btn" type="button" onClick={onDone}>
                  稍后再设
                </button>
                <button
                  className="rh-btn rh-btn--main"
                  type="button"
                  disabled={chosen.length === 0}
                  onClick={() => setStep(1)}
                >
                  下一步
                </button>
              </>
            ) : (
              <>
                <button className="rh-btn" type="button" onClick={() => setStep(0)}>
                  上一步
                </button>
                <button className="rh-btn rh-btn--main" type="button" onClick={onDone}>
                  开始使用
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 第一页：从哪几家要推荐。
 *
 * 每家的状态来自它自己的 store：已登录显示昵称，没登录给一个能直接开的
 * 登录框，连不上的照实说。勾到只剩一家时最后一家锁住——全关等于没有推荐。
 */
function PushStep({
  providers,
  chosen,
  signedOnly,
  lastOne
}: {
  providers: OnlineMusicProvider[]
  chosen: string[]
  signedOnly: boolean
  lastOne: boolean
}) {
  return (
    <>
      <h2 className="onb__title">先挑一下从哪儿给你推歌</h2>
      <p className="onb__note">
        勾掉的平台不会被问，也不会出现在每日推荐、推荐歌单、推荐专辑、最近新歌与漫游里。
        收藏、关注和最近听过不受影响。
      </p>

      {providers.length === 0 ? (
        <p className="onb__note">这一版没有可用的在线平台，直接用本机音乐就好。</p>
      ) : (
        <div className="onb__plats">
          {providers.map((provider) => (
            <OnboardPlatform
              key={provider.id}
              provider={provider}
              on={chosen.includes(provider.id)}
              locked={lastOne && chosen.includes(provider.id)}
            />
          ))}
        </div>
      )}

      <div className="onb__signed">
        <div className="onb__signed-text">
          <span className="onb__signed-name">只用我登录了的平台</span>
          <span className="onb__signed-hint">
            关掉后，没登录的平台也会推，但推的是它家的公开榜单，不是给你的。
          </span>
        </div>
        <Toggle checked={signedOnly} label="只用我登录了的平台" onChange={setPushSignedOnly} />
      </div>
    </>
  )
}

/**
 * 第二页：听歌的样子。
 *
 * 只放两样开完立刻能看到的：桌面歌词是独立置顶窗口，开了就浮在桌面上；
 * 界面取色决定主色跟不跟封面走。字号码数这类细调留设置页，别在第一次
 * 启动时堆太多。
 */
function LookStep() {
  const accent = useAccentFromArt()
  const status = useOverlayStatus()
  const open = status?.open ?? false

  return (
    <>
      <h2 className="onb__title">再顺手摆一下听歌的样子</h2>
      <p className="onb__note">两样都能随时关掉，关了界面会安静一些。</p>

      <div className="onb__signed">
        <div className="onb__signed-text">
          <span className="onb__signed-name">桌面歌词</span>
          <span className="onb__signed-hint">
            在桌面上开一个小窗口，只显示正在唱的那一句；换歌自动跟上。
          </span>
        </div>
        {isNative ? (
          <button className="btn" type="button" onClick={() => void bridge.overlay.toggle(!open)}>
            {open ? '关闭' : '打开'}
          </button>
        ) : (
          <span className="settings__number">仅桌面版</span>
        )}
      </div>

      <div className="onb__signed">
        <div className="onb__signed-text">
          <span className="onb__signed-name">界面跟着封面取色</span>
          <span className="onb__signed-hint">
            开着时主色随当前封面变；壁纸本身很花的话，关掉更清爽。
          </span>
        </div>
        <Toggle checked={accent} label="界面跟着封面取色" onChange={setAccentFromArt} />
      </div>
    </>
  )
}

function OnboardPlatform({
  provider,
  on,
  locked
}: {
  provider: OnlineMusicProvider
  on: boolean
  locked: boolean
}) {
  const store = useOnlineStore(provider.id)
  const account = store((state) => state.account)
  const ready = store((state) => state.ready)
  const blocked = store((state) => state.backendBlocked)
  const detail = store((state) => state.statusDetail)
  const init = store((state) => state.init)

  useEffect(() => {
    // 不先问一次，已登录的平台也会显示成「还没有登录」。
    void init().catch(() => {})
  }, [init])

  const name = provider.shortName ?? provider.displayName
  const meta = account
    ? account.nickname
    : blocked
      ? (detail ?? '暂时连不上')
      : ready
        ? '还没有登录'
        : '正在确认登录状态…'

  return (
    <div className={'onb-plat' + (on ? ' is-on' : '')}>
      <span className={'onb-plat__dot acct2-dot--' + provider.id} aria-hidden="true" />
      <div className="onb-plat__text">
        <span className="onb-plat__name">{name}</span>
        <span className="onb-plat__meta">{meta}</span>
      </div>
      {account ? (
        <span className="onb-plat__tag">已登录</span>
      ) : (
        <button
          className="btn btn--small"
          type="button"
          disabled={!ready || blocked}
          onClick={() => openPlatformLogin(provider.id)}
        >
          登录
        </button>
      )}
      <Toggle
        checked={on}
        disabled={locked}
        label={'推流：' + name}
        onChange={(next) => setRoamPlatform(provider.id, next)}
      />
    </div>
  )
}
