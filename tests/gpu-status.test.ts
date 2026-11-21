import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gpuProblems, gpuSummary } from '../electron/pure/gpu-status.ts'

/*
 * 判据：只有明确不是 enabled 的关键管线才算问题。
 * 这条规则要稳——报错了会让用户去折腾驱动，漏报了只是少一句提示。
 */

test('全开时不报问题', () => {
  assert.deepEqual(gpuProblems({ gpu_compositing: 'enabled', webgl: 'enabled', webgl2: 'enabled' }), [])
})

test('enabled_on / enabled_off 不是故障', () => {
  assert.deepEqual(
    gpuProblems({ gpu_compositing: 'enabled_on', webgl: 'enabled_off', webgl2: 'disabled_off_ok' }),
    []
  )
})

test('软件渲染会被认出来', () => {
  const problems = gpuProblems({ gpu_compositing: 'disabled_software', webgl: 'unavailable_software' })
  assert.equal(problems.length, 2)
  assert.equal(problems[0].feature, 'gpu_compositing')
  assert.equal(problems[0].state, 'disabled_software')
})

test('未知功能名与未知状态都不报', () => {
  assert.deepEqual(gpuProblems({ some_future_feature: 'whatever' }), [])
  assert.deepEqual(gpuProblems({ gpu_compositing: 'enabled' }), [])
})

test('空或缺失输入不报', () => {
  assert.deepEqual(gpuProblems(null), [])
  assert.deepEqual(gpuProblems(undefined), [])
  assert.deepEqual(gpuProblems({}), [])
})

test('摘要：没问题给空串，有问题给一句人话', () => {
  assert.equal(gpuSummary({ gpu_compositing: 'enabled' }), '')
  const line = gpuSummary({ gpu_compositing: 'disabled_software', webgl: 'unavailable_software' })
  assert.match(line, /窗口合成走的是 CPU/)
  assert.match(line, /另有 1 项/)
})
