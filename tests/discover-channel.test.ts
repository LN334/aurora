import assert from 'node:assert/strict'
import test from 'node:test'

import { providerDiscover } from '../src/features/online/discover-channel.ts'

/**
 * 「发现」板块在渲染层的入口。
 *
 * 一个 kind 问一个板块，offset 是「换一批」的游标。失败折回空结果：首屏的一块
 * 内容读不到，页面画空态比抛出去合适；理由留在 warn 里。
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

const EMPTY = { kind: 'newsongs', songs: [], playlists: [] }

test('走 discover 那条通道，参数是 { kind, limit, offset }', async () => {
  const calls = install(() => ({ ok: true, value: { kind: 'newsongs', songs: [{ id: 3 }], playlists: [] } }))
  const result = await providerDiscover('netease', 'newsongs', 40, 80, EMPTY)
  assert.deepEqual(result.songs, [{ id: 3 }])
  assert.equal(calls[0].capability, 'discover')
  assert.deepEqual(calls[0].args, { kind: 'newsongs', limit: 40, offset: 80 })
})

test('读失败折回空结果，并留一行 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerDiscover('netease', 'newsongs', 40, 0, EMPTY), EMPTY)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 1)
  assert.ok(warnings.lines[0].includes('netease.discover'))
})

test('没有主进程时折回空结果', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerDiscover('netease', 'playlists', 40, 0, EMPTY), EMPTY)
  } finally {
    warnings.restore()
  }
  assert.ok(warnings.lines[0].includes('没有主进程'))
})
