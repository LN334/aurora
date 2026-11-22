import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, listTargets, sleep, waitForDevtools } from './perf-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9277
const PROFILE = path.join(ROOT, '.cmt4', 'profile')
fs.rmSync(PROFILE, { recursive: true, force: true })
fs.mkdirSync(PROFILE, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--disable-features=CalculateNativeWinOcclusion'],
  { cwd: ROOT, env, stdio: 'ignore' })

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.text))
  return result.result?.value
}

try {
  await waitForDevtools(PORT, { timeoutMs: 60000 })
  const targets = await listTargets(PORT)
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url))
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl, { callTimeoutMs: 25000 })
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 80; i += 1) {
    if (await evaluate(cdp, "!document.getElementById('splash') && Boolean(document.querySelector('.rail'))")) break
    await sleep(300)
  }
  await evaluate(cdp, `(() => { for (const d of document.querySelectorAll('[role=dialog]')) { const b = [...d.querySelectorAll('button')].find((x) => ['以后再说','稍后再设','知道了','暂不登录'].includes(x.textContent.trim())); if (b) b.click() } return true })()`)
  await evaluate(cdp, `(() => {
    const input = document.querySelector('#global-search')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '夜')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.closest('form')?.requestSubmit()
  })()`)
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(cdp, "document.querySelectorAll('.trk__hit').length > 0")) break
    await sleep(300)
  }
  await evaluate(cdp, "document.querySelectorAll('.trk__hit')[0].click()")
  await sleep(1200)
  await evaluate(cdp, "location.hash = '#comments'")
  await sleep(3000)
  await evaluate(cdp, `(() => {
    const box = document.querySelector('.cmt__input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, '测试')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(150)
  await evaluate(cdp, "document.querySelector('.cmt__send')?.click()")
  await sleep(2500)
  const texts = await evaluate(cdp, "[...document.querySelectorAll('.toast__text')].map((n) => n.textContent)")
  console.log('toasts:', JSON.stringify(texts))
  const logs = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled').map((e) => (e.params.args || []).map((a) => a.value ?? a.description).join(' ')).filter((l) => l.includes('cmt-send'))
  console.log('console:', JSON.stringify(logs))
} finally {
  try { child.kill() } catch {}
}
