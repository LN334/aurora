import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DRIFT_LIMIT,
  HOLD_MS,
  expectedPosition,
  momentStale,
  playStateFor,
  followsRemote,
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

/*
 * 一条过期上报。
 *
 * 房主暂停后不再心跳，或者干脆断了；客人手上那条「现在听什么」会一直留着。
 * 从前顶上那条带子拿它算 `位置 + (现在 - 上报时刻)`，于是半小时后显示
 * 「差 1812 秒」，还带一颗按下去会 seek 到歌外面的「对齐」键。
 */
test('a paused host keeps its position however old the report is', () => {
  assert.equal(expectedPosition(moment(90, false, 30 * 60 * 1000), at0), 90)
})

test('an ancient report is not extrapolated into a position past the end of the song', () => {
  assert.equal(expectedPosition(moment(90, true, 30 * 60 * 1000), at0), 90)
})

test('an ancient report is marked stale, so nothing is pulled towards it', () => {
  const old = moment(90, true, 30 * 60 * 1000)
  assert.equal(momentStale(old, at0), true)
  assert.equal(seekTarget(old, local(12, true), at0), null)
})

test('a fresh report is fine, and a clock that is a few seconds ahead does not mark it stale', () => {
  assert.equal(momentStale(moment(90, true, 2000), at0), false)
  /* 房主的钟快 5 秒：时间戳落在未来，但这只是钟差，不是断线。 */
  assert.equal(momentStale({ ...moment(90, true), at: at0 + 5000 }, at0), false)
})

test('a clock off by half an hour is treated as untrustworthy, in either direction', () => {
  /* 房主的钟慢半小时 → 客人算出的等待时间是正的半小时。 */
  assert.equal(momentStale(moment(90, true, 30 * 60 * 1000), at0), true)
  /* 房主的钟快半小时 → 负的半小时。 */
  assert.equal(momentStale({ ...moment(90, true), at: at0 + 30 * 60 * 1000 }, at0), true)
})


/*
 * 跟着房间走，不等于本机有人动手。
 *
 * 「暂停回声」是放开控制权之后最容易炸的那一支：A 按暂停，B 被广播推着暂停；
 * B 若把这当成自己的操作再报，房主收到两条暂停、两条都推回去，播放键就开始
 * 自己跳。所以每一条上报前都要先问这一句。
 */
const remoteNow = { trackId: 'netease:1', playing: true, position: 90, at: at0 }

test('being pulled to another track is following, not switching', () => {
  assert.equal(followsRemote('track', remoteNow, { trackId: 'netease:1' }, at0 + 200), true)
  assert.equal(followsRemote('track', remoteNow, { trackId: 'qq:2' }, at0 + 200), false)
})

test('being pulled into a pause is following, not a keypress', () => {
  /* 房间里已经是暂停，本地跟着变成暂停：这是回声。 */
  assert.equal(
    followsRemote('state', { ...remoteNow, playing: false }, { playing: false }, at0 + 200),
    true
  )
  /* 房间里还在放，本地却按了暂停：这是人按的，要报。 */
  assert.equal(followsRemote('state', remoteNow, { playing: false }, at0 + 200), false)
})

test('a position near the room target is the seek we were pulled through', () => {
  const later = at0 + 2000
  /* 房间 90 秒处，两秒后应该在 92 秒附近；本地就在这里。 */
  assert.equal(followsRemote('seek', remoteNow, { position: 92 }, later), true)
  /* 差得远的就是有人拖了。 */
  assert.equal(followsRemote('seek', remoteNow, { position: 30 }, later), false)
})

test('a paused room does not drift forward while judging a seek', () => {
  const paused = { ...remoteNow, playing: false, position: 42 }
  assert.equal(followsRemote('seek', paused, { position: 42 }, at0 + 60_000), true)
  assert.equal(followsRemote('seek', paused, { position: 52 }, at0 + 60_000), false)
})

test('without a room target nothing is treated as following', () => {
  assert.equal(followsRemote('state', null, { playing: false }, at0), false)
  assert.equal(followsRemote('track', null, { trackId: 'netease:1' }, at0), false)
  assert.equal(followsRemote('seek', null, { position: 1 }, at0), false)
})
