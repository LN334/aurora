import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeProxy,
  parseProxyServer,
  proxyRulesFor
} from '../electron/pure/proxy.ts'

/**
 * These strings are copied from what Windows and the common desktop clients
 * actually write, because the whole point of the parser is to survive them:
 * the updater is asked to use a proxy precisely when the user never typed one
 * into Aurora.
 */

test('a bare host:port is the ordinary case', () => {
  assert.deepEqual(parseProxyServer('127.0.0.1:7891'), { host: '127.0.0.1', port: 7891 })
})

test('the per-protocol form picks http or https over anything else', () => {
  assert.deepEqual(parseProxyServer('http=127.0.0.1:7890;https=127.0.0.1:7891'), {
    host: '127.0.0.1',
    port: 7890
  })
  assert.deepEqual(parseProxyServer('https=127.0.0.1:7891;http=127.0.0.1:7890'), {
    host: '127.0.0.1',
    port: 7891
  })
})

test('a scheme prefix is stripped, not treated as a host', () => {
  assert.deepEqual(parseProxyServer('http://127.0.0.1:7891'), { host: '127.0.0.1', port: 7891 })
  assert.deepEqual(parseProxyServer('http://127.0.0.1:7891/'), { host: '127.0.0.1', port: 7891 })
})

test('a socks entry is refused rather than guessed at', () => {
  // The probe speaks HTTP CONNECT; a socks-only listener would answer nothing,
  // which must not be mistaken for "this proxy works".
  assert.equal(parseProxyServer('socks=127.0.0.1:1080'), null)
  assert.equal(parseProxyServer('socks5=127.0.0.1:1080'), null)
})

test('a socks entry does not hide a usable http entry next to it', () => {
  assert.deepEqual(parseProxyServer('socks=127.0.0.1:1080;http=127.0.0.1:7891'), {
    host: '127.0.0.1',
    port: 7891
  })
})

test('the loopback bypass marker is not a proxy', () => {
  assert.equal(parseProxyServer('<-loopback>'), null)
  assert.deepEqual(parseProxyServer('http=127.0.0.1:7891;<-loopback>'), {
    host: '127.0.0.1',
    port: 7891
  })
})

test('local names are allowed through, ports must be ports', () => {
  assert.deepEqual(parseProxyServer('localhost:8888'), { host: 'localhost', port: 8888 })
  assert.equal(parseProxyServer('127.0.0.1'), null)
  assert.equal(parseProxyServer('127.0.0.1:0'), null)
  assert.equal(parseProxyServer('127.0.0.1:70000'), null)
  assert.equal(parseProxyServer('127.0.0.1:abc'), null)
})

test('an ipv6 literal keeps its brackets out of the host', () => {
  assert.deepEqual(parseProxyServer('[::1]:7891'), { host: '::1', port: 7891 })
})

test('nothing at all is null, not a crash', () => {
  assert.equal(parseProxyServer(undefined), null)
  assert.equal(parseProxyServer(''), null)
  assert.equal(parseProxyServer('   '), null)
})

test('proxyRulesFor covers both schemes with the same authority', () => {
  assert.equal(proxyRulesFor({ host: '127.0.0.1', port: 7891 }), 'http=127.0.0.1:7891;https=127.0.0.1:7891')
})

test('describeProxy is the form a person reads in the settings panel', () => {
  assert.equal(describeProxy({ host: '127.0.0.1', port: 7891 }), 'http://127.0.0.1:7891')
})
