import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerAccountFor,
  providerLoginCellphone,
  providerLoginStatus,
  providerLogout,
  providerLogoutProfile,
  providerQrCheck,
  providerQrCreate,
  providerStatus
} from '../src/features/online/account-channel.ts'

/**
 * 账号组在渲染层的入口：通道名对不对、失败折回哪个兜底值、有没有留下一条
 * 能让控制台追到的 warn。这一层不改主进程的结论，所以测的是「照搬」而不是
 * 「修好」。
 */

type Call = { provider: string; capability: string; args: unknown }

const globals = globalThis as unknown as { window?: unknown }

function install(answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = []
  globals.window = {
    aurora: {
      provider: {
        call: async (provider: string, capability: string, args: unknown) => {
          const call = { provider, capability, args }
          calls.push(call)
          return answer(call)
        }
      }
    }
  }
  return calls
}

function collectWarnings(): { lines: string[]; restore(): void } {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '))
  }
  return { lines, restore: () => (console.warn = original) }
}

test('每个助手走自己那条通道，参数形状固定', async () => {
  const calls = install(() => ({ ok: true, value: [] }))
  await providerStatus('netease')
  await providerLoginStatus('qq')
  await providerAccountFor('kugou', 'acc_1')
  await providerLogoutProfile('netease', 'acc_2')
  await providerQrCreate('qishui', { key: '', imageDataUrl: '' })
  await providerQrCheck('bilibili', 'key-9', { status: 'failed' })
  await providerLogout('netease')
  await providerLoginCellphone('netease', '13800000000', 'pw')
  assert.deepEqual(
    calls.map((call) => call.capability),
    ['status', 'loginStatus', 'accountFor', 'logoutProfile', 'qrCreate', 'qrCheck', 'logout', 'loginCellphone']
  )
  assert.deepEqual(calls[2].args, { profileId: 'acc_1' })
  assert.deepEqual(calls[3].args, { profileId: 'acc_2' })
  assert.deepEqual(calls[5].args, { key: 'key-9' })
  assert.deepEqual(calls[7].args, { phone: '13800000000', password: 'pw' })
})

test('主进程答 ok 时原样返回，不包装', async () => {
  install((call) =>
    call.capability === 'logout' ? { ok: true, value: true } : { ok: true, value: { ready: true } }
  )
  assert.deepEqual(await providerStatus('netease'), { ready: true })
  assert.equal(await providerLogout('netease'), true)
})

test('主进程答 ok 但值是 null，就交回 null（未登录不是失败）', async () => {
  install(() => ({ ok: true, value: null }))
  assert.equal(await providerLoginStatus('qq'), null)
})

test('通道失败时每种助手折回自己的兜底值，并留下一条 warn', async () => {
  install(() => ({ ok: false, error: { code: 'unsupported-capability', message: '没登记' } }))
  const warnings = collectWarnings()
  try {
    assert.equal(await providerStatus('netease'), null)
    assert.equal(await providerAccountFor('netease', 'acc_1'), null)
    assert.equal(await providerLogoutProfile('netease', 'acc_1'), false)
    assert.deepEqual(await providerQrCreate('qq', { key: '', imageDataUrl: '' }), {
      key: '',
      imageDataUrl: ''
    })
    assert.deepEqual(await providerQrCheck('kugou', 'k', { status: 'failed' }), { status: 'failed' })
    assert.equal(await providerLogout('qishui'), false)
    assert.deepEqual(await providerLoginCellphone('netease', '1', '2', { ok: false }), { ok: false })
  } finally {
    warnings.restore()
  }
  assert.equal(warnings.lines.length, 7)
  assert.ok(
    warnings.lines.every((line) => /^\[aurora\] (netease|qq|kugou|qishui|bilibili)\./.test(line))
  )
  assert.match(warnings.lines[0], /unsupported-capability 没登记/)
})

test('没有主进程时不调用通道，折回兜底值', async () => {
  globals.window = undefined
  const warnings = collectWarnings()
  try {
    assert.equal(await providerStatus('netease'), null)
    assert.deepEqual(await providerQrCheck('qq', 'k', { status: 'failed' }), { status: 'failed' })
  } finally {
    warnings.restore()
  }
  assert.match(warnings.lines[0], /没有主进程/)
})

test('调用本身抛错也算没走通，不把异常漏给界面', async () => {
  install(() => {
    throw new Error('ipc closed')
  })
  const warnings = collectWarnings()
  try {
    assert.equal(await providerLoginStatus('netease'), null)
  } finally {
    warnings.restore()
  }
  assert.match(warnings.lines[0], /ipc closed/)
})
