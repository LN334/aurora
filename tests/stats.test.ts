import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayKey, type HistoryState, type PlayEntry } from '../src/features/player/history.ts'
import { hourLabel, summarizeListening } from '../src/features/player/stats.ts'

/** 2026-11-15（周日）21:30，本地时区。 */
const NOW = new Date(2026, 10, 15, 21, 30).getTime()
const DAY = 24 * 60 * 60 * 1000

function hoursAgo(hours: number): number {
  return NOW - hours * 60 * 60 * 1000
}

function daysAgo(days: number): number {
  return NOW - days * DAY
}

function play(id: string, at: number, artist = 'A'): PlayEntry {
  return { id, title: `曲目 ${id}`, artist, album: '集', at }
}

function state(overrides: Partial<HistoryState> = {}): HistoryState {
  return { version: 1, recent: [], days: [], plays: [], ...overrides }
}

test('一周窗口只数最近七天，三十天窗口再往前数', () => {
  const history = state({
    days: [
      { day: dayKey(daysAgo(0)), seconds: 600, trackIds: ['a'], artists: { A: 600 } },
      { day: dayKey(daysAgo(3)), seconds: 300, trackIds: ['b'], artists: { B: 300 } },
      { day: dayKey(daysAgo(10)), seconds: 120, trackIds: ['c'], artists: { C: 120 } }
    ]
  })
  const week = summarizeListening(history, NOW, 'week')
  assert.equal(week.days, 2)
  assert.equal(week.seconds, 900)
  const month = summarizeListening(history, NOW, 'month')
  assert.equal(month.days, 3)
  assert.equal(month.seconds, 1020)
})

test('最常听歌手按秒数排，并列时按名字稳定', () => {
  const history = state({
    days: [
      { day: dayKey(daysAgo(0)), seconds: 0, trackIds: [], artists: { 陈一: 100, 另一: 100 } },
      { day: dayKey(daysAgo(1)), seconds: 0, trackIds: [], artists: { 陈一: 50, 三三: 10 } }
    ]
  })
  const stats = summarizeListening(history, NOW, 'week')
  assert.deepEqual(
    stats.topArtists.map((item) => item.name),
    ['陈一', '另一', '三三']
  )
  assert.equal(stats.topArtists[0].seconds, 150)
})

test('次数与曲目数来自明细，重复播放算多次', () => {
  const history = state({
    plays: [play('x', hoursAgo(1)), play('x', hoursAgo(2)), play('y', hoursAgo(3)), play('z', daysAgo(30))]
  })
  const week = summarizeListening(history, NOW, 'week')
  assert.equal(week.plays, 3)
  assert.equal(week.tracks, 2)
  assert.deepEqual(
    week.topTracks.map((item) => [item.id, item.count]),
    [
      ['x', 2],
      ['y', 1]
    ]
  )
  const all = summarizeListening(history, NOW, 'all')
  assert.equal(all.plays, 4)
  assert.equal(all.tracks, 3)
})

test('时段分布按本地小时落桶，并给出最常听的一小时', () => {
  const history = state({
    plays: [play('a', hoursAgo(1)), play('b', hoursAgo(1.5)), play('c', hoursAgo(20))]
  })
  const stats = summarizeListening(history, NOW, 'week')
  assert.equal(stats.hours[20], 2)
  assert.equal(stats.hours[1], 1)
  assert.equal(stats.topHour, 20)
})

test('连续天数：今天没听也算连着昨天，断一天就归零重数', () => {
  const continuous = state({
    days: [
      { day: dayKey(daysAgo(1)), seconds: 10, trackIds: ['a'], artists: { A: 10 } },
      { day: dayKey(daysAgo(2)), seconds: 10, trackIds: ['a'], artists: { A: 10 } },
      { day: dayKey(daysAgo(4)), seconds: 10, trackIds: ['a'], artists: { A: 10 } }
    ]
  })
  assert.equal(summarizeListening(continuous, NOW, 'week').streak, 2)
  const gap = state({
    days: [
      { day: dayKey(daysAgo(0)), seconds: 10, trackIds: ['a'], artists: { A: 10 } },
      { day: dayKey(daysAgo(3)), seconds: 10, trackIds: ['a'], artists: { A: 10 } }
    ]
  })
  assert.equal(summarizeListening(gap, NOW, 'week').streak, 1)
})

test('没有记录时全是零，最常听时段为 null', () => {
  const stats = summarizeListening(state(), NOW, 'week')
  assert.equal(stats.seconds, 0)
  assert.equal(stats.plays, 0)
  assert.equal(stats.tracks, 0)
  assert.equal(stats.days, 0)
  assert.equal(stats.topHour, null)
  assert.equal(stats.streak, 0)
  assert.deepEqual(stats.topArtists, [])
  assert.equal(stats.hours.length, 24)
})

test('时段说法读得通', () => {
  assert.equal(hourLabel(0), '凌晨 12 点')
  assert.equal(hourLabel(9), '上午 9 点')
  assert.equal(hourLabel(12), '中午 12 点')
  assert.equal(hourLabel(15), '下午 3 点')
  assert.equal(hourLabel(21), '晚上 9 点')
})
