import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChangelog } from '../src/features/updates/changelog.ts'

const RAW = `# 更新日志

每个版本改了什么。

## 未发布

### 壁纸

- 还没发版的东西不该被当成这一版。

## 0.9.0 — 2026-11-20

### 启动

- 第一个版本标题下面这一条。
- **加粗**与\`代码\`要去掉标记。

### 壁纸

- 第二组的条目。

## 0.8.1 — 2026-11-15

### 更新提示

- 上一版的条目。
`

test('parseChangelog takes the newest version block and stops at the next one', () => {
  const entry = parseChangelog(RAW)
  assert.ok(entry)
  assert.equal(entry.version, '0.9.0')
  assert.deepEqual(
    entry.sections.map((section) => section.title),
    ['启动', '壁纸']
  )
  assert.deepEqual(entry.sections[0].items, [
    '第一个版本标题下面这一条。',
    '加粗与代码要去掉标记。'
  ])
  /* 未发布段与更老的版本都不应该混进来。 */
  assert.equal(entry.sections[1].items.length, 1)
})

test('parseChangelog returns null when the asked-for version is not the newest', () => {
  /* CHANGELOG 忘了写新版本时，宁可不出公告，也不能拿上一版的改动冒充。 */
  assert.equal(parseChangelog(RAW, '0.9.9'), null)
  assert.equal(parseChangelog(RAW, '0.8.1'), null)
})

test('parseChangelog accepts the version it was asked for', () => {
  const entry = parseChangelog(RAW, '0.9.0')
  assert.equal(entry?.version, '0.9.0')
})

test('parseChangelog drops groups that have no items and empty input', () => {
  const raw = `# 更新日志

## 1.0.0

### 空的

### 有内容

- 一条。
`
  const entry = parseChangelog(raw)
  assert.ok(entry)
  assert.deepEqual(entry.sections.map((section) => section.title), ['有内容'])
  assert.equal(parseChangelog('没有版本标题'), null)
  assert.equal(parseChangelog('## 1.0.0\n\n### 空\n'), null)
})

test('parseChangelog accepts a leading v on the version heading', () => {
  const entry = parseChangelog('## v1.2.3\n\n### 改动\n\n- 一条。\n', '1.2.3')
  assert.equal(entry?.version, '1.2.3')
})
