import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMediaCache } from '../electron/media-cache.ts'

/**
 * The cache is plain filesystem code - no Electron import - so these tests run
 * the real thing in a throwaway directory instead of faking the layer below it.
 * That is what makes "upper limit shrinks, oldest goes first" checkable at all.
 */

function body(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes
  })()
}

function mp3(size = 4096): Uint8Array {
  const data = new Uint8Array(size)
  data.set([0x49, 0x44, 0x33]) // "ID3"
  return data
}

function pause(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scratch(): Promise<{ dir: string; dispose: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurora-media-cache-'))
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

test('serves a stored track with its sniffed type and size', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 1)
    assert.equal(await cache.store('netease:1', body(mp3(4096))), true)

    const hit = await cache.lookup('netease:1')
    assert.ok(hit)
    assert.equal(hit.size, 4096)
    assert.equal(hit.type, 'audio/mpeg')

    const stats = await cache.stats()
    assert.equal(stats.entries, 1)
    assert.equal(stats.bytes, 4096)
    assert.equal(stats.limitBytes, 1024 * 1024)
  } finally {
    await dispose()
  }
})

test('returns null for a key that was never stored', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 1)
    assert.equal(await cache.lookup('qq:404'), null)
    assert.equal((await cache.stats()).entries, 0)
  } finally {
    await dispose()
  }
})

test('overwrites the same key instead of piling up files', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 1)
    await cache.store('kugou:7', body(mp3(1000)))
    await cache.store('kugou:7', body(mp3(2000)))

    const hit = await cache.lookup('kugou:7')
    assert.ok(hit)
    assert.equal(hit.size, 2000)
    assert.equal((await cache.stats()).entries, 1)
  } finally {
    await dispose()
  }
})

test('drops the least recently used files when the limit shrinks', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 2)
    // Three 400 KB entries: 1.2 MB total, comfortably inside 2 MB.
    for (const key of ['a', 'b', 'c']) {
      await cache.store(key, body(mp3(400 * 1024)))
    }
    // Touch a and c later than b, so b is the one that has to go. The pause
    // matters: mtimes are compared by millisecond, and a tight loop can write
    // all three inside the same one.
    await pause()
    await cache.lookup('a')
    await pause()
    await cache.lookup('c')
    // Shrinking the budget is what triggers the eviction.
    await cache.setLimit(1)

    const names = (await readdir(dir)).filter((name) => name.endsWith('.bin'))
    assert.equal(names.length, 2)
    assert.equal(await cache.lookup('b'), null)
    assert.ok(await cache.lookup('a'))
    assert.ok(await cache.lookup('c'))
  } finally {
    await dispose()
  }
})

test('a limit of zero turns the cache off and empties it', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 2)
    await cache.store('x', body(mp3(2048)))
    await cache.setLimit(0)

    assert.equal((await cache.stats()).entries, 0)
    assert.equal((await readdir(dir)).filter((name) => name.endsWith('.bin')).length, 0)
    // Off means off: a new store call is refused rather than written and swept.
    assert.equal(await cache.store('y', body(mp3(2048))), false)
    assert.equal(await cache.lookup('y'), null)
  } finally {
    await dispose()
  }
})

test('clear wipes the directory and leaves it usable', async () => {
  const { dir, dispose } = await scratch()
  try {
    const cache = createMediaCache(dir, 2)
    await cache.store('x', body(mp3(2048)))
    await writeFile(path.join(dir, 'stray.txt'), 'not ours')
    await cache.clear()

    assert.equal((await readdir(dir)).length, 0)
    assert.equal(await cache.store('y', body(mp3(4096))), true)
    const again = await cache.lookup('y')
    assert.ok(again)
    assert.ok(await stat(again.path).catch(() => null))
  } finally {
    await dispose()
  }
})
