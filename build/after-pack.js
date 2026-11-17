const fs = require('node:fs')
const path = require('node:path')

/**
 * 打包后裁掉 Electron 里只有 WebGPU 才用得到的两个 DLL。
 *
 * dxcompiler.dll 是 DirectX Shader Compiler（DXC），dxil.dll 是它的 DXIL 签名库，
 * 两个加起来 26 MB。Chromium 只在 `navigator.gpu` 真正被调用时才加载它们；
 * Aurora 是 DOM + Canvas 2D 的应用（壁纸场景走 2D canvas，不碰 WebGPU），
 * 所以这两个文件从安装到卸载都不会被打开。
 *
 * 不删的：vk_swiftshader.dll / vulkan-1.dll。它们是没显卡、老驱动、远程桌面、
 * 虚拟机上的软件渲染兜底，删了那几类机器会黑屏，5 MB 不值得。
 * d3dcompiler_47.dll 也不能删——ANGLE 的 D3D11 后端靠它编译着色器。
 *
 * 回收站行为：直接删，不留备份。electron-builder 重新打包时会从 Electron
 * 缓存里重新解压出完整目录，所以本地不会缺文件。
 */
const DROP = ['dxcompiler.dll', 'dxil.dll']

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const dir = context.appOutDir
  const dropped = []
  for (const name of DROP) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) continue
    fs.unlinkSync(file)
    dropped.push(name)
  }

  const saved = DROP.length ? 26 : 0
  console.log(
    `  • afterPack 裁掉 ${dropped.join(', ') || '（无）'}，约省 ${saved} MB`
  )
}
