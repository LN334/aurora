import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBootRecorder, formatBootSteps } from '../electron/pure/boot-steps.ts'

/*
 * 启动步骤记录：要能回答「卡在哪一段」，所以每步都要有绝对时刻与和上一步的间隔。
 */

function recorderAt(times) {
  let index = 0
  return createBootRecorder({ now: () => times[Math.min(index++, times.length - 1)], startedAt: times[0] })
}

test('每步记下绝对时刻与相对上一步的间隔', () => {
  const recorder = recorderAt([1000, 1050, 1120])
  recorder.mark('log')
  recorder.mark('protocols')
  recorder.mark('window')
  const steps = recorder.snapshot()
  assert.equal(steps.length, 3)
  assert.equal(steps[0].at, 0)
  assert.equal(steps[0].sinceLast, null)
  assert.equal(steps[1].at, 50)
  assert.equal(steps[1].sinceLast, 50)
  assert.equal(steps[2].at, 120)
  assert.equal(steps[2].sinceLast, 70)
})

test('失败步骤记下错误文字，且不影响后续步骤', () => {
  const recorder = recorderAt([0, 10, 20])
  recorder.mark('log')
  recorder.fail('protocols', new Error('handle failed'))
  recorder.mark('window')
  const steps = recorder.snapshot()
  assert.equal(steps[1].error, 'handle failed')
  assert.equal(steps[2].error, null)
})

test('错误带 code 时补在前面，字符串与普通对象也能用', () => {
  const recorder = recorderAt([0, 1, 2, 3])
  const coded = new Error('EADDRINUSE: 端口被占')
  Object.assign(coded, { code: 'EADDRINUSE' })
  recorder.fail('a', coded)
  recorder.fail('b', 'plain text')
  recorder.fail('c', { message: 'object message' })
  recorder.fail('d', null)
  const steps = recorder.snapshot()
  assert.equal(steps[0].error, 'EADDRINUSE: 端口被占')
  assert.equal(steps[1].error, 'plain text')
  assert.equal(steps[2].error, 'object message')
  assert.equal(steps[3].error, 'unknown')
})

test('每次 mark 都往日志写一行带间隔的记录', () => {
  const lines = []
  let index = 0
  const times = [0, 40]
  const recorder = createBootRecorder({
    now: () => times[Math.min(index++, times.length - 1)],
    startedAt: 0,
    log: (line) => lines.push(line)
  })
  recorder.mark('open-log')
  recorder.mark('window')
  assert.equal(lines[0], 'boot: open-log +0ms')
  assert.equal(lines[1], 'boot: window +40ms (+40ms)')
})

test('导出格式：一行一步，没有步骤时给空串', () => {
  const recorder = recorderAt([0, 30])
  recorder.mark('log')
  recorder.fail('protocols', 'boom')
  const text = formatBootSteps(recorder.snapshot())
  assert.match(text, /- log：\+0ms/)
  assert.match(text, /- protocols：\+30ms \(\+30ms\)\s+FAILED boom/)
  assert.equal(formatBootSteps([]), '')
})
