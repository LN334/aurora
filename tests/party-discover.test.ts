import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  broadcastTargets,
  discover,
  startAnswering,
  stopAnswering
} from '../electron/party/discover.ts'

/*
 * 局域网发现：朋友只填房间码，地址由程序自己找。
 *
 * 这条路的失败方式很安静——防火墙拦住、广播没出去、房间里没人答话，表现
 * 全是「找不到」。所以测试只钉死一件事：房间在的时候一定找得到，房间不在、
 * 码不对的时候一定找不到，而不是随便回一个地址让人连到别人家里去。
 */

/* 测试端口与生产分开：跑测试时本机可能真开着一间房。 */
const TEST_PORT = 47121

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('广播目标里有全网广播，且都是合法地址', () => {
  const targets = broadcastTargets()
  assert.ok(targets.includes('255.255.255.255'), '全网广播是保底的一条')
  for (const target of targets) {
    assert.match(target, /^\d{1,3}(\.\d{1,3}){3}$/)
  }
})

test('房主答话，客人凭房间码拿到地址', async () => {
  startAnswering(() => ({ code: 'PARTY', port: 23456, name: '测试房', locked: true }), TEST_PORT)
  try {
    await wait(80)
    const hit = await discover('party', {
      targets: ['127.0.0.1'],
      port: TEST_PORT,
      timeoutMs: 1500
    })
    assert.deepEqual(hit, { address: '127.0.0.1:23456', name: '测试房', locked: true })
  } finally {
    stopAnswering()
  }
})

test('房间码不对就装作没听见', async () => {
  startAnswering(() => ({ code: 'PARTY', port: 23456, name: '测试房', locked: false }), TEST_PORT)
  try {
    await wait(80)
    const hit = await discover('OTHER', {
      targets: ['127.0.0.1'],
      port: TEST_PORT,
      timeoutMs: 400
    })
    assert.equal(hit, null, '一串不对的码不该换来一个「好像找到了」')
  } finally {
    stopAnswering()
  }
})

test('房间关了就不再答话', async () => {
  startAnswering(() => ({ code: 'PARTY', port: 23456, name: '测试房', locked: false }), TEST_PORT)
  await wait(80)
  stopAnswering()
  await wait(40)
  const hit = await discover('PARTY', {
    targets: ['127.0.0.1'],
    port: TEST_PORT,
    timeoutMs: 400
  })
  assert.equal(hit, null)
})
