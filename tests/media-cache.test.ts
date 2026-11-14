import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cacheLimitBytes,
  evictionsFor,
  parseRange,
  sniffAudioType
} from '../electron/pure/media-cache-rules.ts'

test('cacheLimitBytes 把设置页的 MB 换成字节并夹在范围内', () => {
  assert.equal(cacheLimitBytes(2048), 2048 * 1024 * 1024)
  assert.equal(cacheLimitBytes(0), 0)
  assert.equal(cacheLimitBytes(-5), 0)
  assert.equal(cacheLimitBytes(99_999), 10_240 * 1024 * 1024)
  assert.equal(cacheLimitBytes(Number.NaN), 0)
  // 小数按最近的整 MB 算：设置页只会给整数，手改的配置不该产生奇怪的上限。
  assert.equal(cacheLimitBytes(1.6), 2 * 1024 * 1024)
})

test('sniffAudioType 认得各家用得上的容器', () => {
  const bytes = (...values: (string | number)[]): Uint8Array => {
    const out: number[] = []
    for (const value of values) {
      if (typeof value === 'number') out.push(value)
      else for (const char of value) out.push(char.charCodeAt(0))
    }
    return Uint8Array.from(out)
  }

  assert.equal(sniffAudioType(bytes('ID3', 4, 0)), 'audio/mpeg')
  assert.equal(sniffAudioType(bytes(0xff, 0xfb, 0x90, 0x64)), 'audio/mpeg')
  assert.equal(sniffAudioType(bytes(0xff, 0xf3, 0x18, 0xc4)), 'audio/mpeg')
  assert.equal(sniffAudioType(bytes(0xff, 0xf1, 0x50, 0x80)), 'audio/aac')
  assert.equal(sniffAudioType(bytes('fLaC', 0, 0)), 'audio/flac')
  assert.equal(sniffAudioType(bytes('OggS', 0, 2)), 'audio/ogg')
  assert.equal(sniffAudioType(bytes('RIFF', 0, 0, 0, 0, 'WAVE')), 'audio/wav')
  assert.equal(sniffAudioType(bytes(0, 0, 0, 0x20, 'ftypM4A')), 'audio/mp4')
  assert.equal(sniffAudioType(bytes('<!DO', 67, 84)), null)
  assert.equal(sniffAudioType(new Uint8Array()), null)
})

test('parseRange 覆盖整文件、前后缀与越界', () => {
  assert.equal(parseRange(null, 100), null)
  assert.equal(parseRange('', 100), null)
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseRange('bytes=-20', 100), { start: 80, end: 99 })
  // 越界的终点被夹住，不报错——播放器常按乐观的字节数猜。
  assert.deepEqual(parseRange('bytes=90-999', 100), { start: 90, end: 99 })
  assert.equal(parseRange('bytes=100-', 100), 'invalid')
  assert.equal(parseRange('bytes=50-20', 100), 'invalid')
  assert.equal(parseRange('bytes=-0', 100), 'invalid')
  assert.equal(parseRange('items=0-1', 100), 'invalid')
  assert.equal(parseRange('bytes=-10', 0), 'invalid')
})

test('evictionsFor 从最旧删到 90% 以下，且不动刚写入的那份', () => {
  const files = [
    { name: 'a', size: 40, at: 1 },
    { name: 'b', size: 40, at: 2 },
    { name: 'c', size: 40, at: 3 }
  ]
  // 上限 100、共 120：删最旧的 a 后剩 80，已低于 90。
  assert.deepEqual(evictionsFor(files, 100), ['a'])
  // 上限 80、共 120：删到 72 以下要删两份。
  assert.deepEqual(evictionsFor(files, 80), ['a', 'b'])
  // 没超上限就什么都不删。
  assert.deepEqual(evictionsFor(files, 200), [])
  // 上限为 0 表示关闭缓存：全部清掉，但保留正在写的那份。
  assert.deepEqual(evictionsFor(files, 0, 'c'), ['a', 'b'])
  // 同一时间戳按名字稳定排序，两次扫描结果一致。
  const tied = [
    { name: 'z', size: 10, at: 5 },
    { name: 'y', size: 10, at: 5 }
  ]
  assert.deepEqual(evictionsFor(tied, 12), ['y'])
})
