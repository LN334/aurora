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
import { useNetease } from './features/netease/store'
import { bridge } from './bridge'
import { setActiveStorageProfile } from './features/accounts/profile-storage'
import { useAccounts } from './features/accounts/store'
import { applyReduceMotion, readReduceMotion } from './features/settings/motion'

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
useAccounts.getState().ensureDefault()
setActiveStorageProfile(useAccounts.getState().activeId)
/*
 * The same for the library, which lives in the main process.
 *
 * Not awaited: the first render must not wait for an IPC round trip. But it is
 * sent before any component mounts, which is what keeps the opening frame from
 * reading the index of whichever profile the main process fell back to.
 */
const openingProfile = useAccounts.getState().activeId
if (openingProfile) void bridge.library.useProfile(openingProfile)

/*
 * Ask the online source whether it is usable and who is signed in.
 *
 * Deliberately not awaited and deliberately not fatal: it is a network round
 * trip to a third-party service on a cold start, and the offline parts of the
 * app - which is nearly all of it - must not wait for it or fail with it.
 */
void useNetease.getState().init()

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
  requestAnimationFrame(() => console.log('[boot] first frame painted', Math.round(performance.now())))
})
