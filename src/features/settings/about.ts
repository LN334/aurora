/**
 * 「关于」区用到的固定信息，以及几个只跟字符串有关的格式化函数。
 *
 * 单独放一个文件，是因为版本号、平台名和 issue 预填文本都有确定的映射，
 * 可以脱离 React 与 Electron 直接测（tests/about.test.ts）。
 */

export const REPO_URL = 'https://github.com/LN334/aurora'
export const ISSUES_URL = 'https://github.com/LN334/aurora/issues'

/** 反馈 issue 里自动带上的环境信息。 */
export interface AboutFacts {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** `process.platform` 的常见值换成用户认得的名字。 */
export function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform || '未知'
}

/** 0.4.0 → v0.4.0；已经是 v 开头或空值都照原样给一个能读的结果。 */
export function versionLabel(version: string): string {
  if (!version) return '未知'
  return version.startsWith('v') ? version : 'v' + version
}

/**
 * 新建 issue 的地址：标题与正文预填版本、运行环境与平台。
 * 用户只剩「哪里不对」要写，省得被问「你用的是哪个版本」。
 */
export function issueUrl(facts: AboutFacts): string {
  const body = [
    '',
    '---',
    '版本：' + (facts.version || '未知'),
    '运行环境：Electron ' + facts.electron + ' / Chromium ' + facts.chrome + ' / Node ' + facts.node,
    '平台：' + platformLabel(facts.platform)
  ].join('\n')
  return ISSUES_URL + '/new?body=' + encodeURIComponent(body)
}
