/**
 * 从 cloudflared 的一行输出里认出快速隧道地址。
 *
 * 抽成纯函数是为了能单测：cloudflared 的真实日志没法在测试里跑出来，但它的样子
 * 可以按实测样本钉住。
 */

/**
 * 快速隧道的地址长这样：`https://adrian-when-coalition-urw.trycloudflare.com`。
 *
 * 必须要求四段以上子域：日志里还会出现 `api.trycloudflare.com`（cloudflared
 * 启动时调的接口），只写 `[a-z0-9-]+` 会先把它认成隧道地址——第一次实测就栽在这里。
 */
const QUICK_URL = /https:\/\/([a-z0-9]+(?:-[a-z0-9]+){3,}\.trycloudflare\.com)/i

/** 认得出来就返回 `wss://` 形式（房间要的是 WebSocket），认不出返回 null。 */
export function parseCloudflareLine(line: string): string | null {
  const match = QUICK_URL.exec(line)
  return match ? 'wss://' + match[1] : null
}
