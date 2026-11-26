import { ipcMain } from 'electron'
import { errorText } from './pure/error-text.ts'
import {
  callKey,
  failure,
  parseProviderCall,
  PROVIDER_CALL_CHANNEL,
  succeed,
  type ProviderCallResult
} from './pure/provider-call.ts'

/**
 * 一条通道，装下所有平台的所有能力。
 *
 * 各家的 `registerXxxIpc()` 在自己的通道后面顺手登记「这家能做这个」，分派表
 * 在运行时查——注册顺序不重要，重要的是登记发生在任何 invoke 之前。
 *
 * 为什么值得换掉每个能力一条通道：53 个能力 × 五家 = 上百条通道名，名字各写
 * 一遍就各错一遍，而「这家没这个能力」在旧的通道表里根本表达不出来（调用一条
 * 不存在的通道，渲染层拿到的是 Electron 的 "No handler registered"，一句
 * 与业务无关的英文）。这里把「没这个能力」变成一个带 code 的正常返回值。
 *
 * 与旧通道并存是刻意的：搬家的过程中旧入口继续可用，两边调的是同一个处理
 * 函数（逻辑只有一份），所以不会出现「新通道修好了、旧通道还坏着」的漂移。
 */

type ProviderCapabilityHandler = (args: unknown) => unknown | Promise<unknown>

const handlers = new Map<string, ProviderCapabilityHandler>()
let opened = false

/** 登记「某平台能做某能力」。重复登记以后来的为准（热重载、测试重置都靠它）。 */
export function registerProviderCapability(
  provider: string,
  capability: string,
  handler: ProviderCapabilityHandler
): void {
  handlers.set(callKey(provider, capability), handler)
}

export function openProviderGateway(): void {
  if (opened) return
  opened = true

  ipcMain.handle(PROVIDER_CALL_CHANNEL, async (_event, input: unknown): Promise<ProviderCallResult> => {
    const parsed = parseProviderCall(input)
    if (!parsed.ok) return parsed

    const { provider, capability, args } = parsed.request
    const handler = handlers.get(callKey(provider, capability))
    if (!handler) {
      return failure('unsupported-capability', `${provider} 没有注册能力 ${capability}`)
    }

    try {
      return succeed(await handler(args))
    } catch (error) {
      /*
       * 走到这里说明处理函数在自家 guard 之外抛了。不把 rejection 交给渲染层：
       * 那样它会在一次渲染里变成没人接的异常，页面直接白掉。折成带 code 的
       * 失败，页面至少能显示一句「这家这次不行」。
       */
      return failure('handler-failed', errorText(error))
    }
  })
}
