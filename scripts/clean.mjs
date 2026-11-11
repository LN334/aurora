/*
 * 清掉本机的构建产物、探针输出与安装包。默认只删「能重新生成」的东西；
 * 安装包与探针用的账号副本要显式加参数才动。
 *
 * 用法:
 *   node scripts/clean.mjs                    构建产物 + 巡检/探针截图与日志
 *   node scripts/clean.mjs --dry              只报会删什么、占多少
 *   node scripts/clean.mjs --releases         release* 目录（安装包产物）
 *   node scripts/clean.mjs --probes           .probe-profile/ 与根目录 .probe-* 产物
 *   node scripts/clean.mjs --refs             .refs/（抓下来的参考仓库源码）
 *   node scripts/clean.mjs --all              以上全部
 *
 * 这个脚本只删仓库根目录下的固定名字，且删除前校验 realpath 的父目录仍是仓库根，
 * 免得 cwd 错了或某条路径是符号链接时把别处的东西删掉。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = fs.realpathSync(process.cwd())
const dry = process.argv.includes('--dry')
const all = process.argv.includes('--all')
const withReleases = all || process.argv.includes('--releases')
const withProbes = all || process.argv.includes('--probes')
const withRefs = all || process.argv.includes('--refs')

const targets = [
  ...['dist', 'dist-electron', 'dist-preview', 'dist-preview-overlay', 'preview-dist'].map((name) => ({ name, why: '构建产物' })),
  ...['shots', '.smoke', '.perf'].map((name) => ({ name, why: '巡检与性能探针输出' })),
  ...['build-probe.log'].map((name) => ({ name, why: '探针日志' }))
]

if (withReleases) {
  // 除了 release/，electron-builder 也可能被 -c.directories.output 指到 release-xxx/，一并认。
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith('release')) continue
    let stat
    try {
      stat = fs.statSync(path.join(root, entry))
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    targets.push({ name: entry, why: '安装包产物' })
  }
}
if (withProbes) {
  targets.push({ name: '.probe-profile', why: '探针用的账号副本' })
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith('.probe-')) continue
    if (entry === '.probe-profile') continue // 上面已经单列
    if (entry.endsWith('.mjs') || entry.endsWith('.cjs')) continue // 探针脚本本身留着
    targets.push({ name: entry, why: '探针产物' })
  }
}
if (withRefs) targets.push({ name: '.refs', why: '参考仓库源码摘录' })

function sizeOf(target) {
  let bytes = 0
  let files = 0
  const stack = [target]
  while (stack.length > 0) {
    const current = stack.pop()
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      let entries = []
      try {
        entries = fs.readdirSync(current)
      } catch {
        continue
      }
      for (const entry of entries) stack.push(path.join(current, entry))
    } else {
      bytes += stat.size
      files += 1
    }
  }
  return { bytes, files }
}

function human(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

let removed = 0
let freed = 0
let kept = 0

for (const target of targets) {
  const full = path.resolve(root, target.name)
  if (!fs.existsSync(full)) continue

  // 只允许删仓库根目录下的直属条目。
  const parent = fs.realpathSync(path.dirname(full))
  if (parent !== root) {
    console.error('跳过（不在仓库根目录下）: ' + full)
    kept += 1
    continue
  }
  const base = path.basename(full)
  if (base !== target.name) {
    console.error('跳过（realpath 名字变了，疑似符号链接）: ' + full + ' -> ' + base)
    kept += 1
    continue
  }

  const { bytes, files } = sizeOf(full)
  const label = '  ' + target.name.padEnd(24) + human(bytes).padStart(9) + '  ' + String(files).padStart(6) + ' 个文件  ' + target.why
  if (dry) {
    console.log('[dry] ' + label.trim())
    freed += bytes
    continue
  }
  try {
    fs.rmSync(full, { recursive: true, force: true })
    console.log('删除 ' + label.trim())
    removed += 1
    freed += bytes
  } catch (error) {
    console.error('删除失败: ' + target.name + ' -> ' + (error instanceof Error ? error.message : String(error)))
    kept += 1
  }
}

if (removed === 0 && freed === 0) {
  console.log('没有需要清理的东西。')
} else {
  console.log('')
  console.log((dry ? '会释放 ' : '已释放 ') + human(freed) + (kept > 0 ? '，' + kept + ' 项跳过' : ''))
}
if (!withReleases) console.log('安装包未动（需要时加 --releases）。')
if (!withProbes) console.log('探针账号副本未动（需要时加 --probes）。')
