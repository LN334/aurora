import { app, protocol } from 'electron'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import fs from 'node:fs'
import path from 'node:path'
import { resolveAppAsset } from '../pure/app-paths'
import { otaDirAllowed, otaSuperseded, parseOtaState } from '../pure/ota-renderer'
import { write } from '../startup-log'

/**
 * Serves the built renderer over a private scheme instead of `file://`.
 *
 * This is not cosmetic. A `file://` document has an *opaque* origin, which
 * breaks the production build two different ways:
 *
 *  1. Vite emits `<script type="module" crossorigin src="./assets/…">`. Module
 *     scripts require CORS, and an opaque origin fails that check - the page
 *     loads and stays blank.
 *  2. The app's own CSP says `script-src 'self'`. For an opaque origin, `'self'`
 *     matches nothing, so the policy blocks the app's own bundle.
 *
 * Neither shows up in development, because the dev server is real HTTP. Serving
 * from `aurora-app://app/` gives the document a real, secure origin where module
 * loading, `crossorigin` stylesheets and `'self'` all behave normally.
 */

 const APP_SCHEME = 'aurora-app'
export const APP_ORIGIN = `${APP_SCHEME}://app`

/** 渲染层产物目录。本文件编译到 dist-electron/protocols/，所以要上两级。 */

const distRoot = (): string => path.resolve(__dirname, '..', '..', 'dist')

/*
 * 本机热更：userData/ota/state.json 指向哪份产物就加载哪份。
 *
 * 只在启动时算一次——热更是「这次启动用哪份」，不是运行中换壳。目录必须落在
 * userData/ota/renderers 之下（那是一份可手改的普通文件），且必须真的有
 * index.html；任何一条不满足都回落到安装包，不让一个写坏的 state 影响启动。
 */
let rendererRootCache: string | null = null

/**
 * 这一程实际加载的热更，给「更新与关于」那一屏用。
 *
 * 界面上的版本号来自安装包（app.getVersion()），而热更换掉的只是渲染层——两句话
 * 对不上时，用户没法知道眼前这份界面是哪来的。这里把热更自己的版本和时间带出去。
 */
let otaActive: { version: string; hash: string; at: number } | null = null

export function otaFacts(): {
  source: 'ota' | 'bundle'
  version: string
  hash: string
  at: number
} {
  if (otaActive) return { source: 'ota', ...otaActive }
  return { source: 'bundle', version: '', hash: '', at: 0 }
}

function otaRoot(): string | null {
  try {
    const base = path.join(app.getPath('userData'), 'ota')
    const renderers = path.join(base, 'renderers')
    const statePath = path.join(base, 'state.json')
    write(`ota: userData=${app.getPath('userData')} state=${statePath}`)
    const state = parseOtaState(fs.readFileSync(statePath, 'utf8'))
    if (!state) return null
    if (!otaDirAllowed(state.dir, renderers)) {
      write(`ota: refused dir=${state.dir}`)
      return null
    }
    /*
     * 装上了更新的安装包之后，这份热更就是过期的：新 dist 已经包含它，再留着只会
     * 让人分不清「跑的是哪一份」。撤掉 state 回到安装包，目录留给清理去收拾。
     */
    if (otaSuperseded(state, app.getVersion())) {
      fs.rmSync(statePath, { force: true })
      write(`ota: stale install=${app.getVersion()} ota=${state.version}，已撤掉 state`)
      return null
    }
    if (!fs.existsSync(path.join(state.dir, 'index.html'))) {
      write(`ota: missing index.html dir=${state.dir}`)
      return null
    }
    otaActive = { version: state.version, hash: state.hash, at: state.at }
    write(
      `ota: active dir=${state.dir} hash=${state.hash} version=${state.version || '-'} at=${state.at || '-'}`
    )
    return state.dir
  } catch (error) {
    /* 没有 state.json 就是没有热更，这是常态；写一行，省得下次再猜。 */
    write(`ota: none (${(error as Error)?.message ?? 'no state'})`)
    return null
  }
}

function rendererRoot(): string {
  if (!rendererRootCache) rendererRootCache = otaRoot() ?? distRoot()
  return rendererRootCache
}
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.gif': 'image/gif'
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function handleAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('bad url', { status: 400 })
    }

    // 任何判断之前先记录：答错时也要能看出请求了什么。
    write(`app-protocol ${request.method} host=${url.host} path=${url.pathname}`)

    if (url.host !== 'app') {
      write(`  -> 404 host is not "app"`)
      return new Response('not found', { status: 404 })
    }

    const root = rendererRoot()
    // 连路径一起记：只写 404 无法判断是算错了路径还是文件真的不在。
    write(`  __dirname=${__dirname}`)
    write(`  module=${__filename}`)
    write(`  root=${root} exists=${fs.existsSync(root)}`)
    /*
     * Containment is decided on the resolved path, not the raw string: `..`
     * segments, encoded traversal and absolute paths (including a Windows drive
     * letter) all have to be caught, and only the resolved form catches all of
     * them.
     */
    const target = resolveAppAsset(root, url.pathname)
    if (!target) {
      write(`  -> 403 resolveAppAsset refused  root=${root}`)
      return new Response('forbidden', { status: 403 })
    }
    write(`  target=${target}`)

    // 以能否读取为准：ENOENT 才算 404。statSync 只用来取 content-length。
    let size = 0
    try {
      const stat = fs.statSync(target)
      if (!stat.isFile()) {
        write(`  -> 404 not a file`)
        return new Response('not found', { status: 404 })
      }
      size = stat.size
    } catch (error) {
      // 真正不存在就是 404，其他原因把话写进响应体，窗口会显示出来。
      const code = (error as NodeJS.ErrnoException)?.code
      write(`  -> 404 stat failed code=${code} message=${(error as Error)?.message}`)
      if (code === 'ENOENT') {
        return new Response('not found', { status: 404 })
      }
      return new Response(`cannot stat ${url.pathname}: ${(error as Error)?.message ?? error}`, { status: 404 })
    }

    const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
    /*
     * <video> 要 Range。
     *
     * 装了视频之后开屏才会用 `aurora-app://` 取 mp4，而媒体元素总是先发一个
     * `bytes=0-` 探路、再按需分段。协议以前一律 200 整包，元素虽然也能读到
     * 文件，却要等整段读完才能起播——开屏只有三秒，这一段等待全变成黑屏。
     * 这里按标准回 206 + content-range，起播就不必等整个文件。
     */
    const range = request.headers.get('range')
    if (range && size > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      const rawStart = match?.[1] ?? ''
      const rawEnd = match?.[2] ?? ''
      if (match) {
        const start = rawStart ? Number(rawStart) : 0
        const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
          const headers: Record<string, string> = {
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${size}`,
            'accept-ranges': 'bytes',
            'cache-control': 'public, max-age=31536000, immutable'
          }
          write(`  -> 206 ${type} ${start}-${end}/${size}`)
          return new Response(
            Readable.toWeb(fs.createReadStream(target, { start, end })) as WebReadableStream,
            { status: 206, headers }
          )
        }
      }
    }
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(target)
    } catch (error) {
      write(`  -> 404 createReadStream threw: ${(error as Error)?.message}`)
      return new Response(`cannot read ${url.pathname}: ${(error as Error)?.message ?? error}`, { status: 404 })
    }
    write(`  -> 200 ${type} ${size} bytes`)

    const headers: Record<string, string> = {
      'content-type': type,
      // Hashed asset filenames make the renderer safe to cache hard; the HTML
      // itself must not be, or a new build would never be picked up.
      'cache-control': path.extname(target) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
    }
    // Only claim a length when it is known, rather than sending 0 and truncating.
    if (size > 0) {
      headers['content-length'] = String(size)
      headers['accept-ranges'] = 'bytes'
    }

    return new Response(Readable.toWeb(stream) as WebReadableStream, { status: 200, headers })
  })
}
