/**
 * 「关于」区用到的固定信息，以及几个只跟字符串有关的格式化函数。
 *
 * 单独放一个文件，是因为版本号、平台名和 issue 预填文本都有确定的映射，
 * 可以脱离 React 与 Electron 直接测（tests/about.test.ts）。
 */

export const REPO_URL = 'https://github.com/LN334/aurora'
export const ISSUES_URL = 'https://github.com/LN334/aurora/issues'

/** 反馈 issue 里自动带上的环境信息。 */
interface AboutFacts {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** 界面这一份从哪来；与「版本」那一行的安装包版本是两件事。 */
interface RendererFacts {
  source: 'ota' | 'bundle'
  version: string
  hash: string
  at: number
}

/**
 * 「界面」那一行写什么。
 *
 * 安装包版本与界面版本本来就可能是两个数：热更换掉的是渲染层目录，
 * `app.getVersion()` 仍报安装包那个。这里把热更自己的版本与写入时间带出来，
 * 一眼能看出眼前这份界面是安装包自带的，还是本机落后/领先于它。
 */
export function rendererLabel(renderer: RendererFacts | undefined): string {
  if (!renderer) return '未知'
  if (renderer.source !== 'ota') return '安装包自带'
  const when = renderer.at > 0 ? stamp(renderer.at) : ''
  const version = renderer.version ? ' ' + renderer.version : ''
  return '本机热更' + version + (when ? ' · ' + when : '')
}

/** 毫秒时间戳 → `11-22 15:52`。只用来对账，年份反倒占地方。 */
export function stamp(at: number): string {
  const when = new Date(at)
  if (!Number.isFinite(when.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    pad(when.getMonth() + 1) +
    '-' +
    pad(when.getDate()) +
    ' ' +
    pad(when.getHours()) +
    ':' +
    pad(when.getMinutes())
  )
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
