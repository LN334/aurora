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

/*
 * 实测样本：2026-11-20 这台机器上真起出来的一行。樱花现在把地址写成
 * frp-run.com 这一种，不带 natfrp 前缀；只认 natfrp.* 的话地址永远是空的。
 */
test('the frp-run.com address reported by a real launch is picked up', () => {
  const parsed = parseTunnelLine('使用 >>frp-run.com:23720<< 连接你的隧道')
  assert.deepEqual(parsed, { kind: 'address', address: 'frp-run.com:23720' })
})

test('the carrier-specific frp-run hosts count as addresses too', () => {
  const parsed = parseTunnelLine('- 电信: dx.frp-run.com:23720')
  assert.deepEqual(parsed, { kind: 'address', address: 'dx.frp-run.com:23720' })
})

/*
 * 同一个实测：直连 7000 端口能连上，登录握手被掐断，日志里就是这一长串。
 * 它必须变成一句能动手的话，而不是把 doc 链接原样甩给用户。
 */
test('a login handshake failure becomes advice, not a FAQ link', () => {
  const parsed = parseTunnelLine(
    '2026/11/20 10:55:14 [W] 登录节点失败, 请检查网络连接, 或更换网络环境 (如手机流量热点) 重试, 参考 >>https://doc.natfrp.com/faq/client-error.html#login-to-server-failed<<. 错误信息: EOF'
  )
  assert.equal(parsed?.kind, 'error')
  assert.ok(parsed?.kind === 'error' && parsed.message.includes('代理'))
  assert.ok(parsed?.kind === 'error' && !parsed.message.includes('http'))
})

/*
 * 实测样本：走代理时出口 IP 在国外，节点直接拒绝。这不是网络故障，
 * 而是一句能动手的提示——关掉代理的全局模式，或者换个节点。
 */
test('a node that refuses non-mainland clients says how to fix it', () => {
  const parsed = parseTunnelLine('该节点只允许中国内地客户端启动隧道，当前 IP 103.151.173.203 不符合要求 [-3]')
  assert.equal(parsed?.kind, 'error')
  assert.ok(parsed?.kind === 'error' && parsed.message.includes('大陆'))
})
