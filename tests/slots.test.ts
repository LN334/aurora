import assert from 'node:assert/strict'
import test from 'node:test'
import { fillSlots, groupRows, SLOTS } from '../src/features/online/slots.ts'

/** 一家的货架：name-0 … name-(count-1)。 */
function shelf(name: string, count: number): string[] {
  return Array.from({ length: count }, (_, at) => name + '-' + at)
}

test('fillSlots 轮转着填，一行里各家都有', () => {
  const rows = fillSlots([shelf('ne', 2), shelf('qq', 2), shelf('kg', 2)], 6)
  assert.deepEqual(rows, ['ne-0', 'qq-0', 'kg-0', 'ne-1', 'qq-1', 'kg-1'])
})

test('关掉一家平台，别家把位置补上，总数不变', () => {
  const four = [shelf('ne', 40), shelf('qq', 40), shelf('kg', 40), shelf('qs', 40)]
  // 四家各四十张，槽位二十四。
  assert.equal(fillSlots(four, SLOTS.playlist).length, SLOTS.playlist)
  // 关掉两家（剩两家的货架仍然够），总数还是二十四。
  assert.equal(fillSlots(four.slice(0, 2), SLOTS.playlist).length, SLOTS.playlist)
  // 只剩一家也够：它自己补满。
  assert.equal(fillSlots([four[0]], SLOTS.playlist).length, SLOTS.playlist)
})

test('一家的货架先见底，剩下的位置由别家继续填', () => {
  const rows = fillSlots([shelf('ne', 1), shelf('qq', 9)], 6)
  assert.equal(rows.length, 6)
  assert.equal(rows[0], 'ne-0')
  assert.equal(new Set(rows).size, 6)
  assert.ok(rows.filter((row) => row.startsWith('qq')).length === 5)
})

test('所有货架都见底就提前收，不拿重复项凑数', () => {
  const rows = fillSlots([shelf('ne', 2), shelf('qq', 1)], 24)
  assert.equal(rows.length, 3)
  assert.equal(new Set(rows).size, 3)
})

test('空池子与零槽位都返回空数组', () => {
  assert.deepEqual(fillSlots([], 24), [])
  assert.deepEqual(fillSlots([shelf('ne', 3)], 0), [])
  assert.deepEqual(fillSlots([[], []], 24), [])
})

test('槽位表是产品规格，不随开关变化', () => {
  // 改这几个数等于改首页的排数，测试盯住它们别再被「每家出几张」的写法带跑。
  // 2026-11：推荐专辑从六列小卡（18 张）改成一行可左右翻的横条（12 张）——歌单已经
  // 是一堵封面墙了，两堵同形的墙看不出区别；新歌从六行加到十二行，展示从一张
  // 表改成「左主推 + 右十一行」。两处都是产品规格，改了就要一起改这里。
  assert.equal(SLOTS.daily, 30)
  assert.equal(SLOTS.playlist, 24)
  assert.equal(SLOTS.album, 12)
  assert.equal(SLOTS.fresh, 12)
  assert.equal(SLOTS.roam, 20)
})

test('groupRows 按首次遇到的顺序分组', () => {
  const rows = [
    { id: 1, from: 'qq' },
    { id: 2, from: 'ne' },
    { id: 3, from: 'qq' }
  ]
  const groups = groupRows(rows, (row) => row.from)
  assert.deepEqual([...groups.keys()], ['qq', 'ne'])
  assert.deepEqual(groups.get('qq')?.map((row) => row.id), [1, 3])
})
