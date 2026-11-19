import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  rememberSharedOrigin,
  rememberSharedStream,
  resolveSharedUrl,
  sharedStreamFor
} from '../src/features/party/shared-stream.ts'

/*
 * 房主给的转发是相对路径，主机由客人按自己连进来的地址补。
 *
 * 这一条直接决定两件事：同一 WiFi 的客人不会被绕到公网；只有 https 的隧道
 * 也不会被硬拼成 http。
 */

test('a relay path is joined with the address the guest came in through', () => {
  rememberSharedOrigin('192.168.1.5:51234')
  rememberSharedStream({ trackId: 'netease:1', path: '/stream/abc', quality: '母带' })
  const stream = sharedStreamFor('netease:1')
  assert.ok(stream)
  assert.equal(resolveSharedUrl(stream), 'http://192.168.1.5:51234/stream/abc')
})

test('a direct url wins over the path', () => {
  rememberSharedStream({ trackId: 'netease:2', url: 'https://cdn/b.mp3', quality: '无损' })
  const stream = sharedStreamFor('netease:2')
  assert.ok(stream)
  assert.equal(resolveSharedUrl(stream), 'https://cdn/b.mp3')
})

test('another track does not get it', () => {
  assert.equal(sharedStreamFor('netease:9'), null)
})

test('clearing the room clears the address', () => {
  rememberSharedStream(null)
  assert.equal(sharedStreamFor('netease:1'), null)
})
