import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rememberSharedStream, sharedStreamFor } from '../src/features/party/shared-stream.ts'

/*
 * 一起听共享的是「同一份地址」：房主选了母带，客人拿到的也是母带那一份。
 * 这里钉的是匹配规则——只有同一首才算数，换歌之后旧地址必须失效。
 */

test('a shared stream is handed back for the same track', () => {
  rememberSharedStream({ trackId: 'netease:1', url: 'https://cdn/a.mp3', quality: '母带' })
  assert.deepEqual(sharedStreamFor('netease:1'), {
    trackId: 'netease:1',
    url: 'https://cdn/a.mp3',
    quality: '母带'
  })
})

test('another track does not get it', () => {
  assert.equal(sharedStreamFor('netease:2'), null)
})

test('clearing the room clears the address', () => {
  rememberSharedStream(null)
  assert.equal(sharedStreamFor('netease:1'), null)
})
