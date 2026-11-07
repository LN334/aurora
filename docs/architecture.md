# 代码结构与约定

这份文档说明代码放在哪里、为什么这样分、以及哪些方向不允许反向依赖。界面设计的决定
另见 [`ui-design.md`](./ui-design.md)。

## 分层

```
src/
  app/          外壳与装配：App、路由、预览开关、Rail、TitleBar、跨功能的派生数据
  features/     功能模块，每个功能自成一目录（store / hooks / 该功能专属组件）
    accounts/     档案、按档案分区存储、在线账号绑定
    online/       **平台层**（与具体平台无关的一切）：契约、注册表、共享 store、
                  共享屏幕、直链缓存、预览开关
    netease/      网易云：provider 声明 + 它自己的登录弹窗 + api/track/stream/lrc
    qq/           QQ 音乐：它自己的登录弹窗与视图（provider 声明在 online/qq-provider.ts）
    library/      本地曲库：store、扫描、来源接缝、封面、歌单树、配色
    lyrics/       歌词解析（LRC）
    player/       播放内核：engine、driver、queue、urls、进度条；history.ts 是播放历史的
                  纯函数（按本地日历日累计、最近 60 条），history-store.ts 负责攒批与落盘
    playlists/    歌单：m3u 读写、存储、导入导出的流程
    home/         主页（侧栏第一项，路由仍是 discover）：问候、上次听到、四张快捷卡、
                  今日聆听、最近播放；平台推荐直接嵌 discover/
    discover/     平台公开内容（推荐歌单/新歌速递/分类歌单）+ 它的纯函数与 store
    settings/     设置状态的读写；motion.ts 是「动态效果」开关（只有渲染层，存 localStorage）
    wallpaper/    动态背景：选择规则的纯函数、开关与可见度的存储、场景挂载
  views/        页面与面板，一个文件一个屏幕或一块面板；views/settings/ 是单页设置的
                四个编号分区（parts.tsx 是排版零件，panes/ 每段一个文件）；
                AccountView.tsx 是账号页（档案 + 在线平台 + 本地文件夹），
                settings/panes/AccountPane.tsx 是它的内容，两者共用同一份零件
  ui/           共享基元：ArtCard、Artwork、icons、TrackList、format、UpdatePanel
  stage/        歌词舞台与可视化
  overlay/      桌面歌词窗口（独立入口 overlay.html）
  styles/       全局样式；功能专属样式跟随其目录
  preview/      仅预览构建使用的压力测试种子
electron/
  pure/         零 Electron 依赖、可在裸 Node 下测试的纯逻辑（含 netease-bootstrap 的
                重试策略）
  protocols/    私有协议：aurora-app:// aurora-media:// aurora-remote:// aurora-wallpaper://
  netease/      网易云客户端与 IPC
  qq/           QQ 音乐客户端与 IPC，按 transport / normalize / reasons / session 分文件
  wallpaper.ts  Wallpaper Engine 库扫描与 aurora-wallpaper:// 协议（只读，不改对方文件）
  ipc/          按域注册 IPC：app / library / wallpaper / overlay / updates / lyrics /
                player / settings；host.ts 只声明依赖接口，窗口与扫描状态由 main.ts 注入
  main.ts       Electron 主进程外壳：单实例锁、窗口生命周期、协议、托盘、启动扫描
scripts/        开发与审计工具（见下方「审计」）
tests/          单元测试，主要覆盖纯逻辑
```

### 主页与播放历史（`src/features/home/`）

侧栏第一项叫主页，回答的是「接着听什么」，不是「有哪些新内容」。它在打开应用的第一屏就
给出四件事：上次听到的那首（能直接继续）、我的音乐（各平台账号状态）、为你挑选（平台公开推荐）、
今日听了多久与最常听谁。最近播放排在最后。
参考项目 Mineradio-paused 的主页也是这个顺序：先给「你刚才在干什么」，再给「世界有什么」。

- 历史存在渲染层（`features/player/history.ts` 是纯函数，`history-store.ts` 是攒批与落盘）：
  按**本地日历日**累计秒数与曲目，最近 60 条，3 分钟内重复播放不算两条。
- 只统计真正走过的播放时间：`engine.ts` 的 `recordProgress` 在 `currentTime` 前进且
  增量 ≤ 3 秒时才计入，seek 与拖动不算听歌。攒到 1 秒才记账，5 秒或 20 秒缓冲后写 localStorage，
  暂停、切歌、关窗时强制 flush。
- 今日聆听、最常听、接下来播放全部在渲染层算，没有为此加任何接口。

### 单页设置（`src/views/settings/`）

设置曾经是三个导航项（档案 / 音源 / 偏好设置），各有一半答案。现在是一页五个编号分区，
按「你会为什么来这里」排：01 播放与音质、02 外观与桌面、03 快捷键、04 更新与关于、
05 清理与维护。

**账号不在这**：`src/views/AccountView.tsx` 是独立一页（入口是侧栏底部的头像），
内容是 `settings/panes/AccountPane.tsx`。它和设置页共用 `parts.tsx` 的排版零件与
`settings.css`，所以两页看起来是同一个系统的两屏，而不是两套界面。把它留在设置里会
让「换档案 / 扫码登录」这种高频动作埋进低频页面。

- **排版零件**在 `parts.tsx`：`Part`（编号方块 + 英文小标 + 中文名 + 发丝线）、`Sub`、`Rows`、
  `Row`（左标签右控件）、`Toggle`、`Actions`。设置页的四个 pane 与账号页只用这些零件，
  不再各写一套行样式。
- **每项只有一个真源**：能播什么、音质、歌词开关在 `features/settings/store.ts`（主进程持有）；
  「动态效果」在 `features/settings/motion.ts`（纯渲染层，localStorage + `.is-reduced-motion`）；
  壁纸在 `features/wallpaper/store.ts`。设置页只接线，不另存一份。
- **窗口行为由主进程兑现**：`closeToTray` 写进主进程设置文件，主窗口的 `close` 处理读它决定
  隐藏还是真关；全屏走 `window:toggleFullscreen` IPC（`F11` 与设置页按钮是同一个调用）。
  渲染层永远拿不到 BrowserWindow，也就不该假装能控制它。
- **档案头像**（`src/features/accounts/store.ts` 的 `avatar?`）：用户选的图在渲染层用
  canvas 缩成 96×96 的 JPEG data URL（约 4–8 KB），直接存在档案对象里——档案本身就在
  localStorage，头像跟着它一起存、一起删，不需要在主进程再维护一套「谁的头像文件」映射。
  显示优先级在 `useOnlineBindings` 之上：自设头像 → 该档案绑定的平台账号头像（经
  `remoteImageUrl` 走主进程代理，跨源图片直连会被 CSP 拦）→ 档案名首字。侧栏底部的
  档案入口与账号页共用同一份判断（`features/accounts/bindings.ts`），两处必须是同一张脸。
- **快捷键是只读清单**（`panes/HotkeysPane.tsx`）：键位写死在 `src/app/useKeyboardShortcuts.ts`，
  做可录制键位要连带处理冲突、持久化与重载，收益小于风险。改键位时同时改这个 pane 与 README 的表。

### 平台层（`src/features/online/`）

在线音乐曾经是硬编码的网易云。结构照参考软件 Folia 的 provider 模式做（分析见
[`reference-players.md`](./reference-players.md)），因为它是被验证过的形状，而自己发明一个
只会得到同一套东西的另一版命名。

- **注册表**：`Map<ProviderId, Provider>`，UI 只调 `listProviders()`，不 import 任何具体平台。
  `providerForTrack(track)` 按歌曲反查平台。
- **契约是一组布尔能力**：`capabilities` 里 `search / playback / lyrics / auth / collections / …`
  全是布尔，每个能力对应一个可选子接口。**平台没有某功能是 `false`，不是在 UI 里判断它是谁。**
- **歌曲自带来源**：`{ kind: 'online', providerId }`，取代了以前的 `track.source === 'netease'`。
- **侧栏与搜索页从注册表生成**：加一个平台不改这两个文件一行代码。
- **可用性三态**：`playable` / `unknown + restricted` / `takenDown`。判决只来自真实请求，
  运行时不回写（这是 Folia 契约里的规则：权限/付费/地区属于「受限」，不能当成「已下架」）。
- **平台专属界面留在平台自己目录里**：两个登录弹窗不共用，因为它们的流程真的不同；
  硬抽象成「通用登录」会比它替换掉的两份代码更长。

## 依赖方向（硬规则）

```
views  →  features  →  ui
app    →  features / views / ui
electron/main  →  electron/pure        （pure 不得反向依赖）
electron/pure  →  只有 node: 内置模块与类型
```

- **`ui/` 不得 import `features/`。** 基元层若依赖功能层，就再也不能当作基元用。
  实测踩过两次：`Bar.tsx`（播放进度条，属播放器）与 `formatTime`（通用格式化，属基元）
  曾都放在 `ui/` 里却引用播放器 store。前者移入 `features/player/`，后者抽成 `ui/format.ts`。
- **`electron/pure/` 不得 import 其它 `electron/` 模块。** 一旦引入 `settings` 这类
  会 `import electron` 的模块，整个目录就无法在测试里加载，`pure` 也就名不副实。
  `ScanProgress` 类型因此定义在 `pure/scan-progress.ts`，由 `library-scan` 转发导出。
- **视图不直接碰 store 之外的接线**：跨功能的编排写进 `app/` 的 hook
  （如 `useLibraryData`），而不是塞进 `App`。

## 一页一个标题、界面规则

见 [`ui-design.md`](./ui-design.md)。要点：标题由外壳打印、页内不重复；本地与在线共用
`ArtCard`；页内不再造侧栏；曲库操作只在 `LIBRARY_VIEWS` 里出现。

## 审计

三个脚本用来自动回答「有没有死代码」，而不是靠印象：

```bash
npm run check     # 类型检查 + 测试 + 下面两个审计
node scripts/audit-reachability.mjs   # 从真实入口走 import 图，找无法加载的文件
node scripts/audit-css.mjs            # 找代码与 HTML 都合成不出来的 CSS 类
node scripts/audit-exports.mjs        # 找只在本文件内使用的导出
```

`audit-css.mjs` 需要理解三类误报，否则会得出错误结论：模板字符串拼接的类名
（`` `lyr--d${n}` ``）、CSS 注释里提到的文件名（`tokens.css`）、以及 HTML 入口里的类名
（`overlay.html` 的 `overlay-body`）。脚本已处理这三类。

## 桌面歌词

`overlay.html` 是一个独立的无边框透明置顶窗口（`electron/lyrics-overlay.ts`）。页面只负责画，
「鼠标现在是不是在歌词上」由主进程判断，原因是一条实测结论：锁定（鼠标穿透）时窗口设的是
`setIgnoreMouseEvents(true, { forward: true })`，但 `forward` 转发的 `mousemove` 根本到不了页面
（`window` 上的计数为 0，而 `document.elementFromPoint(中心)` 却能命中歌词行）。所以页面 hover
不可靠。

现在改成：页面用 `ResizeObserver` 量出文字板矩形，通过 `overlay:hit-area` 上报；主进程每 70ms
读一次 `screen.getCursorScreenPoint()`，与窗口 bounds 加这块矩形比较（四周留 10px 容差），命中就
把穿透关掉并发 `overlay:hover`，页面收到后浮出控制条。鼠标移开立刻恢复穿透——于是锁定状态下
不用先解锁也能拖动和点按钮。

视觉上不画底板：静止态只有文字与一圈径向暗晕（`::before`，`opacity: .92`），悬停时才淡入一层
34% 的深色卡片（`::after`）承托控制条。顶部的 28px 内边距就是给控制条留的座位，不然按钮会压在
第一行歌词上。

## 真实窗口巡检

测试只覆盖纯逻辑，所以界面另有一条走真实 Electron 窗口的巡检：

```bash
npm run smoke                          # 空曲库，走完 13 个页面
npm run smoke -- --library=<文件夹>     # 先播种曲库再走，能查到扫描结果
```

它启动的是 `node_modules/electron/dist/electron.exe`（不是打包产物），参数里带自己的
`--user-data-dir`，因此 `app.getPath('userData')` 也跟着指到临时目录——**不会碰用户真实的
settings.json 和档案**。播种曲库就是把 `{ roots: [文件夹] }` 写进那份临时 settings.json。

每一步点侧栏、等标题出现、截图，并用 Runtime 收集控制台错误与未捕获异常；空屏、破图、
标题没出现都算失败。最后两步走出纯本地：联网搜一次（校验确实落到在线标签、行数大于 0），
再点开第一首在线歌（校验播放条时间走过了 0:00，失败时会停在 0:00 并弹错误提示）。

`aurora-media://art/…` 的 404 不算失败：扫描器不解码封面，`hasArt` 是乐观值，没有内嵌封面的
文件本来就会走到「请求失败 → 用占位图」这条路，Chromium 只是把这次失败记进控制台。巡检把它
单独计数，其余控制台错误仍然算失败。

`aurora-wallpaper://…/scene.json` 的 404 同理：场景引擎先探测旧式的 JSON 工程，只带 `scene.pkg`
的工坊项目本来就没有这个文件。两类 404 一起计数。

末尾还有一步条件性的壁纸验证：偏好设置里确实列出了壁纸时，点一张、等背景层挂上 scene canvas
（或视频/图片元素）、连拍两帧确认场景在动；列表为空就把这一步记为「没有壁纸」，不算失败。

## 动态背景（Wallpaper Engine）

壁纸不是自研格式，也不去驱动 Wallpaper Engine：主进程只读地读它的数据，渲染层把同一份
工程交给 WebGL 场景引擎。

- **主进程**（`electron/wallpaper.ts` + `electron/pure/wallpaper-rules.ts`）：从注册表
  （HKCU 的 `SteamPath`、两个 HKLM 的 `InstallPath`）与每个库的 `libraryfolders.vdf` 找出
  Steam 根，用 `steamapps/common/wallpaper_engine/config.json` 判定引擎在，再扫
  `steamapps/workshop/content/431960/*` 与引擎自带的 `projects/*`。当前壁纸只取
  `<账号>.general.wallpaperconfig.selectedwallpapers`（每显示器一条、值是**文件**路径），
  刻意不读 `wallpaperconfigrecent`——那是历史，盲扫会把上次用过的当成正在用的。扫描结果
  缓存 30 秒，全程只读：不启动、不修改 Wallpaper Engine。
- **协议**（`aurora-wallpaper://wp/<id>/<相对路径>`）：把 id 映射回扫描到的项目目录、拒绝
  越界（`isInside`）、支持 Range 206，缩略图和视频都从这条协议取。
- **渲染层**（`src/features/wallpaper/`）：`pure.ts` 是选择规则的纯函数（存了什么、跟随当前、
  项目里挑哪个入口文件），`store.ts` 把开关/选择/可见度写进 localStorage
  （`aurora.backdrop.wallpaper`、`.id`、`.strength`），`Backdrop.tsx` 对场景壁纸动态
  `import('webwallgl')` 挂载 `.pkg`，其余 kind 直接出 `<video>` / `<iframe>` / `<img>`。
  外壳加 `has-wallpaper` 类，CSS 用 `--wp-level` 把 rail / main / player 的底色改成半透明，
  再用一层 veil 压暗背景，保证文字对比不被壁纸吃掉。
- **CSP**：`index.html` 的 `img-src` / `media-src` / `connect-src` 必须列出
  `aurora-wallpaper:`，否则 Chromium 在协议处理器之前就拒绝缩略图、视频与场景包的 fetch。
  场景里动态加载的字体是 `blob:`，所以 `font-src` 要带上 `blob:`。
- **体积**：`webwallgl`（约 1.1 MB）只能经 `Backdrop.tsx` 的动态 import 到达；
  `vite.config.ts` 的 manualChunks 明确把它排除在共享 vendor 之外，不用壁纸的人不下载它。

## 清理与维护

「设置 → 05 清理与维护」的实现在 `electron/maintenance.ts`，两个动作：

- **释放内存**：`releaseMemory()` 找出应用自己的全部进程（主进程、GPU、渲染进程、utility），
  用 PowerShell 的 `EmptyWorkingSet` 逐个把工作集交还系统，前后各读一次 `WorkingSet64` 报告
  实际释放量。播放不会中断：交还的只是暂时用不到的页，用过再缺页换回来。
- **垃圾文件**：`scanJunk()` 量三类——缓存（`settings.ts` 导出的 `CACHE_DIRS` 九个目录）、
  日志、崩溃转储。`sweepJunk()` 的结论有一条是实测出来的：**缓存删不掉**。Chromium 以
  共享删除方式打开这些文件，`unlink` 返回成功但空间不归还，清理前后两次测量一个字节都不差。
  所以缓存一律写进 `userData/junk-pending.json`，由 `sweepPendingJunk()` 在
  `app.whenReady()` 里、建窗口之前清掉；日志与崩溃转储当场删。
- `JunkScan` 因此带两个数字：`cleanedBytes`（两次测量真实下降的量）与 `deferredBytes`
  （排进下次启动、取清理后缓存总量）。两者互为补数，界面上写「已清理」和「下次启动再清」，
  不会同一批字节既算清掉又算没清。

## 搬迁工具

`scripts/move-files.mjs` 移动文件并改写所有相对 import（静态、动态、type-only、
`export … from`），基于 TypeScript AST 而不是正则：

```bash
node scripts/move-files.mjs --plan scripts/moves/features.json          # 试运行，打印改动
node scripts/move-files.mjs --plan scripts/moves/features.json --apply  # 执行
```

计划文件在 `scripts/moves/`。工具在动任何文件**之前**会校验全部源路径与目标路径。

## 踩过的坑（避免重复）

- **脚本按行号切分大文件很危险**：一次失败会留下半改的文件。正确做法是写入前完成全部
  自检，失败后**先从 git 恢复再重试**，不要在中间态上打补丁。
- **锚点要用足够精确的文本**：锚 `'Preview benchmark mode'` 命中了另一段注释里提到它的
  那一行，整块提取偏移了六行。用 `' * Preview benchmark mode'` 才唯一。
- **仓库检出是 CRLF**：按 `'\n'` 搜索字符串会全部落空，先规范化行尾。
- **验证打包产物必须用 `@electron/asar`**：手算头部偏移会读到错位数据；在整包里搜字符串
  会误报（被打包的 JS 里也有同样的字符串）。
- **PowerShell 5.1**：不支持 `??`；`Set-Content -Encoding UTF8` 会写入 BOM（JSON 会解析
  失败），需要无 BOM 时用 Node 写文件。

## 尚待完成

按「值不值得」排序，附当前行数（2026-10，平台抽象之后）：

- **`src/App.tsx`（964 行）**仍是最大的渲染层文件：键盘快捷键、播放/导航动作、
  六段视图分发的 JSX 都在其中。`useKeyboardShortcuts` 与 `usePlaybackActions` 已经抽出
  （曾经约 1180 行），剩下的主要是视图分发与头部接线，可以再拆，但收益已经不如从前。
- **`electron/netease/client.ts`（840 行）**按 bootstrap / 会话 / 搜索 / 播放 / 登录拆分。
  它是全项目最大的文件，且 `bootstrap` 那段逻辑（含重试策略）已经证明值得独立。
- **`src/features/online/store.ts`（592 行）与 `PlatformView.tsx`（591 行）**是平台层的两个大件；
  前者可分离「搜索 / 目录 / 直链」三块状态，后者可按界面区块拆组件。
- 未统一 store 写法；有一批导出只在本文件内使用，可以收窄（`npm run audit:exports` 是入口）。

**已经做完、不必再列**（这份文档曾经把它们列为待办）：

- `src/features/netease/store.ts` 从 571 行降到 237 行：它现在是**适配器**而非实现，
  内部转发到平台层的共享 store。两套直链缓存合并成了一套——那正是抽象要消灭的重复。
- 在线音乐不再是硬编码网易云：见上方「平台层」。
- 三个死代码审计都接入了 `npm run check`。
- `electron/main.ts` 的 IPC 注册拆到了 `electron/ipc/`（878 → 574 行，41 个 channel
  的名称、校验与返回形状一字未改，依赖靠 `ipc/host.ts` 的接口注入）。
