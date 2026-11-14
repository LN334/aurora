/**
 * 封面磁盘缓存的淘汰规则。
 *
 * 单独抽出来是为了能测：真正的清理要 readdir + stat + unlink，跑起来是 I/O；
 * 「该删哪些」是纯算术，坏掉时只会表现为「盘一直涨」或「刚存的封面立刻没了」，
 * 这两种在真机上都要等很久才看得出来。
 */

interface CoverFile {
  name: string
  /** mtime，越大越新。 */
  at: number
  size: number
}

/**
 * 磁盘上限 200 MB。
 *
 * 光按文件数清不够：单张最多 3 MB，4000 个文件最坏能占十几 G。
 */
export const COVER_DISK_BUDGET = 200 * 1024 * 1024
/** 清到 90%：留出余量，免得下一张封面又触发一次全目录 stat。 */
const COVER_KEEP_BYTES = Math.round(COVER_DISK_BUDGET * 0.9)
const COVER_MAX_FILES = 4000
const COVER_KEEP_FILES = 3000

/**
 * 返回该删掉的文件名，最久没用的排在前面。
 *
 * 文件数与字节数两条任一超了才清，清到两条都回到保留线以内。同一毫秒的按名字
 * 排序，让结果与 readdir 顺序无关——否则测试会随机红。
 */
export function coverEvictions(files: readonly CoverFile[]): string[] {
  let bytes = 0
  for (const file of files) bytes += Math.max(0, file.size)

  if (files.length <= COVER_MAX_FILES && bytes <= COVER_DISK_BUDGET) return []

  const ordered = [...files].sort((left, right) => left.at - right.at || left.name.localeCompare(right.name))
  const drop: string[] = []
  let kept = files.length
  for (const file of ordered) {
    if (kept <= COVER_KEEP_FILES && bytes <= COVER_KEEP_BYTES) break
    drop.push(file.name)
    kept -= 1
    bytes -= Math.max(0, file.size)
  }
  return drop
}
