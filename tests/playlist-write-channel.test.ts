import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerPlaylistAddTracks,
  providerPlaylistCreate,
  providerPlaylistRemove,
  providerPlaylistRemoveTracks,
  providerPlaylistRename
} from '../src/features/online/playlist-channel.ts'

/**
 * 歌单写侧在渲染层的入口。
 *
 * 测的是「照搬」：通道名对不对、参数形状固定不固定、失败折回 false/null 而不是
 * 抛异常、以及有没有留下一条能追到控制台的 warn。主进程的判据不在这里测——它
 * 与旧 handle 共用同一份实现，搬家不改结论。
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

test('五条写操作各走自己那条通道，参数形状固定', async () => {
  const calls = install(() => ({ ok: true, value: true }))
  await providerPlaylistCreate('netease', '新的歌单')
  await providerPlaylistAddTracks('netease', 501, [1, 2])
  await providerPlaylistRemoveTracks('netease', 501, [3])
  await providerPlaylistRename('netease', 501, '改个名')
  await providerPlaylistRemove('netease', 501)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['playlistCreate', 'playlistAddTracks', 'playlistRemoveTracks', 'playlistRename', 'playlistDelete']
  )
  assert.deepEqual(calls[0].args, { name: '新的歌单' })
  assert.deepEqual(calls[1].args, { playlistId: 501, songIds: [1, 2] })
  assert.deepEqual(calls[2].args, { playlistId: 501, songIds: [3] })
  assert.deepEqual(calls[3].args, { playlistId: 501, name: '改个名' })
  assert.deepEqual(calls[4].args, { playlistId: 501 })
})

test('主进程答 ok 时原样返回', async () => {
  install((call) =>
    call.capability === 'playlistCreate'
      ? { ok: true, value: { id: 900, name: '新单' } }
      : { ok: true, value: true }
  )
  assert.deepEqual(await providerPlaylistCreate('netease', '新单'), { id: 900, name: '新单' })
  assert.equal(await providerPlaylistAddTracks('netease', 1, [2]), true)
})

test('主进程答 false 就交回 false —— 没改成与写失败在界面上是同一句话', async () => {
  install(() => ({ ok: true, value: false }))
  assert.equal(await providerPlaylistRename('netease', 1, 'x'), false)
  assert.equal(await providerPlaylistRemove('netease', 1), false)
})

test('ok 但值形状不对：建单交回 null，其余交回 false', async () => {
  install((call) => (call.capability === 'playlistCreate' ? { ok: true } : { ok: true, value: 'yes' }))
  assert.equal(await providerPlaylistCreate('netease', 'x'), null)
  assert.equal(await providerPlaylistAddTracks('netease', 1, [2]), false)
})

test('通道失败时每条都折回自己的兜底值，并留下一条 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: '炸了' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerPlaylistCreate('netease', 'x'), null)
    assert.equal(await providerPlaylistAddTracks('netease', 1, [2]), false)
    assert.equal(await providerPlaylistRemoveTracks('netease', 1, [2]), false)
    assert.equal(await providerPlaylistRename('netease', 1, 'y'), false)
    assert.equal(await providerPlaylistRemove('netease', 1), false)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 5)
  assert.ok(
    warnings.lines.every((line) => /^\[aurora\] netease\./.test(line)),
    '每条 warn 都要点出是哪一家、哪个能力'
  )
  assert.match(warnings.lines[0], /handler-failed 炸了/)
})

test('没有主进程时不调用通道，折回兜底值', async () => {
  globals.window = undefined
  const warnings = collectWarnings()
  try {
    assert.equal(await providerPlaylistCreate('netease', 'x'), null)
    assert.equal(await providerPlaylistRemove('netease', 1), false)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.match(warnings.lines[0], /没有主进程/)
})
