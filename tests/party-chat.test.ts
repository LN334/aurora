import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanChatText } from '../electron/party/room.ts'

/*
 * 聊天文本的清洗规则。谁都能往房间里发话，所以「什么算一条消息」必须在服务端
 * 定死：不做的话，一条带控制字符或两千个字的消息就能让所有人的面板同时跳。
 */

test('leading and trailing spaces are dropped', () => {
  assert.equal(cleanChatText('  晚上好  '), '晚上好')
})

test('a line break becomes a space instead of a second line in the panel', () => {
  assert.equal(cleanChatText('哈哈\n你好'), '哈哈 你好')
})

test('runs of whitespace collapse to a single space', () => {
  assert.equal(cleanChatText('  a \t\t  b  '), 'a b')
})

test('control characters never reach another machine', () => {
  assert.equal(cleanChatText('a\u0000b\u001fc'), 'a b c')
})

test('text is cut to 200 characters', () => {
  assert.equal([...cleanChatText('字'.repeat(250))].length, 200)
})

test('a surrogate pair is never cut in half', () => {
  const cleaned = cleanChatText('🎵'.repeat(250))
  assert.equal([...cleaned].length, 200)
  /* 末尾留下半个 emoji，到了对面就是一颗替换字符。 */
  assert.ok(!/[\uD800-\uDBFF]$/.test(cleaned), 'no lone high surrogate at the end')
})

test('whitespace-only text is not a message', () => {
  assert.equal(cleanChatText('   \n\t '), '')
})
