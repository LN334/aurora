import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSpan, formatTime } from '../src/ui/format.ts'

test('formatSpan 短于一分就说秒', () => {
  assert.equal(formatSpan(0), '0 秒')
  assert.equal(formatSpan(Number.NaN), '0 秒')
  assert.equal(formatSpan(-5), '0 秒')
  assert.equal(formatSpan(45), '45 秒')
  assert.equal(formatSpan(59), '59 秒')
})

test('formatSpan 不到十分钟才把秒也说出来', () => {
  assert.equal(formatSpan(60), '1 分钟')
  assert.equal(formatSpan(345), '5 分 45 秒')
  assert.equal(formatSpan(599), '9 分 59 秒')
  assert.equal(formatSpan(600), '10 分钟')
  assert.equal(formatSpan(960), '16 分钟')
  assert.equal(formatSpan(3599), '59 分钟')
})

test('formatSpan 过了一小时给小时和分，整点不带分', () => {
  assert.equal(formatSpan(3600), '1 小时')
  assert.equal(formatSpan(4380), '1 小时 13 分')
  assert.equal(formatSpan(13358), '3 小时 42 分')
})

test('formatSpan 不能退化成 formatTime 那种时钟写法', () => {
  // 「5:45」是五分钟四十五秒，但一眼会被读成五点四十五分。
  assert.equal(formatTime(345), '5:45')
  assert.equal(formatSpan(345), '5 分 45 秒')
  assert.notEqual(formatSpan(345), formatTime(345))
})
