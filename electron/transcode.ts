import { app } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Where the encoder comes from.
 *
 * Aurora does not ship FFmpeg: a 100 MB binary inside an installer that some
 * users never touch is a bad trade. Instead we look for one in the places a
 * user or a packager would put it, then fall back to PATH. Downloading still
 * works without it - the stream is just stored as it arrived.
 */
export type TranscodeFormat = 'mp3' | 'flac' | 'm4a'

export interface TranscodeOptions {
  format: TranscodeFormat
  /** kbps for the lossy targets; ignored by FLAC. */
  bitrate?: number
  /** Seconds of the source, used to turn ffmpeg out_time into a percentage. */
  duration?: number
}

export interface TranscodeResult {
  ok: boolean
  message?: string
}

let cached: string | null | undefined

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function onPath(command: string): boolean {
  try {
    const probe = spawnSync(command, ['-version'], { windowsHide: true, timeout: 4000 })
    return probe.status === 0
  } catch {
    return false
  }
}

/** Resolved once per process: spawning a version probe per track would be silly. */
export function findFfmpeg(): string | null {
  if (cached !== undefined) return cached
  const candidates = [
    process.env.AURORA_FFMPEG ?? '',
    path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
    path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg'),
    path.join(app.getPath('userData'), 'ffmpeg', 'ffmpeg.exe'),
    path.join(app.getPath('userData'), 'ffmpeg', 'ffmpeg')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (isFile(candidate)) {
      cached = candidate
      return cached
    }
  }
  cached = onPath('ffmpeg') ? 'ffmpeg' : null
  return cached
}

export function ffmpegAvailable(): boolean {
  return findFfmpeg() !== null
}

function codecArgs(options: TranscodeOptions): string[] {
  const bitrate = Math.min(320, Math.max(96, Math.round(options.bitrate ?? 256)))
  if (options.format === 'flac') return ['-c:a', 'flac', '-compression_level', '5']
  if (options.format === 'm4a') return ['-c:a', 'aac', '-b:a', bitrate + 'k']
  return ['-c:a', 'libmp3lame', '-b:a', bitrate + 'k']
}

/**
 * Cover art survives a re-encode only if it is carried across explicitly; a
 * plain audio map would drop the attached picture that every streaming file
 * in this app has.
 */
function mapArgs(format: TranscodeFormat): string[] {
  if (format === 'flac') return ['-map', '0:a']
  return ['-map', '0:a', '-map', '0:v?', '-c:v', 'copy']
}

export function transcode(
  input: string,
  output: string,
  options: TranscodeOptions,
  onProgress?: (percent: number) => void
): Promise<TranscodeResult> {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return Promise.resolve({ ok: false, message: '没有找到 ffmpeg，无法转码' })

  const args = [
    '-y',
    '-hide_banner',
    '-v',
    'error',
    '-nostats',
    '-progress',
    'pipe:1',
    '-i',
    input,
    '-vn',
    ...mapArgs(options.format),
    ...codecArgs(options),
    '-map_metadata',
    '0',
    ...(options.format === 'mp3' ? ['-id3v2_version', '3'] : []),
    output
  ]

  return new Promise<TranscodeResult>((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let tail = ''
    let settled = false

    const finish = (result: TranscodeResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      for (const line of text.split('\n')) {
        const match = /^out_time_us=(\d+)/.exec(line.trim())
        if (!match) continue
        const seconds = Number(match[1]) / 1_000_000
        const total = options.duration ?? 0
        if (total > 0) onProgress?.(Math.min(99, Math.round((seconds / total) * 100)))
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-600)
    })
    child.on('error', (error) => finish({ ok: false, message: error.message }))
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100)
        finish({ ok: true })
      } else {
        finish({ ok: false, message: tail.trim() || 'ffmpeg 退出码 ' + String(code) })
      }
    })
  })
}
