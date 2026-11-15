import { useEffect, useMemo, useState } from 'react'
import { roamPlatforms, useRoamPlatforms } from '../player/roam-sources'
import { bridge } from '../../bridge'
import { usePushSignedOnly } from '../settings/push-signed'
import type { ProviderId } from './types'

/**
 * 推送位问哪几家：勾着的，加上「这一家现在登录着」——除非用户自己放开了。
 *
 * 两道条件的含义不一样。勾选是用户的意思——「别拿它推给我」；登录是能不能——
 * 没登录的平台给不出「给你的推荐」，只会拿公开榜单顶上（QQ 的今日私享要账号，
 * 网易云的私人漫游要账号，汽水的 feed 要 session）。默认两个都满足才问，推荐位
 * 才不会把游客也看得到的榜单冒充成个人推荐。
 *
 * 但这是用户的判断，不是我们替他定：设置里那句「只用我登录了的平台」关掉之后，
 * 没登录的平台照旧参与，只是内容退化成公开榜单。
 *
 * 「没登录」只影响推送位。搜索、播放、收藏都不看这个判断：那些事游客也能做。
 */

/**
 * 推送位该问的平台。
 *
 * 返回 null 表示登录状态还没回来（一次 IPC，毫秒级）：调用方此时应停在加载态，
 * 别先画一版再收紧（那会看起来像内容在换）。
 *
 * 登录状态问主进程，不问各平台的 store。问 store 需要先 init——为了知道「这家
 * 登录没有」把四家后端全拉起来（网易云那 93 MB 的包、酷狗的本地服务），正是不
 * 该做的事。主进程读一眼会话文件就知道，零加载。
 */
export function usePushPlatforms(): ProviderId[] | null {
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const chosenKey = chosen.join(',')
  const [signed, setSigned] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    if (!signedOnly) return
    let alive = true
    void bridge.platforms
      .signedIn()
      .then((map) => {
        if (alive) setSigned(map)
      })
      .catch(() => {
        // 问不出来就当都没登录：宁可少问一家，也别把四家后端拉起来。
        if (alive) setSigned({})
      })
    return () => {
      alive = false
    }
  }, [signedOnly])

  return useMemo(() => {
    // 用户放开了：勾着谁就问谁，没登录也照问，取回来的会是公开榜单。
    if (!signedOnly) return chosen
    if (!signed) return null
    const allowed = new Set(Object.keys(signed).filter((id) => signed[id]))
    return chosen.filter((id) => allowed.has(id))
    // 数组每份快照都是新的，用 join 后的字符串与登录快照当依赖。
  }, [chosenKey, signed, signedOnly])
}

/**
 * 首帧之后把用户勾选的推流平台先问一遍。
 *
 * 只按勾选，不看登录：勾了就是「这家可以推给我」，没登录的那家也要把后端先拉
 * 起来——酷狗要 spawn 本地服务、网易云要完成设备握手，这两件都要一两秒。等用户
 * 点进漫游或搜索才做，这段等待就落到操作上了。
 *
 * 主进程侧只做与账号无关的前半段，全部单飞幂等：和首页取数撞上也只会跑一次，
 * 重复调用命中已热的缓存。预热失败不在这里写任何状态——该报的错由 init 留在页面上。
 */
export function warmChosenPlatforms(): void {
  const ids = roamPlatforms()
  // 一家都没勾就是「不要推荐」，这时什么也不用拉。
  if (ids.length === 0) return
  void bridge.platforms.warmUp(ids).catch(() => {})
}
