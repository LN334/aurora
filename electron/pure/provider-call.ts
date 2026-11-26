/**
 * 一次「跨平台调用」长什么样，以及它只能以哪两种方式结束。
 *
 * 现在每个平台一套 `netease:xxx` / `qq:xxx` / `kugou:xxx` 通道，253 个
 * `ipcMain.handle`：渲染层要知道「哪家平台能干什么」就只能靠方法名硬编码，
 * 而「这家没有这个能力」和「这家有这个能力、但这次什么都没取到」在通道层面
 * 长得一模一样——两条路都返回 `[]`。
 *
 * 这个模块只负责最外层那点形状：调用怎么描述、坏输入怎么拒、失败怎么带原因。
 * 真正干活的分派在 `electron/provider-gateway.ts`，两边分开是因为这里要能被
 * 单元测试直接加载，而那一半必须 import electron。
 *
 * 约定：**通道永不 reject**。渲染层拿到的一定是 `{ ok: true, value }` 或
 * `{ ok: false, error }`；主进程里真正的异常已经由各家的 guard 折成空结果，
 * 走到 `handler-failed` 的只可能是 guard 之外的程序错误，而那种情况更需要
 * 一句能读的话，不是一条未处理的 rejection。
 */

/** 唯一的跨平台通道名。 */
export const PROVIDER_CALL_CHANNEL = 'provider:call'

/**
 * 认哪些平台。
 *
 * 白名单而不是「渲染层说谁就是谁」：provider 这个名字会进日志、进错误文案，
 * 也会被拿去查处理器表；让它自由发挥，拼错时得到的是一句「未知平台」之外
 * 什么都没有的空结果。
 */
export const PROVIDER_IDS = ['netease', 'qq', 'kugou', 'qishui', 'bilibili'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/**
 * 能力名的语法。
 *
 * 小驼峰、小写开头、四十字符以内。它只是名字，不带路径也不带分隔符——分派表
 * 用的键是 `平台/能力`，让能力名里能出现 `/` 就等于给通道注入留了个口子。
 */
const CAPABILITY_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/

type ProviderCallErrorCode =
  /** 平台不在白名单里。 */
  | 'unsupported-provider'
  /** 能力名不像话（大小写、长度、非法字符）。 */
  | 'invalid-capability'
  /** 平台存在，但这个能力没有注册处理器。 */
  | 'unsupported-capability'
  /** 处理器自己抛了——不该发生，发生了就得说清楚是什么。 */
  | 'handler-failed'

interface ProviderCallError {
  code: ProviderCallErrorCode
  message: string
}

export type ProviderCallResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderCallError }

interface ProviderCallRequest {
  provider: ProviderId
  capability: string
  /** 原样透传给处理器：参数校验是各平台自己的事，这一层不猜形状。 */
  args: unknown
}

type ProviderCallParse =
  | { ok: true; request: ProviderCallRequest }
  | { ok: false; error: ProviderCallError }

/** 分派表的键。 */
export function callKey(provider: string, capability: string): string {
  return `${provider}/${capability}`
}

export function failure(code: ProviderCallErrorCode, message: string): ProviderCallResult<never> {
  return { ok: false, error: { code, message } }
}

export function succeed<T>(value: T): ProviderCallResult<T> {
  return { ok: true, value }
}

/** 回显输入时的长度上限：错误文案不该把一整首歌的词搬进日志。 */
function brief(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 40)
  if (value === null || value === undefined) return String(value)
  return typeof value
}

export function parseProviderCall(input: unknown): ProviderCallParse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: { code: 'unsupported-provider', message: '调用参数不是一个对象' } }
  }
  const record = input as Record<string, unknown>

  const provider = record.provider
  if (typeof provider !== 'string' || !(PROVIDER_IDS as readonly string[]).includes(provider)) {
    return { ok: false, error: { code: 'unsupported-provider', message: `未知平台：${brief(provider)}` } }
  }

  const capability = record.capability
  if (typeof capability !== 'string' || !CAPABILITY_NAME.test(capability)) {
    return { ok: false, error: { code: 'invalid-capability', message: `能力名不合法：${brief(capability)}` } }
  }

  return { ok: true, request: { provider: provider as ProviderId, capability, args: record.args } }
}
