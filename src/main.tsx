import './features/perf/long-tasks'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import './styles/player.css'
import './styles/roam.css'
import { App } from './App'
import './features/player/actions'
/*
 * Playback wiring for the online source. Imported for its side effects, exactly
 * like `player/actions`: it is the module that connects the source to the
 * transport, so neither of them has to import the other.
 */
import './features/player/netease'
/*
 * Fill the online platform registry before anything renders.
 *
 * Imported for its side effects and nothing else: every screen that talks about
 * platforms - the rail, the search tabs, the settings page - reads the registry, and
 * a registry that is empty at first paint would draw a shell with no online
 * sections at all. Doing it here rather than from a component makes the failure
 * mode obvious (no platforms anywhere) instead of partial (one screen missing a
 * platform the others have).
 */
import './features/online/register'
import { bridge } from './bridge'
import { warmChosenPlatforms } from './features/online/push-platforms'
import { prewarmAfterSplash, prewarmPages } from './app/prewarm'
import { useLikes } from './features/favorites/likes'
import { setActiveStorageProfile } from './features/accounts/profile-storage'
import { loadProfilePresets } from './features/presets/store'
import { useAccounts } from './features/accounts/store'
import { useParty } from './features/party/store'
import { applyReduceMotion, readReduceMotion } from './features/settings/motion'
import { applyRowDensity, readRowDensity } from './features/settings/row-density'
import { applyLyricSize, readLyricSize } from './features/settings/lyric-size'
import { applyTheme, readTheme } from './features/settings/theme'
import { applyBackdrop, readBackdrop } from './features/settings/backdrop'

/*
 * Establish the profile before anything renders.
 *
 * Profile-scoped storage decides where data lands from a module-level variable,
 * so a write that happens while no profile exists lands in a placeholder slot
 * that no profile will ever read - and is then discarded when the real profile
 * loads. Doing this here rather than in an effect closes that window entirely:
 * by the time any component mounts, there is a profile and the stores are
 * already pointing at its slot.
 */
applyReduceMotion(readReduceMotion())
applyLyricSize(readLyricSize())
applyRowDensity(readRowDensity())
/* 首帧之前就要把主题落到 <html> 上，否则会用浏览器默认色闪一下。 */
applyTheme(readTheme())
/* 背景材质与模糊半径，同样只落一次，之后由设置页改。 */
applyBackdrop(readBackdrop())
useAccounts.getState().ensureDefault()
setActiveStorageProfile(useAccounts.getState().activeId)
/* 预设的 persist 在模块加载时已经读过一次盘（那时档案还没设），这里按真档案重读。 */
void loadProfilePresets(useAccounts.getState().activeId)
/*
 * 一起听的状态常驻订阅。
 *
 * 以前这一步在「一起听」页挂载时才做：人没进过那一页，别人点他发来的邀请
 * 链接，主进程把链接递过来也没有人接——点了没反应。房间本来就活在主进程里，
 * 界面开没开都不影响它，那就该从启动起就听着。
 */
useParty.getState().init()
/*
 * The same for the library, which lives in the main process.
 *
 * Not awaited: the first render must not wait for an IPC round trip. But it is
 * sent before any component mounts, which is what keeps the opening frame from
 * reading the index of whichever profile the main process fell back to.
 */
const openingProfile = useAccounts.getState().activeId
if (openingProfile) void bridge.library.useProfile(openingProfile)

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

// Deliberately not wrapped in StrictMode: its double-invoked effects would
// build and tear down the Web Audio graph twice, which produces audible
// glitches and duplicate Media Session registrations.
/*
 * 启动打点。
 *
 * 用户嘴里的「打开慢」是窗口出现到看见内容这一段，只有把 render 派发、首帧、
 * 窗口 show 三个时刻放在同一条时间轴上，才知道慢在哪一段。console.log 会被
 * 主进程的 console-message 转发进 startup.log，所以这几行别删。
 */
console.log('[boot] module evaluated', Math.round(performance.now()))
createRoot(container).render(<App />)
console.log('[boot] render dispatched', Math.round(performance.now()))
// 双 rAF：第一个回调在下一帧绘制前，第二个在那一帧已经上屏之后。
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    console.log('[boot] first frame painted', Math.round(performance.now()))
    /*
     * 首帧之后才预热。
     *
     * 预热会把用户勾选的平台后端拉起来——网易云那一步要 require 上游 API 包，
     * 实测常驻 RSS +93 MB——放在 render 之前等于让它和首屏抢同一段时间。推到
     * 首帧之后，冷启动那段窗口期就不再被它拖长；用户点进漫游或搜索时，它多半
     * 已经跑完了。
     */
    warmChosenPlatforms()
    /*
     * 顺手把「我喜欢的」拉一次。心形按钮读的是这份缓存，而它以前只有进过
     * 「我喜欢的」页才被填上——重启之后先看首页或播放页时，在线歌的心全是灭的，
     * 要绕一圈才和平台对得上。这里不等它，拉到了自然会重画。
     */
    void useLikes.getState().refreshAll()
  })
})

/*
 * 摘掉开屏。
 *
 * index.html 里那块纯 CSS 开屏从 HTML 解析完就开始动，应用首帧之后淡出。
 * 用 rAF 等到下一次绘制再摘，避免「刚画完还没提交就被盖住」；另外留一个 4 秒
 * 兜底——壁纸解析卡住时不能把开屏永远留在那儿。
 */
{
  const splash = document.getElementById('splash')
  if (splash) {
    const shownAt = performance.now()
    const MIN_MS = 3200
    const MAX_MS = 7000
    /* 预热最多等这么久（歌单与我喜欢的要问四家平台，比首页慢）；拉不动就按原节奏揭幕。 */
    const WARM_MS = 6000
    let gone = false
    const dismiss = () => {
      if (gone) return
      gone = true
      splash.classList.add('is-gone')
      window.setTimeout(() => splash.remove(), 620)
    }
    /*
     * 揭幕前等一等：开屏这几十毫秒不白花，用来把首页与每日推荐的数据拉起来。
     *
     * 只在首帧之后摘是不够的：预热过的机器首帧只要几十毫秒，开屏一闪就没了；
     * 而且那时数据还没回来，切到首页照样是骨架格。现在改成首帧之后再等预热
     * 落地（最多 6 秒），然后按最短停留补足；上限 7 秒兜底壁纸解析卡住。
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        startSplashVideo()
        const warm = prewarmPages()
        const gate = Promise.race([
          warm.catch(() => undefined),
          new Promise((resolve) => window.setTimeout(resolve, WARM_MS))
        ])
        void gate.then(() => {
          /* 揭幕之后才去拉要问四家平台的那几块，别压在开屏那三秒上。 */
          prewarmAfterSplash()
          const wait = Math.max(0, MIN_MS - (performance.now() - shownAt))
          window.setTimeout(dismiss, wait)
        })
      })
    })
    window.setTimeout(dismiss, MAX_MS)
  }
}

/**
 * 开屏那段实拍视频：等首帧之后再取。
 *
 * 海报写在 HTML 的 `poster` 上（33 KB 的 JPEG），所以开屏一出现就有画面；这段
 * 只负责把 436 KB 的片子接进来。放在首帧之后，是因为启动那几百毫秒正在挂
 * React、解析壁纸，这时候再起一份视频解码只是抢同一块 CPU。
 *
 * 顺带解释了为什么这里不能用内联 `<script>`：CSP 是 `script-src 'self'`，
 * index.html 里的内联脚本会被直接拦掉，视频永远不会加载。
 */
function startSplashVideo(): void {
  const video = document.querySelector<HTMLVideoElement>('.splash__video')
  if (!video) return
  /*
   * 视频的地址与 autoplay 都写在 HTML 标签上，浏览器解析到它就开始取、开始解，
   * 不必等这一段 JS——这一段只做两件事：尊重「减少动态效果」，以及兜一次 play()。
   *
   * 之前是首帧之后才给 src，于是开屏先挂着一张静帧等好几百毫秒才动起来。
   */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.pause()
    return
  }
  const played = video.play()
  if (played && typeof played.catch === 'function') played.catch(() => undefined)
}
