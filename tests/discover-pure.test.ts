import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NeteaseDiscoverPlaylist, NeteaseSong } from '../src/env'
import {
  DISCOVER_TABS,
  emptyTextFor,
  formatCount,
  hasContent,
  isDiscoverKind,
  normalizePlaylists,
  normalizeSongs,
  playlistMeta,
  playlistSubtitle,
  songArtistsText,
  tabLabel
} from '../src/features/discover/pure.ts'

/*
 * 「发现」页里唯一能脱离窗口验证的部分。
 *
 * 这些规则看着琐碎，但每一条都对应一个真实会出现在首屏的坏样式：上游同一个
 * 歌单被两个推荐位选中会出重影卡片；播放量原样打印是 10492938 这样读不出来的
 * 数字；没有 creator 的推荐歌单如果拿空串当副标题，卡片第二行会塌成一条空白。
 * 页面本身要真窗口才看得到，所以把这些判断钉在这里。
 */

function playlist(over: Partial<NeteaseDiscoverPlaylist> = {}): NeteaseDiscoverPlaylist {
  return {
    id: 1,
    name: '歌单',
    coverUrl: null,
    trackCount: 0,
    playCount: 0,
    creator: '',
    note: '',
    ...over
  }
}

function song(over: Partial<NeteaseSong> = {}): NeteaseSong {
  return {
    id: 1,
    name: '歌',
    artists: [{ id: 1, name: '歌手' }],
    album: { id: 1, name: '专辑', picUrl: null },
    duration: 240,
    fee: 0,
    ...over
  }
}

test('栏目顺序固定为 推荐歌单 / 新歌速递 / 精品歌单，且和接口一一对应', () => {
  assert.deepEqual(
    DISCOVER_TABS.map((tab) => tab.id),
    ['playlists', 'newsongs', 'quality']
  )
  assert.equal(tabLabel('playlists'), '推荐歌单')
  assert.equal(tabLabel('newsongs'), '新歌速递')
  assert.equal(tabLabel('quality'), '精品歌单')
  assert.ok(isDiscoverKind('quality'))
  assert.equal(isDiscoverKind('ranking'), false)
})

test('播放量按中文习惯缩成一位小数，整数不显示 .0', () => {
  assert.equal(formatCount(0), '')
  assert.equal(formatCount(-3), '')
  assert.equal(formatCount(842), '842')
  assert.equal(formatCount(9999), '9999')
  assert.equal(formatCount(10_000), '1万')
  assert.equal(formatCount(12_340), '1.2万')
  assert.equal(formatCount(337_602), '33.8万')
  assert.equal(formatCount(10492938), '1049.3万')
  assert.equal(formatCount(120_000_000), '1.2亿')
})

test('卡片副标题优先创建者，其次是推荐语；都空时不占位', () => {
  assert.equal(playlistSubtitle({ creator: '陈粒', note: '民谣' }), '陈粒')
  assert.equal(playlistSubtitle({ creator: '  ', note: '  私人雷达  ' }), '私人雷达')
  assert.equal(playlistSubtitle({ creator: '', note: '' }), undefined)
})

test('卡片右端写清曲目数与播放量，缺一段就少写一段', () => {
  assert.equal(playlistMeta({ trackCount: 300, playCount: 81202 }), '300 首 · 8.1万 播放')
  assert.equal(playlistMeta({ trackCount: 12, playCount: 0 }), '12 首')
  assert.equal(playlistMeta({ trackCount: 0, playCount: 337602 }), '33.8万 播放')
  assert.equal(playlistMeta({ trackCount: 0, playCount: 0 }), '歌单')
})

test('推荐位重复的歌单只留第一张，无效 id 直接丢掉', () => {
  const rows = normalizePlaylists([
    playlist({ id: 2, name: ' A ', creator: ' x ' }),
    playlist({ id: 2, name: '重复' }),
    playlist({ id: 0 }),
    playlist({ id: -5 }),
    playlist({ id: 1.5 }),
    playlist({ id: 3, name: '   ' })
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    [2, 3]
  )
  assert.equal(rows[0].name, 'A')
  assert.equal(rows[0].creator, 'x')
  assert.equal(rows[1].name, '未命名歌单')
})

test('新歌去重保序，标题原样保留', () => {
  const rows = normalizeSongs([
    song({ id: 7, name: '第一首' }),
    song({ id: 7, name: '重复' }),
    song({ id: 9, name: '第二首' })
  ])
  assert.deepEqual(
    rows.map((row) => row.name),
    ['第一首', '第二首']
  )
})

test('空态判断按栏目看不同的数组', () => {
  assert.equal(hasContent('newsongs', { songs: [], playlists: [playlist()] }), false)
  assert.equal(hasContent('newsongs', { songs: [song()], playlists: [] }), true)
  assert.equal(hasContent('playlists', { songs: [song()], playlists: [] }), false)
  assert.equal(hasContent('quality', { songs: [], playlists: [playlist()] }), true)
})

test('空态文案点名平台与栏目，三种空不是同一句话', () => {
  const news = emptyTextFor('newsongs', '网易云')
  const quality = emptyTextFor('quality', '网易云')
  const recommend = emptyTextFor('playlists', '网易云')
  assert.notEqual(news, quality)
  assert.notEqual(quality, recommend)
  for (const text of [news, quality, recommend]) assert.ok(text.includes('网易云'))
})

test('新歌行副标题是歌手名，多个歌手用斜杠连接', () => {
  assert.equal(
    songArtistsText(song({ artists: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }] })),
    '甲 / 乙'
  )
  assert.equal(songArtistsText(song({ artists: [] })), '')
})
