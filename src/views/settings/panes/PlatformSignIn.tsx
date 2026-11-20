import { NeteaseLogin } from '../../../features/netease/NeteaseLogin'
import { setLoginOpen as setNeteaseLoginOpen, useNeteaseLoginOpen } from '../../../features/netease/store'
import { QqLogin, useQqLoginOpen } from '../../../features/qq/QqLogin'
import { KugouLogin, useKugouLoginOpen } from '../../../features/kugou/KugouLogin'
import { QishuiLogin, useQishuiLoginOpen } from '../../../features/qishui/QishuiLogin'
import { BiliLogin, useBiliLoginOpen } from '../../../features/bilibili/BiliLogin'

/**
 * 在线平台的登录入口与对话框。
 *
 * 平台页面以前是唯一的登录入口：设置页里那一行如果没有自己的对话框，用户看到
 * 「未登录」却无处点。两个对话框本来就与页面无关（它们是全屏 modal），
 * 所以这里按平台的 open 标志直接挂载，不复制它们的流程。
 */
export function openPlatformLogin(providerId: string): void {
  if (providerId === 'netease') setNeteaseLoginOpen(true)
  else if (providerId === 'qq') useQqLoginOpen.getState().setOpen(true)
  else if (providerId === 'kugou') useKugouLoginOpen.getState().setOpen(true)
  else if (providerId === 'qishui') useQishuiLoginOpen.getState().setOpen(true)
  else if (providerId === 'bilibili') useBiliLoginOpen.getState().setOpen(true)
}

/**
 * 换页时把五个平台的登录层一起收起。
 *
 * 它们是全屏 modal，不属于任何一页；切页之后还浮着，既挡住新页面，也让人
 * 以为「点了没反应」——实测从「我」点开登录、切到设置、再点「检查更新」，
 * 点到的是那颗还挂着的登录框。
 */
export function closePlatformLogins(): void {
  setNeteaseLoginOpen(false)
  useQqLoginOpen.getState().setOpen(false)
  useKugouLoginOpen.getState().setOpen(false)
  useQishuiLoginOpen.getState().setOpen(false)
  useBiliLoginOpen.getState().setOpen(false)
}

/** 只渲染当前被请求打开的那个对话框；两个平台各管各的标志。 */
export function PlatformLoginDialogs() {
  const neteaseOpen = useNeteaseLoginOpen()
  const qqOpen = useQqLoginOpen((state) => state.open)
  const kugouOpen = useKugouLoginOpen((state) => state.open)
  const qishuiOpen = useQishuiLoginOpen((state) => state.open)
  const biliOpen = useBiliLoginOpen((state) => state.open)

  return (
    <>
      {neteaseOpen ? <NeteaseLogin onClose={() => setNeteaseLoginOpen(false)} /> : null}
      {qqOpen ? <QqLogin onClose={() => useQqLoginOpen.getState().setOpen(false)} /> : null}
      {kugouOpen ? <KugouLogin onClose={() => useKugouLoginOpen.getState().setOpen(false)} /> : null}
      {qishuiOpen ? (
        <QishuiLogin onClose={() => useQishuiLoginOpen.getState().setOpen(false)} />
      ) : null}
      {biliOpen ? <BiliLogin onClose={() => useBiliLoginOpen.getState().setOpen(false)} /> : null}
    </>
  )
}
