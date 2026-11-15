import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeFollowedArtists } from '../electron/qq/normalize.ts'

/*
 * 关注歌手的列表。
 *
 * 这个接口没被真机确认过形状（写它时用户的 QQ 登录态已过期），所以这里钉住的是
 * 「容错到什么程度」：两种信封、四种列表名、字段别名，以及登录失效时的空。
 */

test('reads the singer list out of the usual envelope', () => {
  const response = {
    status: 200,
    body: {
      response: {
        code: 0,
        data: {
          singer_list: [
            {
              singer_id: 3051,
              singer_mid: '0025NhlN2yWrP4',
              singer_name: '林俊杰',
              singer_pic: 'https://y.gtimg.cn/music/photo_new/T001R300x300M0000025NhlN2yWrP4.jpg',
              album_num: 38,
              song_num: 412
            }
          ]
        }
      }
    }
  }

  assert.deepEqual(normalizeFollowedArtists(response), [
    {
      id: 3051,
      mid: '0025NhlN2yWrP4',
      name: '林俊杰',
      avatarUrl: 'https://y.gtimg.cn/music/photo_new/T001R300x300M0000025NhlN2yWrP4.jpg',
      albumCount: 38,
      musicCount: 412
    }
  ])
})

test('accepts a bare data envelope with the short field names', () => {
  const response = { data: { list: [{ id: 7, name: '某人' }] } }
  assert.deepEqual(normalizeFollowedArtists(response), [
    { id: 7, mid: '', name: '某人', avatarUrl: null, albumCount: 0, musicCount: 0 }
  ])
})

test('drops rows without an id or a name instead of inventing one', () => {
  const response = {
    data: {
      singers: [{ singer_id: 1 }, { singer_name: '只有名字' }, { singer_id: 2, singer_name: '完整的' }]
    }
  }
  assert.deepEqual(
    normalizeFollowedArtists(response).map((artist) => artist.name),
    ['完整的']
  )
})

test('an expired login answers an empty list, not a throw', () => {
  // 上游登录失效就是这个形状：`{code:1000,subcode:1000,msg:"not login"}`。
  assert.deepEqual(normalizeFollowedArtists({ code: 1000, subcode: 1000, msg: 'not login' }), [])
  assert.deepEqual(normalizeFollowedArtists(null), [])
  assert.deepEqual(normalizeFollowedArtists({}), [])
})

test('reads the relation-list envelope the current upstream answers', () => {
  /*
   * 2026-11-15 真机：`music.concern.RelationList` / `GetFollowSingerList`。
   * 字段全大写，只有 MID 没有数字 id，也没有专辑数/歌曲数。
   */
  const response = {
    status: 200,
    body: {
      code: 0,
      req: {
        code: 0,
        data: {
          Msg: '',
          Total: 74,
          FromLimit: 2000,
          List: [
            {
              MID: '000djEdv2aAycA',
              EncUin: 'oK6kowEAoK4z7eSPoiSiNKoqoc**',
              Name: '艾热AIR',
              Desc: '种梦音乐旗下艺人',
              AvatarUrl: 'http://y.gtimg.cn/music/photo_new/T001R150x150M000000djEdv2aAycA_6.jpg',
              FanNum: 41814
            },
            { MID: '', Name: '没有 mid 的行' },
            { MID: 'only-mid' }
          ]
        }
      }
    }
  }

  assert.deepEqual(normalizeFollowedArtists(response), [
    {
      id: 0,
      mid: '000djEdv2aAycA',
      name: '艾热AIR',
      avatarUrl: 'http://y.gtimg.cn/music/photo_new/T001R150x150M000000djEdv2aAycA_6.jpg'
    }
  ])
})
