/*
 * Finds references to source files that no longer exist at the path written.
 *
 * A repository reorganisation leaves stale paths behind in the places nothing
 * type-checks: measurement scripts, docs, plans, comments. Those failures are
 * quiet - a perf tool that cannot find a module just reports nothing, so the
 * number simply disappears from the report and nobody notices.
 *
 * What this checks: every quoted or backticked string that looks like a path into
 * src/ or electron/, resolved against git's file list. It deliberately ignores
 * strings that resolve to a directory, since those are legitimate.
 *
 * Usage: node scripts/audit-stale-paths.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
/*
 * 用 --others --exclude-standard 把还没 git add 的新文件也列进来，再用 existsSync
 * 去掉已经删掉但还没暂存的文件。少了后半句，删一个文件就会让下面读文件时 ENOENT；
 * 少了前半句，新文件对审计不存在，它用到的 class / 符号会被报成「没人用」。
 */
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)
  .filter((file) => fs.existsSync(path.join(root, file)))

const trackedSet = new Set(tracked)
/** Directories that exist, so a path into one is not stale. */
const dirs = new Set()
for (const file of tracked) {
  const parts = file.split('/')
  for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'))
}

/** Files worth scanning (skip binaries and lockfiles by extension). */
const scanned = tracked.filter(
  (file) =>
    /\.(ts|tsx|mjs|cjs|js|md|json|css|html)$/.test(file) &&
    file !== 'package-lock.json'
)

/** Files whose `usage:` examples show made-up paths. */
const EXAMPLE_FILES = new Set(['scripts/audit-stale-paths.mjs'])

/*
 * 计划文档先写还没建的文件，这是它们的用处，不是失效引用。只放行这一份：
 * roadmap 描述的是下一步要新建的模块，写路径比写「那个匹配器」更可查。
 * 一旦某个路径已经建成、又被挪走，这份白名单同样会漏报——所以别往里加。
 */
const PLAN_FILES = new Set(['docs/roadmap.md'])

/*
 * Longest meaningful source path in a string.
 *
 * The extension alternation is written `tsx?`, not `ts|tsx`: this pattern is
 * not anchored at the end, so a shorter `ts` alternative would match the first
 * two letters of `foo.tsx` and the audit would report every `.tsx` reference as
 * a stale `.ts` one. That is the false-positive class this ordering removes, and
 * it is load-bearing rather than cosmetic: those reports can never be fixed by
 * editing the referenced text.
 */
const PATH_PATTERN = /(?:^|[\s'"(=`])((?:src|electron)\/[A-Za-z0-9_./-]+\.(?:tsx?|css|mjs|cjs))/g

const stale = []
for (const file of scanned) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  // A `usage:` line in tooling shows a path that is not meant to exist.
  const lines = text.split('\n')
  for (const match of text.matchAll(PATH_PATTERN)) {
    const candidate = match[1]
    if (trackedSet.has(candidate) || dirs.has(candidate)) continue
    const line = text.slice(0, match.index).split('\n').length
    if (PLAN_FILES.has(file)) continue
    if (EXAMPLE_FILES.has(file) && /\busage\b|^ \*/i.test(lines[line - 1] ?? '')) continue
    stale.push({ file, line, candidate })
  }
}

if (stale.length === 0) {
  console.log('✓ 没有指向已不存在文件的路径引用')
} else {
  console.log(`发现 ${stale.length} 处指向已不存在文件的引用：\n`)
  let current = ''
  for (const item of stale.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (item.file !== current) {
      current = item.file
      console.log(`  ${current}`)
    }
    console.log(`    L${item.line}  ${item.candidate}`)
  }
}
