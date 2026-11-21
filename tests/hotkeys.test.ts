import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comboOf, isModifierCode } from '../src/features/hotkeys/binding.ts'

/*
 * 快捷键录制的两条规矩：
 *  - 修饰键自己按下去不是一个组合（按 Ctrl+K 时 ControlLeft 先来一条）；
 *  - 组合串要是 Mod+Alt+Shift+Code 的形式，交给 prettyCombo 显示。
 */

test('修饰键的 code 被认出来', () => {
  for (const code of ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']) {
    assert.equal(isModifierCode(code), true, code + ' 应算修饰键')
  }
})

test('普通键不算修饰键', () => {
  for (const code of ['KeyK', 'KeyJ', 'Digit1', 'F11', 'ArrowRight', 'Space']) {
    assert.equal(isModifierCode(code), false, code + ' 不该算修饰键')
  }
})

test('组合串按 Mod/Alt/Shift/Code 排列', () => {
  const combo = comboOf({ code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })
  assert.equal(combo, 'Mod+KeyK')
})

test('三键组合也能拼出来', () => {
  const combo = comboOf({ code: 'KeyK', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true })
  assert.equal(combo, 'Mod+Alt+Shift+KeyK')
})

test('什么都不按的单键就是它自己', () => {
  assert.equal(comboOf({ code: 'KeyJ', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }), 'KeyJ')
})
