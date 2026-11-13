import assert from 'node:assert/strict'
import { test } from 'node:test'

const { registerProvider } = await import('../src/features/online/registry.ts')
const { canWritePlaylist } = await import('../src/features/online/playlist-write.ts')

/*
 * 用一张最小的假 provider 顶替真实的网易云：这里要验的是「归属决定摆不摆按钮」，
 * 不牵扯那一家怎么连上游。canWritePlaylist 只看 provider 有没有 playlists 写通道。
 */
type Provider = Parameters<typeof registerProvider>[0]
registerProvider({
  id: 'netease',
  playlists: { rename: async () => true, remove: async () => true }
} as unknown as Provider)

type Face = {
  id: number
  name: string
  coverUrl: string | null
  creator: string
  ownership?: string
  subscribed?: boolean
}

function face(ownership?: string, subscribed?: boolean): Face {
  return { id: 1, name: '一张单子', coverUrl: null, creator: '', ownership, subscribed }
}

test('推荐位上的歌单不给改名和删除', () => {
  assert.equal(canWritePlaylist('netease', face('unknown', false)), false)
})

test('收藏来的歌单只读', () => {
  assert.equal(canWritePlaylist('netease', face('collected', false)), false)
})

test('自己建的单子照旧能改', () => {
  assert.equal(canWritePlaylist('netease', face('mine')), true)
})

test('平台不给归属时退回 subscribed', () => {
  assert.equal(canWritePlaylist('netease', face(undefined, true)), false)
  assert.equal(canWritePlaylist('netease', face(undefined, false)), true)
})

test('写不了歌单的平台一律没有按钮', () => {
  assert.equal(canWritePlaylist('kugou', face('mine')), false)
})
