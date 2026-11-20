import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { cleanCode } from './code.ts'

/**
 * 同一网络里只凭房间码找到房间。
 *
 * 房间原本要靠房主把 `IP:端口` 念出来，朋友再一个字一个字填进去——这一步是
 * 「一起听」最容易断的地方：地址是多网卡里挑的一条、端口是五位数、中间夹着
 * 冒号，抄错一位就是「连不上房主」，两个人对着屏幕找半天也看不出错在哪。
 *
 * 房间就在同一个局域网里，那就不用抄：房主开房时在 UDP 47120 上等一句暗号，
 * 客人拿着房间码喊一声，房主听懂了就回一句「我在这儿」。地址自己出来了。
 *
 * 三件事说清楚：
 * 1. 只有房间里的人答话——暗号里带着房间码，对不上就装作没听见，所以没码的
 *    人扫不到这间房。
 * 2. 跨网络不成立：路由器不转发广播，公网那一套仍旧走地址加隧道。
 * 3. 发现失败不是错误：防火墙、公司网络禁广播都会让这条路走不通，界面这时
 *    退回手填地址，而不是把人卡在「正在找」。
 */

const DISCOVER_PORT = 47120

/** 暗号前缀；后面跟房间码。 */
const PING = 'aurora-discover-v1'

interface RoomHint {
  /** 房间所在机器的 `地址:端口`，可以直接拿去连。 */
  address: string
  /** 房间名，界面上用来确认「找到的是不是那一间」。 */
  name: string
  /** 那一间有没有上锁，先提示客流一句，省得进去才被拒。 */
  locked: boolean
}

/** 房主这头答话要用的现状。 */
interface RoomFacts {
  code: string
  port: number
  name: string
  locked: boolean
}

let responder: Socket | null = null

/**
 * 房主开始答话。
 *
 * `lookup` 每次问都现取：房间名、密码、端口在房间活着的时候都能改，缓存一份
 * 就会出现「明明改了名，朋友还是看到旧名字」。
 */
export function startAnswering(lookup: () => RoomFacts | null, port = DISCOVER_PORT): void {
  stopAnswering()
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  responder = socket
  socket.on('error', () => {
    /* 端口被占、被防火墙按住：没有发现服务而已，房间照开。 */
    if (responder === socket) stopAnswering()
  })
  socket.on('message', (raw, from) => {
    const text = String(raw)
    if (!text.startsWith(PING + ' ')) return
    const asked = cleanCode(text.slice(PING.length + 1))
    const here = lookup()
    if (!here || !here.port || asked !== here.code) return
    /*
     * 回包里不放房间码：能问对码的人才收得到这条应答，再回一遍等于把门牌号
     * 抄给一个本来就拿着门牌号的人。
     */
    const reply = JSON.stringify({
      t: 'aurora-room',
      name: here.name,
      port: here.port,
      locked: here.locked
    })
    try {
      socket.send(reply, from.port, from.address)
    } catch {
      /* 对方已经走了 */
    }
  })
  socket.bind(port)
}

export function stopAnswering(): void {
  const socket = responder
  responder = null
  if (!socket) return
  try {
    socket.close()
  } catch {
    /* 已经关了 */
  }
}

/**
 * 客人这头喊一声。
 *
 * `targets` 让测试能直接对着本机问；正常走的时候是全网广播加每条网卡的
 * 定向广播——255.255.255.255 在有些机器的多网卡上只会从其中一条出去。
 */
export function discover(
  code: string,
  options: { timeoutMs?: number; targets?: string[]; port?: number } = {}
): Promise<RoomHint | null> {
  const wanted = cleanCode(code)
  if (!wanted) return Promise.resolve(null)
  const timeoutMs = options.timeoutMs ?? 900
  const targets = options.targets ?? broadcastTargets()
  const port = options.port ?? DISCOVER_PORT
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const finish = (hit: RoomHint | null): void => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        /* 已经关了 */
      }
      resolve(hit)
    }
    socket.on('error', () => finish(null))
    socket.on('message', (raw, from) => {
      let message: { t?: string; name?: string; port?: number; locked?: boolean }
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.t !== 'aurora-room' || !message.port) return
      finish({
        address: from.address + ':' + message.port,
        name: message.name ?? '',
        locked: Boolean(message.locked)
      })
    })
    socket.bind(() => {
      try {
        socket.setBroadcast(true)
      } catch {
        /* 不允许广播就只剩定向广播那几条 */
      }
      const ask = (): void => {
        for (const target of targets) {
          try {
            socket.send(PING + ' ' + wanted, port, target)
          } catch {
            /* 这条网卡此刻不可用 */
          }
        }
      }
      ask()
      /* 再问一次：第一次可能正好撞上房主那边还在起服务，或者包丢了。 */
      setTimeout(ask, Math.min(400, Math.max(120, Math.round(timeoutMs / 2))))
      setTimeout(() => finish(null), timeoutMs)
    })
  })
}

/**
 * 该往哪些地址广播。
 *
 * 只发 255.255.255.255 是不够的：装了 VPN、虚拟机、多块网卡的机器上，这个
 * 全网广播未必从客人所在的那条网卡出去。每条 IPv4 网卡按自己的掩码算出定向
 * 广播地址，两条一起发，才不用赌哪一条是对的。
 */
export function broadcastTargets(): string[] {
  const targets = ['255.255.255.255']
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal || !item.netmask) continue
      const address = ipToInt(item.address)
      const mask = ipToInt(item.netmask)
      if (address === null || mask === null) continue
      const text = intToIp((address | (~mask >>> 0)) >>> 0)
      if (text && !targets.includes(text)) targets.push(text)
    }
  }
  return targets
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const piece = Number(part)
    if (!Number.isInteger(piece) || piece < 0 || piece > 255) return null
    value = (value << 8) + piece
  }
  return value >>> 0
}

function intToIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}
