import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupName,
  buildBackup,
  describeBackup,
  filesToRestore,
  parseBackup
} from '../electron/pure/backup-rules.ts'

test('names the file after the moment it was made', () => {
  const name = backupName(new Date(2026, 10, 16, 1, 5, 0))
  assert.equal(name, 'aurora-backup-20261116-0105.json')
})

test('builds a stamped bundle and drops values that are not text', () => {
  const bundle = buildBackup(
    { 'settings.json': '{}', 'ignored.json': '' },
    { 'aurora.playlists': '[]', bad: 3 as unknown as string },
    new Date('2026-11-16T01:05:00.000Z')
  )
  assert.equal(bundle.format, BACKUP_FORMAT)
  assert.equal(bundle.version, BACKUP_VERSION)
  assert.equal(bundle.createdAt, '2026-11-16T01:05:00.000Z')
  assert.deepEqual(Object.keys(bundle.files).sort(), ['ignored.json', 'settings.json'])
  assert.deepEqual(Object.keys(bundle.storage), ['aurora.playlists'])
})

test('reads its own file back', () => {
  const bundle = buildBackup({ 'settings.json': '{"a":1}' }, { 'aurora.x': 'y' }, new Date())
  const result = parseBackup(JSON.stringify(bundle))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.bundle.files['settings.json'], '{"a":1}')
  assert.equal(result.bundle.storage['aurora.x'], 'y')
})

test('refuses text that is not JSON', () => {
  const result = parseBackup('not json')
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /JSON/)
})

test('refuses somebody else\'s JSON', () => {
  const result = parseBackup(JSON.stringify({ hello: 'world' }))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /Aurora/)
})

test('refuses a newer format instead of guessing', () => {
  const bundle = { ...buildBackup({ 'settings.json': '{}' }, {}, new Date()), version: BACKUP_VERSION + 1 }
  const result = parseBackup(JSON.stringify(bundle))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /更新的版本/)
})

test('refuses an empty bundle', () => {
  const bundle = { ...buildBackup({}, {}, new Date()), files: {}, storage: {} }
  const result = parseBackup(JSON.stringify(bundle))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /空的/)
})

test('restores only the files it owns', () => {
  const bundle = buildBackup(
    { 'settings.json': '{}', '../../evil.json': '{}' },
    {},
    new Date()
  )
  assert.deepEqual(Object.keys(filesToRestore(bundle)), ['settings.json'])
})

test('describes what the file carries', () => {
  const bundle = buildBackup(
    { 'settings.json': '{}', 'library.json': '{}' },
    { 'aurora.a': '1', 'aurora.b': '2' },
    new Date(2026, 10, 16, 1, 5, 0)
  )
  assert.equal(describeBackup(bundle), '2026-11-16 01:05 · 2 项本地数据 · 2 个文件')
})
