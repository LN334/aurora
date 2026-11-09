import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, killTree, listTargets, sleep, waitForDevtools } from './perf-lib.mjs'

/**
 * The window walk.
 *
 * README has said since 0.1 that the logic is tested but "the application itself
 * has never been run in a real Windows window top to bottom". This is that run,
 * made repeatable: it launches the built app with a throwaway profile, visits
 * every screen in the rail, screenshots each one, and fails if a screen is blank,
 * logs a console error, throws, or leaves a cover with no pixels.
 *
 * What it is not: a substitute for looking at the screenshots. It proves a screen
 * renders and stays quiet; whether it is *good* is still a human judgement, which
 * is why the images are kept rather than only the pass/fail line.
 *
 *   node scripts/smoke.mjs                                       # current build
 *   node scripts/smoke.mjs --exe=release/win-unpacked/Aurora.exe  # packaged app
 *
 * Flags: --port=<n>, --keep (leave the app open), --no-network (record instead of
 * failing on artwork that needs the internet).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SHOTS = path.join(ROOT, 'shots', 'smoke')
const PROFILE = path.join(ROOT, '.smoke', 'profile')

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const at = arg.indexOf('=')
    return at === -1 ? [arg.replace(/^--/, ''), 'true'] : [arg.slice(2, at), arg.slice(at + 1)]
  })
)
const PORT = Number(args.get('port') ?? 9250)
const KEEP = args.has('keep')
const NO_NETWORK = args.has('no-network')
const EXE = args.get('exe') ? path.resolve(ROOT, args.get('exe')) : null
/** A music folder to index before the walk, so the shelves are not empty. */
const LIBRARY = args.get('library') ? path.resolve(ROOT, args.get('library')) : null

/**
 * The walk, in the order a person would take it: every top-level item in the
 * rail, in the order the rail shows them.
 *
 * `title` is the text that page actually prints, not the name of the concept -
 * the home page opens with a greeting and its first heading is 推荐, and 漫游
 * lands on the now-playing screen, so a walk that expected the rail label to
 * come back would wait six seconds and pass for the wrong reason.
 *
 * Not walked any more: the account screen and the platform screens. Both moved
 * under the profile row at the bottom of the rail, and their contents depend on
 * a signed-in account, so a throwaway profile cannot prove them.
 */
const JOURNEY = [
  { view: 'now', kind: 'rail', label: '现在', title: '推荐' },
  { view: 'roam', kind: 'rail', label: '漫游', title: '漫游' },
  { view: 'liked', kind: 'rail', label: '我喜欢的', title: '我喜欢的音乐' },
  { view: 'recent', kind: 'rail', label: '最近播放', title: '最近播放' },
  { view: 'playlists', kind: 'rail', label: '歌单', title: '歌单' },
  { view: 'albums', kind: 'rail', label: '专辑', title: '专辑' },
  { view: 'artists', kind: 'rail', label: '艺人', title: '艺人' },
  { view: 'settings', kind: 'rail', label: '设置', title: '设置' }
]

function fail(message) {
  console.error('smoke: ' + message)
  process.exit(2)
}

/**
 * The page's own diagnostics, as data rather than as console noise.
 *
 * A cover that failed to decode is not a console error in Electron - the loader
 * just leaves an <img> at zero pixels - so the images are counted here instead.
 */
const PROBE = [
  '(() => {',
  "  const imgs = Array.from(document.images)",
  '  const broken = imgs.filter((img) => img.complete && img.naturalWidth === 0 && img.src)',
  '  const text = (document.body.innerText || "").trim()',
  '  return JSON.stringify({',
  '    text: text.slice(0, 160),',
  '    textLength: text.length,',
  '    images: imgs.length,',
  '    brokenCount: broken.length,',
  '    broken: broken.slice(0, 5).map((img) => img.src.slice(0, 120))',
  '  })',
  '})()'
].join('\n')

function ensureBuild() {
  if (EXE) {
    if (!fs.existsSync(EXE)) fail('executable not found: ' + EXE)
    return
  }
  for (const rel of ['dist/index.html', 'dist-electron/main.js']) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail('missing ' + rel + ' - run "npm run build" first')
    }
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  })
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
    throw new Error('page evaluation threw: ' + String(text).slice(0, 400))
  }
  return result.result.value
}

/** Where each kind of step keeps its clickable rows. */
const STEP_SELECTORS = {
  rail: '.rail-item'
}

/** Click the control this step names, and say whether it existed. */
async function clickStep(cdp, step) {
  const expression = [
    '(() => {',
    '  const rows = Array.from(document.querySelectorAll(' + JSON.stringify(STEP_SELECTORS[step.kind]) + '))',
    // A row can carry a count next to its label (the rail prints one for songs, the
    // section tabs print one each), so match the label prefix, not the whole text.
    "  const row = rows.find((node) => (node.querySelector('.nav-item__label')?.textContent || node.textContent || '').trim().startsWith(" + JSON.stringify(step.label) + '))',
    '  if (!row) return false',
    '  row.click()',
    '  return true',
    '})()'
  ].join('\n')
  return (await evaluate(cdp, expression)) === true
}

/**
 * One screenshot, with a second chance.
 *
 * A page that is still pulling cover art can occasionally leave the compositor
 * without a frame to capture, and the CDP call then sits until its deadline. That
 * is a reason to try again, not a reason to fail the whole walk.
 */
async function shoot(cdp, filePath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'))
      return true
    } catch (error) {
      console.log('smoke: screenshot attempt ' + (attempt + 1) + ' failed: ' + error.message)
      await sleep(1500)
    }
  }
  return false
}

/**
 * Subresource failures the application expects, counted instead of failed.
 *
 * Two of them, both 404s Chromium logs as errors:
 *
 *  - aurora-media://art/ is the documented "this track has no embedded cover"
 *    answer. The scanner never decodes pictures, so it assumes artwork exists and
 *    the artwork request settles the question.
 *  - aurora-wallpaper://…/scene.json is the scene engine probing for the older
 *    JSON project format before falling back to scene.pkg. Workshop projects that
 *    ship a package have no scene.json at all.
 *
 * Everything else is still a real error, so these are counted apart.
 */
function isQuietMiss(event) {
  const entry = event.params?.entry
  if (entry?.level !== 'error' || !/ 404 /.test(String(entry.text || ''))) return false
  const url = String(entry.url || '')
  return url.startsWith('aurora-media://art/') || url.startsWith('aurora-wallpaper://')
}

async function waitForHeading(cdp, title, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await evaluate(cdp, 'document.body.innerText.slice(0, 400)')
    if (typeof text === 'string' && text.includes(title)) return true
    await sleep(150)
  }
  return false
}

async function main() {
  ensureBuild()
  fs.rmSync(SHOTS, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.rmSync(PROFILE, { recursive: true, force: true })
  fs.mkdirSync(PROFILE, { recursive: true })

  /*
   * The app derives its data directory from --user-data-dir, so pointing a root at
   * a throwaway profile is enough to hand it a library without touching the real
   * one. A populated library needs an index: the app scans on boot when folders are
   * configured and the index is empty, which is exactly this state.
   */
  if (LIBRARY) {
    if (!fs.existsSync(LIBRARY)) fail('library folder not found: ' + LIBRARY)
    fs.writeFileSync(
      path.join(PROFILE, 'settings.json'),
      JSON.stringify({ roots: [LIBRARY], rootsDiscovered: true }, null, 2)
    )
    console.log('smoke: seeded library root ' + LIBRARY)
  }

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const command = EXE ?? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const argv = EXE
    ? ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--disable-gpu']
    : ['.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--disable-gpu']

  console.log('smoke: launching ' + path.basename(command) + ' on port ' + PORT)
  const child = spawn(command, argv, { cwd: ROOT, env, stdio: 'ignore' })
  let cdp = null
  const rows = []
  const errors = []
  /** Cover requests that 404'd because the file simply has no embedded art. */
  let quietMisses = 0

  try {
    await waitForDevtools(PORT, { timeoutMs: 60000 })
    const targets = await listTargets(PORT)
    const page = targets.find((target) => target.type === 'page')
    if (!page) fail('no page target; targets seen: ' + targets.map((t) => t.type).join(', '))

    cdp = await Cdp.connect(page.webSocketDebuggerUrl, { callTimeoutMs: 30000 })
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')

    // The shell paints before it finishes booting; wait for the rail rather than
    // for did-finish-load, which arrives while the tree is still empty.
    let booted = false
    for (let i = 0; i < 80; i += 1) {
      if (await evaluate(cdp, "Boolean(document.querySelector('.rail'))")) {
        booted = true
        break
      }
      await sleep(250)
    }
    if (!booted) fail('the shell never drew a rail')
    console.log('smoke: page ' + (await evaluate(cdp, 'window.location.href')))

    // A seeded library scans in the background; walking the shelves before it
    // finishes would photograph the empty state and pass for the wrong reason.
    if (LIBRARY) {
      /*
       * 首屏是「现在」，它在没有播放记录时不长歌曲行，所以「等首页出现 .trk」永远等不到。
       * 先等后台扫描结束（扫描中会在页面上写「正在扫描」），再切回首页确认索引真的
       * 长成了行 —— 这一步同时是「播种曲库确实被读到」的断言。
       */
      const scanDeadline = Date.now() + 180000
      while (Date.now() < scanDeadline) {
        const scanning = await evaluate(cdp, '(document.body.innerText || "").includes("正在扫描")')
        if (!scanning) break
        await sleep(500)
      }
      await clickStep(cdp, { view: 'now', kind: 'rail', label: '现在', title: '推荐' })
      await sleep(600)
      const rowsDeadline = Date.now() + 30000
      let rendered = 0
      while (Date.now() < rowsDeadline) {
        rendered = await evaluate(cdp, 'document.querySelectorAll(".trk").length')
        if (rendered > 0) break
        await sleep(300)
      }
      if (rendered === 0) fail('the seeded library rendered no rows')
      console.log('smoke: library rendered ' + rendered + ' rows')
    }

    for (let index = 0; index < JOURNEY.length; index += 1) {
      const step = JOURNEY[index]
      const mark = cdp.events.length
      if (!(await clickStep(cdp, step))) {
        rows.push({ ...step, ok: false, why: 'no ' + step.kind + ' labelled ' + step.label })
        continue
      }
      const reached = await waitForHeading(cdp, step.title, 6000)
      await sleep(700) // let artwork and rows settle before the shot

      const probe = JSON.parse(await evaluate(cdp, PROBE))
      const shotName = String(index + 1).padStart(2, '0') + '-' + step.view + '.png'
      const shotPath = path.join(SHOTS, shotName)
      const shotOk = await shoot(cdp, shotPath)

      const fresh = cdp.events.slice(mark)
      const logged = fresh
        .filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
        .filter((event) => !isQuietMiss(event))
        // The text alone says "400 (Bad Request)" without naming the request, which
        // is useless when chasing it. Carry the URL next to it.
        .map((event) => {
          const url = String(event.params.entry.url || '')
          return url ? event.params.entry.text + ' <- ' + url : event.params.entry.text
        })
      quietMisses += fresh.filter(isQuietMiss).length
      const thrown = fresh
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map(
          (event) =>
            event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text
        )
      errors.push(...logged, ...thrown)

      const problems = []
      if (!reached) problems.push('heading "' + step.title + '" never appeared')
      if (!shotOk) problems.push('screenshot failed')
      if (probe.textLength < 20) problems.push('blank screen')
      if (logged.length) problems.push(logged.length + ' console error(s)')
      if (thrown.length) problems.push(thrown.length + ' uncaught exception(s)')
      if (probe.brokenCount && !NO_NETWORK) problems.push(probe.brokenCount + ' broken image(s)')

      rows.push({
        ...step,
        ok: problems.length === 0,
        why: problems.join('; '),
        images: probe.images,
        broken: probe.brokenCount,
        brokenSrcs: probe.broken,
        shot: path.relative(ROOT, shotPath)
      })
    }

    /*
     * The wallpaper backdrop, when this machine can offer one.
     *
     * Wallpaper Engine is optional and Windows-only, so this is a conditional
     * assertion: if the settings screen lists no wallpapers, the walk says so and
     * moves on. When one is listed, picking it has to actually paint the shell -
     * the scene engine (webwallgl) mounting a real .pkg, or a video/image element
     * for the other kinds. A wallpaper that is listed but mounts nothing is the
     * failure this step exists to catch.
     */
    {
      const mark = cdp.events.length
      await clickStep(cdp, { kind: 'rail', label: '设置' })
      await waitForHeading(cdp, '设置', 6000)

      // The row ships with the switch on; turn it on if a saved setting said off.
      const switchState = await evaluate(
        cdp,
        [
          "(() => {",
          "  const row = Array.from(document.querySelectorAll('.settings__row')).find((node) => (node.textContent || '').includes('Wallpaper Engine'))",
          "  if (!row) return 'no row'",
          '  const box = row.querySelector("input") || row.querySelector("[role=switch]")',
          "  if (!box) return 'no switch'",
          "  const on = box.checked === true || box.getAttribute('aria-checked') === 'true'",
          "  if (!on) box.click()",
          "  return on ? 'already on' : 'turned on'",
          "})()"
        ].join("\n")
      )

      let cards = 0
      if (switchState !== "no row" && switchState !== "no switch") {
        const deadline = Date.now() + 25000
        while (Date.now() < deadline) {
          cards = await evaluate(cdp, 'document.querySelectorAll(".wp-card").length')
          if (cards > 0) break
          await sleep(400)
        }
      }

      // Thumbnails are files on disk served over aurora-wallpaper://, so they
      // settle quickly; a 404 or a decode failure leaves naturalWidth at 0.
      let thumbs = { total: 0, pending: 0, broken: 0 }
      if (cards > 0) {
        const deadline = Date.now() + 25000
        while (Date.now() < deadline) {
          thumbs = JSON.parse(
            await evaluate(
              cdp,
              [
                "(() => {",
                "  const imgs = Array.from(document.querySelectorAll('.wp-grid img'))",
                "  return JSON.stringify({",
                "    total: imgs.length,",
                "    pending: imgs.filter((img) => !img.complete).length,",
                "    broken: imgs.filter((img) => img.complete && img.naturalWidth === 0).length",
                "  })",
                "})()"
              ].join("\n")
            )
          )
          if (thumbs.total > 0 && thumbs.pending === 0) break
          await sleep(500)
        }
      }

      const picked =
        cards > 0
          ? await evaluate(
              cdp,
              [
                "(() => {",
                "  const all = Array.from(document.querySelectorAll('.wp-card'))",
                "  const pick = all.find((card) => card.querySelector('.wp-card__art img'))",
                "  if (!pick) return ''",
                "  pick.scrollIntoView({ block: 'center' })",
                "  pick.click()",
                "  const title = pick.querySelector('.wp-card__title')",
                "  return title ? title.textContent.trim() : '(untitled)'",
                "})()"
              ].join("\n")
            )
          : ""

      let stage = { present: false, className: "", shellHasWallpaper: false, level: "", canvas: 0, video: 0, frames: [] }
      if (picked) {
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
          stage = JSON.parse(
            await evaluate(
              cdp,
              [
                "(() => {",
                "  const shell = document.querySelector('.shell')",
                "  const wall = document.querySelector('.wallpaper')",
                "  const kids = wall ? Array.from(wall.children).map((node) => node.tagName) : []",
                "  return JSON.stringify({",
                "    present: Boolean(wall),",
                "    className: wall ? wall.className : '',",
                "    shellHasWallpaper: shell ? shell.classList.contains('has-wallpaper') : false,",
                "    level: shell ? shell.style.getPropertyValue('--wp-level') : '',",
                "    canvas: wall ? wall.querySelectorAll('canvas').length : 0,",
                "    video: wall ? wall.querySelectorAll('video').length : 0,",
                "    frames: kids",
                "  })",
                "})()"
              ].join("\n")
            )
          )
          const painted = stage.canvas > 0 || stage.video > 0 || stage.frames.includes("IMG") || stage.frames.includes("IFRAME")
          if (stage.present && painted) break
          await sleep(500)
        }
      }

      // A scene is a WebGL animation, so two captures a second apart must differ.
      // A still picture is allowed to be identical, hence a record and not a rule.
      let framesDiffer = null
      if (stage.canvas > 0) {
        const before = await cdp.send("Page.captureScreenshot", { format: "png" })
        await sleep(900)
        const after = await cdp.send("Page.captureScreenshot", { format: "png" })
        framesDiffer = before.data !== after.data
      }

      await sleep(400)
      const shotPath = path.join(SHOTS, "08b-settings-wallpaper.png")
      const shotOk = await shoot(cdp, shotPath)

      const fresh = cdp.events.slice(mark)
      const logged = fresh
        .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
        .filter((event) => !isQuietMiss(event))
        .map((event) => event.params.entry.text)
      quietMisses += fresh.filter(isQuietMiss).length
      const thrown = fresh
        .filter((event) => event.method === "Runtime.exceptionThrown")
        .map(
          (event) =>
            event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text
        )
      errors.push(...logged, ...thrown)

      const problems = []
      if (!shotOk) problems.push("screenshot failed")
      if (thumbs.broken > 0 && !NO_NETWORK) problems.push(thumbs.broken + " broken wallpaper thumbnail(s)")
      if (picked && !stage.present) problems.push("picking a wallpaper painted no backdrop")
      if (picked && stage.present && !stage.canvas && !stage.video && !stage.frames.includes("IMG") && !stage.frames.includes("IFRAME"))
        problems.push("the backdrop mounted no scene canvas and no media element")
      if (picked && !stage.shellHasWallpaper) problems.push("the shell never took the has-wallpaper state")
      if (logged.length) problems.push(logged.length + " console error(s)")
      if (thrown.length) problems.push(thrown.length + " uncaught exception(s)")

      const note =
        cards === 0
          ? "no wallpaper listed (" + switchState + ") - Wallpaper Engine not installed, or still scanning"
          : ""
      console.log(
        "smoke: wallpapers switch=" + switchState + ", cards=" + cards + ", picked=" + (picked || "-") +
          ", backdrop=" + (stage.present ? stage.className + " canvas=" + stage.canvas + " video=" + stage.video : "none") +
          (framesDiffer === null ? "" : ", frames differ=" + framesDiffer)
      )

      rows.push({
        view: "wallpaper",
        label: "壁纸背景",
        ok: problems.length === 0,
        why: problems.length ? problems.join("; ") : note,
        images: thumbs.total,
        broken: thumbs.broken,
        brokenSrcs: [],
        shot: path.relative(ROOT, shotPath)
      })
    }

    /*
     * One online search, typed the way a person types it.
     *
     * This is the only step that proves the remote path end to end: a search goes
     * out through the platform backend, comes back as tracks, and their covers are
     * loaded over aurora-remote://. Artwork is counted rather than console-checked
     * because a cover that fails to decode raises nothing - the <img> just stays at
     * zero pixels, which is the failure this walk exists to catch.
     */
    {
      const mark = cdp.events.length
      const typed = await evaluate(
        cdp,
        [
          '(() => {',
          '  const input = document.querySelector("#global-search")',
          '  if (!input) return false',
          '  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set',
          '  setter.call(input, "夜")',
          '  input.dispatchEvent(new Event("input", { bubbles: true }))',
          '  const form = input.closest("form")',
          '  if (form) form.requestSubmit()',
          '  return true',
          '})()'
        ].join('\n')
      )
      /*
       * Pick the online tab explicitly rather than trusting whatever the screen
       * considers its default: this step exists to prove the remote path, and a
       * walk that silently searched the (empty) local library would pass while
       * proving nothing.
       */
      /*
       * Search used to split its results behind a row of source tabs; it now
       * searches every platform at once, so there is nothing to pick. Keep the
       * click for screens that still offer the row, and carry on when they do
       * not: what this step proves is rows arriving, which is checked below.
       */
      let picked = 'every platform'
      if (typed) {
        const screenDeadline = Date.now() + 8000
        while (Date.now() < screenDeadline) {
          if (await evaluate(cdp, 'Boolean(document.querySelector(".tabs--sources .tab[data-remote]"))')) break
          await sleep(200)
        }
        picked = await evaluate(
          cdp,
          [
            '(() => {',
            '  const tabs = Array.from(document.querySelectorAll(".tabs--sources .tab[data-remote]"))',
            '  const remote = tabs[0]',
            '  if (!remote) return "every platform"',
            '  remote.click()',
            '  return (remote.textContent || "").trim()',
            '})()'
          ].join('\n')
        )
      }

      /*
       * Search answers as a table, not a wall of cards, so the proof here is
       * rows that arrived from the platform - not artwork. The cover pipeline is
       * covered where covers actually appear.
       */
      let probe = { images: 0, brokenCount: 0, textLength: 0, broken: [] }
      let hits = 0
      if (typed) {
        const deadline = Date.now() + 25000
        while (Date.now() < deadline) {
          hits = await evaluate(cdp, 'document.querySelectorAll(".trk").length')
          if (hits > 0) break
          await sleep(500)
        }
        probe = JSON.parse(await evaluate(cdp, PROBE))
      }
      const heading = await evaluate(
        cdp,
        "document.querySelector('main h1') ? document.querySelector('main h1').textContent.trim() : ''"
      )
      console.log(
        'smoke: searched through ' + picked + ', rows=' + hits + ', heading=' + heading + ', images=' + probe.images
      )
      await sleep(600)
      const shotPath = path.join(SHOTS, '12-search-online.png')
      const shotOk = await shoot(cdp, shotPath)

      const fresh = cdp.events.slice(mark)
      const logged = fresh
        .filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
        .filter((event) => !isQuietMiss(event))
        // The text alone says "400 (Bad Request)" without naming the request, which
        // is useless when chasing it. Carry the URL next to it.
        .map((event) => {
          const url = String(event.params.entry.url || '')
          return url ? event.params.entry.text + ' <- ' + url : event.params.entry.text
        })
      quietMisses += fresh.filter(isQuietMiss).length
      const thrown = fresh
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map(
          (event) =>
            event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text
        )
      errors.push(...logged, ...thrown)

      const problems = []
      if (!typed) problems.push('no search field in the title bar')
      if (!shotOk) problems.push('screenshot failed')
      if (picked === 'not asked') problems.push('the search box never accepted the query')
      if (heading !== '搜索') problems.push('left the search screen (heading: ' + heading + ')')
      if (hits === 0 && !NO_NETWORK) problems.push('the online search returned no rows')
      if (probe.brokenCount) problems.push(probe.brokenCount + ' broken cover(s)')
      if (logged.length) problems.push(logged.length + ' console error(s)')
      if (thrown.length) problems.push(thrown.length + ' uncaught exception(s)')

      rows.push({
        view: 'search-online',
        label: '在线搜索',
        ok: problems.length === 0,
        why: problems.join('; '),
        images: probe.images,
        broken: probe.brokenCount,
        brokenSrcs: probe.broken,
        shot: path.relative(ROOT, shotPath),
        rows: hits
      })
    }

    /*
     * Start one online track. Searching proves the platform's catalogue reaches
     * the window; pressing play on a result proves the other half - the main
     * process resolving a stream URL and the engine advancing through it. The
     * check is "the bar moved past 0:00", which is true of playback and false of
     * a URL that failed to resolve (that leaves the bar showing 0:00 and an error
     * notice instead).
     */
    {
      const mark = cdp.events.length
      const title = await evaluate(
        cdp,
        'document.querySelector(".trk .trk__title") ? document.querySelector(".trk .trk__title").innerText.trim() : ""'
      )
      /*
       * 真的鼠标点一下，而不是 element.click()。
       *
       * Chromium 只把手势当用户意图，脚本点击拿不到播放许可：歌能加载出总时长
       * （4:32），进度却一直停在 0:00，看上去像播放坏了。
       */
      const spotJson = await evaluate(
        cdp,
        [
          '(() => {',
          '  const row = document.querySelector(".trk .trk__hit")',
          '  if (!row) return "null"',
          '  const r = row.getBoundingClientRect()',
          '  return JSON.stringify({ x: r.left + Math.min(160, r.width / 2), y: r.top + r.height / 2 })',
          '})()'
        ].join('\n')
      )
      let clicked = 'no row'
      if (spotJson && spotJson !== 'null') {
        const spot = JSON.parse(spotJson)
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: spot.x,
          y: spot.y,
          button: 'left',
          clickCount: 1
        })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: spot.x,
          y: spot.y,
          button: 'left',
          clickCount: 1
        })
        clicked = 'clicked'
      }
      let bar = ''
      let moved = false
      if (clicked === 'clicked') {
        const deadline = Date.now() + 35000
        while (Date.now() < deadline) {
          bar = await evaluate(
            cdp,
            "document.querySelector('.player') ? document.querySelector('.player').innerText.replace(/\\n/g, ' / ') : ''"
          )
          const time = /(\d+):(\d\d)/.exec(bar)
          if (time && Number(time[1]) * 60 + Number(time[2]) >= 2) {
            moved = true
            break
          }
          await sleep(500)
        }
      }
      console.log('smoke: played "' + title + '" through ' + clicked + ', bar=' + bar)
      await sleep(400)
      const shotPath = path.join(SHOTS, '13-play-online.png')
      const shotOk = await shoot(cdp, shotPath)

      const fresh = cdp.events.slice(mark)
      const logged = fresh
        .filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
        .filter((event) => !isQuietMiss(event))
        // The text alone says "400 (Bad Request)" without naming the request, which
        // is useless when chasing it. Carry the URL next to it.
        .map((event) => {
          const url = String(event.params.entry.url || '')
          return url ? event.params.entry.text + ' <- ' + url : event.params.entry.text
        })
      quietMisses += fresh.filter(isQuietMiss).length
      const thrown = fresh
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map(
          (event) =>
            event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text
        )
      errors.push(...logged, ...thrown)

      const problems = []
      if (clicked !== 'clicked') problems.push('no online row to play')
      if (!moved) problems.push('playback never advanced past 0:00 (bar: ' + bar + ')')
      // The row prints the title and the platform on separate lines; the bar prints
      // the title alone. Compare the first line, not the whole cell.
      const shown = String(title || '').split('\n')[0].trim()
      if (!shown || !bar.includes(shown)) problems.push('the player bar does not show the track that was started')
      if (!shotOk) problems.push('screenshot failed')
      if (logged.length) problems.push(logged.length + ' console error(s)')
      if (thrown.length) problems.push(thrown.length + ' uncaught exception(s)')

      rows.push({
        view: 'play-online',
        label: '在线播放',
        ok: problems.length === 0,
        why: problems.join('; '),
        images: 0,
        broken: 0,
        brokenSrcs: [],
        shot: path.relative(ROOT, shotPath)
      })
    }

    /*
     * 音量滑杆的边界：拖到 0 之后按静音键两次，界面必须回到一个能听见的音量。
     * 旧实现只把 muted 关掉、音量仍是 0，于是「取消静音」按了等于没按。
     */
    {
      const mark = cdp.events.length
      const readVolume =
        'document.querySelector(".pb-volume") ? Number(document.querySelector(".pb-volume").getAttribute("aria-valuenow")) : -1'
      const clickMute = [
        "(() => {",
        "  const b = Array.from(document.querySelectorAll('.pb-vol .pb-btn')).find((n) => (n.getAttribute('aria-label') || '').indexOf('静音') >= 0)",
        "  if (!b) return 'no mute button'",
        "  b.click()",
        "  return b.getAttribute('aria-label')",
        "})()"
      ].join("\n")
      let slider = null
      const rectJson = await evaluate(
        cdp,
        "(() => { const v = document.querySelector('.pb-volume'); if (!v) return 'null'; const r = v.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }) })()"
      )
      if (rectJson && rectJson !== 'null') slider = JSON.parse(rectJson)
      if (slider) {
        const y = slider.y + slider.h / 2
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: slider.x + 1, y, button: 'left', clickCount: 1 })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slider.x + 1, y, button: 'left', clickCount: 1 })
        await sleep(300)
      }
      const beforeMute = await evaluate(cdp, readVolume)
      await evaluate(cdp, clickMute)
      await sleep(250)
      const mutedAt = await evaluate(cdp, readVolume)
      await evaluate(cdp, clickMute)
      await sleep(350)
      const restoredAt = await evaluate(cdp, readVolume)
      const shotPath = path.join(SHOTS, '14-volume.png')
      const shotOk = await shoot(cdp, shotPath)
      console.log('smoke: volume ' + beforeMute + '% -> muted ' + mutedAt + '% -> unmuted ' + restoredAt + '%')

      const fresh = cdp.events.slice(mark)
      const logged = fresh
        .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
        .filter((event) => !isQuietMiss(event))
        .map((event) => event.params.entry.text)
      quietMisses += fresh.filter(isQuietMiss).length
      const thrown = fresh
        .filter((event) => event.method === "Runtime.exceptionThrown")
        .map(
          (event) =>
            event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text
        )
      errors.push(...logged, ...thrown)

      const problems = []
      if (!slider) problems.push('no volume slider in the player bar')
      if (mutedAt !== 0) problems.push('muting did not take the volume to 0 (aria-valuenow=' + mutedAt + ')')
      // 静音前刚把滑条拖到最左，原始音量本来就只有 1%。取消静音要回到那个值，
      // 而不是某个「听起来合理」的数字——旧实现的 bug 是回到 0，按了等于没按。
      if (!(restoredAt >= 1)) problems.push('unmuting left the volume at ' + restoredAt + '%')
      if (!shotOk) problems.push('screenshot failed')
      if (logged.length) problems.push(logged.length + ' console error(s)')
      if (thrown.length) problems.push(thrown.length + ' uncaught exception(s)')

      rows.push({
        view: 'volume',
        label: '音量与静音',
        ok: problems.length === 0,
        why: problems.join('; '),
        images: 0,
        broken: 0,
        brokenSrcs: [],
        shot: path.relative(ROOT, shotPath)
      })
    }
    // The player bar is on every screen; a walk that never sees it would still
    // pass every step above, so it gets its own check.
    if (!(await evaluate(cdp, "Boolean(document.querySelector('.player'))"))) {
      errors.push('the player bar is missing from the shell')
    }
  } finally {
    if (KEEP) {
      if (cdp) cdp.close()
      console.log('smoke: --keep left the app running on port ' + PORT)
    } else {
      if (cdp) cdp.close()
      try {
        await killTree(child)
      } catch {
        try {
          child.kill()
        } catch {
          /* already gone */
        }
      }
      await sleep(800)
    }
  }

  console.log('')
  console.log('view         label        images  broken  result')
  console.log('----------------------------------------------------------')
  for (const row of rows) {
    console.log(
      String(row.view).padEnd(13) +
        String(row.label).padEnd(13) +
        String(row.images ?? '-').padEnd(8) +
        String(row.broken ?? '-').padEnd(8) +
        (row.ok ? 'ok' : 'FAIL: ' + row.why)
    )
  }

  const failed = rows.filter((row) => !row.ok)
  console.log('')
  console.log('smoke: ' + (rows.length - failed.length) + '/' + rows.length + ' screens passed')
  if (quietMisses) {
    console.log('smoke: ' + quietMisses + ' expected 404(s) - art for files without a cover, scene.json probes')
  }
  console.log('smoke: screenshots in ' + SHOTS)
  for (const row of failed) {
    if (row.brokenSrcs && row.brokenSrcs.length) console.log('  ' + row.view + ': ' + row.brokenSrcs.join(' | '))
  }
  if (errors.length) {
    console.log('smoke: console errors (' + errors.length + '):')
    for (const text of [...new Set(errors)].slice(0, 12)) console.log('  ' + String(text).slice(0, 240))
  }
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('smoke: ' + (error && error.stack ? error.stack : error))
  process.exit(1)
})
