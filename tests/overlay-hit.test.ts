import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pointInBox, shouldShowControls, shouldTakeOver } from '../electron/pure/overlay-hit.ts'

/*
 * 桌面歌词的三条规则，用测试钉住：
 *  - 锁定时歌词文字也要穿透（鼠标落到桌面）；
 *  - 锁定时只有控制条那一块接管；
 *  - 控制条浮出来不改变穿透。
 */

const toolbar = { x: 400, y: 100, width: 200, height: 40 }
const words = { x: 200, y: 20, width: 600, height: 60 }
const origin = { x: 100, y: 50 }

test('落在控制条里算命中', () => {
  assert.equal(pointInBox({ x: 600, y: 170 }, origin, toolbar), true)
})

test('落在歌词文字里不算控制条命中', () => {
  assert.equal(pointInBox({ x: 600, y: 170 }, origin, words), false)
})

test('留了 4px 余量：贴着边缘也算', () => {
  assert.equal(pointInBox({ x: 400 - 3 + 100, y: 100 - 3 + 50 }, origin, toolbar), true)
})

test('未锁定：整窗接管', () => {
  assert.equal(shouldTakeOver({ locked: false, hoverControls: true, pointerInToolbar: false }), true)
})

test('锁定 + 指针在歌词上：穿透（这是用户要的关键一条）', () => {
  assert.equal(shouldTakeOver({ locked: true, hoverControls: true, pointerInToolbar: false }), false)
})

test('锁定 + 指针在控制条上：接管，好让用户点得到', () => {
  assert.equal(shouldTakeOver({ locked: true, hoverControls: true, pointerInToolbar: true }), true)
})

test('锁定 + 关掉悬停开关：一律穿透', () => {
  assert.equal(shouldTakeOver({ locked: true, hoverControls: false, pointerInToolbar: true }), false)
})

test('解锁时常显控制条，锁定后只在悬停时显示', () => {
  assert.equal(shouldShowControls({ locked: false, hovering: false }), true)
  assert.equal(shouldShowControls({ locked: true, hovering: false }), false)
  assert.equal(shouldShowControls({ locked: true, hovering: true }), true)
})

test('歌词区命中不影响接管判定（它只用来决定控制条显不显示）', () => {
  const onWords = pointInBox({ x: 500, y: 90 }, origin, words)
  assert.equal(onWords, true)
  assert.equal(shouldTakeOver({ locked: true, hoverControls: true, pointerInToolbar: false }), false)
})
