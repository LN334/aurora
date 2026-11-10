import { useEffect } from 'react'
import { useAvailableProviders } from '../features/online/hooks'
import { useOnlineStore } from '../features/online/store'
import type { OnlineMusicProvider } from '../features/online/types'
import { setRoamPlatform, useRoamPlatforms } from '../features/player/roam-sources'
import { setPushSignedOnly, usePushSignedOnly } from '../features/settings/push-signed'
import { Toggle } from './settings/parts'
import { openPlatformLogin } from './settings/panes/PlatformSignIn'

/**
 * 第一次启动时那一道设置。
 *
 * 只当面问一件必须问的事：从哪几家要推荐。勾选与登录是两回事——勾选是
 * 「别拿它推给我」，登录是「能不能给」，两个都在这儿一次说完。之后首页与
 * 漫游都按这一份走，不用再去设置里翻。
 */
export function Onboarding({ onDone }: { onDone(): void }) {
  const providers = useAvailableProviders()
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const lastOne = chosen.length <= 1

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="先设置一下">
      <div className="onb__panel">
        <p className="onb__kicker">第一次使用</p>
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

        <div className="onb__acts">
          <p className="onb__hint">
            {chosen.length === 0 ? '至少留一家：全关就没有推荐可看了。' : '设置页里随时能改。'}
          </p>
          <div className="onb__btns">
            <button className="rh-btn" type="button" onClick={onDone}>
              稍后再设
            </button>
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={chosen.length === 0}
              onClick={onDone}
            >
              开始使用
            </button>
          </div>
        </div>
      </div>
    </div>
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
