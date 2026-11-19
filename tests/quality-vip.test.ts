import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tierAllowed } from '../src/features/online/types.ts'

/*
 * 「按权限开放档位」只有一条规则：明确是非会员才挡，未知与会员都放行。
 * 把未知当没有会让一个会员账号永远看不到无损；把会员当未知则会让非会员
 * 每次都选了才降级——两头都不能错。
 */

const kugou = { qualityNeedsVip: ['lossless'] as const }

test('a member sees every tier', () => {
  assert.equal(tierAllowed(kugou, 'lossless', true), true)
  assert.equal(tierAllowed(kugou, 'standard', true), true)
})

test('an unknown membership is treated as allowed, not as missing', () => {
  assert.equal(tierAllowed(kugou, 'lossless', null), true)
})

test('a confirmed non-member does not get the member tier', () => {
  assert.equal(tierAllowed(kugou, 'lossless', false), false)
  assert.equal(tierAllowed(kugou, 'standard', false), true)
})

test('a platform that declares nothing allows everything', () => {
  assert.equal(tierAllowed({}, 'lossless', false), true)
})
