import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dailyDay, dailyLabel } from '../src/features/library/daily-day.ts'
import { dailyTracks } from '../src/features/library/daily.ts'

/**
 * 每日推荐的批次日界是早上六点：各平台六点换一批，界面、排序、缓存都该跟
 * 着换。零点分日会让凌晨那几小时出现「平台已经换了、首页还是昨天」。
 */
test('六点前算前一天', () => {
  assert.equal(dailyDay(new Date(2026, 10, 12, 5, 59)), '2026-11-11')
  assert.equal(dailyDay(new Date(2026, 10, 12, 0, 10)), '2026-11-11')
})

test('六点整就是新的批次', () => {
  assert.equal(dailyDay(new Date(2026, 10, 12, 6, 0)), '2026-11-12')
  assert.equal(dailyDay(new Date(2026, 10, 12, 23, 30)), '2026-11-12')
})

test('跨月跨年也算得对', () => {
  assert.equal(dailyDay(new Date(2027, 0, 1, 3, 0)), '2026-12-31')
  assert.equal(dailyDay(new Date(2027, 0, 1, 6, 0)), '2027-1-1')
})

test('界面那句日期跟批次同一天', () => {
  assert.equal(dailyLabel(new Date(2026, 10, 12, 5, 30)), '11 月 11 日')
  assert.equal(dailyLabel(new Date(2026, 10, 12, 6, 30)), '11 月 12 日')
})

test('同一个批次里本机兜底那批是稳定的', () => {
  const pool = Array.from({ length: 20 }, (_, at) => ({ id: 't' + at })) as never[]
  const a = dailyTracks(pool, new Date(2026, 10, 12, 6, 30), 5).map((item) => item.id)
  const b = dailyTracks(pool, new Date(2026, 10, 12, 23, 30), 5).map((item) => item.id)
  const c = dailyTracks(pool, new Date(2026, 10, 13, 6, 30), 5).map((item) => item.id)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
})
