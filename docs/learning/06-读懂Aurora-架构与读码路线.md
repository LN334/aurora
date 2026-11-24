# 第 5 站：读懂 Aurora —— 架构与读码路线

> 目标：拿到任何一个功能名，能在 3 分钟内找到它落在哪几个文件；能画出一条「点击 → 出声」的完整链路。
> 这一章不教语法，教**结构感**。它值得反复读。

---

## 一、一句话架构

> **一个曲库，四家平台的素材，一个播放内核，两种（本地/在线）取流方式。**

代码上它长这样：

```
                         ┌─────────────────────────────┐
                         │  src/App.tsx  组件树的总装厂  │
   views/  ──────────────┤  一页一个文件，只负责画与转发  │
                         └──────────────┬──────────────┘
                                        │ props / store 订阅
                         ┌──────────────▼──────────────┐
   features/ ────────────┤  业务逻辑：播放、歌单、平台…   │
                         └──────────────┬──────────────┘
                                        │ 只在需要原生能力时
                         ┌──────────────▼──────────────┐
   bridge → preload ─────┤  IPC：文件、窗口、协议、更新   │  ← 进程边界
                         └──────────────┬──────────────┘
                         ┌──────────────▼──────────────┐
   electron/ ────────────┤  主进程：Node 的一切能力       │
                         └─────────────────────────────┘
```

依赖方向是硬规则：**`views → features → ui`**，主进程 `electron/pure/` 不 import Electron。
反过来（`features` import `views`、`pure` import `electron`）会立刻被 `npm run check` 或裸 Node 测试打回。

---

## 二、五个接缝（seam）

「接缝」= 一个刻意留下的接口，让未来加东西时不用改老代码。
这个项目有五个，全部有注释说明为什么存在。**读懂这五个，等于读懂了这个项目的设计。**

### 接缝 1 · TrackSource：这首歌的音从哪来

```ts
// src/features/library/source.ts:22-33
export interface TrackSource {
  id: string
  name: string
  /** One line for the sources screen. */
  summary: string
  online: boolean
  /** Playable URL for this track, or null when the source cannot serve it. */
  streamUrl(track: Track): string | null
  /** Artwork URL, or null. Must stay same-origin or CORS-clean for Web Audio. */
  artUrl(track: Track, px?: number): string | null
  /** Raw LRC text, or null. */
  lyrics(track: Track): Promise<string | null>
}
```

- 注册表：`SOURCES` 数组（`src/features/library/source.ts:272`），`sourceFor(track)`（第 282 行）按 `track.source` 找源，找不到就回落到本地。
- `Track.source?: string` 的注释写得很妙：**「缺省意味着本地库，这也是为什么加一个远程源不需要动任何既有代码路径。」**
- 现有四个实现：本地、网易云、QQ、酷狗/汽水（各平台各一个对象）。

**学到的设计**：把「资源从哪来」抽成一个函数集合，播放内核就永远不需要知道「这是磁盘文件还是服务器给的」。

### 接缝 2 · AudioDriver：播放怎么发生

```ts
// src/features/player/driver.ts（节选）
interface AudioDriver {
  load(track: Track, autoplay: boolean): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setVolume(): void
  setEq(): void
  isTrackReady(track: Track): boolean
  getSpectrum(): Uint8Array | null
  getWaveform(): Uint8Array | null
  getAudioInfo(): { sampleRate: number; baseLatency: number; state: string } | null
}
```

两处实现：真实的 Web Audio（`webAudioDriver`）和浏览器预览用的合成驱动。注释给了两个理由：**浏览器里能驱动整套 UI（不用开 Electron 就能改视觉）**；**将来换后端不用碰传输逻辑**。

注意 `setVolume()` / `setEq()` **没有参数**——它们直接读 store。这是刻意的：参数版本会让「谁在什么时候设了音量」变成一场传参接力。

### 接缝 3 · OnlineMusicProvider：平台怎么接

`src/features/online/types.ts` 定义契约，`registry.ts` 存一个 `Map<ProviderId, OnlineMusicProvider>`。

三条设计原则（原注释）：

1. **能力是布尔字段**：「这个平台没有每日推荐」是 `recommendations: false`，不是 `if (provider === 'qq')`。
2. **歌自带出处**：`getPlaybackSourceRef(track)` 回答 `{ kind: 'online', providerId }`，调用方不用记得自己从哪一屏来的。
3. **不可用不是错误**：`ProviderSongAvailability` 是独立概念（会员曲、地区限制），有专门的失败词汇表 `OnlineFailureReason`。

**这就是为什么四家平台共用一套页面**：`views/OnlinePage.tsx` 之类的页面从不 import 任何平台模块，只问 registry 要 provider。

### 接缝 4 · Bridge：页面怎么跟系统说话

三件套，缺一不可：

| 文件 | 角色 |
| --- | --- |
| `electron/preload.ts` | 真正暴露能力的地方（`contextBridge.exposeInMainWorld('aurora', api)`，第 759 行） |
| `src/env.d.ts` | 把那份能力「声明」成类型，页面才有提示 |
| `src/bridge.ts` | 页面唯一的访问点；浏览器里回落成内存实现 |

**加一个 IPC 必须四处同步**：主进程 handler → preload 暴露 → `env.d.ts` 声明 → 页面调用。少一处就编译不过或运行时报 `undefined is not a function`。

### 接缝 5 · 私有协议：资源怎么加载

`electron/protocols/` 下四个文件 + `wallpaper.ts`，服务五种用途（`aurora-app:` / `aurora-media:` / `aurora-remote:` / `aurora-cache:` / `aurora-wallpaper:`）。

它们解决同一个问题：**页面需要加载「不属于它自己」的资源，而 Web 的安全模型不允许它直接读文件、也拒绝跨源的 Web Audio。**

---

## 三、主链走查：点一首网易云的歌，声音怎么出来

这是本项目最值得亲手追的一条链。八步，每步都有文件与函数。

**第 1 步 · 行被点击**
`src/ui/TrackList.tsx` 里某一行的播放按钮被点。列表不负责播放，它调父页面传下来的回调。

**第 2 步 · 用户意图**
页面（或点击处理函数）调：

```ts
// src/features/player/actions.ts:50
export const player = {
  playQueue(tracks: Track[], startAt = 0): void { ... },
  playTrack(track: Track): void { ... },
  ...
}
```

`player` 是一个**动作集合**，不是 store。注释解释了为什么要把它们分开放：

> 组件调这些；它们改 store 并驱动 driver。把它们从 store 里拿出去，是为了让 store 不依赖音频图。

**第 3 步 · 进队列**
`playQueue` → `usePlayer.getState().setQueue(tracks, startAt)` → `loadCurrent(true)`。

`usePlayer` 是 zustand store（`src/features/player/store.ts`）。队列、当前索引、播放模式、音量都在这里。它还是**唯一持久化**的那一层（`persist` 中间件 + 档案隔离）。

**第 4 步 · 请 driver 装歌**

```ts
void driver.load(track, autoplay)     // actions.ts 里的 loadCurrent
```

driver 再转给引擎（`src/features/player/engine.ts`）——Web Audio 图、淡入淡出（`FADE_IN_MS = 220`、`FADE_OUT_MS = 150`）、频谱分析都在这。

**第 5 步 · 引擎问「地址呢」**

```ts
// src/features/player/engine.ts 里
sourceFor(track).streamUrl(track)
```

`sourceFor` 按 `track.source === 'netease'` 找到 `neteaseSource`。它的 `streamUrl` 同步返回「这次会话里已经取到的地址」；没有就**报告一次 miss 并返回 `null`**（原注释：miss 不是 failure，地址过期或还没取，让引擎下一次 load 拿真地址重试）。

**第 6 步 · 补地址**
是 `null` 时，引擎去问通过 `setOnlineStreamLoader`（`src/features/player/online-fetch.ts:20`）注册的加载器。注册发生在 `src/features/online/register.ts:27`——**应用启动时一个 `import` 就完成**，没有调用顺序问题。

加载器做的事（节选注释）：

> 一律走 `aurora-cache:`，命中与否由主进程判断：命中是本地文件，未命中它会透传上游并顺手把整首存下来。这样播放内核不需要知道缓存的存在。

**第 7 步 · 过协议**
`<audio src="aurora-cache://...">` → 渲染进程发起请求 → 主进程 `electron/protocols/cache-protocol.ts` 接住 → 命中读本地文件，未命中 `fetch` 上游并写缓存 → 带 CORS 头返回。

**第 8 步 · 出声与回传**
Web Audio 解码播放 → 频谱给可视化 → 进度 ticker 更新 store：

- 窗口可见：正常频率（60 Hz 那套）；
- 窗口不可见：降到 4 Hz，`HIDDEN_POSITION_MS = 250`（`src/features/player/engine.ts`）。注释算得很细：歌词行几秒才变一次，四分之一秒的延迟没人察觉得到；但 `backgroundThrottling: false` 意味着这 4 次/秒就是全部的后台开销。

**这条链的形态，和扫描那条（第 4 站）一模一样**：都是「页面 → store → 接缝 → 跨进程 → 主进程干活 → 回传」。项目里所有功能都长这样。

---

## 四、状态住在哪

23 个文件 import 了 zustand，17 个 store。新人最常问「这个数据在哪」，答案按重要性：

| store | 管什么 | 持久化 |
| --- | --- | --- |
| `src/features/player/store.ts` | 队列、当前曲、播放模式、音量、EQ | **是**（按档案隔离） |
| `src/features/library/store.ts` | 本地曲库、扫描进度、根目录 | 索引在主进程，store 只镜像 |
| `src/features/online/store.ts` | 每家平台的列表/详情缓存、取流状态 | 部分 |
| `src/features/settings/store.ts` | 全局设置状态 | 各设置项自己管 key |
| `src/features/playlists/store.ts` | 用户自建歌单 | **是** |
| `src/features/downloads/store.ts` | 下载任务 | 主进程持有任务，store 镜像 |

规矩：**需要跨重启记住的，进 store + persist 或进主进程；只影响当前这一屏的，留在组件 state。**

---

## 五、读码顺序（十二步）

按这个顺序读，每一步都比上一步深一层。**读完一步要能用自己的话说出它干什么，再走下一步。**

| # | 文件 | 带着问题读 |
| --- | --- | --- |
| 1 | `package.json`（scripts） | 这个项目怎么跑、怎么验、怎么打包？ |
| 2 | `src/main.tsx` | 应用启动时，除了挂 React 还做了什么「只做一次」的事？为什么这些 import 没有接收者？ |
| 3 | `src/types.ts` | `Track` 有哪些字段？哪些是「必须」、哪些是为某个平台加的补丁？ |
| 4 | `src/App.tsx` 的 `return` | 组件树从外到内是什么顺序？哪些东西是常驻的（播放条、弹层）？ |
| 5 | `src/app/routing.ts` + `src/app/shell.ts` | 「我现在在哪一页」这件事由谁决定？ |
| 6 | `src/features/player/store.ts` | 队列是什么形状？`order` 和 `queue` 为什么要分开？ |
| 7 | `src/features/player/actions.ts` | 用户能做哪些动作？哪些动作会引发「跳过链」？ |
| 8 | `src/features/player/driver.ts` → `engine.ts` | 播放内核对外只暴露什么？fade 与 ticker 在哪？ |
| 9 | `src/features/library/source.ts` | 五个接缝里最漂亮的一个：加一个源要改什么？ |
| 10 | `src/bridge.ts` → `electron/preload.ts` | 页面能碰到的全部原生能力有哪些？ |
| 11 | `electron/ipc/library.ts` → `electron/library-scan.ts` | 一条 IPC 的两端怎么接上？慢活在主进程怎么组织？ |
| 12 | `electron/main.ts`（只读窗口创建与启动顺序） | 一个桌面应用的启动要按什么顺序做哪些事？ |

第 12 步会很长。**只读两个地方**：`createWindow()` 里的 `webPreferences`，和 `app.whenReady()` 之后的注册顺序（协议、IPC、托盘、更新）。其余跳过。

---

## 六、「我要改 X」该动哪

这是最实用的表。左列是你想改的东西，右列是起点（不保证穷尽，但方向对）。

| 想改 | 起点 | 大概率还要动 |
| --- | --- | --- |
| 配色 / 主题 | `src/styles/tokens.css` | `src/features/settings/theme.ts`、`accent.ts` |
| 某一页的布局 | `src/views/XxxPage.tsx` + `src/styles/xxx.css` | 可能 `src/ui/` 里的共享组件 |
| 播放页 | `src/views/NowPlayingPage.tsx` | `src/views/player-bar/`、`src/styles/player.css` |
| 加一个设置项 | 仿 `src/features/settings/row-density.ts` | `src/views/settings/panes/`、用到它的组件 |
| 扫描逻辑 | `electron/library-scan.ts` | `electron/pure/library-discovery-rules.ts`、`library-paths.ts` |
| 加一个平台 | `src/features/online/types.ts` + `registry.ts` | `electron/<平台>/`、`src/env-types/platforms.ts`、`preload.ts` |
| 歌词解析 / 滚动 | `src/features/lyrics/` | `electron/lyrics.ts`、`src/styles/` 对应文件 |
| 桌面歌词窗 | `electron/lyrics-overlay.ts` | `src/overlay/`、`src/styles/overlay.css` |
| 自动更新 | `electron/updates.ts`、`update-download.ts` | `src/features/updates/store.ts`、`src/ui/UpdateDialog.tsx` |
| 打包 / 安装器 | `package.json` 的 `build` 段 | `build/`、`build/after-pack.js` |
| 加一个 IPC | 主进程 handler | preload、`src/env.d.ts`、调用处（**四处**） |
| 加一个私有协议 | `electron/protocols/` 找最近的先例 | `electron/main.ts` 注册、`index.html` 的 CSP 白名单 |

最后一行值得单拎出来：**CSP 白名单是新手最容易漏的一步**。加了协议、页面还是不加载，八成是忘了改 `index.html` 里那串 `img-src` / `media-src` / `connect-src`。

---

## 七、四个常见误解

**误解 1：「App.tsx 有 2000 行，说明设计很差」**
它是个总装厂：所有页面的状态都在最外层（因为播放条、弹层、路由都挂在根上）。拆它要先把「哪些状态真的需要全局」想清楚，否则会拆出一堆互相传参的中间层。这是**有意的集中**，不是懒。

**误解 2：「为什么不用 Redux」**
zustand 的 store 就是 `create()` 一个对象，没有 action/reducer/dispatch 那套仪式。这个项目的状态不需要时间旅行调试，也不需要中间件链。**工具要匹配问题规模。**

**误解 3：「在线平台和本地是两套系统」**
界面上一套（共用 `TrackList`、`ArtCard`），数据上一套（`Track` 同一形状，`source` 区分），播放上一套（`TrackSource` 接缝）。**三层都统一，只是实现分开。** 这是本项目最核心的取舍。

**误解 4：「注释这么多是废话」**
这个仓库的注释几乎全是「为什么」，而且经常是在记录**踩过的坑**：

```ts
// src/features/player/crossfade.ts
// 上一版在引擎里读 crossfadeSec 只把它当成一个开关（>0 就淡 190ms），
// 滑到 12 秒和滑到 1 秒没有区别。
```

这段注释的价值等于一次 code review。学会读它，你会少走很多弯路；学会写它，你就从「会写代码」变成「能维护代码」。

---

## 八、自测

1. 五个接缝分别解决什么问题？各自的接口文件在哪？
2. 加一个音源（比如 NAS 上的 Jellyfin）最少要改几个文件？为什么这么少？
3. 点一首歌到出声，经过哪几个进程？
4. 「歌的地址过期了」被当成错误处理吗？项目怎么处理它？
5. 为什么页面不能直接 `import fs`？
6. `views` 和 `features` 的依赖方向是什么？反过来会坏在哪？
7. 一个设置从 localStorage 到界面生效，要经过哪几层？（提示：`row-density.ts`）
8. 加一个 IPC，四处同步缺一处分别会报什么错？

---

## 九、练手

本章练手全部是「理解类」，写代码的正式练习在第 7 章。

**练手 1（1 小时）**：拿一张 A4 纸，凭记忆画三层架构 + 五个接缝，标上文件路径。画完对照本章，标出你画错的地方。

**练手 2（40 分钟）**：在仓库里搜 `sourceFor(`，列出所有调用点（应该不多）。回答：为什么播放内核只要这一个入口就够了？

**练手 3（1 小时）**：随机挑一个 `views/` 下的页面，往上追它的数据从哪个 store 来、往下追它调了哪些 `features` 的动作。用一张纸画出这个页面的「数据输入 / 事件输出」。

**练手 4（30 分钟）**：读 `docs/architecture.md` 的「依赖方向（硬规则）」一节，然后自己用 `grep -rn "from '../../views" src/features` 验证规则有没有被破坏。没有输出就是没破坏——这个动作本身就是一次 code review。
