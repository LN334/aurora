import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import type { NativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { encodeIco, roundCorners } from './pure/app-icon-shape'

/*
 * 用户自定义的窗口 / 托盘 / 快捷方式图标。
 *
 * 这里只管「换掉看得见的图标」，不去动 exe 里的资源——那是安装包固化的，改不了
 * 也不该改。能换的三处：窗口图标（任务栏与 Alt+Tab）、托盘图标、桌面与开始菜单
 * 的快捷方式。
 *
 * 落盘的是七档 PNG，用哪个由系统挑；换成位图而不是保留 SVG，是因为用户给的
 * 原图什么样就什么样，缩下去糊不糊由他自己负责，我们只负责把四角切圆。
 */

/** Windows 会按显示场景自己挑最接近的一档，所以七档都备着。 */
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** 圆角占比，与内置图标一致。 */
const CORNER = 0.17

type IconListener = () => void

const listeners: IconListener[] = []

/** 注册「图标已换」的监听。main.ts 用它把新图标铺到窗口与托盘上。 */
export function onIconChanged(listener: IconListener): void {
  listeners.push(listener)
}

function iconDir(): string {
  return path.join(app.getPath('userData'), 'app-icon')
}

function iconPath(size: number): string {
  return path.join(iconDir(), 'icon-' + size + '.png')
}

/** 自带的那张窗口图标。打包后在 resources 里，开发时就在仓库根。 */
function bundledIcon(): string {
  return path.join(app.getAppPath(), 'assets', 'icons', 'app.png')
}

function hasCustomIcon(): boolean {
  return fs.existsSync(iconPath(256))
}

/** 窗口该用的图标路径：设过就用设过的，否则用自带那张。 */
export function windowIconPath(): string {
  return hasCustomIcon() ? iconPath(256) : bundledIcon()
}

function readIcon(size: number): NativeImage | null {
  const file = iconPath(size)
  if (!fs.existsSync(file)) return null
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? null : image
}

/** 托盘优先吃用户设的图标；没设过返回 null，由 tray.ts 回落到自带那对。 */
export function customTrayImage(): NativeImage | null {
  return readIcon(32) ?? readIcon(16)
}

interface IconResult {
  ok: boolean
  canceled?: boolean
  reason?: string
}

/** 设置页预览。没设过就给自带那张，用户看得见「现在是什么样」。 */
export function iconPreview(): { custom: boolean; dataUrl: string } {
  const custom = hasCustomIcon()
  const file = custom ? iconPath(256) : bundledIcon()
  if (!fs.existsSync(file)) return { custom, dataUrl: '' }
  return { custom, dataUrl: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') }
}

export async function chooseIcon(): Promise<IconResult> {
  const picked = await dialog.showOpenDialog({
    title: '选一张图当图标',
    buttonLabel: '用这张',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'ico'] }]
  })
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }

  const source = nativeImage.createFromPath(picked.filePaths[0])
  if (source.isEmpty()) return { ok: false, reason: '这张图打不开，换 PNG 或 JPG 试试' }
  return storeIcon(source)
}

function storeIcon(source: NativeImage): IconResult {
  const size = source.getSize()
  if (size.width < 16 || size.height < 16) {
    return { ok: false, reason: '这张图太小了，至少要 16×16' }
  }

  fs.mkdirSync(iconDir(), { recursive: true })
  const square = squareCrop(source)
  for (const target of ICON_SIZES) {
    fs.writeFileSync(iconPath(target), renderIcon(square, target))
  }
  const entries = ICON_SIZES.map((target) => ({
    size: target,
    png: fs.readFileSync(iconPath(target))
  }))
  fs.writeFileSync(path.join(iconDir(), 'icon.ico'), encodeIco(entries))

  applyEverywhere()
  return { ok: true }
}

export function resetIcon(): boolean {
  fs.rmSync(iconDir(), { recursive: true, force: true })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setIcon(bundledIcon())
  }
  // 传空串：清掉快捷方式里的图标字段，让 Windows 跟着 exe 自己走。
  // 传 app.getPath('exe') 在开发态会写成 node_modules 里的 electron.exe。
  rewriteShortcuts('')
  notify()
  return true
}

/** 启动时调一次：设过自定义图标的话，把快捷方式重新指过去（重装后会丢）。 */
export function initCustomIcon(): void {
  if (!hasCustomIcon()) return
  const ico = path.join(iconDir(), 'icon.ico')
  if (fs.existsSync(ico)) rewriteShortcuts(ico)
}

/**
 * `--set-icon=<图片路径>`：开机就把这张图设成图标。
 *
 * 给自动化验收和批量部署用——换图标要开系统文件对话框，脚本点不到它。
 * 参数不合法就安静跳过，绝不因为一个启动参数把应用卡在启动页。
 */
export function applyIconFromArgv(): void {
  const flag = process.argv.find((arg) => arg.startsWith('--set-icon='))
  if (!flag) return
  const file = flag.slice('--set-icon='.length).replace(/^"|"$/g, '')
  if (!file || !fs.existsSync(file)) return
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return
  storeIcon(image)
}

function squareCrop(source: NativeImage): NativeImage {
  const { width, height } = source.getSize()
  if (width === height) return source
  const side = Math.min(width, height)
  return source.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side
  })
}

/**
 * 缩到目标尺寸并把四角切圆。
 *
 * 先缩再切是刻意的：先切再缩，圆角在缩放里会重新糊成直角或锯齿。切圆走的是
 * pure 里的像素函数，alpha 之外不动，所以颜色不会因为这条路径偏掉。
 */
function renderIcon(square: NativeImage, target: number): Buffer {
  const scaled = square.resize({ width: target, height: target, quality: 'best' })
  const bitmap = scaled.toBitmap()
  roundCorners(bitmap, target, target, CORNER)
  return nativeImage
    .createFromBitmap(bitmap, { width: target, height: target, scaleFactor: 1 })
    .toPNG()
}

function applyEverywhere(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setIcon(windowIconPath())
  }
  rewriteShortcuts(path.join(iconDir(), 'icon.ico'))
  notify()
}

function notify(): void {
  for (const listener of listeners) listener()
}

function shortcutFiles(): string[] {
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  return [
    path.join(app.getPath('desktop'), 'Aurora.lnk'),
    path.join(programs, 'Aurora.lnk'),
    path.join(programs, 'Aurora', 'Aurora.lnk')
  ]
}

/**
 * 把快捷方式的图标换成给定文件。
 *
 * 只改图标，target / args / cwd 一律照抄原来的——用户可能自己动过快捷方式，
 * 我们要的只是换张脸。读不到（没装、开发模式、别的用户建的）就跳过。
 */
function rewriteShortcuts(icon: string): void {
  if (process.platform !== 'win32') return
  // 开发态跑的是 node_modules 里的 electron.exe，把它写进用户的桌面快捷方式，
  // 快捷方式就会变成 Electron 的原子图标（0.7.2 验收时踩过）。要验这条，用打包版。
  if (!app.isPackaged) return
  const exe = app.getPath('exe')
  for (const link of shortcutFiles()) {
    let current: Electron.ShortcutDetails
    try {
      current = shell.readShortcutLink(link)
    } catch {
      continue
    }
    try {
      shell.writeShortcutLink(link, 'update', {
        target: current.target || exe,
        args: current.args,
        cwd: current.cwd,
        icon,
        iconIndex: 0,
        description: current.description
      })
    } catch {
      // 被策略或权限锁着：窗口和托盘已经换了，这里失败不影响别的入口
    }
  }
}
