import { NeteaseLogin } from '../../../features/netease/NeteaseLogin'
import { setLoginOpen as setNeteaseLoginOpen, useNeteaseLoginOpen } from '../../../features/netease/store'
import { QqLogin, useQqLoginOpen } from '../../../features/qq/QqLogin'
import { KugouLogin, useKugouLoginOpen } from '../../../features/kugou/KugouLogin'
import { QishuiLogin, useQishuiLoginOpen } from '../../../features/qishui/QishuiLogin'

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
}

/** 只渲染当前被请求打开的那个对话框；两个平台各管各的标志。 */
export function PlatformLoginDialogs() {
  const neteaseOpen = useNeteaseLoginOpen()
  const qqOpen = useQqLoginOpen((state) => state.open)
  const kugouOpen = useKugouLoginOpen((state) => state.open)
  const qishuiOpen = useQishuiLoginOpen((state) => state.open)

  return (
    <>
      {neteaseOpen ? <NeteaseLogin onClose={() => setNeteaseLoginOpen(false)} /> : null}
      {qqOpen ? <QqLogin onClose={() => useQqLoginOpen.getState().setOpen(false)} /> : null}
      {kugouOpen ? <KugouLogin onClose={() => useKugouLoginOpen.getState().setOpen(false)} /> : null}
      {qishuiOpen ? (
        <QishuiLogin onClose={() => useQishuiLoginOpen.getState().setOpen(false)} />
      ) : null}
    </>
  )
}
