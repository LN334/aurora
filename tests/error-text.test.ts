import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorText } from '../electron/pure/error-text.ts'

/*
 * 一句能给人看的报错。
 *
 * 修这条的起因：用户点「发送评论」，右下角弹出两条 "[object Object]"。上游抛的
 * 不是一个 Error 而是一个普通对象，各处那句 `String(error)` 就把它变成了这句
 * 什么也没说的话，一路带到提示里。
 */

test('an Error keeps its message', () => {
  assert.equal(errorText(new Error('登录网易云后才能发评论')), '登录网易云后才能发评论')
})

test('a plain object with a message field uses that field', () => {
  assert.equal(errorText({ code: 301, message: '需要登录' }), '需要登录')
})

test('an object without a message is shown as its JSON, not [object Object]', () => {
  assert.equal(errorText({ code: 500 }), '{"code":500}')
})

test('an empty object still says something readable', () => {
  assert.equal(errorText({}), '未知错误')
})

test('a string passes through', () => {
  assert.equal(errorText('没网'), '没网')
})

test('null and undefined do not become "null"', () => {
  assert.equal(errorText(null), '未知错误')
  assert.equal(errorText(undefined), '未知错误')
})

test('a number is printed as itself', () => {
  assert.equal(errorText(42), '42')
})

test('a circular object falls back instead of throwing', () => {
  const loop: Record<string, unknown> = {}
  loop.self = loop
  assert.equal(errorText(loop), '未知错误')
})

/*
 * 上游的失败是一条信封：{ status, body: { code, msg, data }, cookie }。
 * 这层信封以前被整个 stringify 到提示条上（用户截图里那一屏花括号），
 * 内层那句人话反而没人看见。
 */

test('a transport envelope is unwrapped to the message inside it', () => {
  assert.equal(
    errorText({ status: 502, body: { code: 502, msg: 'read ECONNRESET' }, cookie: [] }),
    'read ECONNRESET'
  )
})

test('the dialog title of a moderation block leads the sentence', () => {
  assert.equal(
    errorText({
      status: 250,
      body: {
        code: 250,
        msg: '抱歉，评论发布失败，请稍后重试',
        data: { dialog: { title: '风险提示', buttonUrl: 'http://163.lu/EmUzy2' } }
      },
      cookie: []
    }),
    '风险提示：抱歉，评论发布失败，请稍后重试'
  )
})

test('an envelope with nothing readable still falls back to JSON', () => {
  assert.equal(
    errorText({ status: 502, body: { code: 502 }, cookie: [] }),
    '{"status":502,"body":{"code":502},"cookie":[]}'
  )
})
