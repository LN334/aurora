import assert from 'node:assert/strict'
import { test } from 'node:test'
import { otaDirAllowed, parseOtaState } from '../electron/pure/ota-renderer.ts'

/*
 * 本机热更的两道闸：state.json 的解析，以及「目录必须在 renderers 之下」。
 * 第二道是安全边界——那是普通文件，谁都能改；没有它，协议会去服务任意目录。
 */

test('a well-formed state points at a renderer directory', () => {
  const state = parseOtaState(JSON.stringify({ dir: 'C:/x/ota/renderers/abc', hash: 'abc' }))
  assert.deepEqual(state, { dir: 'C:/x/ota/renderers/abc', hash: 'abc' })
})

test('broken JSON, empty text and missing dir all mean "no override"', () => {
  assert.equal(parseOtaState(''), null)
  assert.equal(parseOtaState('{'), null)
  assert.equal(parseOtaState('null'), null)
  assert.equal(parseOtaState('[]'), null)
  assert.equal(parseOtaState(JSON.stringify({ hash: 'abc' })), null)
  assert.equal(parseOtaState(JSON.stringify({ dir: '   ' })), null)
})

test('a directory under renderers is allowed', () => {
  const root = 'C:/Users/PC/AppData/Roaming/aurora-player/ota/renderers'
  assert.equal(otaDirAllowed(root + '/abc123', root), true)
})

test('a sibling that merely starts with the same name is refused', () => {
  const root = 'C:/Users/PC/AppData/Roaming/aurora-player/ota/renderers'
  assert.equal(otaDirAllowed(root + '-evil/x', root), false)
})

test('the renderers root itself is refused — only a versioned child is served', () => {
  const root = 'C:/Users/PC/AppData/Roaming/aurora-player/ota/renderers'
  assert.equal(otaDirAllowed(root, root), false)
})

test('traversal out of renderers is refused', () => {
  const root = 'C:/Users/PC/AppData/Roaming/aurora-player/ota/renderers'
  assert.equal(otaDirAllowed(root + '/../../../Windows', root), false)
})
