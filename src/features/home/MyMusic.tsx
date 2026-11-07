import { useEffect } from 'react'
import type { Route } from '../../app/routing'
import { platformView } from '../online/registry'
import { useAvailableProviders } from '../online/hooks'
import { useOnlineStore } from '../online/store'
import type { OnlineMusicProvider } from '../online/types'
import { openPlatformLogin } from '../../views/settings/panes/PlatformSignIn'

/**
 * 「我的音乐」——因账号而存在的那几个入口。
 *
 * 每日推荐、我喜欢的音乐、音乐云盘、我的歌单都不是曲库：没有登录就没有内容，
 * 登录的是哪个账号就换一批。所以它们挂在账号这一侧，而不是音乐库的标签页里。
 * 参考的四个播放器都是这样处理的——账号只管登录，账号里的东西在首页出现：
 * Cloudy 未登录首页就是每日推荐 + 榜单 + 推荐歌单，Mineradio 的账号弹窗只放登录，
 * Rhine 把「当前平台」放在设置里、内容集合单独成页。
 *
 * 这里只做入口，不重写平台页：点进去仍然落回 PlatformView，由它按平台声明的
 * collections 渲染（那套是同一份声明，不能有第二份）。
 */

interface MyMusicProps {
  onNavigate(route: Route): void
}

export function MyMusic({ onNavigate }: MyMusicProps) {
  const providers = useAvailableProviders()
  if (providers.length === 0) return null

  return (
    <div className="my-music">
      {providers.map((provider) => (
        <PlatformCard key={provider.id} provider={provider} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function PlatformCard({ provider, onNavigate }: { provider: OnlineMusicProvider; onNavigate(route: Route): void }) {
  const store = useOnlineStore(provider.id)
  const account = store((state) => state.account)
  const ready = store((state) => state.ready)
  const init = store((state) => state.init)

  // 账号状态来自主进程，打开主页时问一次；问不到就按未登录显示，不编造。
  useEffect(() => {
    void init().catch(() => {})
  }, [init])

  const collections = provider.collections ?? []

  if (!account) {
    return (
      <button className="my-music__signin" type="button" onClick={() => openPlatformLogin(provider.id)}>
        <span className="my-music__signin-name">{provider.displayName}</span>
        <span className="my-music__signin-act">{ready ? '登录' : '确认中'}</span>
      </button>
    )
  }

  return (
    <section className="my-music__card">
      <header className="my-music__head">
        <span className="my-music__name">{provider.displayName}</span>
        <span className="my-music__state is-on">
          {account.nickname + (account.vip ? ' · 会员' : '')}
        </span>
      </header>

      <div className="my-music__entries">
        {collections.map((collection) => (
          <button
            key={collection.kind}
            className="my-music__entry"
            type="button"
            title={collection.label}
            onClick={() => onNavigate({ view: platformView(provider), tab: collection.kind })}
          >
            {collection.label}
          </button>
        ))}
      </div>
    </section>
  )
}
