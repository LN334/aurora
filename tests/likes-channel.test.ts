import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerCollectedAlbums,
  providerLike,
  providerLiked
} from '../src/features/online/likes-channel.ts'

/**
 * 「喜欢」在渲染层的入口。
 *
 * 与歌单、账号那两组最大的不同在这里被钉住：**读失败要抛，不能折成空**。
 * 收藏页把「读完了，确实没有」与「没读到」画成两句不同的话，这一层一旦把错误
 * 吞掉，上层就永远看不见差别——2026-11-17 那次上游抖动被画成「0 首」就是这么来的。
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

test('三个助手各走自己那条通道，参数形状固定', async () => {
  const calls = install(() => ({ ok: true, value: [] }))
  await providerLiked('netease')
  await providerLiked('kugou', 200)
  await providerLike('qq', 12345, true)
  await providerCollectedAlbums('qq', 50)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['liked', 'liked', 'like', 'collectedAlbums']
  )
  assert.deepEqual(calls[0].args, { limit: undefined })
  assert.deepEqual(calls[1].args, { limit: 200 })
  assert.deepEqual(calls[2].args, { songId: 12345, liked: true })
  assert.deepEqual(calls[3].args, { limit: 50 })
})

test('主进程答 ok 时原样返回', async () => {
  install((call) =>
    call.capability === 'like' ? { ok: true, value: true } : { ok: true, value: [{ id: 7 }] }
  )
  assert.deepEqual(await providerLiked('netease'), [{ id: 7 }])
  assert.equal(await providerLike('netease', 7, false), true)
  assert.deepEqual(await providerCollectedAlbums('qq'), [{ id: 7 }])
})

test('读喜欢失败要抛：空列表与没读到在更上一层是两件事', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    await assert.rejects(() => providerLiked('netease'), /handler-failed boom/)
    // 抛之前先留一条 warn，控制台能追到是哪一家、为什么。
    assert.equal(warnings.lines.length, 1)
    assert.ok(warnings.lines[0].includes('netease.liked'))
    assert.ok(warnings.lines[0].includes('handler-failed boom'))
  } finally {
    warnings.restore()
  }
})

test('写一条失败只回 false，界面照实提示，不抛给点按的手指', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'no' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerLike('kugou', 9, true), false)
    assert.deepEqual(await providerCollectedAlbums('qq'), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('kugou.like'))
  assert.ok(warnings.lines[1].includes('qq.collectedAlbums'))
})

test('没有主进程时读也抛，理由说清是没有主进程', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    await assert.rejects(() => providerLiked('qq'), /没有主进程/)
    assert.equal(await providerLike('qq', 1, true), false)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答了 ok 但值形状不对时按空处理，不把 undefined 交给页面', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.deepEqual(await providerLiked('qishui'), [])
  assert.deepEqual(await providerCollectedAlbums('qq'), [])
  assert.equal(await providerLike('kugou', 1, true), false)
})
