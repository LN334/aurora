import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ISSUES_URL,
  issueUrl,
  platformLabel,
  rendererLabel,
  stamp,
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

test('rendererLabel says where this copy of the UI came from', () => {
  assert.equal(rendererLabel(undefined), '未知')
  assert.equal(rendererLabel({ source: 'bundle', version: '', hash: '', at: 0 }), '安装包自带')
  assert.equal(
    rendererLabel({ source: 'ota', version: '0.9.25', hash: 'abc', at: 0 }),
    '本机热更 0.9.25'
  )
  assert.equal(
    rendererLabel({
      source: 'ota',
      version: '0.9.25',
      hash: 'abc',
      at: new Date(2026, 10, 22, 15, 52).getTime()
    }),
    '本机热更 0.9.25 · 11-22 15:52'
  )
  /* 老脚本写出的热更没有版本，只剩时间也要能读。 */
  assert.equal(
    rendererLabel({ source: 'ota', version: '', hash: 'abc', at: new Date(2026, 0, 3, 9, 5).getTime() }),
    '本机热更 · 01-03 09:05'
  )
})

test('stamp pads every field and refuses a time it cannot read', () => {
  assert.equal(stamp(new Date(2026, 0, 3, 9, 5).getTime()), '01-03 09:05')
  assert.equal(stamp(Number.NaN), '')
})

test('issueUrl survives missing facts without printing undefined', () => {
  const url = issueUrl({ version: '', electron: '', chrome: '', node: '', platform: '' })
  const body = decodeURIComponent(url.slice((ISSUES_URL + '/new?body=').length))
  assert.ok(body.includes('版本：未知'))
  assert.ok(body.includes('平台：未知'))
  assert.ok(!body.includes('undefined'))
})
