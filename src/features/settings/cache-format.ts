/*
 * 设置页「下载」分区的两处单位换算。
 *
 * 抽成纯函数是因为它们各自出过一次错：缓存的 101 KB 被四舍五入成 1 MB，
 * 看着像没缓存。这类换算按规则写死并留用例，比每次读代码心算可靠。
 */

/** 缓存上限的可选项文案：0 表示不缓存，其余按 MB/GB 报。 */
export function cacheLimitLabel(megabytes: number): string {
  if (megabytes === 0) return '不缓存'
  return megabytes >= 1024 ? `${megabytes / 1024} GB` : `${megabytes} MB`
}

/**
 * 缓存占用：按「1.2 GB / 36 MB / 101 KB」报。
 *
 * 分档的意义在最后一档——短音频、试听片段只有几十上百 KB，若一律按 MB
 * 四舍五入就会变成 0 或 1，用户从这行看不出到底存没存东西。
 */
export function cacheSizeLabel(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
