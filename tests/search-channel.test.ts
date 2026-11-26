import assert from 'node:assert/strict'
import test from 'node:test'

import { providerSearch } from '../src/features/online/search-channel.ts'

/**
 * 搜索在渲染层的入口。
 *
 * 钉住两件事：一，它走 `search` 那条通道，参数是命名对象（keywords / type /
 * limit）；二，失败折回调用方给的空态——搜索框的「没搜到」与「通道断了」在屏幕上
 * 本来就应该长得一样，区别只留在 console.warn 里。
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

const EMPTY = { songs: [], albums: [], artists: [] }

test('走 search 那条通道，参数是 { keywords, type, limit }', async () => {
  const calls = install(() => ({ ok: true, value: { songs: [{ id: 1 }], albums: [], artists: [] } }))
  const result = await providerSearch('netease', '范特西', 'song', 30, EMPTY)
  assert.deepEqual(result.songs, [{ id: 1 }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'netease')
  assert.equal(calls[0].capability, 'search')
  assert.deepEqual(calls[0].args, { keywords: '范特西', type: 'song', limit: 30 })
})

test('不传 limit 时参数里是 undefined，交给主进程自己的默认值', async () => {
  const calls = install(() => ({ ok: true, value: EMPTY }))
  await providerSearch('qq', '莲花', 'song', undefined, EMPTY)
  assert.deepEqual(calls[0].args, { keywords: '莲花', type: 'song', limit: undefined })
})

test('读失败折回调用方给的兜底，并留一行 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerSearch('kugou', 'x', 'song', 10, EMPTY), EMPTY)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 1)
  assert.ok(warnings.lines[0].includes('kugou.search'))
  assert.ok(warnings.lines[0].includes('handler-failed boom'))
})

test('没有主进程时同样折回兜底，不抛', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerSearch('netease', 'x', 'song', 10, EMPTY), EMPTY)
  } finally {
    warnings.restore()
  }
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答复 ok 但值是 null 时也折回兜底（形状不对不算答案）', async () => {
  install(() => ({ ok: true, value: null }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerSearch('netease', 'x', 'song', 10, EMPTY), EMPTY)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 0)
})
