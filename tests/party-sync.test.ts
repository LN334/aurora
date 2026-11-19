import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DRIFT_LIMIT,
  HOLD_MS,
  expectedPosition,
  playStateFor,
  sawSeek,
  seekTarget,
  type LocalPlayback,
  type PartyMoment,
  type PlaybackTick
} from '../src/features/party/pure.ts'

const at0 = 1_700_000_000_000

function moment(position: number, playing: boolean, ageMs = 0): PartyMoment {
  return { at: at0 - ageMs, position, playing }
}

function local(position: number, playing: boolean): LocalPlayback {
  return { position, playing }
}

function tick(trackId: string, position: number, playing: boolean, at: number): PlaybackTick {
  return { trackId, position, playing, at }
}

test('the position the host sent is corrected for how long the message took', () => {
  /* 房主 90 秒时发出，消息走了 1.5 秒——他那边此刻是 91.5 秒。 */
  assert.equal(expectedPosition(moment(90, true, 1500), at0), 91.5)
})

test('a paused host does not drift forward while the message travels', () => {
  assert.equal(expectedPosition(moment(90, false, 5000), at0), 90)
})

test('a message stamped in the future never rewinds the position', () => {
  /* 两台机器的钟差可以到秒级；拿未来时间戳倒推会得到比发送时更早的位置。 */
  assert.equal(expectedPosition({ ...moment(90, true), at: at0 + 2000 }, at0), 90)
})

test('small differences are left alone instead of yanked back', () => {
  assert.equal(seekTarget(moment(90, true, 0), local(91, true), at0), null)
  assert.equal(seekTarget(moment(90, true, 0), local(90 + DRIFT_LIMIT, true), at0), null)
})

test('a difference past the limit is pulled to the corrected second', () => {
  const target = seekTarget(moment(90, true, 2000), local(12, true), at0)
  assert.ok(target !== null)
  assert.equal(Math.round(target * 100) / 100, 92)
})

test('holding off means no seek at all, however far behind the guest is', () => {
  assert.equal(seekTarget(moment(90, true, 0), local(12, true), at0, true), null)
})

test('the guest follows the host pause and play, not just the position', () => {
  assert.equal(playStateFor(moment(0, false), local(0, true)), false)
  assert.equal(playStateFor(moment(0, true), local(0, false)), true)
  /* 已经一致时什么都不用做，否则每收到一条消息都会重排一次淡入淡出。 */
  assert.equal(playStateFor(moment(0, true), local(0, true)), null)
})

test('ordinary playback is not mistaken for a drag', () => {
  /* 250ms 走了 0.25 秒，正常。 */
  assert.equal(sawSeek(tick('a', 10, true, at0), tick('a', 10.25, true, at0 + 250)), false)
})

test('a jump of several seconds is a drag', () => {
  assert.equal(sawSeek(tick('a', 10, true, at0), tick('a', 40, true, at0 + 250)), true)
  /* 往回拖也是拖动。 */
  assert.equal(sawSeek(tick('a', 40, true, at0), tick('a', 5, true, at0 + 250)), true)
})

test('a paused track keeping its position is not a drag', () => {
  assert.equal(sawSeek(tick('a', 10, false, at0), tick('a', 10, false, at0 + 2000)), false)
})

test('following the host to another track is not a local drag', () => {
  assert.equal(sawSeek(tick('a', 40, true, at0), tick('b', 0, true, at0 + 250)), false)
})

test('the hold window outlasts one host heartbeat', () => {
  /* 房主每 4 秒报一次位置；窗口比它短的话，刚拖完就被下一条消息打回去。 */
  assert.ok(HOLD_MS > 4000)
})
