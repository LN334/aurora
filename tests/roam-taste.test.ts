import assert from 'node:assert/strict'
import { test } from 'node:test'
import { knownFrom, tasteOrder } from '../src/features/player/roam-pure.ts'
import { makeTrack } from './fixtures.ts'

function song(id: string, artist: string, album = '某张专辑'): ReturnType<typeof makeTrack> {
  return makeTrack(id, 'C:\\m\\' + id + '.flac', { artist, albumArtist: artist, album })
}

const ids = (tracks: { id: string }[]): string[] => tracks.map((track) => track.id)

test('a collaboration credit is split, so the guest artist counts as known too', () => {
  const known = knownFrom([song('a', '甲 / 乙')])
  assert.ok(known.artists.has('甲'))
  assert.ok(known.artists.has('乙'))
  assert.ok(!known.artists.has('甲 / 乙'), 'the whole string is not an artist name')
})

test('default leaves the order alone', () => {
  const tracks = [song('1', '甲'), song('2', '乙')]
  assert.deepEqual(ids(tasteOrder(tracks, 'default', knownFrom([]))), ['1', '2'])
})

test('familiar puts known artists first and keeps the rest behind them', () => {
  const tracks = [song('1', '陌生人'), song('2', '甲'), song('3', '另一个陌生人'), song('4', '乙')]
  const order = tasteOrder(tracks, 'familiar', knownFrom([song('x', '甲'), song('y', '乙')]))
  assert.deepEqual(ids(order), ['2', '4', '1', '3'])
})

test('familiar keeps every track, even when it knows nobody', () => {
  const tracks = [song('1', '甲'), song('2', '乙')]
  const order = tasteOrder(tracks, 'familiar', knownFrom([]))
  assert.deepEqual(ids(order), ['1', '2'])
  assert.equal(order.length, tracks.length)
})

test('a known album counts even when the artist is new', () => {
  /*
   * 同一张专辑算「认识」：歌手是新人，但唱片还是那张。
   * 专辑身份按「专辑名 + 专辑艺人」认，所以这里两边的 albumArtist 必须一致。
   */
  const onThatAlbum = makeTrack('1', 'C:\\m\\1.flac', {
    artist: '新人甲',
    albumArtist: '老歌手',
    album: '老专辑'
  })
  const elsewhere = makeTrack('2', 'C:\\m\\2.flac', { artist: '路人', albumArtist: '路人', album: '别的' })
  const known = knownFrom([
    makeTrack('x', 'C:\\m\\x.flac', { artist: '老歌手', albumArtist: '老歌手', album: '老专辑' })
  ])
  assert.deepEqual(ids(tasteOrder([elsewhere, onThatAlbum], 'familiar', known)), ['1', '2'])
})

test('explore leads with strangers and never repeats an artist up front', () => {
  const tracks = [song('1', '熟人'), song('2', '陌生人'), song('3', '陌生人'), song('4', '第三人')]
  const known = knownFrom([song('x', '熟人')])
  /* 2 是「陌生人」的第一首，进前排；3 同一个人，退到后面；4 是生面孔，进前排。 */
  assert.deepEqual(ids(tasteOrder(tracks, 'explore', known)), ['2', '4', '1', '3'])
})

test('explore never drops a track: the pool is small and one is still heard only once', () => {
  const tracks = [song('1', '甲'), song('2', '甲'), song('3', '甲')]
  const order = tasteOrder(tracks, 'explore', knownFrom([]))
  assert.equal(order.length, 3)
  assert.deepEqual(ids(order), ['1', '2', '3'], 'same artist: first one leads, the rest follow in order')
})

test('explore with everything known falls back to the given order', () => {
  const tracks = [song('1', '甲'), song('2', '乙')]
  const order = tasteOrder(tracks, 'explore', knownFrom([song('x', '甲'), song('y', '乙')]))
  assert.deepEqual(ids(order), ['1', '2'])
})
