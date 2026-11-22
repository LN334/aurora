import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QUEUE_MAX, addToQueue, moveInQueue, removeFromQueue } from '../electron/party/queue.ts'

/*
 * 房间列表的三个动作。
 *
 * 这里测的不是「数组操作对不对」，而是「没变化时必须返回同一个引用」——
 * 房间状态是整包广播的，一次多余的推送就是给每个成员多发一份队列；而要
 * 判断「有没有变化」，调用方只做一次引用比较。
 */

const a = { id: 'netease:1' }
const b = { id: 'qq:2' }
const c = { id: 'local:D:\\Music\\x.flac' }

test('a song lands at the end of the queue', () => {
  assert.deepEqual(addToQueue([a], b), [a, b])
})

test('the same song is not queued twice', () => {
  const queue = [a, b]
  assert.equal(addToQueue(queue, { id: a.id }), queue, 'no change means the same array')
})

test('a full queue refuses more songs instead of growing without bound', () => {
  const full = Array.from({ length: QUEUE_MAX }, (_, i) => ({ id: 'x:' + i }))
  assert.equal(addToQueue(full, b), full)
})

test('removing takes exactly one occurrence', () => {
  assert.deepEqual(removeFromQueue([a, b, c], b.id), [a, c])
})

test('removing something that is not queued changes nothing', () => {
  const queue = [a, b]
  assert.equal(removeFromQueue(queue, c.id), queue)
})

test('moving to the front keeps the rest in order', () => {
  assert.deepEqual(moveInQueue([a, b, c], c.id, 0), [c, a, b])
})

test('moving to the end keeps the rest in order', () => {
  assert.deepEqual(moveInQueue([a, b, c], a.id, 2), [b, c, a])
})

test('a move that lands where it already was is not a change', () => {
  const queue = [a, b, c]
  assert.equal(moveInQueue(queue, b.id, 1), queue)
})

test('an out-of-range target is clamped, not dropped', () => {
  assert.deepEqual(moveInQueue([a, b, c], c.id, 99), [a, b, c])
  assert.deepEqual(moveInQueue([a, b, c], c.id, -5), [c, a, b])
})

test('moving a song that is not queued changes nothing', () => {
  const queue = [a, b]
  assert.equal(moveInQueue(queue, c.id, 0), queue)
})
