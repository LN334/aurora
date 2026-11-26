import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerMyPlaylists,
  providerPlaylistCreator,
  providerPlaylistOwned,
  providerPlaylistTracks,
  providerRecommendPlaylists,
  providerSearchPlaylists
} from '../src/features/online/playlist-channel.ts'

/**
 * 歌单（读）在渲染层的入口。
 *
 * 测的是「照搬」而不是「修好」：通道名对不对、参数形状固不固定、失败折回
 * 哪个兜底值、有没有留下一条能让控制台追到的 warn。主进程的结论这一层不改。
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

test('六个助手各走自己那条通道，参数形状固定', async () => {
  const calls = install(() => ({ ok: true, value: [] }))
  await providerMyPlaylists('netease', 40)
  await providerPlaylistTracks('qq', 12345)
  await providerPlaylistCreator('kugou', 'abc')
  await providerRecommendPlaylists('qq', 12)
  await providerPlaylistOwned('qishui', 77, null)
  await providerSearchPlaylists('qishui', '民谣', 6)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['myPlaylists', 'playlistTracks', 'playlistCreator', 'recommendPlaylists', 'playlistOwned', 'searchPlaylists']
  )
  assert.deepEqual(calls[0].args, { limit: 40 })
  assert.deepEqual(calls[1].args, { playlistId: 12345 })
  assert.deepEqual(calls[2].args, { playlistId: 'abc' })
  assert.deepEqual(calls[3].args, { limit: 12 })
  assert.deepEqual(calls[4].args, { playlistId: 77 })
  assert.deepEqual(calls[5].args, { keywords: '民谣', limit: 6 })
})

test('主进程答 ok 时原样返回', async () => {
  install((call) =>
    call.capability === 'playlistCreator'
      ? { ok: true, value: '张三' }
      : { ok: true, value: [{ id: 1, name: '歌单' }] }
  )
  assert.deepEqual(await providerMyPlaylists('netease'), [{ id: 1, name: '歌单' }])
  assert.equal(await providerPlaylistCreator('qq', 9), '张三')
})

test('失败折回空数组并留一条 warn，不是静默的空货架', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerMyPlaylists('kugou'), [])
    assert.deepEqual(await providerPlaylistTracks('kugou', 1), [])
    assert.deepEqual(await providerRecommendPlaylists('qq'), [])
    assert.deepEqual(await providerSearchPlaylists('qishui', '夜晚'), [])
    assert.equal(await providerPlaylistCreator('kugou', 1), '')
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 5)
  assert.ok(warnings.lines[0].includes('kugou.myPlaylists'))
  assert.ok(warnings.lines[0].includes('handler-failed boom'))
})

test('归属的兜底值由调用方给：QQ 是空数组，汽水是 null', async () => {
  install(() => ({ ok: false, error: { code: 'unsupported-capability', message: 'no' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerPlaylistOwned('qq', null, []), [])
    assert.equal(await providerPlaylistOwned('qishui', 5, null), null)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
})

test('没有主进程时折兜底、并且说清楚是没有主进程', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerMyPlaylists('netease'), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 1)
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答了 ok 但值形状不对时按空处理，不把 undefined 交给页面', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.deepEqual(await providerMyPlaylists('qq'), [])
  assert.deepEqual(await providerSearchPlaylists('qishui', '歌单'), [])
})
