import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTrack } from './fixtures.ts'
import {
  DAY_LIMIT,
  DEDUP_WINDOW_MS,
  PLAY_DAYS,
  PLAY_DEDUP_MS,
  PLAY_LIMIT,
  RECENT_LIMIT,
  addPlay,
  addRecent,
  addSeconds,
  dayKey,
  dayStat,
  emptyHistory,
  groupPlaysByDay,
  parseHistory,
  prunePlays,
  serializeHistory,
  todaySummary
} from '../src/features/player/history.ts'

/** A local instant, so the tests agree with the bucket logic on any machine. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

const night = makeTrack('a', 'D:/m/a.flac', { title: '夜曲', artist: '周杰伦', album: '十一月的萧邦' })
const sunny = makeTrack('b', 'D:/m/b.flac', { title: '晴天', artist: '周杰伦', album: '叶惠美' })
const rice = makeTrack('c', 'D:/m/c.flac', { title: '稻香', artist: '周杰伦', album: '魔杰座' })
const online = makeTrack('e', 'netease:1', { title: '在线', artist: '某人', source: 'netease' })

test('dayKey uses the local calendar day, not UTC', () => {
  assert.equal(dayKey(at(2026, 11, 7, 0, 5)), '2026-11-07')
  assert.equal(dayKey(at(2026, 11, 7, 23, 55)), '2026-11-07')
  assert.equal(dayKey(at(2026, 1, 1, 9, 0)), '2026-01-01')
})

test('parseHistory tolerates nothing at all', () => {
  assert.deepEqual(parseHistory(null), emptyHistory())
  assert.deepEqual(parseHistory(''), emptyHistory())
  assert.deepEqual(parseHistory('not json'), emptyHistory())
  assert.deepEqual(parseHistory('[]'), emptyHistory())
  assert.deepEqual(parseHistory('{"recent":5,"days":"x"}'), emptyHistory())
})

test('parseHistory drops junk rows instead of failing', () => {
  const raw = JSON.stringify({
    version: 99,
    recent: [
      { id: 'a', title: '夜曲', artist: '周杰伦', album: '', at: 1 },
      { id: 'a', title: 'dup', artist: '', album: '', at: 2 },
      { id: 42, title: 'bad id' },
      null,
      'nope'
    ],
    days: [
      { day: '2026-11-07', seconds: 100, trackIds: ['a', 7], artists: { 周杰伦: 100, '': -3 } },
      { day: 'nonsense', seconds: 5 },
      { day: '2026-11-06', seconds: 'x' }
    ]
  })
  const state = parseHistory(raw)
  assert.equal(state.version, 1)
  assert.equal(state.recent.length, 1)
  assert.equal(state.recent[0].id, 'a')
  assert.equal(state.recent[0].at, 1)
  assert.deepEqual(state.days.map((item) => item.day), ['2026-11-07', '2026-11-06'])
  assert.deepEqual(state.days[0].trackIds, ['a'])
  assert.deepEqual(state.days[0].artists, { 周杰伦: 100 })
  assert.equal(state.days[1].seconds, 0)
})

test('addRecent keeps newest first and one row per track', () => {
  let state = emptyHistory()
  state = addRecent(state, night, at(2026, 11, 7, 9, 0))
  state = addRecent(state, sunny, at(2026, 11, 7, 9, 5))
  assert.deepEqual(state.recent.map((item) => item.id), ['b', 'a'])
  // Coming back to 夜曲 later but outside the dedup window is a new play, and
  // it must not leave the old row behind.
  state = addRecent(state, night, at(2026, 11, 7, 10, 0))
  assert.deepEqual(state.recent.map((item) => item.id), ['a', 'b'])
})

test('addRecent refreshes rather than duplicates a repeat inside the window', () => {
  let state = emptyHistory()
  state = addRecent(state, night, at(2026, 11, 7, 9, 0))
  state = addRecent(state, night, DEDUP_WINDOW_MS / 2 + at(2026, 11, 7, 9, 0))
  assert.equal(state.recent.length, 1)
  assert.equal(state.recent[0].at, DEDUP_WINDOW_MS / 2 + at(2026, 11, 7, 9, 0))
})

test('addRecent marks online tracks and leaves local ones unmarked', () => {
  let state = emptyHistory()
  state = addRecent(state, online, at(2026, 11, 7, 9, 0))
  state = addRecent(state, night, at(2026, 11, 7, 9, 1))
  assert.equal(state.recent[0].source, undefined)
  assert.equal(state.recent[1].source, 'netease')
})

test('addRecent caps the rail', () => {
  let state = emptyHistory()
  for (let index = 0; index < RECENT_LIMIT + 15; index += 1) {
    state = addRecent(state, makeTrack(`t${index}`, `D:/m/${index}.flac`), at(2026, 11, 7, 9, 0) + index)
  }
  assert.equal(state.recent.length, RECENT_LIMIT)
  assert.equal(state.recent[0].id, `t${RECENT_LIMIT + 14}`)
})

test('addSeconds accumulates today and credits the artist', () => {
  let state = emptyHistory()
  const now = at(2026, 11, 7, 10, 0)
  state = addSeconds(state, night, 30, now)
  state = addSeconds(state, sunny, 45, now)
  state = addSeconds(state, night, 15, now)
  const stat = dayStat(state, '2026-11-07')
  assert.ok(stat)
  assert.equal(stat.seconds, 90)
  assert.deepEqual(stat.trackIds, ['a', 'b'])
  assert.equal(stat.artists['周杰伦'], 90)
})

test('addSeconds ignores non-positive and non-finite spans', () => {
  const state = emptyHistory()
  assert.equal(addSeconds(state, night, 0, at(2026, 11, 7)), state)
  assert.equal(addSeconds(state, night, -5, at(2026, 11, 7)), state)
  assert.equal(addSeconds(state, night, Number.NaN, at(2026, 11, 7)), state)
})

test('addSeconds keeps separate buckets per local day', () => {
  let state = emptyHistory()
  state = addSeconds(state, night, 60, at(2026, 11, 7, 23, 59))
  state = addSeconds(state, sunny, 30, at(2026, 11, 8, 0, 1))
  // Newest day first, so the home page never has to sort.
  assert.deepEqual(state.days.map((item) => item.day), ['2026-11-08', '2026-11-07'])
  assert.equal(dayStat(state, '2026-11-07')?.seconds, 60)
  assert.equal(dayStat(state, '2026-11-08')?.seconds, 30)
})

test('addSeconds prunes beyond the retention window', () => {
  let state = emptyHistory()
  for (let index = 0; index < DAY_LIMIT + 5; index += 1) {
    state = addSeconds(state, night, 10, at(2026, 11, 7) + index * 24 * 60 * 60 * 1000)
  }
  assert.equal(state.days.length, DAY_LIMIT)
})

test('todaySummary reports zeroes on a fresh day', () => {
  const state = addSeconds(emptyHistory(), night, 60, at(2026, 11, 6))
  assert.deepEqual(todaySummary(state, at(2026, 11, 7)), {
    seconds: 0,
    tracks: 0,
    topArtist: null,
    topArtistSeconds: 0
  })
})

test('todaySummary names the artist with the most seconds today', () => {
  const now = at(2026, 11, 7)
  let state = emptyHistory()
  state = addSeconds(state, night, 30, now)
  state = addSeconds(state, rice, 20, now)
  state = addSeconds(state, makeTrack('x', 'D:/m/x.flac', { artist: '别人' }), 10, now)
  const summary = todaySummary(state, now)
  assert.equal(summary.seconds, 60)
  assert.equal(summary.tracks, 3)
  assert.equal(summary.topArtist, '周杰伦')
  assert.equal(summary.topArtistSeconds, 50)
})

test('serializeHistory trims to the retention limits', () => {
  let state = emptyHistory()
  for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
    state = addRecent(state, makeTrack(`t${index}`, `D:/m/${index}.flac`), at(2026, 11, 7) + index)
  }
  for (let index = 0; index < DAY_LIMIT + 3; index += 1) {
    state = addSeconds(state, night, 1, at(2026, 11, 7) + index * 24 * 60 * 60 * 1000)
  }
  const trimmed = serializeHistory(state)
  assert.equal(trimmed.recent.length, RECENT_LIMIT)
  assert.equal(trimmed.days.length, DAY_LIMIT)
  assert.equal(trimmed.version, 1)
})

test('addPlay keeps every listen instead of one row per track', () => {
  let state = emptyHistory()
  state = addPlay(state, night, at(2026, 11, 7, 9, 0))
  state = addPlay(state, sunny, at(2026, 11, 7, 9, 5))
  state = addPlay(state, night, at(2026, 11, 7, 9, 30))
  // 明细的意义是「听了几次」，同一天再听一遍要另起一行。
  assert.deepEqual(
    state.plays.map((entry) => entry.id),
    ['a', 'b', 'a']
  )
})

test('addPlay folds a restart inside the dedup window', () => {
  let state = emptyHistory()
  const start = at(2026, 11, 7, 9, 0)
  state = addPlay(state, night, start)
  state = addPlay(state, night, start + PLAY_DEDUP_MS / 2)
  assert.equal(state.plays.length, 1)
  assert.equal(state.plays[0].at, start + PLAY_DEDUP_MS / 2)
})

test('addPlay does not fold two tracks that interleave', () => {
  let state = emptyHistory()
  const start = at(2026, 11, 7, 9, 0)
  state = addPlay(state, night, start)
  state = addPlay(state, sunny, start + 1000)
  state = addPlay(state, night, start + 2000)
  assert.deepEqual(
    state.plays.map((entry) => entry.id),
    ['a', 'b', 'a']
  )
})

test('addPlay caps the detail log', () => {
  let state = emptyHistory()
  for (let index = 0; index < PLAY_LIMIT + 5; index += 1) {
    state = addPlay(state, makeTrack(`t${index}`, `D:/m/${index}.flac`), at(2026, 11, 7) + index)
  }
  assert.equal(state.plays.length, PLAY_LIMIT)
})

test('prunePlays drops rows past the retention window', () => {
  let state = emptyHistory()
  const old = at(2026, 1, 1)
  const recent = at(2026, 11, 7)
  state = addPlay(state, night, old)
  state = addPlay(state, sunny, recent)
  const pruned = prunePlays(state, recent)
  assert.deepEqual(
    pruned.plays.map((entry) => entry.id),
    ['b']
  )
})

test('prunePlays returns the same state when nothing is old enough', () => {
  const state = addPlay(emptyHistory(), night, at(2026, 11, 7))
  assert.equal(prunePlays(state, at(2026, 11, 8)), state)
})

test('prunePlays keeps a row exactly on the retention edge', () => {
  const recent = at(2026, 11, 7)
  const edge = recent - PLAY_DAYS * 24 * 60 * 60 * 1000
  let state = addPlay(emptyHistory(), rice, edge)
  state = addPlay(state, sunny, recent)
  // 边界那一毫秒算「还在」：宁可多留一天，也不要某天突然少一批。
  assert.deepEqual(
    prunePlays(state, recent).plays.map((entry) => entry.id),
    ['b', 'c']
  )
})

test('groupPlaysByDay splits newest day first and folds repeats inside a day', () => {
  let state = emptyHistory()
  state = addPlay(state, night, at(2026, 11, 6, 22, 0))
  state = addPlay(state, sunny, at(2026, 11, 7, 9, 0))
  state = addPlay(state, night, at(2026, 11, 7, 9, 30))
  state = addPlay(state, rice, at(2026, 11, 7, 10, 0))
  const days = groupPlaysByDay(state.plays)
  assert.deepEqual(
    days.map((day) => day.day),
    ['2026-11-07', '2026-11-06']
  )
  // 今天这组按开始时间倒序：稻香 10:00、夜曲 9:30、晴天 9:00。
  assert.deepEqual(
    days[0].entries.map((entry) => entry.id),
    ['c', 'a', 'b']
  )
  assert.deepEqual(
    days[1].entries.map((entry) => entry.id),
    ['a']
  )
})

test('parseHistory reads plays and drops junk rows', () => {
  const raw = JSON.stringify({
    version: 1,
    recent: [],
    days: [],
    plays: [
      { id: 'a', title: '夜曲', artist: '周杰伦', album: '', at: 1 },
      { id: 'a', title: '夜曲', artist: '周杰伦', album: '', at: 2 },
      { id: 7, title: 'bad' },
      null
    ]
  })
  const state = parseHistory(raw)
  assert.equal(state.plays.length, 2)
  assert.equal(state.plays[0].at, 1)
})

test('parseHistory accepts payloads that predate plays', () => {
  const state = parseHistory(JSON.stringify({ version: 1, recent: [], days: [] }))
  assert.deepEqual(state.plays, [])
})
