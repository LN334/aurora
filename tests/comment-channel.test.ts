import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerCommentLike,
  providerCommentSend,
  providerComments
} from '../src/features/online/comment-channel.ts'

/**
 * 评论在渲染层的入口。
 *
 * 与「喜欢」那支的取舍不同：读失败折 null（页面据此不画评论墙，旧的 try/catch
 * 就是这个效果），写失败折一句人话——主进程给的句子到不了通道层，这一层能给的
 * 只有「没发出去，稍后再试」。
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
  const calls = install(() => ({ ok: true, value: null }))
  await providerComments('netease', 186016)
  await providerComments('qq', '102065756', 'cursor-1', 30)
  await providerCommentSend('kugou', 12345, '好听')
  await providerCommentLike('netease', 186016, 778899, true)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['comments', 'comments', 'commentSend', 'commentLike']
  )
  assert.deepEqual(calls[0].args, { songId: 186016, cursor: '', limit: 20 })
  assert.deepEqual(calls[1].args, { songId: '102065756', cursor: 'cursor-1', limit: 30 })
  assert.deepEqual(calls[2].args, { songId: 12345, content: '好听' })
  assert.deepEqual(calls[3].args, { songId: 186016, commentId: 778899, liked: true })
})

test('主进程答 ok 时原样返回', async () => {
  const page = { comments: [{ id: '1' }], total: 1, cursor: 'next', hasMore: true }
  install((call) => (call.capability === 'comments' ? { ok: true, value: page } : { ok: true, value: { ok: true, message: '' } }))
  assert.deepEqual(await providerComments('netease', 1), page)
  assert.deepEqual(await providerCommentSend('qq', 1, '嗯'), { ok: true, message: '' })
  assert.deepEqual(await providerCommentLike('netease', 1, 2, true), { ok: true, message: '' })
})

test('读一页失败折 null，先留一条 warn 说清是哪家、为什么', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerComments('kugou', 1), null)
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 1)
  assert.ok(warnings.lines[0].includes('kugou.comments'))
  assert.ok(warnings.lines[0].includes('handler-failed boom'))
})

test('写失败折一句人话，不抛给点按的手指', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'no' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerCommentSend('qq', 1, '嗯'), { ok: false, message: '没发出去，稍后再试' })
    assert.deepEqual(await providerCommentLike('netease', 1, 2, false), { ok: false, message: '没点上，稍后再试' })
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('qq.commentSend'))
  assert.ok(warnings.lines[1].includes('netease.commentLike'))
})

test('没有主进程时读折 null、写折人话', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.equal(await providerComments('qishui', 1), null)
    assert.deepEqual(await providerCommentSend('qishui', 1, '嗯'), { ok: false, message: '没发出去，稍后再试' })
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答了 ok 但值形状不对时按空处理', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.equal(await providerComments('netease', 1), null)
  assert.deepEqual(await providerCommentSend('netease', 1, '嗯'), { ok: false, message: '没发出去，稍后再试' })
})
