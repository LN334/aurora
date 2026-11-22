import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toast, useToast } from '../src/ui/toast.ts'

/*
 * 提示的排队规则。
 *
 * 这里能测的只有「排几条、留哪条、怎么收」——颜色、位移和动画在样式表里，靠
 * 截图看。排队规则恰恰最容易出问题：同一条动作连点几次会叠成一列、旧提示挤掉
 * 刚弹出的那条、或者退场动画还没放完卡片就被拔掉。
 */

/** 每个测试都从空列开始；直接清空，不走退场，免得上一轮的定时器串到这一轮。 */
function reset() {
  useToast.setState({ items: [] })
}

test('a toast shows up and can be dismissed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  reset()
  const id = toast('已收藏')
  assert.equal(useToast.getState().items.length, 1)
  assert.equal(useToast.getState().items[0]?.message, '已收藏')
  useToast.getState().dismiss(id)
  assert.equal(useToast.getState().items.length, 0 + 1, 'it fades out before it goes')
  assert.equal(useToast.getState().items[0]?.leaving, true)
  t.mock.timers.tick(250)
  assert.equal(useToast.getState().items.length, 0)
})

test('an empty message is dropped instead of leaving a blank card', (t) => {
  reset()
  toast('   ')
  assert.equal(useToast.getState().items.length, 0)
})

test('the same key replaces the previous one instead of stacking', (t) => {
  reset()
  toast({ message: '正在收藏', key: 'like' })
  toast({ message: '已收藏', key: 'like' })
  const items = useToast.getState().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.message, '已收藏')
})

test('at most four stay on screen, and the oldest goes first', (t) => {
  reset()
  for (const text of ['一', '二', '三', '四', '五']) toast(text)
  const messages = useToast.getState().items.map((item) => item.message)
  assert.deepEqual(messages, ['二', '三', '四', '五'])
})

test('a tone is carried through, and defaults to info', (t) => {
  reset()
  toast('普通')
  toast({ message: '失败', tone: 'error' })
  assert.deepEqual(
    useToast.getState().items.map((item) => item.tone),
    ['info', 'error']
  )
})

test('clear() fades everything out, then empties the stack', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  reset()
  toast('一')
  toast('二')
  useToast.getState().clear()
  assert.equal(useToast.getState().items.length, 2, 'still there while fading')
  assert.ok(useToast.getState().items.every((item) => item.leaving === true))
  t.mock.timers.tick(250)
  assert.equal(useToast.getState().items.length, 0)
})
