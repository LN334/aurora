import { execFile } from 'node:child_process'

/**
 * 去掉窗口顶部那条 1px 的系统强调色线。
 *
 * Windows 11 的 DWM 会给「当前活动窗口」在标题栏顶部画一条系统强调色，
 * 四边不对称（只有上边）。Electron 没有暴露这个属性，只能调 dwmapi：
 *
 *   DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xFFFFFFFE)
 *
 * 这里用 PowerShell 跑一次 P/Invoke，而不是引一个 native 绑定：只为一根
 * 像素线加一个 .node 模块（还要 unpack、还要跟着 Electron 的 ABI 升）不划算。
 * 子进程异步跑，窗口不会等它；失败了也只是那条线还在。
 */
export function hideWindowBorder(handle: Buffer): void {
  if (process.platform !== 'win32' || handle.length < 8) return

  const hwnd = handle.readBigUInt64LE(0).toString()
  const script = [
    'Add-Type -Namespace Aurora -Name Dwm -MemberDefinition ',
    "'[DllImport(\"dwmapi.dll\")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);'",
    '; $v = -2; ',
    `[void][Aurora.Dwm]::DwmSetWindowAttribute([IntPtr]${hwnd}, 34, [ref]$v, 4)`
  ].join('')

  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error) => {
    if (error) console.warn('[window] border attribute failed:', error.message)
  })
}
