import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../src/types.ts'
import { interleaveBySource, ringSlice } from '../src/features/online/fresh-window.ts'

function track(id: string, source?: string): Track {
  return {
    id,
    path: id,
    source,
    title: id,
    artist: 'a',
    albumArtist: 'a',
    album: 'alb',
    genre: '',
    year: null,
    trackNo: null,
    discNo: null,
    duration: 100,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: '',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: 0
  }
}

test('两家各两首：轮流坐庄，不是一家占满', () => {
  const rows = [track('n1', 'netease'), track('t1', 'qq'), track('n2', 'netease'), track('t2', 'qq')]
  assert.deepEqual(interleaveBySource(rows).map((t) => t.id), ['n1', 't1', 'n2', 't2'])
})

test('桶按首次出现的顺序排，短的那家见底就跳过', () => {
  const rows = [track('q1', 'qq'), track('n1', 'netease'), track('n2', 'netease'), track('n3', 'netease')]
  assert.deepEqual(interleaveBySource(rows).map((t) => t.id), ['q1', 'n1', 'n2', 'n3'])
})

test('缺 source 的算本机，与在线的分桶', () => {
  const rows = [track('l1'), track('o1', 'qq')]
  assert.deepEqual(interleaveBySource(rows).map((t) => t.id), ['l1', 'o1'])
})

test('轮数封顶：一百首单源只取前六十', () => {
  const rows = Array.from({ length: 100 }, (_, i) => track('x' + i, 'qq'))
  assert.equal(interleaveBySource(rows).length, 60)
})

test('空输入给空队，不抛', () => {
  assert.deepEqual(interleaveBySource([]), [])
})

test('队比一屏短：原样给出，顺序不动', () => {
  const rows = [track('a'), track('b')]
  assert.deepEqual(ringSlice(rows, 5, 0).map((t) => t.id), ['a', 'b'])
  assert.deepEqual(ringSlice(rows, 5, 3).map((t) => t.id), ['a', 'b'])
})

test('换一批整屏往后挪', () => {
  const rows = Array.from({ length: 10 }, (_, i) => track('s' + i))
  assert.deepEqual(ringSlice(rows, 4, 0).map((t) => t.id), ['s0', 's1', 's2', 's3'])
  assert.deepEqual(ringSlice(rows, 4, 1).map((t) => t.id), ['s4', 's5', 's6', 's7'])
})

test('挪过尾巴从头补足，永远是一整屏', () => {
  const rows = Array.from({ length: 10 }, (_, i) => track('s' + i))
  assert.deepEqual(ringSlice(rows, 4, 2).map((t) => t.id), ['s8', 's9', 's0', 's1'])
  assert.equal(ringSlice(rows, 4, 7).length, 4)
})

test('负的批次数也落在队内，不返回空', () => {
  const rows = Array.from({ length: 10 }, (_, i) => track('s' + i))
  assert.deepEqual(ringSlice(rows, 4, -1).map((t) => t.id), ['s6', 's7', 's8', 's9'])
})
