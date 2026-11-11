/**
 * 每日推荐的「今天」从早上六点算。
 *
 * 各平台的日推在六点换一批，界面若还按零点分日，六点前后会出现「平台已经换
 * 了、首页还是昨天那批」。批次日期统一走这里，取数、排序、缓存判据都用同一
 * 个值。
 */
const DAILY_RESET_HOUR = 6

/** 批次那一天（本地时间，零点）。六点前算前一天，所以凌晨看到的仍是昨晚那一批。 */
function dailyDate(now = new Date()): Date {
  const at = new Date(now.getTime())
  if (at.getHours() < DAILY_RESET_HOUR) at.setDate(at.getDate() - 1)
  at.setHours(0, 0, 0, 0)
  return at
}

/** 批次日期，用来当缓存与排序的种子。 */
export function dailyDay(now = new Date()): string {
  const at = dailyDate(now)
  return at.getFullYear() + '-' + (at.getMonth() + 1) + '-' + at.getDate()
}

/** 界面上那句「11 月 11 日」，跟批次同一天。 */
export function dailyLabel(now = new Date()): string {
  const at = dailyDate(now)
  return (at.getMonth() + 1) + ' 月 ' + at.getDate() + ' 日'
}
