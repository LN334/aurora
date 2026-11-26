import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SHELL_EYEBROWS,
  SHELL_TITLES,
  routeToShell,
  sameShell,
  shellFromHash,
  shellToHash,
  shellToRoute
} from '../src/app/shell-pure.ts'

/**
 * 外壳路由的两向翻译。
 *
 * 这一层没有界面：写错一处，要么白屏（少了分支），要么两页抢一个地址（多了
 * 分支），而真机上一页页点过去很难覆盖到。所以把地址写法与翻译钉在单测里。
 */

test('地址写法：普通页只有一段，详情页带 id', () => {
  assert.equal(shellToHash({ view: 'home' }), 'home')
  assert.equal(shellToHash({ view: 'album', id: 'abc' }), 'album/abc')
  // 在线三页的 id 本身是两段（provider/numericId），逐段编码后仍要在地址里可读。
  assert.equal(shellToHash({ view: 'onlinealbum', id: 'netease/18915' }), 'onlinealbum/netease/18915')
})

test('地址解析：详情页把 id 收回来，普通页不吃 id', () => {
  assert.deepEqual(shellFromHash('#onlinealbum/netease/18915'), { view: 'onlinealbum', id: 'netease/18915' })
  assert.deepEqual(shellFromHash('#album/abc'), { view: 'album', id: 'abc' })
  // 首页不吃 id：地址里多写一段不该悄悄变成另一页。
  assert.deepEqual(shellFromHash('#home/anything'), { view: 'home' })
  assert.deepEqual(shellFromHash('#home'), { view: 'home' })
})

test('地址解析：空片段、陌生片段、原型链上的名字都返回 null', () => {
  assert.equal(shellFromHash(''), null)
  assert.equal(shellFromHash('#'), null)
  assert.equal(shellFromHash('#nope'), null)
  // `in` 会把这些名字当成合法页，落进一个不存在的视图里白屏。
  assert.equal(shellFromHash('#toString'), null)
  assert.equal(shellFromHash('#constructor'), null)
  assert.equal(shellFromHash('#__proto__'), null)
})

test('地址解析：旧书签落到新页，不白屏', () => {
  assert.deepEqual(shellFromHash('#myplaylists'), { view: 'playlists' })
  // 「歌单」列表页不吃 id：它下一层是 playlist 详情页，两页各一个地址。
  assert.deepEqual(shellFromHash('#myplaylists/abc'), { view: 'playlists' })
  assert.deepEqual(shellFromHash('#roam'), { view: 'nowplaying' })
})

test('地址解析：id 里的转义字符能原样回来', () => {
  const route = { view: 'playlist' as const, id: '话 / 说' }
  assert.deepEqual(shellFromHash('#' + shellToHash(route)), route)
})

test('新壳到旧路由：详情页带 id，安全页不自造 id', () => {
  assert.deepEqual(shellToRoute({ view: 'me' }), { view: 'accounts' })
  assert.deepEqual(shellToRoute({ view: 'album', id: 'a1' }), { view: 'albums', albumId: 'a1' })
  assert.deepEqual(shellToRoute({ view: 'artist', id: 'b1' }), { view: 'artists', artistId: 'b1' })
  assert.deepEqual(shellToRoute({ view: 'playlist', id: 'c1' }), { view: 'playlists', playlistId: 'c1' })
  // 歌单页没有 id 时旧路由里不能带一个 undefined 的 playlistId。
  assert.deepEqual(shellToRoute({ view: 'playlists' }), { view: 'discover' })
  // 自己取数的页面，旧视图表里没有对应项，统一给一个安全落点。
  for (const view of ['home', 'daily', 'recent', 'nowplaying', 'track', 'onlinealbum'] as const) {
    assert.deepEqual(shellToRoute({ view }), { view: 'discover' })
  }
})

test('旧路由到新壳：认得出的走详情页，认不出的回本机音乐', () => {
  assert.deepEqual(routeToShell({ view: 'discover' }), { view: 'home' })
  assert.deepEqual(routeToShell({ view: 'albums', albumId: 'a1' }), { view: 'album', id: 'a1' })
  assert.deepEqual(routeToShell({ view: 'albums' }), { view: 'home' })
  assert.deepEqual(routeToShell({ view: 'playlists' }), { view: 'playlists' })
  assert.deepEqual(routeToShell({ view: 'accounts' }), { view: 'me' })
  assert.deepEqual(routeToShell({ view: 'songs' }), { view: 'local' })
  assert.deepEqual(routeToShell({ view: 'folders' }), { view: 'local' })
})

test('同一次导航：id 不同也算走了', () => {
  assert.equal(sameShell({ view: 'home' }, { view: 'home' }), true)
  assert.equal(sameShell({ view: 'album', id: '1' }, { view: 'album', id: '2' }), false)
  assert.equal(sameShell({ view: 'album' }, { view: 'album', id: '1' }), false)
})

test('两张页头表覆盖同一批页面', () => {
  assert.deepEqual(Object.keys(SHELL_EYEBROWS).sort(), Object.keys(SHELL_TITLES).sort())
  // 在线三页自己的封面旁就写着是什么，外壳不再打一行标题。
  for (const view of ['onlinealbum', 'onlineartist', 'onlineplaylist'] as const) {
    assert.equal(SHELL_TITLES[view], '')
    assert.equal(SHELL_EYEBROWS[view], '')
  }
  // 歌单页要标题（左栏那一项叫「歌单」），但眉标留空：页面自己已经写了 PLAYLIST。
  assert.equal(SHELL_TITLES.playlist, '歌单')
  assert.equal(SHELL_EYEBROWS.playlist, '')
})