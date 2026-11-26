import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CAPABILITY_ORDER,
  brokenClaims,
  implementsCapability,
  supportsCapability,
  withheldCapabilities
} from '../src/features/online/capability.ts'
import type { OnlineMusicProvider, ProviderCapabilities } from '../src/features/online/types.ts'

/*
 * 能力表只有一个真源：声明（capabilities）与实现（方法在不在）分开问，界面只认
 * 「两者都真」。这些用例守的就是这条契约——任何一侧写错，在这里变成红灯，而不是
 * 变成界面里一个点不动的入口。
 */

const NOTHING: ProviderCapabilities = {
  search: false,
  playback: false,
  lyrics: false,
  auth: false,
  playlists: false,
  albums: false,
  artists: false,
  recommendations: false,
  userCloud: false,
  likes: false
}

function caps(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return { ...NOTHING, ...overrides }
}

/** 只带指定方法的假平台。方法体不会被调用，所以是空函数。 */
function fake(shape: Partial<OnlineMusicProvider>, declared: Partial<ProviderCapabilities> = {}): OnlineMusicProvider {
  return { id: 'netease', capabilities: caps(declared), ...shape } as unknown as OnlineMusicProvider
}

const IMPLEMENTATIONS: Record<keyof ProviderCapabilities, Partial<OnlineMusicProvider>> = {
  search: { search: { search: async () => ({ songs: [], albums: [], artists: [] }) } },
  playback: {
    playback: {
      streamUrl: async () => null,
      getAvailability: () => ({ state: 'unknown', reason: 'restricted' })
    } as never
  },
  lyrics: { lyrics: { lyrics: async () => null } },
  auth: { auth: { loginStatus: async () => null, logout: async () => {} } },
  playlists: { playlists: { create: async () => null } },
  albums: { catalog: { album: async () => null, playlistTracks: async () => [] } },
  artists: { catalog: { artistTopSongs: async () => [], playlistTracks: async () => [] } },
  recommendations: { recommendations: { dailySongs: async () => [] } },
  userCloud: { recommendations: { cloudSongs: async () => [] } },
  likes: { likes: { list: async () => [], set: async () => true } }
}

test('每一项能力都指向自己的方法，不串门', () => {
  for (const capability of CAPABILITY_ORDER) {
    const provider = fake(IMPLEMENTATIONS[capability])
    const implemented = CAPABILITY_ORDER.filter((name) => implementsCapability(provider, name))
    assert.deepEqual(implemented, [capability], capability)
  }
})

test('声明真、实现真，才算能点', () => {
  const provider = fake(IMPLEMENTATIONS.search, { search: true })
  assert.equal(supportsCapability(provider, 'search'), true)
})

test('声明真、没有实现：不能点，且被 brokenClaims 抓到', () => {
  const provider = fake({}, { auth: true })
  assert.equal(supportsCapability(provider, 'auth'), false)
  assert.deepEqual(brokenClaims(provider), ['auth'])
})

test('实现真、没声明：不能点，记为 withheld 而不是错误', () => {
  const provider = fake(IMPLEMENTATIONS.lyrics, { lyrics: false })
  assert.equal(supportsCapability(provider, 'lyrics'), false)
  assert.deepEqual(withheldCapabilities(provider), ['lyrics'])
  assert.deepEqual(brokenClaims(provider), [])
})

test('艺人页只接了热门歌曲也算有', () => {
  const provider = fake({ catalog: { artistTopSongs: async () => [], playlistTracks: async () => [] } }, { artists: true })
  assert.equal(implementsCapability(provider, 'artists'), true)
  assert.equal(supportsCapability(provider, 'artists'), true)
})

test('艺人页只有 artistSongs 分页、没有热门：不算有', () => {
  const provider = fake(
    { catalog: { artistSongs: async () => [], playlistTracks: async () => [] } },
    { artists: true }
  )
  assert.equal(implementsCapability(provider, 'artists'), false)
  assert.deepEqual(brokenClaims(provider), ['artists'])
})

test('云端歌曲看 recommendations.cloudSongs，不看整支 recommendations', () => {
  const provider = fake({ recommendations: { dailySongs: async () => [] } }, { userCloud: true })
  assert.equal(implementsCapability(provider, 'userCloud'), false)
  assert.deepEqual(brokenClaims(provider), ['userCloud'])
})

test('没有 platform 就是都不能点', () => {
  assert.equal(supportsCapability(null, 'search'), false)
  assert.equal(supportsCapability(undefined, 'playback'), false)
  assert.equal(implementsCapability(null, 'likes'), false)
})

test('一张干净的表：十项全对时为全空', () => {
  const shape: Partial<OnlineMusicProvider> = {
    search: IMPLEMENTATIONS.search.search,
    playback: IMPLEMENTATIONS.playback.playback,
    lyrics: IMPLEMENTATIONS.lyrics.lyrics,
    auth: IMPLEMENTATIONS.auth.auth,
    playlists: IMPLEMENTATIONS.playlists.playlists,
    likes: IMPLEMENTATIONS.likes.likes,
    catalog: {
      album: async () => null,
      artistTopSongs: async () => [],
      playlistTracks: async () => []
    },
    recommendations: {
      dailySongs: async () => [],
      cloudSongs: async () => []
    }
  }
  const declared = Object.fromEntries(CAPABILITY_ORDER.map((name) => [name, true])) as Partial<ProviderCapabilities>
  const provider = fake(shape, declared)
  assert.deepEqual(brokenClaims(provider), [])
  assert.deepEqual(withheldCapabilities(provider), [])
  assert.deepEqual(
    CAPABILITY_ORDER.filter((name) => supportsCapability(provider, name)),
    [...CAPABILITY_ORDER]
  )
})
