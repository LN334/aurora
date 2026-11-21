import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/*
 * 崩溃标记的读写与「只提示一次」。
 *
 * installCrashGuard 会往当前进程挂 process.on，测试里不装它——这里只验标记
 * 文件这一半：写下去之后读得到、读完就没了、正常退出清理也生效。
 */
import { clearCrashMarker, installCrashGuard, takeCrashReport } from '../electron/crash-guard.ts'

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-crash-'))
}

test('没有标记时返回 null', () => {
  const dir = freshDir()
  installCrashGuard(dir, () => {})
  assert.equal(takeCrashReport(), null)
  clearCrashMarker()
})

test('读完就清掉，只提示一次', () => {
  const dir = freshDir()
  installCrashGuard(dir, () => {})
  fs.writeFileSync(path.join(dir, 'crash.txt'), '2026-11-21T22:00:00.000Z\n[uncaughtException] boom', 'utf8')

  const first = takeCrashReport()
  assert.ok(first, '第一次应该读到')
  assert.equal(first.at, '2026-11-21T22:00:00.000Z')
  assert.equal(first.summary, '[uncaughtException] boom')

  assert.equal(takeCrashReport(), null, '第二次不该再报')
})

test('正常退出清理掉标记之后不会再提示', () => {
  const dir = freshDir()
  installCrashGuard(dir, () => {})
  fs.writeFileSync(path.join(dir, 'crash.txt'), '2026-11-21T22:00:00.000Z\n[x] y', 'utf8')
  clearCrashMarker()
  assert.equal(takeCrashReport(), null)
})
