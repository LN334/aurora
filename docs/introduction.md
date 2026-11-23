# Aurora（极光）

Aurora 是一个 Windows 桌面音乐客户端。网易云、QQ 音乐、酷狗、汽水四家的账号，加上本机的音乐文件夹，在它里面是同一个曲库；B 站没有单独入口，视频可以当歌放，取的是音频轨。同一首歌在几家都有时，列表里只占一行，播放时按用户排的音源顺序挑一个能放的。

现在是 0.9.x。版本号、已知边界和最近改了什么见 [CHANGELOG](../CHANGELOG.md)；架构与接缝见 [architecture](./architecture.md)；界面规则见 [ui-design](./ui-design.md)。

技术栈是 Electron 44、React 19、TypeScript 5、Vite 7、Zustand 5，没有 UI 组件库和 CSS 框架，图标是手写 SVG，配色写在 `src/styles/tokens.css`。

## 它做什么

它是容器，不带内容。曲库来自用户自己的账号与文件夹，播放的是各平台给的音频地址，它只负责把这几摊东西摆成一份能用的列表。

明确不做的事：

- 不做曲库。拿不到版权，它一直是各平台的客户端。
- 不破解付费。会员曲、加密音频、会员音质都不碰，界面直接说原因。
- 不做第二套主题。颜色跟着封面走，再叠皮肤会和这套打架。
- 不上传。曲库、歌单、历史、统计全在本机，没有遥测与崩溃上报。

## 界面

### 一层玻璃

0.7.7 把整个窗口重做成一块玻璃：壁纸在最底下，内容层是一层半透明 + 模糊 + 1px 内描边的面，卡片是这层玻璃上的薄片。深色玻璃透明度 0.56，浅色 0.66——浅色要更实，否则亮壁纸会把字吃掉。

只有「一整块的面」（每日推荐、上次听到、快捷卡、面板）才铺底；封面式卡片（歌单卡、专辑卡、最近听过）靠封面自己分块，底下不垫东西。播放条浮在内容之上，不占布局的最后一行。

### 颜色

界面里唯一的动态值是 `--accent`：从当前封面取主色，其余强调色都从它派生，没有组件写死品牌色。灰阶只有一条（`--ink-1000..500`），浅色主题整条翻过来，角色不变。文字只有三档：`--text-hi / mid / low`。

品牌标记 `BrandMark` 是固定三色渐变（`#2ad9c8 → #36aef3 → #8f5cf0`），不跟封面变。

### 尺度

| 区块 | 形态 | 关键尺寸 |
| --- | --- | --- |
| 今天听什么 | 左列文字 + 右侧可转封面墙 | 墙 660×220，卡 128px，九张同屏 |
| 推荐歌单 | 六列方卡 | `repeat(6, minmax(0,1fr))`，窄屏 4 列 |
| 推荐专辑 | 可左右翻的一行 | 一屏 5 张 |
| 最近新歌 | 左主推 + 右九行 | 主推 320 方图，列表最高 378px，行高 42px |
| 最近听过 | 八张窄卡 | 八列 145px |
| 设置 | 单页玻璃板 | `max-width: 820px` 居中 |

间距令牌 4 / 8 / 12 / 16 / 24 / 32 / 48；圆角控件 6、面板 10、封面 12；字号 display 27 / title 15 / body 13.5 / meta 12 / micro 11。

封面墙放九张是因为再多封面里的字就看不清，再少转不起来；九张时相邻两张交叠 55–63px。

### 动效

1. 任何输入只改目标位置，不改实际位置。滚轮、键盘、点侧卡都只写「目标」，位置由帧循环逼近。
2. 帧循环里不 setState。位置、透明度、z 序直写 `el.style`，只有「中心换到另一张」才让 React 重渲染一次。
3. 吸附用欠阻尼弹簧（`acc = gap * 190 - vel * 14`），不用线性插值。

两条别做：帧循环驱动的元素不加 CSS `transition: transform`（每帧重启动，永远追不上指针）；每帧重绘的容器不加 `mask-image` 或 `backdrop-filter`。

### 界面硬规则

写在 [ui-design](./ui-design.md)，改界面前要遵守：

1. 一页只有一个标题，由外壳打，页内不打。
2. 没有页内侧栏，导航只在左栏一处。
3. 本地与在线共用同一套卡片，来源只用徽章区分。
4. 颜色只来自封面，不在组件里写死。
5. 五个平台一起改，不许只改一家。
6. 交互不能走进死路，关掉功能要留说明或回入口。
7. 不用系统弹窗（`confirm` / `alert` 换成应用自己的 Modal）。

### 文案

说人话，不写机制；错误写「怎么办」，不写异常名。一句话只做一件事，设置项说明写「关掉会怎样」。

## 功能

### 导航

顶部是「现在」和「漫游」；「我」下面是「我喜欢的」「最近播放」；「库」下面是「歌单」「专辑」「艺人」「本机」；底部是设置、账号、收起侧栏。平台不单独占一级。搜索只有顶部一个入口（`Ctrl K`）——搜索是动作，不是目的地。

### 首页

顺序是问候、今天听什么、上次听到、四张快捷卡、推荐歌单、推荐专辑、最近新歌、最近听过。

顺序按操作优先排：能直接放的在上面，导航次之，要翻的发现区在下。

### 漫游

四家各拉一批，最先回来的那家开播，其余的补进队列；切一首补一首，队列面板叫「漫游 · 接下来」。有「不再推」和「结束漫游」。去听歌单或专辑会退出漫游并还原原来的循环模式。未登录时用对话框说「漫游需要登录」。

轨道上有默认、熟悉、探索三种挑法，只影响这一批先放谁。

### 播放

四档模式合成一颗键：顺序、列表循环、单曲循环、随机。10 段均衡器五组预设、双击归零。交叉淡化按秒生效。ReplayGain 加限幅。启动可以恢复上次的队列，但只摆着，不自动开唱。

音源优先级可排，播放时按它挑第一个能放的。音质按平台设档，换档从下一首起生效，正在播的不中断。

### 歌词

取词三级：本平台 → `track.versions` 里的其它平台 → LRCLIB（在线歌词默认关，打开时才发歌名、艺术家和时长）。

全屏歌词页当前句放大、上下渐隐，原文一行译文贴在其下，可滚轮和拖动，停手 4 秒回到正在唱的那句。歌词页用帧循环写 transform，滚轮和拖动只改目标位置。舞台页是另一套九槽连续滚动加粒子。

译文是平台自带的另一条轨道（网易云 `tlyric`、QQ `trans`、酷狗 KRC 的 `language`、汽水 `lang_translations`），主进程按行并成「原文 / 译文」单串，渲染层再拆回两行。拆不拆看两段是不是不同书写系统：`splitLyricLine` 里，日文和中文、英文和中文要拆，合作署名 `周乘羽 / 卡力老虎` 这种同属中文的不拆。

桌面歌词是独立无边框透明置顶窗口：一句原文、紧随的译文、下一句；已唱过的字按封面主色点亮，交界是一道羽化的扫光。鼠标移上去浮出胶囊工具条。锁定时鼠标穿透，但仍可悬停拖动点击。主窗口全屏、进歌词舞台，或系统里有别的程序全屏时，它自动让开。

### 评论

曲目详情页底下接一段评论区。读网易云、QQ、酷狗、汽水各自的评论接口，头像走 `aurora-remote` 代理缩到 60px，时间按「刚刚 / N 分钟前 / N 天前」显示，一次 20 条游标翻页。写评论接了前三家，都走各自的登录态，写完重取第一页；网易云的赞能点。汽水只能读——它的写接口要 App 端 cookie 加官方签名器，本机拿到的车机协议 access-token 不通用。

### 系统集成

托盘常驻，关窗口只是收进托盘。任务栏缩略图按钮（上一首 / 播放 / 下一首）、SMTC、硬件媒体键都接了，系统媒体卡片上带封面。全局快捷键覆盖播放、切歌、音量、桌面歌词、锁定、搜索。

### 背景

接 Steam 版 Wallpaper Engine：场景 `.pkg` 由内置 WebGL 引擎渲染，也支持视频、网页、图片，只读不启动。画质分省电（20 帧）、均衡（30 帧）、清晰（60 帧）。

## 技术

### 进程与协议

主进程 `electron/main.ts` 加上拆出去的 `electron/ipc/`（app / library / wallpaper / overlay / updates / lyrics / player / settings / downloads / maintenance）。渲染层两页：`index.html` 播放器和 `overlay.html` 桌面歌词，各自一套入口，不互相路由。

四个私有协议都由主进程供给：`aurora-app://` 生产渲染页（CSP 只放行私有协议）、`aurora-media://` 本地媒体与封面缩略图、`aurora-remote://` 在线音频与封面代理（Range 206、CORS、地址白名单、拒本机与内网）、`aurora-wallpaper://` Wallpaper Engine 工程文件。

必须有 `aurora-remote` 的原因是播放走 Web Audio，而 Web Audio 对一个页面无权读取的源输出静音、不报错。代理同时解决 CORS 和 Range：`stream: true` 让拖动有效，`corsEnabled` 让 `crossOrigin=anonymous` 成立。

### 目录与依赖

| 目录 | 放什么 |
| --- | --- |
| `src/app/` | 外壳、路由、左栏、标题栏、快捷键 |
| `src/features/` | 功能域：accounts / online / netease / qq / kugou / qishui / library / lyrics / player / playlists / discover / downloads / favorites / glass / overlay / perf / refs / settings / updates / wallpaper |
| `src/views/` | 页面与面板 |
| `src/ui/` | 基元：Artwork、icons、TrackList、Skeleton、UpdatePanel、format |
| `src/stage/` | 全屏歌词舞台与粒子 |
| `src/styles/` | tokens 与各层 CSS |
| `electron/pure/` | 不碰 Electron 的纯逻辑，可以被 `node --test` 直接跑 |
| `electron/protocols/` | 协议实现 |
| `electron/netease|qq|kugou|qishui/` | 各家客户端与传输层 |

依赖方向单向：`views → features → ui`，`app → features / views / ui`，`electron/main → electron/pure`。`ui/` 不 import `features`，`electron/pure` 不反向依赖主进程。

### 平台适配

账号侧是注册表 `Map<ProviderId, Provider>`，UI 只调 `listProviders()`，`providerForTrack(track)` 反查。契约是 capabilities 布尔（search / playback / lyrics / auth / collections / write），不是「有没有这个函数」——写不动的功能据此置灰并说明原因，而不是点了没反应。

音源侧是另一条接缝，`src/features/library/source.ts` 的 `TrackSource`：`id / name / summary / online / streamUrl(track) / artUrl(track) / lyrics(track)`。加一家平台要同时过这两道契约。

### 播放链路

`pickPlayable(track)` → 逐版本问各平台取流 → `engine.load(track, autoplay)` → driver → Web Audio（EQ、增益、淡化、分析）→ MediaSession / SMTC。

三条踩过坑才写死的不变量：

1. 取流不重入。两路同时取流会抢同一个 audio 元素，抛 `AbortError` 后进度永远停在 0:00。现在先问 `driver.isTrackReady(track)`，就绪就不重载；`engine.play()` 的 catch 首行遇到 `AbortError` 直接返回。
2. 没源就跳，不钉住。`engineHooks.unplayable(track)` 把决定权交给 actions，连跳上限 6 首后停下并给可见提示。
3. 恢复的队列不自动播。恢复只是摆着，没有指上音频元素时点播放先装载再播。

音源地址会过期（平台签名约 20 分钟有效，本地缓存认为是 8 分钟后可重取）。`stale-source.ts` 按「这份地址装上去多久」判定，`STALE_SOURCE_MS` 是 7 分钟；判定过期时 `isTrackReady` 返回 false，播放会重取地址；播放中途 `error` 事件也会强制重取一次并 seek 回原来的位置。

播放历史只存本机：按本地日历日累计，最近 60 条，3 分钟内重复不算两条；`recordProgress` 只在 currentTime 前进且增量不超过 3 秒时计入，seek 不算。

### 首页与漫游

`loadPlatformDaily()` 用 `Promise.all` 同时问所有声明了 `recommendations.dailySongs` 的平台，某家失败返回空不影响整块；`interleaveBySource` 按来源轮流取，保证第一屏四家都有；不够 30 首由本机按口味补。换批时间 `DAILY_RESET_HOUR = 6`，凌晨算前一天。

推荐歌单、专辑、新歌共用同一个「推流来源」勾选，缓存按平台集合分键、TTL 10 分钟；未登录平台 `GIVE_UP_MS = 1800` 放弃等待。「等齐再画」用 ready 布尔加短兜底窗，不先画一批再换源。

漫游是快池模型：四家并发，第一家带回歌就先开播，其余回来补进队列，后台 `fillRoamPool()` 补整池，`refillIfLow` 在队列低位时补批并按量截断。

### 壁纸与更新

壁纸从注册表 `SteamPath`、两个 HKLM `InstallPath` 和 `libraryfolders.vdf` 找 Steam 根，用 `wallpaper_engine/config.json` 判定，扫 `workshop/content/431960` 与引擎 `projects`，只取 `selectedwallpapers`，缓存 30 秒，全程只读。渲染层对场景动态 `import('webwallgl')`，进出舞台共用窗口层那一份背景，不重建。

更新有手动和自动两条路。手动是「检查 → 下载 → 安装」每步都要按；自动默认开，后台查、后台下、没在放歌时自己换上。`latest.yml` 是 electron-updater 唯一读的清单，漏了自动更新就断。

### 状态与持久化

渲染层状态用 Zustand，设置项每项一个真源（主进程 `settings/store.ts`、纯渲染 `motion.ts`、`wallpaper/store.ts`）。凭据用 Windows DPAPI 加密只存本机，多档案隔离（`aurora.player.prefs::<档案 id>` 这类键）。主题、玻璃、歌词字号等写 localStorage；桌面歌词位置和窗口行为由主进程兑现。巡检与测试一律用独立 `--user-data-dir`，不碰真实账号。

### 质量

`npm run check` 是类型检查、单元测试和四项静态审计（可达性、CSS 死选择器、指向已不存在文件的路径、多余导出）。`npm run smoke` 起真窗口逐页点过去，收控制台错误、破图与未捕获异常，联网搜一次并点开在线歌确认播放条走过 0:00，有 Wallpaper Engine 时选一张壁纸连拍两帧确认在动。

CI 在 windows-latest 跑 check 和 build——单元测试断言 Windows 路径语义，ubuntu 会假红。CI 不打包：安装包要带 `vendor/KuGouMusicApi`，而 vendor 不入库。

性能口径与历史读数见 [perf-baseline](./perf-baseline.md) 和 [perf-report](./perf-report.md)，用 `npm run perf` 在当前机器重测。

### 发版

CHANGELOG 挪版本段 → 改 `package.json` 的 version → `npm run dist` → 提交并打 annotated tag `vX.Y.Z` → 推送 → 建 Release → 传三个附件（`Setup.exe`、`.blockmap`、`latest.yml`）。安装包没有签名，Release 正文附一行 SHA256。发版前要先征得项目所有者同意，这是仓库的硬规则。

## 版本

0.4–0.6 把「能放、能写回、能更新」打通：平台写回（红心与歌单增删改）、应用内更新、在线歌存本地、取流不重入、漫游四家并发首家先播。

0.7 集中修「看起来和用起来像不像一个东西」：整窗口一层玻璃、浅色主题、封面墙、舞台粒子、静默更新、退出舞台不再重建背景。

0.8 和 0.9 转向多平台统一与稳定性：同曲一行加来源徽章、音源优先级、在线歌单归属与创建者、桌面歌词重做、长时间暂停后重取音源地址。

逐版改动见 [CHANGELOG](../CHANGELOG.md)。

## 已知边界

- 四家平台全是非官方逆向接口，随时可能失效。失效时修同一家的另一条官方路径，不换平台，也不静默失败。
- 不破解付费：会员曲只显示「要会员」，未登录的平台只推公开榜。
- 安装包没有签名，首次运行可能被 SmartScreen 拦。
- 只有 Windows；界面只有中文；动态背景还要求装了 Steam 版 Wallpaper Engine。
- 手机端没有做：390×844 实测左栏 224px、内容区 166px，86 个可点元素里 80 个小于 40px。评估过三条路（局域网遥控器、安卓壳、独立 App），先做遥控器。
- 音质、外观、快捷键是设备级设置，不跟账号档案走。
- 关于页写明这是试验性作品，功能与界面可能随时改动，不要用于重要数据。

## 文件地图

| 想看什么 | 去哪 |
| --- | --- |
| 产品定位与功能 | [README](../README.md) / [README.en](../README.en.md) |
| 架构与接缝 | [architecture](./architecture.md) |
| 界面规则与尺度 | [ui-design](./ui-design.md) |
| 维护节奏与回滚 | [maintenance](./maintenance.md) |
| 性能口径 | [perf-baseline](./perf-baseline.md)、[perf-report](./perf-report.md) |
| 版本变更 | [CHANGELOG](../CHANGELOG.md) |
| 视觉令牌 | `src/styles/tokens.css` |
| 品牌字形 | `src/app/BrandMark.tsx`、`scripts/make-icons.mjs` |
| 播放引擎 | `src/features/player/engine.ts`、`driver.ts`、`pick.ts`、`actions.ts` |
| 平台注册表 | `src/features/online/` |
| 音源契约 | `src/features/library/source.ts` |
| 主进程协议 | `electron/protocols/`、`electron/wallpaper.ts` |
| 更新 | `electron/updates.ts`、`src/ui/UpdatePanel.tsx` |
| 验收 | `scripts/smoke.mjs`、`scripts/audit-*.mjs` |

## 术语

| 词 | 意思 |
| --- | --- |
| 推流 / 推荐来源 | 首页四个推荐位与漫游共用的平台勾选，关掉一家就是别拿它推给我 |
| 快池 | 漫游开局先拿到的那一小批，够开播就行 |
| 同曲一行 | 多平台同一首歌合并显示，播放时按音源顺序挑可用的 |
| capabilities | 平台能力布尔表，决定按钮能不能点、要不要置灰说明 |
| 取流 | 向平台换一个可播放的音频地址 |
| 玻璃 | 壁纸模式下几块面共用的半透明 + 模糊 + 内描边层 |
| 薄片 | 玻璃上的卡片；只有「面」才垫底，封面卡不垫 |
| 舞台 | 全屏歌词页（九槽连续滚动加粒子） |
| overlay | 桌面歌词那个独立透明窗口 |
| 四项审计 | 可达性、死 CSS、失效路径、多余导出 |

## 给接手的人

按这个顺序读，两小时能上手：

1. [README](../README.md) 里的「它会什么」和「开发者」两节；
2. [ui-design](./ui-design.md) 的硬规则与尺度表；
3. [architecture](./architecture.md) 的分层、平台层、播放与歌词链路；
4. `src/features/player/engine.ts` 与 `actions.ts`，三条不变量都在那里；
5. `src/styles/tokens.css`：一条灰阶、一层玻璃、三档文字；
6. 跑一次 `npm run check`，再跑一次 `npm run smoke`。

改界面前先问三个问题：这个颜色是不是该从封面来？这几个平台的入口是不是都一起变？关掉这项功能的人能不能找回来？

改播放相关代码前先看 `engineHooks` 与 `isTrackReady`。不要用重试解决竞态，消除重入才是治本。
