import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTunnelLine } from '../electron/party/tunnel.ts'

/*
 * 樱花 frpc 的输出没法在测试里真跑出来，但「哪一行算拿到地址、哪一行算报错」
 * 是可以固定的。这里按官方文档与实测样本把形状钉住。
 */

test('a node address is picked out of the log line', () => {
  const parsed = parseTunnelLine('[I] [control.go:144] [demo] 隧道启动成功 访问地址: demo-a1b2c3.natfrp.cloud:23456')
  assert.deepEqual(parsed, { kind: 'address', address: 'demo-a1b2c3.natfrp.cloud:23456' })
})

test('the other node domains count too', () => {
  assert.deepEqual(parseTunnelLine('tunnel ok -> zh-1.natfrp.net:30123'), {
    kind: 'address',
    address: 'zh-1.natfrp.net:30123'
  })
})

test('a bad token is reported as an error line', () => {
  const parsed = parseTunnelLine('[E] [control.go:100] 认证失败：访问密钥无效')
  assert.equal(parsed?.kind, 'error')
  assert.ok(parsed?.kind === 'error' && parsed.message.includes('认证失败'))
})

test('an ordinary informational line is ignored', () => {
  assert.equal(parseTunnelLine('[I] [service.go:282] try to connect to server...'), null)
})

test('an address in the middle of a sentence still counts', () => {
  const parsed = parseTunnelLine('frpc: started, remote: demo.natfrp.com:52100 ready')
  assert.deepEqual(parsed, { kind: 'address', address: 'demo.natfrp.com:52100' })
})
