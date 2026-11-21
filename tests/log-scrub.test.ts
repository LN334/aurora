import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scrub } from '../electron/pure/log-scrub.ts'

/*
 * 导出日志是唯一一个「把本机运行记录交出去」的功能，脱敏规则错了就是泄露凭据。
 * 这几条把常见的四种写法钉住：请求头、查询串、JSON 字段、房间转发令牌。
 */

test('查询串里的凭据被替换，其余参数留着', () => {
  const line = 'GET https://x/y?token=deadbeef123456&limit=30&cookie=MUSIC_U%3Dabc'
  const out = scrub(line)
  assert.equal(out.includes('deadbeef123456'), false)
  assert.equal(out.includes('MUSIC_U'), false)
  assert.equal(out.includes('limit=30'), true, '非敏感参数不该被动')
})

test('Authorization 头被替换，方案名保留', () => {
  const out = scrub('authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
  assert.equal(out.includes('eyJhbGciOiJIUzI1NiJ9'), false)
  assert.equal(out.includes('authorization'), true)
})

test('JSON 里的凭据字段被替换成 ***', () => {
  const out = scrub('{"user":"a","password":"hunter2hunter2","cookie":"MUSIC_U=abc"}')
  assert.equal(out.includes('hunter2hunter2'), false)
  assert.equal(out.includes('MUSIC_U=abc'), false)
  assert.equal(out.includes('"user":"a"'), true, '非敏感字段不该被动')
})

test('房间转发令牌被替换，路径前缀保留', () => {
  const out = scrub('app-protocol GET host=app path=/stream/9f3c1a77b2e84d6c0a1b')
  assert.equal(out.includes('9f3c1a77b2e84d6c0a1b'), false)
  assert.equal(out.includes('/stream/'), true)
})

test('普通日志行原样保留', () => {
  const line = '2026-11-21T22:00:00.000Z  first frame painted 302 (aurora-app://app/assets/index-abc.js:1)'
  assert.equal(scrub(line), line)
})
