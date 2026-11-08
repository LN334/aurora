/**
 * Turning the machine's proxy settings into something the updater can use.
 *
 * The download side of an update never asks Windows for a proxy: Electron
 * resolves the system proxy only for the default session, and electron-updater
 * runs on a partition of its own. A VPN client that opens a local port but
 * leaves "system proxy" switched off is therefore invisible to it, and a
 * 130 MB fetch from GitHub fails outright rather than merely running slowly.
 *
 * These helpers stay pure so the parsing can be tested without a network:
 * shaping a Windows `ProxyServer` string, and deciding which local ports are
 * worth asking.
 */

export interface ProxyEndpoint {
  host: string
  port: number
}

/** Ports that local VPN and proxy clients are commonly configured to listen on. */
export const LOCAL_PROXY_PORTS: readonly number[] = [
  7890, 7891, 7892, 7897, 10808, 10809, 1080, 1087, 2080, 33210, 8888, 8889,
  8080, 6152, 20171
]

/**
 * Windows stores this setting in several shapes:
 *
 *   `127.0.0.1:7891`
 *   `http=127.0.0.1:7891;https=127.0.0.1:7891`
 *   `http://127.0.0.1:7891`
 *
 * SOCKS entries are dropped rather than guessed at: the probe speaks HTTP
 * `CONNECT`, and a SOCKS-only listener would fail that handshake in a way that
 * looks exactly like "there is no proxy", which is the one answer worth
 * avoiding.
 */
export function parseProxyServer(raw: string | null | undefined): ProxyEndpoint | null {
  if (!raw) return null
  let fallback: ProxyEndpoint | null = null
  for (const entry of raw.split(';')) {
    const trimmed = entry.trim()
    if (!trimmed || trimmed.startsWith('<')) continue
    const equals = trimmed.indexOf('=')
    const scheme = equals === -1 ? '' : trimmed.slice(0, equals).trim().toLowerCase()
    if (scheme === 'socks' || scheme === 'socks4' || scheme === 'socks5') continue
    const endpoint = splitHostPort(equals === -1 ? trimmed : trimmed.slice(equals + 1))
    if (!endpoint) continue
    if (scheme === 'https' || scheme === 'http') return endpoint
    fallback ??= endpoint
  }
  return fallback
}

function splitHostPort(value: string): ProxyEndpoint | null {
  const authority = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slash = authority.indexOf('/')
  const hostPort = slash === -1 ? authority : authority.slice(0, slash)
  const colon = hostPort.lastIndexOf(':')
  if (colon <= 0) return null
  const host = hostPort.slice(0, colon).replace(/^\[|\]$/g, '')
  const port = Number(hostPort.slice(colon + 1))
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { host, port }
}

/** The `proxyRules` string that `session.setProxy` expects. */
export function proxyRulesFor(endpoint: ProxyEndpoint): string {
  const authority = `${endpoint.host}:${endpoint.port}`
  return `http=${authority};https=${authority}`
}

export function describeProxy(endpoint: ProxyEndpoint): string {
  return `http://${endpoint.host}:${endpoint.port}`
}
