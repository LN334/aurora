import assert from 'node:assert/strict'
import { test } from 'node:test'
import { memoryLine, summarizeMemory, typeName } from '../electron/pure/app-metrics.ts'

/*
 * 内存聚合：界面只显示一行，所以「合计多少、分到哪、几个进程」要一次说清。
 */

const rows = [
  { type: 'Browser', workingSetKb: 320 * 1024, pid: 1 },
  { type: 'GPU', workingSetKb: 150 * 1024, pid: 2 },
  { type: 'Tab', workingSetKb: 280 * 1024, pid: 3 },
  { type: 'Utility', workingSetKb: 50 * 1024, pid: 4 }
]

test('按类型求和，并按占用从大到小排', () => {
  const summary = summarizeMemory(rows)
  assert.equal(summary.totalMb, 800)
  assert.deepEqual(
    summary.byType.map((item) => item.type),
    ['Browser', 'Tab', 'GPU', 'Utility']
  )
})

test('同类型多个进程累加，进程数也跟着涨', () => {
  const summary = summarizeMemory([
    { type: 'Tab', workingSetKb: 100 * 1024, pid: 3 },
    { type: 'Tab', workingSetKb: 40 * 1024, pid: 5 }
  ])
  assert.equal(summary.totalMb, 140)
  assert.equal(summary.byType[0].processes, 2)
  assert.equal(summary.processes, 2)
})

test('0 或负值的进程跳过，不参与平均也不占位', () => {
  const summary = summarizeMemory([
    { type: 'Tab', workingSetKb: 0, pid: 1 },
    { type: 'GPU', workingSetKb: -5, pid: 2 },
    { type: 'Browser', workingSetKb: 10 * 1024, pid: 3 }
  ])
  assert.equal(summary.processes, 1)
  assert.equal(summary.byType.length, 1)
  assert.equal(summary.totalMb, 10)
})

test('空输入给 0 与空串', () => {
  const summary = summarizeMemory([])
  assert.equal(summary.totalMb, 0)
  assert.equal(memoryLine(summary), '')
})

test('类型名翻成中文，未知类型原样', () => {
  assert.equal(typeName('Browser'), '主进程')
  assert.equal(typeName('Tab'), '渲染进程')
  assert.equal(typeName('SomethingNew'), 'SomethingNew')
})

test('一行文案含合计、进程数与分项', () => {
  const line = memoryLine(summarizeMemory(rows))
  assert.match(line, /合计 800 MB（4 个进程）/)
  assert.match(line, /主进程 320 MB/)
  assert.match(line, /渲染进程 280 MB/)
})
