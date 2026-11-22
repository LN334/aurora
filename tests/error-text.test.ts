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
