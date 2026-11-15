import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFollowedSingers } from '../electron/kugou/transport.ts'

/*
 * 酷狗「我关注的歌手」。
 *
 * 这个形状是 2026-11-15 真机拿到的：`/user/follow` 把关注对象和用户混在一个
 * `data.lists` 里，靠 `iden_type` 区分（0 用户 / 1 歌手）。所以这里钉住的是
 * 「只挑歌手」这条规则，以及缺 id 的行要丢掉。
 */

const envelope = (lists: unknown[]) => ({ status: 1, error_code: 0, data: { total: lists.length, list_ver: 362, lists } })

test('挑出 iden_type 为 1 的歌手，跳过用户', () => {
  const list = readFollowedSingers(
    envelope([
      { iden_type: 0, userid: 1160654754, nickname: 'cat', pic: 'http://imge.kugou.com/u/cat.jpg' },
      {
        iden_type: 1,
        userid: 1046406620,
        singerid: 1118,
        nickname: '胡彦斌',
        pic: 'http://singerimg.kugou.com/uploadpic/softhead/100/20240229/x.jpg'
      }
    ])
  )

  assert.equal(list.length, 1)
  assert.deepEqual(list[0], {
    id: '1118',
    name: '胡彦斌',
    avatarUrl: 'https://singerimg.kugou.com/uploadpic/softhead/100/20240229/x.jpg'
  })
})

test('歌手行没有 singerid 时退回 userid', () => {
  const list = readFollowedSingers(envelope([{ iden_type: 1, userid: 4242, nickname: 'EXO', source_desc: '歌手' }]))

  assert.deepEqual(list, [{ id: '4242', name: 'EXO', avatarUrl: null }])
})

test('没有 id 或没有名字的行丢掉，而不是塞一个空壳', () => {
  const list = readFollowedSingers(
    envelope([
      { iden_type: 1, nickname: '缺 id' },
      { iden_type: 1, singerid: 84195 },
      { iden_type: 1, singerid: 45364, nickname: 'Ellie Goulding' }
    ])
  )

  assert.deepEqual(list, [{ id: '45364', name: 'Ellie Goulding', avatarUrl: null }])
})

test('未登录或响应缺字段时给空数组', () => {
  assert.deepEqual(readFollowedSingers({ error_code: 20010, status: 0, data: null }), [])
  assert.deepEqual(readFollowedSingers({}), [])
})
