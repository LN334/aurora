import assert from 'node:assert/strict'
import test from 'node:test'
import { albumKeyOf, mergeAlbumCards, type AlbumCard } from '../src/features/online/album-merge.ts'

function album(part: Partial<AlbumCard> & Pick<AlbumCard, 'key' | 'providerId' | 'name'>): AlbumCard {
  return {
    providerLabel: part.providerId === 'netease' ? '网易云音乐' : part.providerId === 'qq' ? 'QQ 音乐' : '酷狗音乐',
    id: 1,
    name: part.name,
    coverUrl: null,
    artistName: '黄子弘凡',
    year: 0,
    platforms: [
      {
        providerId: part.providerId,
        providerLabel: 'x',
        id: part.id ?? 1
      }
    ],
    ...part
  }
}

test('同一张专辑跨平台并成一张，平台都挂上', () => {
  const rows = [
    album({ key: 'qq:1', providerId: 'qq', name: '去云上', id: 11 }),
    album({ key: 'kugou:2', providerId: 'kugou', name: '去云上', id: 22 })
  ]
  const merged = mergeAlbumCards(rows)
  assert.equal(merged.length, 1)
  assert.deepEqual(
    merged[0].platforms.map((on) => on.providerId),
    ['qq', 'kugou']
  )
  assert.deepEqual(
    merged[0].platforms.map((on) => on.id),
    [11, 22]
  )
})

test('主行按 网易云 → QQ → 酷狗：点卡片进信息最全的那家', () => {
  const merged = mergeAlbumCards([
    album({ key: 'kugou:2', providerId: 'kugou', name: '去云上', id: 22 }),
    album({ key: 'netease:3', providerId: 'netease', name: '去云上', id: 33, year: 2026 })
  ])
  assert.equal(merged[0].providerId, 'netease')
  assert.equal(merged[0].year, 2026)
})

test('主行没有封面时借另一家的', () => {
  const merged = mergeAlbumCards([
    album({ key: 'netease:3', providerId: 'netease', name: '去云上', id: 33, coverUrl: null }),
    album({ key: 'qq:1', providerId: 'qq', name: '去云上', id: 11, coverUrl: 'https://x/1.jpg' })
  ])
  assert.equal(merged[0].coverUrl, 'https://x/1.jpg')
})

test('名字只差全角括号或空白也算同一张', () => {
  assert.equal(
    albumKeyOf({ name: '去云上（Live 版）', artistName: '黄子弘凡' }),
    albumKeyOf({ name: '去云上(Live版)', artistName: '黄子弘凡' })
  )
})

test('不同艺人或不同专辑不合并', () => {
  const rows = [
    album({ key: 'qq:1', providerId: 'qq', name: '去云上', id: 11, artistName: '黄子弘凡' }),
    album({ key: 'qq:2', providerId: 'qq', name: '去云上', id: 12, artistName: '别人' }),
    album({ key: 'qq:3', providerId: 'qq', name: '别的碟', id: 13, artistName: '黄子弘凡' })
  ]
  assert.equal(mergeAlbumCards(rows).length, 3)
})

test('同一家的两条不会重复挂同一个平台', () => {
  const merged = mergeAlbumCards([
    album({ key: 'qq:1', providerId: 'qq', name: '去云上', id: 11 }),
    album({ key: 'qq:9', providerId: 'qq', name: '去云上', id: 19 })
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].platforms.length, 1)
})