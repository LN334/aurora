import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCloudflareLine } from '../electron/pure/cloudflare-url.ts'

/*
 * cloudflared 的快速隧道地址是从它自己的日志里认出来的，所以这几条样本就是
 * 真实日志的形状——尤其 `api.trycloudflare.com` 那一条：它的子域只有一段，
 * 认宽了会先把它当成隧道地址。
 */

test('recognises the quick tunnel url', () => {
  const line = '2026-11-21T00:11:21Z INF |  https://adrian-when-coalition-urw.trycloudflare.com  |'
  assert.equal(parseCloudflareLine(line), 'wss://adrian-when-coalition-urw.trycloudflare.com')
})

test('ignores the api host cloudflared also prints', () => {
  assert.equal(parseCloudflareLine('INF Requesting new quick Tunnel on trycloudflare.com...'), null)
  assert.equal(parseCloudflareLine('INF POST https://api.trycloudflare.com/tunnel'), null)
})

test('ignores unrelated lines', () => {
  assert.equal(parseCloudflareLine('INF Registered tunnel connection connIndex=0'), null)
  assert.equal(parseCloudflareLine(''), null)
})

test('keeps working when the url sits inside a longer message', () => {
  const line = 'INF +---------+  https://x-y-z-w.trycloudflare.com  +---------+'
  assert.equal(parseCloudflareLine(line), 'wss://x-y-z-w.trycloudflare.com')
})
