import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePlatformStatus, platformSummary } from '../electron/pure/platform-status.ts'

/*
 * 状态归一：四条规则要稳，界面据此决定「显示故障、显示重连、还是什么都不说」。
 */

test('ready 就是 ready，detail 被清空', () => {
  const status = normalizePlatformStatus('netease', { ready: true, loggedIn: true, detail: '残留说明' })
  assert.equal(status.state, 'ready')
  assert.equal(status.detail, '')
  assert.equal(status.loggedIn, true)
})

test('断网优先于错误——两者要求用户做的事不一样', () => {
  const status = normalizePlatformStatus('qq', { ready: false, offline: true, detail: 'ECONNRESET' })
  assert.equal(status.state, 'offline')
  assert.equal(status.detail, 'ECONNRESET')
})

test('断网但没给原因时用默认说明', () => {
  assert.equal(normalizePlatformStatus('kugou', { offline: true }).detail, '网络不通')
})

test('没 ready 但有原因就是错误', () => {
  const status = normalizePlatformStatus('qishui', { ready: false, detail: '设备握手失败' })
  assert.equal(status.state, 'error')
  assert.equal(status.detail, '设备握手失败')
})

test('没 ready 也没原因就是还没拉起', () => {
  assert.equal(normalizePlatformStatus('netease', {}).state, 'idle')
  assert.equal(normalizePlatformStatus('netease', null).state, 'idle')
})

test('登录状态缺失时是 null，不是 false', () => {
  assert.equal(normalizePlatformStatus('netease', { ready: true }).loggedIn, null)
})

test('摘要：全好给空串，坏了点名', () => {
  const ok = [
    normalizePlatformStatus('netease', { ready: true }),
    normalizePlatformStatus('qq', { ready: true })
  ]
  assert.equal(platformSummary(ok), '')

  const broken = [
    normalizePlatformStatus('netease', { ready: true }),
    normalizePlatformStatus('kugou', { ready: false, detail: '本地服务起不来' })
  ]
  const line = platformSummary(broken)
  assert.match(line, /酷狗没起来/)
  assert.match(line, /本地服务起不来/)
})

test('摘要里断网说成网络不通，不说成没起来', () => {
  const line = platformSummary([normalizePlatformStatus('qq', { offline: true })])
  assert.match(line, /QQ 音乐网络不通/)
})
