/*
 * 一次性：没有 ffmpeg 的机器上从 mp4 抽帧。
 *
 * 用应用自带的 Electron 开一个隐藏窗口，file:// 直接放视频（要关同源限制，
 * 否则 canvas 被污染、toDataURL 抛 SecurityError），seek 到指定秒后画进
 * canvas 再落盘 PNG。用法：
 *   electron scripts/extract-frames.cjs <video.mp4> <outDir> <秒...>
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const [video, outDir, ...seconds] = process.argv.slice(2)

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, webSecurity: false }
  })
  const url = 'file:///' + video.replace(/\\/g, '/').replace(/ /g, '%20')
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<video id="v" src="${url}" preload="auto" muted></video>`)
  )

  const info = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const v = document.getElementById('v')
      const done = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
      if (v.readyState >= 1) done()
      else v.addEventListener('loadedmetadata', done, { once: true })
    })`
  )
  console.log(`duration=${info.duration}s size=${info.width}x${info.height}`)

  for (const raw of seconds) {
    const at = Number(raw)
    const data = await win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const v = document.getElementById('v')
        const paint = () => {
          const canvas = document.createElement('canvas')
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          canvas.getContext('2d').drawImage(v, 0, 0)
          resolve(canvas.toDataURL('image/png'))
        }
        v.addEventListener('seeked', paint, { once: true })
        v.currentTime = ${at}
      })`
    )
    const file = path.join(outDir, `${String(at).replace('.', '_')}.png`)
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
    console.log('wrote ' + file)
  }

  win.destroy()
  app.quit()
})
