/**
 * Finding the machine's proxy and pointing the update download at it.
 *
 * Why this exists: the release files live on GitHub, whose download hosts are
 * not reachable directly from a lot of networks. A proxy client running on the
 * desktop usually opens a local port and leaves Windows' "system proxy" switch
 * alone, and Electron only reads that switch for the default session -
 * electron-updater downloads through `session.fromPartition('electron-updater')`
 * instead. The result is a check that succeeds (the API host answers) and a
 * download that transfers nothing at all.
 *
 * So before the first byte is requested, look for a local proxy that can really
 * reach GitHub, and hand it to the updater's own session. Nothing here touches
 * the default session, so online playback keeps whatever route it had.
 */
import { session } from 'electron'
import { execFile } from 'node:child_process'
import net from 'node:net'
import {
  LOCAL_PROXY_PORTS,
  describeProxy,
  parseProxyServer,
  proxyRulesFor,
  type ProxyEndpoint
} from './pure/proxy'
import { write } from './startup-log'

/** The partition electron-updater downloads through; see its electronHttpExecutor. */
const UPDATER_PARTITION = 'electron-updater'

const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const PROBE_TIMEOUT_MS = 900
const PROBE_TARGET = { host: 'github.com', port: 443 }

/** A working proxy is worth remembering; a missing one is re-checked soon after. */
const FOUND_TTL_MS = 5 * 60 * 1000
const MISS_TTL_MS = 30 * 1000

function runRegQuery(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'reg',
      ['query', REGISTRY_KEY],
      { windowsHide: true },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })
}

/** The manually configured proxy, when Windows has one switched on. */
async function readSystemProxy(): Promise<ProxyEndpoint | null> {
  if (process.platform !== 'win32') return null
  try {
    const stdout = await runRegQuery()
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout)) return null
    const server = /ProxyServer\s+REG_\w+\s+(.+)/i.exec(stdout)
    return parseProxyServer(server?.[1]?.trim())
  } catch {
    return null
  }
}

/** Ask one local port to tunnel to GitHub: the only answer that means anything. */
function probeHttpProxy(endpoint: ProxyEndpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: endpoint.host, port: endpoint.port })
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS)
    socket.once('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${PROBE_TARGET.host}:${PROBE_TARGET.port} HTTP/1.1\r\n` +
          `Host: ${PROBE_TARGET.host}:${PROBE_TARGET.port}\r\n\r\n`
      )
    })
    socket.once('data', (chunk) => {
      clearTimeout(timer)
      finish(/^HTTP\/1\.[01] 200\b/.test(chunk.toString('latin1')))
    })
    socket.once('close', () => {
      clearTimeout(timer)
      finish(false)
    })
  })
}

let cached: { at: number; endpoint: ProxyEndpoint | null } | null = null
let inFlight: Promise<ProxyEndpoint | null> | null = null

/**
 * The first local proxy that can reach GitHub, if any.
 *
 * Probes run together and the whole search is capped at one probe timeout, so a
 * machine with no proxy pays well under a second before the update starts.
 */
async function findWorkingProxy(force = false): Promise<ProxyEndpoint | null> {
  if (!force && cached) {
    const ttl = cached.endpoint ? FOUND_TTL_MS : MISS_TTL_MS
    if (Date.now() - cached.at < ttl) return cached.endpoint
  }
  if (inFlight) return inFlight
  inFlight = search()
  try {
    const endpoint = await inFlight
    cached = { at: Date.now(), endpoint }
    return endpoint
  } finally {
    inFlight = null
  }
}

async function search(): Promise<ProxyEndpoint | null> {
  const candidates: ProxyEndpoint[] = []
  const system = await readSystemProxy()
  if (system) candidates.push(system)
  for (const port of LOCAL_PROXY_PORTS) {
    if (candidates.some((c) => c.port === port && c.host === '127.0.0.1')) continue
    candidates.push({ host: '127.0.0.1', port })
  }
  const results = await Promise.all(
    candidates.map(async (endpoint) => ({ endpoint, ok: await probeHttpProxy(endpoint) }))
  )
  return results.find((result) => result.ok)?.endpoint ?? null
}

interface UpdateRoute {
  /** The proxy in use, or null when the download goes out directly. */
  endpoint: ProxyEndpoint | null
  /** Human-readable form, for the settings panel and the startup log. */
  label: string
}

/**
 * Point the updater's session at whatever route actually works.
 *
 * Always sets something - `direct` included - so a stale proxy from a previous
 * download cannot outlive the client that was listening on that port.
 */
export async function applyUpdaterProxy(force = false): Promise<UpdateRoute> {
  const endpoint = await findWorkingProxy(force)
  const ses = session.fromPartition(UPDATER_PARTITION, { cache: false })
  if (endpoint) {
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: proxyRulesFor(endpoint) })
    const label = describeProxy(endpoint)
    write(`updates: proxy -> ${label}`)
    return { endpoint, label }
  }
  await ses.setProxy({ mode: 'direct' })
  write('updates: proxy -> none (direct)')
  return { endpoint: null, label: '直连' }
}
