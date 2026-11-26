import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  PROVIDER_CALL_CHANNEL,
  PROVIDER_IDS,
  callKey,
  failure,
  parseProviderCall,
  succeed
} from '../electron/pure/provider-call.ts'

/*
 * 跨平台通道的外壳：一个请求怎么描述，坏输入怎么被挡住，成功与失败怎么带回去。
 *
 * 这几条守的是搬家期间最贵的那条线——旧方法 `netease.search(...)` 与新入口
 * `provider.call('netease','search',…)` 必须落在同一个处理函数上。名字拼错、
 * 能力名允许了斜杠、失败被当成成功，任何一种都会让「切过去了还坏着」的地方
 * 在测试里看不出来。
 */

test('通道名固定，preload 与主进程都靠这一个字符串', () => {
  assert.equal(PROVIDER_CALL_CHANNEL, 'provider:call')
})

test('五家平台都在白名单里，别家的名字进不来', () => {
  assert.deepEqual([...PROVIDER_IDS], ['netease', 'qq', 'kugou', 'qishui', 'bilibili'])
  const stranger = parseProviderCall({ provider: 'spotify', capability: 'search' })
  assert.equal(stranger.ok, false)
  if (stranger.ok) return
  assert.equal(stranger.error.code, 'unsupported-provider')
  assert.match(stranger.error.message, /spotify/)
})

test('合法调用原样透传 args，连 undefined 也不改写', () => {
  const args = { keywords: '钻石', type: 'song', limit: 30 }
  const parsed = parseProviderCall({ provider: 'netease', capability: 'search', args })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.request.provider, 'netease')
  assert.equal(parsed.request.capability, 'search')
  assert.deepEqual(parsed.request.args, args)

  const bare = parseProviderCall({ provider: 'qq', capability: 'status' })
  assert.equal(bare.ok, true)
  if (!bare.ok) return
  assert.equal(bare.request.args, undefined)
})

test('不是对象的输入一律按「平台不认识」拒掉，不做猜测', () => {
  for (const input of [null, undefined, 'netease', 42, ['netease', 'search']]) {
    const parsed = parseProviderCall(input)
    assert.equal(parsed.ok, false, `input=${String(input)}`)
    if (parsed.ok) continue
    assert.equal(parsed.error.code, 'unsupported-provider')
  }
})

test('能力名是名字不是路径：大小写、斜杠、空串都挡在分派表之外', () => {
  for (const bad of ['Search', 'search/x', '../search', 'sea rch', '', 'search-']) {
    const parsed = parseProviderCall({ provider: 'netease', capability: bad })
    assert.equal(parsed.ok, false, `capability=${bad}`)
    if (parsed.ok) continue
    assert.equal(parsed.error.code, 'invalid-capability')
  }
  const longest = 'a'.repeat(40)
  const ok = parseProviderCall({ provider: 'netease', capability: longest })
  assert.equal(ok.ok, true)
  const tooLong = parseProviderCall({ provider: 'netease', capability: 'a'.repeat(41) })
  assert.equal(tooLong.ok, false)
})

test('错误文案回显输入时截断，不把整首歌搬进日志', () => {
  const parsed = parseProviderCall({ provider: 'x'.repeat(200), capability: 'search' })
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.ok(parsed.error.message.length < 60, parsed.error.message)
})

test('分派键是「平台/能力」，两家同名能力互不覆盖', () => {
  assert.equal(callKey('netease', 'search'), 'netease/search')
  assert.notEqual(callKey('netease', 'search'), callKey('qq', 'search'))
})

test('成功与失败是两副形状，不会互相冒充', () => {
  const ok = succeed({ songs: [] })
  assert.deepEqual(ok, { ok: true, value: { songs: [] } })
  const bad = failure('unsupported-capability', 'netease 没有注册能力 lyrics')
  assert.deepEqual(bad, {
    ok: false,
    error: { code: 'unsupported-capability', message: 'netease 没有注册能力 lyrics' }
  })
})
test('preload 那份白名单是字面量，且与主进程的真源一字不差', () => {
  const source = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  /*
   * preload 跑在沙箱里，只认 electron/events 这类内置模块。真让它 import 一次本地
   * 的 pure 模块，整个 preload 会崩，window.aurora 于是"根本不存在"——页面不报错，
   * 只是所有按钮都点不动。这条断言替那次事故守门。
   */
  assert.equal(
    /from '\.\/pure\/provider-call/.test(source),
    false,
    'preload 不能 import pure 模块，白名单只能写字面量'
  )
  const listed = /ids:\s*\[([^\]]*)\]/.exec(source)
  assert.ok(listed, 'preload 的 provider.ids 必须是字面量数组')
  const ids = [...(listed[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1])
  assert.deepEqual(ids, [...PROVIDER_IDS])
})

