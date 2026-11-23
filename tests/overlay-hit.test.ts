import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pointInBox, pollHover, shouldShowControls, shouldTakeOver } from '../electron/pure/overlay-hit.ts'

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

/*
 * 轮询接线。
 *
 * 上一版主进程里 `if (locked || !hoverTakesOver()) return` 让整段判定变成死代码：
 * 锁上之后指针位置根本不读，控制条永不出现，用户也就点不到那颗解锁键。纯函数
 * 的旧测试测不到这一层，所以判定本身有了入口 pollHover。
 */

test('锁定 + 指针在歌词上：控制条浮出来，但仍然穿透', () => {
  const result = pollHover({
    locked: true,
    hoverControls: true,
    point: { x: 500, y: 90 },
    origin,
    hitArea: words,
    toolbarArea: toolbar
  })
  assert.equal(result.hovering, true)
  assert.equal(result.pointerInToolbar, false)
  assert.equal(result.takeOver, false)
})

test('锁定 + 指针在控制条上：控制条在，且这一块接管鼠标', () => {
  const result = pollHover({
    locked: true,
    hoverControls: true,
    point: { x: 600, y: 170 },
    origin,
    hitArea: words,
    toolbarArea: toolbar
  })
  assert.deepEqual(result, { hovering: true, pointerInToolbar: true, takeOver: true })
})

test('锁定 + 关掉悬停接管：既不显示控制条也不接管', () => {
  const result = pollHover({
    locked: true,
    hoverControls: false,
    point: { x: 600, y: 170 },
    origin,
    hitArea: words,
    toolbarArea: toolbar
  })
  assert.deepEqual(result, { hovering: false, pointerInToolbar: false, takeOver: false })
})

test('解锁时轮询不改变任何判定：整窗接管', () => {
  const result = pollHover({
    locked: false,
    hoverControls: true,
    point: { x: 600, y: 170 },
    origin,
    hitArea: null,
    toolbarArea: null
  })
  assert.deepEqual(result, { hovering: false, pointerInToolbar: false, takeOver: true })
})
