import { app, dialog } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_FILES,
  backupName,
  buildBackup,
  describeBackup,
  filesToRestore,
  parseBackup
} from './pure/backup-rules'

/**
 * 备份与恢复。
 *
 * 导出：把数据目录里属于「人」的那几个 JSON 与渲染层的持久化键打成一个文件。
 * 导入：先校验格式，再把同名的旧文件挪进 `backup-before-restore/`，最后写回。
 *
 * 会话文件不在名单里 —— 它们装的是各家平台的 cookie，换机没有意义，而一个顺手
 * 带上凭据的「备份」等于把登录态摊在别人的硬盘上。
 */

export type BackupExportResult =
  | { ok: true; path: string; summary: string }
  | { ok: false; reason: string }

export type BackupRestoreResult =
  | { ok: true; storage: Record<string, string>; summary: string; kept: string }
  | { ok: false; reason: string }

function dataDir(): string {
  return app.getPath('userData')
}

/** 默认落到「文档」；没有这个目录的机器退回数据目录。 */
function defaultFolder(): string {
  try {
    return app.getPath('documents')
  } catch {
    return dataDir()
  }
}

async function readOwned(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of BACKUP_FILES) {
    try {
      out[name] = await readFile(path.join(dataDir(), name), 'utf8')
    } catch {
      // 没有这个文件就没这一项：settings.json 都可能缺席，不该因此拒绝导出。
    }
  }
  return out
}

export async function exportBackup(storage: Record<string, string>): Promise<BackupExportResult> {
  const now = new Date()
  const picked = await dialog.showSaveDialog({
    title: '保存备份',
    defaultPath: path.join(defaultFolder(), backupName(now)),
    filters: [{ name: 'Aurora 备份', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePath) return { ok: false, reason: '已取消' }

  const bundle = buildBackup(await readOwned(), storage ?? {}, now)
  const text = JSON.stringify(bundle, null, 2)
  await writeFile(picked.filePath, text, 'utf8')
  return { ok: true, path: picked.filePath, summary: describeBackup(bundle) }
}

export async function restoreBackup(): Promise<BackupRestoreResult> {
  const picked = await dialog.showOpenDialog({
    title: '选择备份文件',
    defaultPath: defaultFolder(),
    properties: ['openFile'],
    filters: [{ name: 'Aurora 备份', extensions: ['json'] }]
  })
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: '已取消' }

  let text: string
  try {
    text = await readFile(picked.filePaths[0], 'utf8')
  } catch {
    return { ok: false, reason: '读不到这个文件' }
  }

  const parsed = parseBackup(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }

  /*
   * 覆盖之前先留一份现场。
   *
   * 导入是唯一会改动现有数据的操作；写坏了没有撤销键，所以旧文件先整份挪进
   * `backup-before-restore/`，出问题还能手动拿回来。
   */
  const kept = path.join(dataDir(), 'backup-before-restore')
  await mkdir(kept, { recursive: true })
  const existing = await readOwned()
  for (const [name, content] of Object.entries(existing)) {
    await writeFile(path.join(kept, name), content, 'utf8')
  }

  const files = filesToRestore(parsed.bundle)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dataDir(), name), content, 'utf8')
  }

  return {
    ok: true,
    storage: parsed.bundle.storage,
    summary: describeBackup(parsed.bundle),
    kept
  }
}
