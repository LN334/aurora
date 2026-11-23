import assert from 'node:assert/strict'
import { test } from 'node:test'
import { otaDirAllowed, otaSuperseded, parseOtaState } from '../electron/pure/ota-renderer.ts'

/*
 * 本机热更的两道闸：state.json 的解析，以及「目录必须在 renderers 之下」。
 * 第二道是安全边界——那是普通文件，谁都能改；没有它，协议会去服务任意目录。
 */

test('a well-formed state points at a renderer directory', () => {
  const state = parseOtaState(JSON.stringify({ dir: 'C:/x/ota/renderers/abc', hash: 'abc' }))
  assert.deepEqual(state, {
    dir: 'C:/x/ota/renderers/abc',
    hash: 'abc',
    version: '',
    at: 0
  })
})

test('the version and the write time ride along when the script recorded them', () => {
  const state = parseOtaState(
    JSON.stringify({
      dir: 'C:/x/ota/renderers/abc',
      hash: 'abc',
      version: '0.9.25',
      at: 1795333949987
    })
  )
  assert.equal(state?.version, '0.9.25')
  assert.equal(state?.at, 1795333949987)
})

test('a state written by the older script still resolves, just without a version', () => {
  assert.equal(parseOtaState(JSON.stringify({ dir: 'C:/x/ota/renderers/abc', hash: 'abc' }))?.version, '')
  assert.equal(parseOtaState(JSON.stringify({ dir: 'C:/x/ota/renderers/abc', at: 'yesterday' }))?.at, 0)
})

test('a newer install supersedes the override', () => {
  const state = { dir: 'C:/x/ota/renderers/abc', hash: 'abc', version: '0.9.25', at: 1 }
  assert.equal(otaSuperseded(state, '0.9.26'), true)
  assert.equal(otaSuperseded(state, '0.10.0'), true)
})

/*
 * 相等不撤：日常「改一行 → build → ota-push → 重启看」根本不 bump 版本，
 * 撤掉就把最常用的那条路堵死了。
 */
test('the same version, an older install, or no recorded version keeps the override', () => {
  const state = { dir: 'C:/x/ota/renderers/abc', hash: 'abc', version: '0.9.25', at: 1 }
  assert.equal(otaSuperseded(state, '0.9.25'), false)
  assert.equal(otaSuperseded(state, '0.9.24'), false)
  assert.equal(otaSuperseded({ ...state, version: '' }, '0.9.26'), false)
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
