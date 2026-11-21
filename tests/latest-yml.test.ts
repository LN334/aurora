import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLatestYml } from '../electron/pure/latest-yml.ts'

/** electron-builder 实际写出来的形状。 */
const REAL = `version: 0.9.8
files:
  - url: Aurora-0.9.8-Setup.exe
    sha512: eqvKlqNqzpj8zdJG/DIqvPz7athfTn7havo4/rNfmoJrQvvv6D/XpY7RuGAHKeQf+S54uBE/ZYDdqqRZtMIfhA==
    size: 120938849
path: Aurora-0.9.8-Setup.exe
sha512: eqvKlqNqzpj8zdJG/DIqvPz7athfTn7havo4/rNfmoJrQvvv6D/XpY7RuGAHKeQf+S54uBE/ZYDdqqRZtMIfhA==
releaseDate: '2026-11-20T17:50:15.979Z'
`

test('从 latest.yml 里取到文件名、sha512、大小', () => {
  const parsed = parseLatestYml(REAL)
  assert.equal(parsed?.url, 'Aurora-0.9.8-Setup.exe')
  assert.equal(parsed?.sha512.startsWith('eqvKlqNqzpj8zdJG'), true)
  assert.equal(parsed?.sha512.length, 88)
  assert.equal(parsed?.size, 120938849)
})

test('只有顶层字段的老格式也能取到', () => {
  const parsed = parseLatestYml("path: app.exe\nsha512: abc==\nreleaseDate: '2026-01-01T00:00:00.000Z'\n")
  assert.deepEqual(parsed, { url: 'app.exe', sha512: 'abc==', size: 0 })
})

test('files 里没有 sha512 时退回顶层的那个', () => {
  const parsed = parseLatestYml('files:\n  - url: app.exe\n    size: 12\nsha512: top==\n')
  assert.equal(parsed?.sha512, 'top==')
  assert.equal(parsed?.size, 12)
})

test('空白内容不编出一个文件来', () => {
  assert.equal(parseLatestYml(''), null)
  assert.equal(parseLatestYml('version: 1.0.0\n'), null)
})

test('带引号的字段会去掉引号', () => {
  const parsed = parseLatestYml('files:\n  - url: "app.exe"\n    sha512: \'abc==\'\n')
  assert.equal(parsed?.url, 'app.exe')
  assert.equal(parsed?.sha512, 'abc==')
})
