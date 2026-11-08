import { BrowserWindow, app, dialog, net, shell } from 'electron'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { kugouStreamUrl } from './kugou/client'
import { neteaseStreamUrl } from './netease/client'
import { qishuiStreamUrl } from './qishui/client'
import { qqStreamUrl } from './qq/client'
import { loadSettings, saveSettings } from './settings'
import { ffmpegAvailable, transcode, type TranscodeFormat } from './transcode'

export type DownloadProvider = 'netease' | 'qq' | 'kugou' | 'qishui'
export type DownloadFormat = 'original' | TranscodeFormat
export type DownloadState = 'queued' | 'downloading' | 'transcoding' | 'done' | 'failed' | 'canceled'

export interface DownloadRequest {
  provider: DownloadProvider
  trackId: string
  title: string
  artists: string[]
  album: string
  /** Seconds; only used to draw a progress bar while transcoding. */
  duration?: number
  format?: DownloadFormat
}

export interface DownloadView {
  id: string
  provider: DownloadProvider
  title: string
  subtitle: string
  format: DownloadFormat
  state: DownloadState
  percent: number
  received: number
  total: number
  speed: number
  filePath?: string
  message?: string
  createdAt: number
}

interface Job {
  id: string
  request: DownloadRequest
  format: DownloadFormat
  state: DownloadState
  percent: number
  received: number
  total: number
  speed: number
  filePath?: string
  message?: string
  createdAt: number
  controller: AbortController
}

/** Two at a time: a music library download is bursty, and four streams compete for the same link. */
const MAX_ACTIVE = 2

const jobs = new Map<string, Job>()
const queue: string[] = []
let active = 0
let timer: NodeJS.Timeout | null = null

function viewOf(job: Job): DownloadView {
  return {
    id: job.id,
    provider: job.request.provider,
    title: job.request.title,
    subtitle: job.request.artists.join('、'),
    format: job.format,
    state: job.state,
    percent: job.percent,
    received: job.received,
    total: job.total,
    speed: job.speed,
    filePath: job.filePath,
    message: job.message,
    createdAt: job.createdAt
  }
}

export function listDownloads(): DownloadView[] {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(viewOf)
}

function emit(): void {
  const views = listDownloads()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('downloads:state', views)
  }
}

/** Progress arrives in kilobytes at a time; pushing every chunk would drown the bridge. */
function scheduleEmit(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    emit()
  }, 400)
}

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 110)
}

const KNOWN_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav']

function extensionOf(url: string, format: DownloadFormat): string {
  try {
    const suffix = path.extname(new URL(url).pathname).toLowerCase()
    if (KNOWN_EXTENSIONS.includes(suffix)) return suffix
  } catch {
    // A malformed URL is caught by the fetch below; the extension is cosmetic.
  }
  return format === 'original' ? '.mp3' : '.' + format
}

function downloadDir(): string {
  const settings = loadSettings()
  const configured = settings.downloadDir?.trim()
  return configured || path.join(app.getPath('music'), 'Aurora')
}

function defaultFormat(): DownloadFormat {
  return loadSettings().downloadFormat ?? 'original'
}

interface ResolvedStream {
  ok: true
  url: string
  trial: boolean
}

interface ResolveFailure {
  ok: false
  message: string
}

async function resolveStream(request: DownloadRequest): Promise<ResolvedStream | ResolveFailure> {
  const settings = loadSettings()
  try {
    if (request.provider === 'netease') {
      const result = await neteaseStreamUrl(Number(request.trackId), settings.neteaseQuality)
      if (!result.ok) return { ok: false, message: result.message ?? '网易云没有给出可取地址' }
      return { ok: true, url: result.stream.url, trial: result.stream.trial }
    }
    if (request.provider === 'qq') {
      const result = await qqStreamUrl(request.trackId)
      if (!result.ok) return { ok: false, message: result.message ?? 'QQ 音乐没有给出可取地址' }
      return { ok: true, url: result.url, trial: result.trial }
    }
    if (request.provider === 'kugou') {
      const result = await kugouStreamUrl(request.trackId)
      if (!result.ok) return { ok: false, message: result.message ?? '酷狗没有给出可取地址' }
      return { ok: true, url: result.url, trial: result.trial }
    }
    const result = await qishuiStreamUrl(Number(request.trackId), 'standard')
    if (!result.ok) return { ok: false, message: result.message ?? '汽水音乐没有给出可取地址' }
    return { ok: true, url: result.url, trial: result.trial }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: '取流失败：' + message }
  }
}

async function writeStreamToFile(
  url: string,
  target: string,
  job: Job,
): Promise<void> {
  const response = await net.fetch(url, { signal: job.controller.signal })
  if (!response.ok) throw new Error('服务器返回 ' + String(response.status))
  const body = response.body
  if (!body) throw new Error('服务器没有返回内容')
  const total = Number(response.headers.get('content-length') ?? 0)
  job.total = Number.isFinite(total) ? total : 0

  const handle = await fsp.open(target, 'w')
  const reader = body.getReader()
  let lastTick = Date.now()
  let lastBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await handle.write(value)
      job.received += value.byteLength
      if (job.total > 0) job.percent = Math.min(99, Math.round((job.received / job.total) * 100))
      const now = Date.now()
      if (now - lastTick >= 500) {
        job.speed = Math.round(((job.received - lastBytes) * 1000) / (now - lastTick))
        lastTick = now
        lastBytes = job.received
        scheduleEmit()
      }
    }
  } finally {
    await handle.close()
  }
}

async function run(job: Job): Promise<void> {
  const request = job.request
  try {
    job.state = 'downloading'
    job.percent = 0
    scheduleEmit()

    const stream = await resolveStream(request)
    if (!stream.ok) {
      job.state = 'failed'
      job.message = stream.message
      return
    }
    if (stream.trial) {
      job.state = 'failed'
      job.message = '这首歌只能试听片段，没有完整音源'
      return
    }

    const dir = downloadDir()
    await fsp.mkdir(dir, { recursive: true })
    const base = safeName(request.title, '未命名') + ' - ' + safeName(request.artists.join('、'), '未知艺人')
    const originalExtension = extensionOf(stream.url, job.format)
    const partPath = path.join(dir, base + originalExtension + '.part')

    await writeStreamToFile(stream.url, partPath, job)
    if (job.controller.signal.aborted) {
      await fsp.rm(partPath, { force: true })
      return
    }

    if (job.format === 'original') {
      const finalPath = path.join(dir, base + originalExtension)
      await fsp.rename(partPath, finalPath)
      job.filePath = finalPath
      job.state = 'done'
      job.percent = 100
      return
    }

    job.state = 'transcoding'
    job.percent = 0
    job.speed = 0
    scheduleEmit()
    const finalPath = path.join(dir, base + '.' + job.format)
    const result = await transcode(
      partPath,
      finalPath,
      { format: job.format, bitrate: loadSettings().downloadBitrate, duration: request.duration ?? 0 },
      (percent) => {
        job.percent = percent
        scheduleEmit()
      }
    )
    await fsp.rm(partPath, { force: true })
    if (!result.ok) {
      job.state = 'failed'
      job.message = result.message ?? '转码失败'
      await fsp.rm(finalPath, { force: true })
      return
    }
    job.filePath = finalPath
    job.state = 'done'
    job.percent = 100
  } catch (error) {
    if (job.controller.signal.aborted) {
      job.state = 'canceled'
      return
    }
    job.state = 'failed'
    job.message = error instanceof Error ? error.message : String(error)
  } finally {
    job.speed = 0
    scheduleEmit()
  }
}

function pump(): void {
  while (active < MAX_ACTIVE && queue.length > 0) {
    const id = queue.shift()!
    const job = jobs.get(id)
    if (!job || job.state !== 'queued') continue
    active += 1
    void run(job).finally(() => {
      active -= 1
      pump()
    })
  }
}

export function enqueueDownload(request: DownloadRequest): DownloadView {
  const id = crypto.randomUUID()
  const format = request.format ?? defaultFormat()
  const job: Job = {
    id,
    request,
    format,
    state: 'queued',
    percent: 0,
    received: 0,
    total: 0,
    speed: 0,
    createdAt: Date.now(),
    controller: new AbortController()
  }
  jobs.set(id, job)
  queue.push(id)
  scheduleEmit()
  pump()
  return viewOf(job)
}

export function cancelDownload(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  if (job.state === 'done' || job.state === 'failed' || job.state === 'canceled') return false
  job.controller.abort()
  const index = queue.indexOf(id)
  if (index >= 0) {
    queue.splice(index, 1)
    job.state = 'canceled'
  }
  scheduleEmit()
  return true
}

export function clearDownloads(): boolean {
  for (const [id, job] of jobs) {
    if (job.state === 'queued' || job.state === 'downloading' || job.state === 'transcoding') continue
    jobs.delete(id)
  }
  scheduleEmit()
  return true
}

export function revealDownload(id: string): boolean {
  const job = jobs.get(id)
  if (!job?.filePath) return false
  shell.showItemInFolder(job.filePath)
  return true
}

export async function openDownloadFolder(): Promise<boolean> {
  const dir = downloadDir()
  await fsp.mkdir(dir, { recursive: true })
  const error = await shell.openPath(dir)
  return error === ''
}

export interface DownloadPrefs {
  dir: string
  effectiveDir: string
  format: DownloadFormat
  bitrate: number
  ffmpeg: boolean
}

export function downloadPrefs(): DownloadPrefs {
  const settings = loadSettings()
  return {
    dir: settings.downloadDir ?? '',
    effectiveDir: downloadDir(),
    format: settings.downloadFormat ?? 'original',
    bitrate: settings.downloadBitrate ?? 256,
    ffmpeg: ffmpegAvailable()
  }
}

export function setDownloadPrefs(patch: {
  dir?: string
  format?: DownloadFormat
  bitrate?: number
}): DownloadPrefs {
  const settings = { ...loadSettings() }
  if (typeof patch.dir === 'string') settings.downloadDir = patch.dir
  if (patch.format === 'original' || patch.format === 'mp3' || patch.format === 'flac' || patch.format === 'm4a') {
    settings.downloadFormat = patch.format
  }
  if (typeof patch.bitrate === 'number' && Number.isFinite(patch.bitrate)) {
    settings.downloadBitrate = Math.min(320, Math.max(96, Math.round(patch.bitrate)))
  }
  saveSettings(settings)
  return downloadPrefs()
}

export async function pickDownloadFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择下载目录',
    defaultPath: downloadDir(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
