import assert from 'node:assert/strict'
import test from 'node:test'

import { providerStreamUrl } from '../src/features/online/playback-channel.ts'

/**
 * 「取播放地址」在渲染层的入口。
 *
 * 这里钉住两件事：通道名与参数形状，以及**失败折回兜底对象而不是抛**——取流
 * 失败是常态，每一种 reason 都要原样画在播放条上；抛出去只剩一句「播放失败」。
 */

type Call = { provider: string; capability: string; args: unknown }

const globals = globalThis as unknown as { window?: unknown }

function install(answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = []
  globals.window = {
    aurora: {
      provider: {
        call: async (provider: string, capability: string, args: unknown) => {
          const call = { provider, capability, args }
          calls.push(call)
          return answer(call)
        }
      }
    }
  }
  return calls
}

function collectWarnings(): { lines: string[]; restore(): void } {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '))
  }
  return { lines, restore: () => (console.warn = original) }
}

const fallback = { ok: false as const, reason: 'service-unavailable' as const }

test('走 playback 通道，参数形状固定；汽水那种 alias 字符串原样传', async () => {
  const calls = install(() => ({ ok: true, value: { ok: true, url: 'https://x' } }))
  await providerStreamUrl('netease', 12345, 'exhigh', fallback)
  await providerStreamUrl('qishui', 'alias-9', undefined, fallback)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['playback', 'playback']
  )
  assert.deepEqual(calls[0].args, { songId: 12345, quality: 'exhigh' })
  assert.deepEqual(calls[1].args, { songId: 'alias-9', quality: undefined })
})

test('主进程答 ok 时把答复原样交给播放器', async () => {
  const answer = { ok: true, url: 'https://cdn/x.mp3', br: 320000, level: 'exhigh', trial: false }
  install(() => ({ ok: true, value: answer }))
  assert.deepEqual(await providerStreamUrl('qq', 7, 'exhigh', fallback), answer)
})

test('取流失败折回兜底，并先留一条能追到是哪一家的 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'upstream is down' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerStreamUrl('kugou', 9, 'lossless', fallback), fallback)
    assert.equal(warnings.lines.length, 1)
    assert.ok(warnings.lines[0].includes('kugou.playback'))
    assert.ok(warnings.lines[0].includes('upstream is down'))
  } finally {
    warnings.restore()
  }
})

test('没有主进程也折回兜底，理由说清是没有主进程', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerStreamUrl('bilibili', 11, 'exhigh', fallback), fallback)
    assert.equal(warnings.lines.length, 1)
    assert.ok(warnings.lines[0].includes('没有主进程'))
  } finally {
    warnings.restore()
  }
})

test('答了 ok 却没给值：当没答，不把 undefined 交给播放器', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.deepEqual(await providerStreamUrl('netease', 1, 'standard', fallback), fallback)
})
