import assert from 'node:assert/strict'
import { test } from 'node:test'
import { partyTrackInfoOf, trackFromParty } from '../src/features/party/shared-track.ts'
import type { Track } from '../src/types.ts'

/*
 * 一起听里「客人没有这首歌」以前是一条死路。现在房主把曲目描述带过去，
 * 客人就地把它装进队列——只要这首是在线曲。
 */

function onlineTrack(): Track {
  return {
    id: 'netease:42',
    path: 'netease:42',
    source: 'netease',
    title: '晴天',
    artist: '周杰伦',
    albumArtist: '周杰伦',
    album: '叶惠美',
    genre: '',
    year: 2003,
    trackNo: 3,
    discNo: 1,
    duration: 269,
    bitrate: 320000,
    sampleRate: 44100,
    channels: 2,
    codec: 'mp3',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: 0,
    hasArt: true,
    coverUrl: 'https://img/cover.jpg',
    gainDb: null,
    peak: null
  } as Track
}

test('an online track round-trips through the party payload', () => {
  const info = partyTrackInfoOf(onlineTrack())
  assert.ok(info)
  const rebuilt = trackFromParty(info)
  assert.equal(rebuilt.id, 'netease:42')
  assert.equal(rebuilt.path, 'netease:42', 'path must identify the song, never a resolved url')
  assert.equal(rebuilt.source, 'netease')
  assert.equal(rebuilt.title, '晴天')
  assert.equal(rebuilt.duration, 269)
})

test('a local file is never sent: the other side has no such file', () => {
  const local = { ...onlineTrack(), id: 'local:1', source: undefined, path: 'D:/music/a.flac' } as Track
  assert.equal(partyTrackInfoOf(local), null)
})
