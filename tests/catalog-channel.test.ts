import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerAlbum,
  providerArtist,
  providerArtistAlbums,
  providerArtistSongs,
  providerArtistTopSongs,
  providerNewAlbums,
  providerSongDetail
} from '../src/features/online/catalog-channel.ts'

/**
 * 专辑页与艺人页在渲染层的入口。
 *
 * 与「喜欢」那一支相反，这一组**失败折回 null / 空数组**：这批只搬家，语义与
 * 旧通道逐字段一致。三条页面各自把空结果画成「没有这张专辑 / 这位艺人没有歌曲」，
 * 要分清「没读到」得连页面一起改，留作单独一版——所以这里的测试钉住的正是
 * 「折回」这个当前契约，改契约时它会先红。
 */

type Call = { provider: string; capability: string; args: unknown }

const globals = globalThis as unknown as { window?: unknown }

function install(answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = []
  globals.window = {
    aurora: {
      provider: {
        call: async (provider: string, capability: string, args: unknown) => {
          const call = { provider, capability, args }
          calls.push(call)
          return answer(call)
        }
      }
    }
  }
  return calls
}

function collectWarnings(): { lines: string[]; restore(): void } {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '))
  }
  return { lines, restore: () => (console.warn = original) }
}

test('五个助手各走自己那条通道，艺人资料那条叫 artistDetail', async () => {
  const calls = install(() => ({ ok: true, value: [] }))
  await providerAlbum('netease', 18915)
  await providerArtist('kugou', 3520)
  await providerArtistTopSongs('qishui', 77)
  await providerArtistSongs('netease', 88, 200, 40)
  await providerArtistAlbums('kugou', 99, 60, 120)
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['album', 'artistDetail', 'artistTopSongs', 'artistSongs', 'artistAlbums']
  )
  // 能力枚举里那一项叫 artists（「这家长没长艺人页」），通道名却按动作叫
  // artistDetail——两者不是同一个东西，写混了主进程会答 unsupported-capability。
  assert.deepEqual(calls[0].args, { albumId: 18915 })
  assert.deepEqual(calls[1].args, { artistId: 3520 })
  assert.deepEqual(calls[2].args, { artistId: 77, limit: undefined })
  assert.deepEqual(calls[3].args, { artistId: 88, limit: 200, offset: 40 })
  assert.deepEqual(calls[4].args, { artistId: 99, limit: 60, offset: 120 })
})

test('主进程答 ok 时原样返回', async () => {
  install((call) =>
    call.capability === 'album' || call.capability === 'artistDetail'
      ? { ok: true, value: { id: 1, name: 'x' } }
      : { ok: true, value: [{ id: 2 }] }
  )
  assert.deepEqual(await providerAlbum('qq', 1), { id: 1, name: 'x' })
  assert.deepEqual(await providerArtist('qishui', 1), { id: 1, name: 'x' })
  assert.deepEqual(await providerArtistTopSongs('kugou', 1), [{ id: 2 }])
})

test('失败折回 null / 空数组，且各留一条 warn 说明是哪一家', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerAlbum('netease', 1), null)
    assert.equal(await providerArtist('kugou', 1), null)
    assert.deepEqual(await providerArtistTopSongs('qishui', 1), [])
    assert.deepEqual(await providerArtistSongs('qq', 1), [])
    assert.deepEqual(await providerArtistAlbums('netease', 1), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 5)
  assert.ok(warnings.lines[0].includes('netease.album'))
  assert.ok(warnings.lines[1].includes('kugou.artistDetail'))
  assert.ok(warnings.lines[0].includes('handler-failed boom'))
})

test('没有主进程时折回兜底，理由说清是没有主进程', async () => {
  delete globals.window
  const warnings = collectWarnings()
  try {
    assert.equal(await providerAlbum('qq', 1), null)
    assert.deepEqual(await providerArtistTopSongs('qq', 1), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 2)
  assert.ok(warnings.lines[0].includes('没有主进程'))
})

test('答了 ok 但值形状不对时按空处理，不把 undefined 交给页面', async () => {
  install(() => ({ ok: true, value: undefined }))
  assert.equal(await providerAlbum('netease', 1), null)
  assert.deepEqual(await providerArtistSongs('kugou', 1), [])
  assert.deepEqual(await providerArtistAlbums('kugou', 1), [])
})

test('答了 ok 但数组位置给的是对象时也算空，页面拿到的一定是数组', async () => {
  install(() => ({ ok: true, value: { id: 3 } }))
  assert.deepEqual(await providerArtistTopSongs('qishui', 1), [])
})

/**
 * 新碟榜。它不是某一页的详情，而是首页那排「推荐专辑」的来源；三家里只有网易云
 * 真有这张榜，另外两家从新歌榜里抽专辑。通道名按动作叫 newAlbums（不是 topAlbums——
 * 那是旧桥的方法名，混用会得到一个 unsupported-capability）。
 */
test('新碟榜那条叫 newAlbums，参数是 { limit, offset }', async () => {
  const calls = install(() => ({ ok: true, value: [{ id: 7, name: '龙年' }] }))
  assert.deepEqual(await providerNewAlbums('netease', 24, 48), [{ id: 7, name: '龙年' }])
  assert.equal(calls[0].capability, 'newAlbums')
  assert.deepEqual(calls[0].args, { limit: 24, offset: 48 })
})

test('新碟榜读失败折回空数组，理由写进 warn', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerNewAlbums('netease', 24), [])
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 1)
  assert.ok(warnings.lines[0].includes('netease.newAlbums'))
})

/**
 * 歌曲详情。恢复出来的队列里可能有一首当前任何列表都没有的歌，只能按 id 补记录，
 * 否则连取流地址都拼不出来。通道名就叫 songDetail。
 */
test('歌曲详情那条叫 songDetail，参数是 { ids }', async () => {
  const calls = install(() => ({ ok: true, value: [{ id: 9 }] }))
  assert.deepEqual(await providerSongDetail('netease', [9, 10]), [{ id: 9 }])
  assert.equal(calls[0].capability, 'songDetail')
  assert.deepEqual(calls[0].args, { ids: [9, 10] })
})

test('歌曲详情读失败折回空数组，补不到记录就当没有', async () => {
  install(() => ({ ok: false, error: { code: 'handler-failed', message: 'boom' } }))
  const warnings = collectWarnings()
  try {
    assert.deepEqual(await providerSongDetail('netease', [9]), [])
  } finally {
    warnings.restore()
  }
  assert.ok(warnings.lines[0].includes('netease.songDetail'))
})
