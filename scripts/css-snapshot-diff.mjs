import fs from 'node:fs'

/*
 * 比较两份样式快照，打印差异。
 *
 * 用法：node scripts/css-snapshot-diff.mjs <基线.json> <新.json>
 *
 * 退出码：0 无差异，1 有差异。适合放进「拆 CSS 之后」的验证步骤。
 */
const [before, after] = process.argv.slice(2)
if (!before || !after) {
  console.error('用法: node scripts/css-snapshot-diff.mjs <基线.json> <新.json>')
  process.exit(2)
}

const a = JSON.parse(fs.readFileSync(before, 'utf8'))
const b = JSON.parse(fs.readFileSync(after, 'utf8'))

if (a.length !== b.length) {
  console.log('元素数量不同:', a.length, '->', b.length)
}

const diffs = []
const limit = Math.min(a.length, b.length)
for (let i = 0; i < limit; i += 1) {
  const x = a[i]
  const y = b[i]
  if (x.path !== y.path) {
    diffs.push({ index: i, what: 'path', before: x.path, after: y.path })
    continue
  }
  for (const key of ['x', 'y', 'w', 'h']) {
    if (x[key] !== y[key]) diffs.push({ index: i, path: x.path, what: key, before: x[key], after: y[key] })
  }
  for (const prop of Object.keys(x.values)) {
    if (x.values[prop] !== y.values[prop]) {
      diffs.push({ index: i, path: x.path, what: prop, before: x.values[prop], after: y.values[prop] })
    }
  }
}

if (diffs.length === 0) {
  console.log('渲染没有变化：', limit, '个元素的几何与计算样式完全一致')
  process.exit(0)
}
console.log('差异', diffs.length, '处，前 20 条：')
for (const d of diffs.slice(0, 20)) {
  console.log('  [' + d.index + '] ' + d.path + ' · ' + d.what + ': ' + JSON.stringify(d.before) + ' -> ' + JSON.stringify(d.after))
}
process.exit(1)
