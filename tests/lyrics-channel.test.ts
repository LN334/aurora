import assert from 'node:assert/strict'
import test from 'node:test'

import { providerLyrics } from '../src/features/online/lyrics-channel.ts'

/**
 * 歌词在渲染层的入口。
 *
 * 通道只搬两份原文，不做合并——译文是不是独立字段、要不要配对，是 align 的事。
 * 这里钉的是「两份分别到达、各自的空白被修掉、都空才是没有歌词」。
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

test('走 lyrics 那条通道，参数是 { songId }', async () => {
  const calls = install(() => ({ ok: true, value: { lrc: '[00:01.00]a', translation: '[00:01.00]A' } }))
  const bundle = await providerLyrics('netease', 12345)
  assert.deepEqual(bundle, { lrc: '[00:01.00]a', translation: '[00:01.00]A' })
  assert.equal(calls[0].capability, 'lyrics')
  assert.deepEqual(calls[0].args, { songId: 12345 })
})

test('字符串 id 原样传，给 B 站那种字母主键留路', async () => {
  const calls = install(() => ({ ok: true, value: { lrc: '[00:01.00]a' } }))
  await providerLyrics('kugou', 'abc123')
  assert.deepEqual(calls[0].args, { songId: 'abc123' })
})

test('只有译文时正文留空串，不是没有歌词', async () => {
  install(() => ({ ok: true, value: { lrc: '   ', translation: '[00:01.00]A' } }))
  assert.deepEqual(await providerLyrics('netease', 1), { lrc: '', translation: '[00:01.00]A' })
})

test('两份都空才是 null', async () => {
  install(() => ({ ok: true, value: { lrc: '', translation: '  ' } }))
  assert.equal(await providerLyrics('netease', 1), null)
})

test('读失败返回 null 并留一行 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerLyrics('netease', 1), null)
  } finally {
    warnings.restore()
  }
  assert.ok(warnings.lines[0].includes('netease.lyrics'))
})

test('没有主进程时返回 null', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.equal(await providerLyrics('netease', 1), null)
  } finally {
    warnings.restore()
  }
  assert.ok(warnings.lines[0].includes('没有主进程'))
})
