import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerCloudSongs,
  providerDailySongs,
  providerNewSongs,
  providerPersonalFm
} from '../src/features/online/recommend-channel.ts'

/**
 * 推荐位在渲染层的入口。
 *
 * 这四条共用一条通道、四种参数形状：日推与云盘不带参数，漫游与新歌榜带 limit。
 * 「今天的推荐」与「漫游的一次取流」在上游是完全不同的接口，这里也登记成不同的
 * 能力——把两者混成一条 kind 参数，页面就一直分不清哪一次没回来。
 *
 * 失败折空数组，与旧通道一致：一处推荐位读不到不该让整块变白。
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

test('四条助手各走自己那条通道，参数形状固定', async () => {
  const calls = install(() => ({ ok: true, value: [] }))
  await providerDailySongs('netease')
  await providerPersonalFm('netease', 6)
  await providerCloudSongs('netease')
  await providerNewSongs('kugou', 20)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['dailySongs', 'personalFm', 'cloudSongs', 'newSongs']
  )
  assert.deepEqual(calls[0].args, undefined)
  assert.deepEqual(calls[1].args, { limit: 6 })
  assert.deepEqual(calls[2].args, undefined)
  assert.deepEqual(calls[3].args, { limit: 20 })
})

test('主进程答 ok 时原样返回', async () => {
  install(() => ({ ok: true, value: [{ id: 7 }] }))
  assert.deepEqual(await providerDailySongs('qishui'), [{ id: 7 }])
  assert.deepEqual(await providerPersonalFm('qishui', 3), [{ id: 7 }])
  assert.deepEqual(await providerCloudSongs('netease'), [{ id: 7 }])
  assert.deepEqual(await providerNewSongs('qq', 5), [{ id: 7 }])
})

test('失败折空数组，并各留一条 warn：推荐位不该让整块变白', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerDailySongs('kugou'), [])
    assert.deepEqual(await providerPersonalFm('netease', 3), [])
    assert.deepEqual(await providerCloudSongs('netease'), [])
    assert.deepEqual(await providerNewSongs('qq', 10), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 4)
  assert.ok(warnings.lines[0].includes('kugou.dailySongs'))
  assert.ok(warnings.lines[1].includes('netease.personalFm'))
  assert.ok(warnings.lines[2].includes('netease.cloudSongs'))
  assert.ok(warnings.lines[3].includes('qq.newSongs'))
  assert.ok(warnings.lines[0].includes('handler-failed boom'))
})

test('没有主进程时也折空，理由说清是没有主进程', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerDailySongs('qq'), [])
    assert.deepEqual(await providerNewSongs('kugou', 10), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答了 ok 但值形状不对时按空处理，不把 undefined 交给页面', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.deepEqual(await providerDailySongs('netease'), [])
  assert.deepEqual(await providerPersonalFm('netease'), [])
  assert.deepEqual(await providerCloudSongs('netease'), [])
  assert.deepEqual(await providerNewSongs('qq'), [])
})

test('值给了对象而不是数组时也按空处理', async () => {
  install(() => ({ ok: true, value: { songs: [{ id: 1 }] } }))
  assert.deepEqual(await providerDailySongs('kugou'), [])
  assert.deepEqual(await providerNewSongs('qq', 10), [])
})
