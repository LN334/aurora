import assert from 'node:assert/strict'
import test from 'node:test'
import {
  albumFingerprintMatches,
  albumNameKey,
  albumOverlap,
  songsOfAlbum
} from '../src/features/online/album-unify.ts'
import type { Track } from '../src/types.ts'

function track(title: string, artist: string, duration = 200, source = 'kugou'): Track {
  return {
    id: `${source}:${title}`,
    path: '',
    source,
    title,
    artist,
    albumArtist: artist,
    album: '龙年',
    genre: '',
    year: 2025,
    trackNo: null,
    discNo: null,
    duration,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: '',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: 0,
    hasArt: false,
    gainDb: null,
    peak: null
  }
}

function song(name: string, albumName: string, artists: string[]) {
  return { name, album: { name: albumName }, artists: artists.map((artist) => ({ id: 1, name: artist })) }
}

test('专辑名归一：空白、大小写、全角括号都不该分家', () => {
  assert.equal(albumNameKey('龙年'), albumNameKey(' 龙 年 '))
  assert.equal(albumNameKey('去云上（Live版）'), albumNameKey('去云上(Live版)'))
  assert.notEqual(albumNameKey('龙年'), albumNameKey('龙年 2025'))
})

test('专辑名与艺人都对得上，才算这张专辑', () => {
  const songs = [
    song('枣庄市马思唯', '龙年', ['华云龙KLE']),
    song('轨道飞虎', '龙年', ['华云龙KLE']),
    song('别的', '别的专辑', ['华云龙KLE'])
  ]
  assert.deepEqual(
    songsOfAlbum('龙年', '华云龙KLE', songs).map((entry) => entry.name),
    ['枣庄市马思唯', '轨道飞虎']
  )
})

test('同名不同艺人：宁可不合，也不把别人的碟并进来', () => {
  const songs = [song('枣庄市马思唯', '龙年', ['另一个人'])]
  assert.deepEqual(songsOfAlbum('龙年', '华云龙KLE', songs), [])
})

test('合辑（群星）不比艺人，只比专辑名', () => {
  const songs = [
    song('一', '群星合辑', ['甲']),
    song('二', '群星合辑', ['乙'])
  ]
  assert.equal(songsOfAlbum('群星合辑', '群星', songs).length, 2)
})

test('曲目指纹：标题、主艺人、时长档都对上才算同一首', () => {
  const head = [track('枣庄市马思唯', '华云龙KLE', 151), track('轨道飞虎', '华云龙KLE', 175)]
  const other = [track('枣庄市马思唯', '华云龙KLE', 150, 'netease'), track('轨道飞虎', '华云龙KLE', 176, 'netease')]
  assert.equal(albumOverlap(head, other), 2)

  const wrongDuration = [track('枣庄市马思唯', '华云龙KLE', 240, 'netease')]
  assert.equal(albumOverlap(head, wrongDuration), 0)

  const wrongArtist = [track('枣庄市马思唯', '别人', 151, 'netease')]
  assert.equal(albumOverlap(head, wrongArtist), 0)
})

test('曲目指纹：撞上一首不算，撞上两首算', () => {
  const long = Array.from({ length: 14 }, (_, index) => track(`歌${index}`, '华云龙KLE', 200))
  const oneHit = [track('歌0', '华云龙KLE', 200, 'netease')]
  assert.equal(albumFingerprintMatches(long, oneHit), false)

  const twoHits = [track('歌0', '华云龙KLE', 200, 'netease'), track('歌1', '华云龙KLE', 200, 'netease')]
  assert.equal(albumFingerprintMatches(long, twoHits), true)

  const sameNameNoHit = [track('别的歌', '华云龙KLE', 200, 'netease')]
  assert.equal(albumFingerprintMatches(long, sameNameNoHit), false)

  const single = [track('歌0', '华云龙KLE', 200)]
  assert.equal(albumFingerprintMatches(single, [track('歌0', '华云龙KLE', 200, 'netease')]), true)
})

test('同名但规模差太多的一张（精选、全集）不算同一张', () => {
  const head = Array.from({ length: 14 }, (_, index) => track(`歌${index}`, '华云龙KLE', 200))
  const anthology = Array.from({ length: 40 }, (_, index) =>
    track(index < 2 ? `歌${index}` : `精选${index}`, '华云龙KLE', 200, 'netease')
  )
  assert.equal(albumFingerprintMatches(head, anthology), false)
})
