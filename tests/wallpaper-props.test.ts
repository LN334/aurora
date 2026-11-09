import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coercePropertyValue,
  colorToHex,
  hexToColor,
  propertyValues
} from '../src/features/wallpaper/pure.ts'
import type { WallpaperProperty } from '../src/env.ts'

const slider: WallpaperProperty = {
  name: 'glow',
  type: 'slider',
  text: '发光强度',
  value: 0.9,
  min: 0.5,
  max: 2,
  step: 0.001
}

const color: WallpaperProperty = {
  name: 'tint',
  type: 'color',
  text: '配色',
  value: '1 1 1'
}

const flag: WallpaperProperty = { name: 'hdr', type: 'bool', text: 'HDR 关闭', value: true }
const combo: WallpaperProperty = {
  name: 'mode',
  type: 'combo',
  text: '模式',
  value: 'b',
  options: [
    { label: '甲', value: 'a' },
    { label: '乙', value: 'b' }
  ]
}

test('colorToHex 把 "r g b" 浮点串转成 #rrggbb', () => {
  assert.equal(colorToHex('1 1 1'), '#ffffff')
  assert.equal(colorToHex('0 0 0'), '#000000')
  assert.equal(colorToHex('0.5 0 0'), '#800000')
})

test('colorToHex 对坏值退回白色而不是 NaN', () => {
  assert.equal(colorToHex(''), '#ffffff')
  assert.equal(colorToHex('nope'), '#ffffff')
  assert.equal(colorToHex(undefined), '#ffffff')
})

test('hexToColor 往返保持同一个颜色', () => {
  assert.equal(hexToColor('#ffffff'), '1.000 1.000 1.000')
  assert.equal(hexToColor('#000000'), '0.000 0.000 0.000')
  // 取色器只给 8 位精度，转回去再转回来必须稳定。
  assert.equal(colorToHex(hexToColor('#7f3a10')), '#7f3a10')
})

test('hexToColor 对坏输入退回白色', () => {
  assert.equal(hexToColor('rgb(1,2,3)'), '1 1 1')
})

test('coercePropertyValue 把滑块夹在工程声明的范围内', () => {
  assert.equal(coercePropertyValue(slider, 5), 2)
  assert.equal(coercePropertyValue(slider, 0), 0.5)
  assert.equal(coercePropertyValue(slider, '1.2'), 1.2)
  assert.equal(coercePropertyValue(slider, 'abc'), null)
  assert.equal(coercePropertyValue(slider, Number.NaN), null)
})

test('coercePropertyValue 只接受布尔给开关', () => {
  assert.equal(coercePropertyValue(flag, false), false)
  assert.equal(coercePropertyValue(flag, 'false'), null)
})

test('coercePropertyValue 让下拉只收字符串', () => {
  assert.equal(coercePropertyValue(combo, 'a'), 'a')
  // 存下来的值可能被手改坏了；认不出来的原样交回去，由 propertyValues 退回默认值。
  assert.equal(coercePropertyValue(combo, true), null)
})

test('propertyValues 没有覆盖值时就是工程默认值', () => {
  const values = propertyValues([slider, flag, combo], undefined)
  assert.deepEqual(values, { glow: 0.9, hdr: true, mode: 'b' })
})

test('propertyValues 用用户的覆盖值盖掉默认值', () => {
  const values = propertyValues([slider, flag], { glow: 1.4, hdr: false })
  assert.deepEqual(values, { glow: 1.4, hdr: false })
})

test('propertyValues 丢掉认不出来的覆盖值，回落到默认值', () => {
  const values = propertyValues([slider, flag], { glow: 'abc', hdr: 'yes' })
  assert.deepEqual(values, { glow: 0.9, hdr: true })
})

test('propertyValues 不会把上一张壁纸的键带过去', () => {
  // 存的是 {其它属性名: 值}，这张壁纸没有那一项，就不该出现在这次的表里。
  const values = propertyValues([slider], { notMine: 1 })
  assert.deepEqual(values, { glow: 0.9 })
})

test('propertyValues 对没有属性的工程返回空表', () => {
  assert.deepEqual(propertyValues(undefined, { glow: 1 }), {})
  assert.deepEqual(propertyValues([], undefined), {})
})
