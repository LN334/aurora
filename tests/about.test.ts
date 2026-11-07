import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ISSUES_URL,
  issueUrl,
  platformLabel,
  versionLabel
} from '../src/features/settings/about.ts'

test('platformLabel names the three platforms this app ships on', () => {
  assert.equal(platformLabel('win32'), 'Windows')
  assert.equal(platformLabel('darwin'), 'macOS')
  assert.equal(platformLabel('linux'), 'Linux')
})

test('platformLabel passes an unknown platform through instead of guessing', () => {
  assert.equal(platformLabel('freebsd'), 'freebsd')
  assert.equal(platformLabel(''), '未知')
})

test('versionLabel always reads as a version', () => {
  assert.equal(versionLabel('0.4.0'), 'v0.4.0')
  assert.equal(versionLabel('v0.4.0'), 'v0.4.0')
  assert.equal(versionLabel(''), '未知')
})

test('issueUrl prefills the version and the runtime so the report is complete', () => {
  const url = issueUrl({
    version: '0.4.0',
    electron: '44.7.2',
    chrome: '140.0.0.0',
    node: '22.20.0',
    platform: 'win32'
  })
  assert.ok(url.startsWith(ISSUES_URL + '/new?body='))
  const body = decodeURIComponent(url.slice((ISSUES_URL + '/new?body=').length))
  assert.ok(body.includes('版本：0.4.0'))
  assert.ok(body.includes('Electron 44.7.2'))
  assert.ok(body.includes('平台：Windows'))
})

test('issueUrl survives missing facts without printing undefined', () => {
  const url = issueUrl({ version: '', electron: '', chrome: '', node: '', platform: '' })
  const body = decodeURIComponent(url.slice((ISSUES_URL + '/new?body=').length))
  assert.ok(body.includes('版本：未知'))
  assert.ok(body.includes('平台：未知'))
  assert.ok(!body.includes('undefined'))
})
