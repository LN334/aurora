import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderPlaylistTracks, orderTracks, playCounts } from '../src/features/library/views.ts'
import type { PlayEntry } from '../src/features/player/history.ts'
import type { Track } from '../src/types.ts'

/*
 * 排序用例。三条不变式：排出来的集合与输入相同（不丢不重）；并列项的顺序稳定
 * （同级用标题兜底，不进随机顺序）；`default` / `manual` 原样返回，不悄悄重排
 * 用户自己拖出来的顺序。
 */

function track(over: Partial<Track> & { title: string }): Track {
  return {
    id: over.id ?? over.title,
    path: over.path ?? `${over.title}.flac`,
    artist: over.artist ?? '陈默',
    album: over.album ?? '夜行列车',
    albumArtist: over.albumArtist ?? over.artist ?? '陈默',
    genre: '',
    year: null,
    trackNo: null,
    discNo: null,
    duration: over.duration ?? 200,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: 'flac',
    lossless: true,
    size: 0,
    mtimeMs: 0,
    addedAt: over.addedAt ?? 0,
    ...over
  } as Track
}

function play(id: string, at: number): PlayEntry {
  return { id, at, track: track({ id, title: id }) } as PlayEntry
}

const titles = (tracks: Track[]) => tracks.map((item) => item.title)

test('default 原样返回，连引用都不换', () => {
  const list = [track({ title: 'b' }), track({ title: 'a' })]
  assert.equal(orderTracks(list, 'default', new Map()), list)
  assert.equal(orderPlaylistTracks(list, 'manual'), list)
})

test('最近添加按入库时间倒序，同一秒用标题兜底', () => {
  const list = [
    track({ title: '旧', addedAt: 100 }),
    track({ title: '新', addedAt: 300 }),
    track({ title: 'B', addedAt: 200 }),
    track({ title: 'A', addedAt: 200 })
  ]
  assert.deepEqual(titles(orderTracks(list, 'recent', new Map())), ['新', 'A', 'B', '旧'])
})

test('最多播放按次数倒序，没播过的按入库时间沉在后面', () => {
  const list = [
    track({ title: '常听', id: 'a', addedAt: 10 }),
    track({ title: '没听过', id: 'b', addedAt: 30 }),
    track({ title: '听过一次', id: 'c', addedAt: 20 })
  ]
  const counts = playCounts([play('a', 1), play('a', 2), play('a', 3), play('c', 4)])
  assert.deepEqual(titles(orderTracks(list, 'plays', counts)), ['常听', '听过一次', '没听过'])
})

test('次数相同（含零次）时保持最近添加的顺序', () => {
  const list = [track({ title: '老', id: 'x', addedAt: 10 }), track({ title: '新', id: 'y', addedAt: 20 })]
  assert.deepEqual(titles(orderTracks(list, 'plays', new Map())), ['新', '老'])
})

test('playCounts 按曲目聚合，同一首播两次算两次', () => {
  const counts = playCounts([play('a', 1), play('b', 2), play('a', 3)])
  assert.equal(counts.get('a'), 2)
  assert.equal(counts.get('b'), 1)
})

test('歌单按标题、艺人、时长排序', () => {
  // 用拉丁字母做艺人/标题，避免断言依赖 ICU 的中文排序口径（那属于系统字典，
  // 不是本项目的规则）；数字与大小写这些规则仍在这里守。
  const list = [
    track({ title: 'Song 10', artist: 'Bob', duration: 300, addedAt: 300 }),
    track({ title: 'Song 2', artist: 'ann', duration: 100, addedAt: 100 }),
    track({ title: 'Song 1', artist: 'Ann', duration: 200, addedAt: 200 })
  ]
  assert.deepEqual(titles(orderPlaylistTracks(list, 'title')), ['Song 1', 'Song 2', 'Song 10'])
  // Ann 与 ann 视为同一人（sensitivity base），组内再按标题。
  assert.deepEqual(titles(orderPlaylistTracks(list, 'artist')), ['Song 1', 'Song 2', 'Song 10'])
  assert.deepEqual(titles(orderPlaylistTracks(list, 'duration')), ['Song 2', 'Song 1', 'Song 10'])
  assert.deepEqual(titles(orderPlaylistTracks(list, 'added')), ['Song 10', 'Song 1', 'Song 2'])
})

test('同艺人的歌按专辑、碟号、轨号走', () => {
  const list = [
    track({ title: 'B side 2', artist: 'Ann', album: 'Album B', discNo: 1, trackNo: 2 }),
    track({ title: 'first', artist: 'Ann', album: 'Album A', discNo: 1, trackNo: 1 }),
    track({ title: 'disc 2', artist: 'Ann', album: 'Album B', discNo: 2, trackNo: 1 })
  ]
  assert.deepEqual(titles(orderPlaylistTracks(list, 'artist')), ['first', 'B side 2', 'disc 2'])
})

test('排歌单不丢条目，只是换顺序', () => {
  const list = [track({ title: 'c' }), track({ title: 'a' }), track({ title: 'b' })]
  const sorted = orderPlaylistTracks(list, 'title')
  assert.equal(sorted.length, list.length)
  assert.deepEqual([...titles(sorted)].sort(), ['a', 'b', 'c'])
  assert.equal(orderPlaylistTracks(sorted, 'added').length, list.length)
})
