# 其他开源音乐播放器如何接入各音乐平台

> 调研目的：给 Aurora（Electron + React，自接网易云 / QQ / 酷狗 / 汽水）找可借鉴的现成实现。
> 数据采集时间：2026-11-17。star / 最近推送 / 语言全部取自 GitHub REST API（api.github.com/repos/...），
> 其中「最近推送」取 pushed_at，语义是**任意分支最后一次 push**，不等于主干最后一次提交。文件级事实取自 contents API 拉回的原始源码。
> 本机已有克隆（D:\Aurora\.ref-*）直接读本地，未重复下载。
> 注意：文中出现的 `src/...`、`electron/...` 路径属于**被调研的仓库**，不是本仓的路径。

## 1. 一页结论

1. **主流共识是「应用不碰签名」。** 十条路线里只有两条是应用主仓自己维护全套平台签名（listen1、lx-music 的内置 SDK），其余全部把签名交给别人：要么内嵌成熟 Node API 包（YesPlayMusic、Mineradio 用 NeteaseCloudMusicApi 系），要么把整个平台逻辑外置成用户可插拔的脚本（lx-music 自定义源、MusicFree 插件、nuclear 插件）。
2. **最省维护的是 lx-music 的双轨制**：内置六平台 SDK 保底 + 自定义源脚本热插拔。脚本协议窄到只有 `musicUrl` / `lyric` / `pic` 三个 action，宿主只给 `lx.request`（绕 CORS）和 `lx.utils.crypto`（aesEncrypt / md5 / rsaEncrypt / randomBytes）—— 宿主完全不需要懂任何平台签名，改版压力随着脚本作者一起走。
3. **但插件化只转移责任，不降低难度。** 抽查社区实际在用的 MusicFree 国内源（martin65536/z-music-plugins 的 wy.js / kg.js），它们并不自己算签名，而是 axios 打一个私人中转站 `ws.suol.cc/api/wy/wy_php.php/`、`ws.suol.cc/kg/kg.php`，返回值故意仿 NeteaseCloudMusicApi 的字段结构（songs[i].ar / al / dt / br）。换句话说：社区生态的「签名问题」被外包给了一台随时会挂的服务器。
4. **汽水（抖音）没有公开的第三方 API 生态，只有两种偏门做法。** Mineradio 用隐藏 Electron 窗口加载官方 passport 网页 + 官方风控 SDK（`qishui-auth-v6/bdms.js` 238KB，按它自己的 NOTICE 是**字节级保留**的官方 Web 安全运行时）完成扫码登录，拿 session cookie 后用自己的 `qishui-api.js`（136KB）调接口；Aurora 现在用 npm `qishui-music-api`（`src/protocol.cjs` 116 行 RSA）属于同一思路的更轻量版。
5. **版权压力是真实存在的工程约束。** MusicFree 官方插件仓（★1,935）readme 原话：「收到了告知函，因此本示例插件仓库不再提供国内音乐厂商的源」，国内平台插件从此散落社区；UnblockNeteaseMusic/server 是 LGPL-3.0。若 Aurora 走脚本化，国内源应当做成「用户自带脚本 / 不进主仓二进制」，而不是内置。

## 2. 逐项目卡片

### 2.1 XxHuberrr/Mineradio-paused ★11,427

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/XxHuberrr/Mineradio-paused |
| star / fork | 11,427 / 899 |
| 最近推送 | 2026-11-09T07:02:59Z |
| 主语言 / License | JavaScript / GPL-3.0-only（package.json 声明）|

**接入平台**：网易云、QQ（仅会员权益判定，见下）、酷狗、汽水（抖音）、Spotify。

**接入方式**（仓库根目录平铺，`electron-builder` 的 files 字段把它们原样打进产物）：

- `server.js` 269,992 B —— 自写 Express，把下面这些模块包成路由给渲染层；
- 网易云：直接依赖 npm `NeteaseCloudMusicApi: ^4.32.0`（binaryify 原版，不是 fork）；
- 酷狗：`kugou-api.js` 90,431 B / 2,266 行，**全自研签名**。硬编码了酷狗的 Android salt `OIlwieks28dk2k092lksi2UIkp`、H5 salt `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt`、sign key salt `57ae12eb6890223e355ccfcb74edf70d` 与 appid 1005 / 1014，源码注释还写着「The official playbyAudio.js now signs /play/songinfo with infSign's H5 contract」，说明作者在持续跟官方 web 端 JS；
- 汽水：`qishui-api.js` 135,652 B + `qishui-auth-v6.js` 20,224 B + `qishui-qr-login.js` 4,964 B + `qishui-auth-v6/`（`bdms.js` 238,184 B、`sdk-glue.js` 94,515 B、`react-dom.js` 120,585 B、`security_host.html`）+ `qishui-audio-decryptor/`（`track-decryptor.js`）；
- Spotify：`spotify-api.js` 62,712 B；QQ：`qq-vip-api.js` 27,539 B —— **注意它只解析会员状态**（VIP_TYPE_KEYS / SVIP_FLAG_KEYS 等几十个字段名的映射表），不是播放接口；
- `dj-analyzer.js` 33,794 B、`mpg123-decoder` 依赖（MP3 解码 + 分析），与平台无关。

**签名/加密归属**：网易云靠上游 npm 包；酷狗、汽水、Spotify 自己维护。`docs/THIRD_PARTY_PORTS.md`（4,060 B）诚实列出了移植来源，其中汽水那条最关键：「Ports only the official Passport Web QR authentication boundary: an isolated hidden Electron security host, the Qishui web signing bootstrap, QR creation and polling, account-session cookie persistence...」。即**借官方网页跑风控签名**，而非逆向。

**值得 Aurora 借鉴**：
- 「汽水登录 = 隐藏 BrowserWindow 加载官方 passport + 官方风控 SDK」这条路，比在 Node 里硬编码 RSA 更耐改版；Aurora 的 `qishui-music-api/src/protocol.cjs` 只有 116 行 RSA，一旦抖音换协议就得整段重写，而 Mineradio 的方案换的是网页，代码不用动。
- 根目录平铺 `<平台>-api.js` + 一个 server.js 聚合层的结构简单粗暴，但 `tests/` 下有 30+ 个针对单平台的测试（`kugou-vip-hardening.test.js` 13KB、`qishui-session-recovery.test.js`、`qishui-audio-decryptor` 相关），这才是它敢自研 300KB 代码的真正原因。

### 2.2 lyswhut/lx-music-desktop ★55,420（洛雪音乐）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/lyswhut/lx-music-desktop |
| star / fork | 55,420 / 7,130 |
| 最近推送 | 2026-11-13T01:39:25Z |
| 主语言 / License | TypeScript / Apache-2.0 |

**接入平台**：网易云(wy)、QQ(tx)、酷狗(kg)、酷我(kw)、咪咕(mg)、虾米(xm，已死)、百度(bd，已注释)，外加 `local`。

**接入方式 = 双轨**：

1. **内置 SDK**（主仓自维护）：`src/renderer/utils/musicSdk/` 88 个文件约 400KB，按平台分目录，每平台再按功能拆 `musicSearch` / `musicInfo` / `leaderboard` / `songList` / `lyric` / `singer` / `comment` / `hotSearch` / `tipSearch` / `pic` / `album` / `index`。
2. **自定义源脚本**（用户可插拔）：`src/main/modules/userApi/`，用**隐藏 BrowserWindow** 加载 `renderer/user-api.html` + `preload.js` 执行用户脚本，主进程只走 IPC（init 上报 sources；request/response 用 requestKey 配对，20 秒超时 + cancelRequest；另有 openDevTools / showUpdateAlert / proxyUpdate）。渲染侧入口 `src/renderer/core/useApp/useInitUserApi.ts`、`views/Setting/components/UserApiModal.vue`、`UserApiOnlineImportModal.vue`（支持在线订阅链接）。

两条轨在 `src/renderer/utils/musicSdk/api-source.js`（41 行）里汇合：`apiList[api.id + "_api_" + source]` 取内置实现，若 `apiSource.value` 匹配 `/^user_api/` 则改走 `userApi.apis[source]`。

**签名归属**：

- 网易云 `wy/utils/crypto.js` **55 行**，文件头第一行注释就是 `// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/util/crypto.js` —— 直接照抄上游 weapi/linuxapi/eapi（aes-128-cbc 双层 + RSA no-padding + eapi md5 摘要），自维护副本；
- QQ `tx/utils/crypto.js` **29 行**，自研 `zzcSign`：SHA1 后按 `PART_1_INDEXES=[23,14,6,36,16,40,7,19]`、`PART_2_INDEXES=[16,1,32,12,19,27,8,5]` 乱序取字符，与 `SCRAMBLE_VALUES` 20 个常量逐个 XOR，base64 去 `/+=`，拼成 zzc+part1+b64Part+part2 再 toLowerCase；
- 酷狗用 `vendors/infSign.min.js`（11.8KB 压缩 vendor）—— 和 Mineradio 的注释指向同一个 infSign 契约；
- 酷我用 `kw/util.js`（约 7KB）。

**跨平台补源**：`musicSdk/index.js`（177 行）实现 `findMusic({name, singer, albumName, interval, source})` —— 对除自己以外的平台并发 `searchMusic`（limit 25），归一化后比对：歌手按 `、&;/|,，` 切分排序、歌名/歌手/专辑去标点转小写、时长容差 ±5 秒、`versionChars` 校验 live/remix 等版本字符一致。命中即返回。比 UNM 的 match 多出「专辑」与「版本字符」两个维度。

**自定义源脚本协议**（官方文档 `lyswhut/lx-music-doc` 的 `docs/desktop/custom-source.mdx`，11,487 B）：

- 脚本头必须是 `/** @name @description @version @author @homepage */` 注释，宿主靠解析注释拿元数据；
- 宿主注入 `globalThis.lx`：`version` / `env` / `currentScriptInfo` / `EVENT_NAMES` / `on` / `send` / `request` / `utils`；
- `lx.request(url, options, cb)` 不受跨域限制，options 支持 method/headers/body/form/formData/timeout，返回 cancel 函数；
- `lx.utils` 只给：`buffer.from`、`buffer.bufToString`、`crypto.aesEncrypt(buffer, mode, key, iv)`、`crypto.md5`、`crypto.randomBytes`、`crypto.rsaEncrypt(buffer, key)`、`zlib.inflate/deflate`；
- 脚本必须在初始化结束前 `send(EVENT_NAMES.inited, { openDevTools, sources })`；`sources` 的 key **只能是 kw/kg/tx/wy/mg/local 六个之一** —— 插件不能声称自己是新平台；
- `request` 事件只有三种 action：`musicUrl`（返回 HTTP 音频直链）、`lyric`（返回 lyric/tlyric/rlyric/lxlyric）、`pic`（封面 URL）；local 源额外支持 lyric/pic；
- 桌面版与移动版差异：移动版没有 openDevTools，部分 utils 不可用，且除 `Function.prototype.toString` 等三个之外的内置属性会被冻结。

**社区音源生态**（全部是 lx 自定义源脚本，不是内置 SDK）：`pdone/lx-music-source` ★11,381（JS，2026-11-17T01:22:02Z 仍在更新，最大）、`Macrohard0001/lx-ikun-music-sources` ★2,950、`ZxwyWebSite/lx-source` ★696（Go）、`cdyUuu/lx-music-xinghai-source` ★275（聚合 GDAPI/ChKSz API、含酷我加密音频解密）、`lyswhut/lx-music-source` ★403（官方示例，2024-06 停更）。

**值得 Aurora 借鉴**：整套 `userApi` 机制（隐藏窗口 + 20s 超时 + requestKey 配对 + 在线订阅导入），以及 `findMusic` 的归一化匹配规则。

### 2.3 listen1/listen1_chrome_extension ★12,122

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/listen1/listen1_chrome_extension |
| star / fork | 12,122 / 2,040 |
| 最近推送 | 2025-06-17T13:15:48Z |
| 主语言 / License | JavaScript / MIT |

**接入平台**：网易云、QQ、酷狗、酷我、咪咕、Bilibili、虾米（已死）、太合(taihe)、本地音乐。

**接入方式 = 纯前端 + vendored 加密库，一平台一文件自签**。`package.json` 里**零运行时依赖**（只有 eslint/prettier/husky），所有第三方能力都以压缩产物塞在 `js/vendor/`：`forge_listen1_fork.min.js` **288,013 B**（node-forge 的自用 fork）、`axios.min.js`、`angular.min.js`、`howler.core.min.js`、`i18next.min.js` 等。

`js/provider/` 每平台一个文件，全是 class + 静态方法：

| provider | 字节 | 行数 | 签名做法 |
|---|---|---|---|
| netease.js | 29,994 | 963 | 自实现 `weapi`（forge AES-CBC 双层 + RSA modPow）与 `eapi`（AES-ECB + md5 摘要），注释写明 refer to Binaryify/NeteaseCloudMusicApi |
| qq.js | 25,990 | 868 | **不签名**，走 `c.y.qq.com/v8/fcg-bin/*.fcg` 老接口，带 `g_tk=5381`、`nosign=1`、`nobase64=1` |
| kugou.js | 15,092 | 516 | **不签名**，走 `www.kugou.com/yy/index.php?r=play/getdata&hash=` 与 `m.kugou.com/app/i/getSongInfo.php` |
| kuwo.js | 23,961 | 791 | 内嵌从酷我站点抄来的 URL 加密函数 `h(t, e)`（纯位运算生成 token），再 forge.sha1/md5 组签 |
| migu.js | 31,470 | 922 | `forge.pki.publicKeyFromPem(publicKey).encrypt(k)` RSA 加密，另有注释掉的 md5 设备签名方案 |
| bilibili.js | 14,243 | — | 常规 API |
| xiami.js | 3,186 | — | 已失效平台，保留壳 |
| taihe.js | 10,253 | — | 太合音乐 |
| localmusic.js | 4,553 | — | 本地文件 |

**签名归属**：全部自己维护（vendored forge 提供原语）。**风险信号**：migu.js 里大段签名代码已被注释（`// const signature_md5 = '6cdc72a439cef99a3418d2a78aa28c73'`），说明这条自维护路线跑到最后会烂掉；仓库自 2025-06 起没有新推送。

**值得 Aurora 借鉴**：`js/provider/` 的「一平台一文件 + 统一 class 形状（show_playlist / get_playlist / search / get_song_url / get_lyric）」是最容易照抄的目录结构。但**不要抄它的维护模式**——它没有上游可跟。

### 2.4 qier222/YesPlayMusic ★33,635

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/qier222/YesPlayMusic |
| star / fork | 33,635 / 4,677 |
| 最近推送 | 2026-10-10T11:05:47Z |
| 主语言 / License | Vue / MIT |
| 本机克隆 | D:\Aurora\.ref-yesplaymusic（version 0.4.11）|

**接入平台**：只有网易云。QQ/酷狗/酷我/咪咕等仅作为「灰色歌曲」的**补源引擎**出现，不走 UI。

**接入方式 = 内嵌 NeteaseCloudMusicApi 服务**：

- 依赖 `@neteaseapireborn/api ^4.29.7`（NeteaseCloudMusicApi 的继任 fork）+ `@unblockneteasemusic/rust-napi ^0.4.0`；
- `src/electron/services.js` 只有 **15 行**，核心是 `import server from '@neteaseapireborn/api/server'`，再 `await server.serveNcmApi({ port: 10754, moduleDefs: require('../ncmModDef') })`；
- 渲染层经 `src/utils/request.js` 的 axios baseURL 打 `/song/url`、`/song/detail`、`/lyric` 等 REST 路由（`.env.example`：`VUE_APP_ELECTRON_API_URL=/api`，DEV 指向 `http://127.0.0.1:10754`）；
- `src/api/` 只有 9 个文件约 28KB（album/artist/auth/lastfm/mv/others/playlist/track/user），全是薄 axios 封装，**零签名代码**；
- `src/ncmModDef.js` 手写 moduleDefs 数组（identifier / route / module require）按需注册接口，不整包暴露。

**补源（unblock）**：`src/electron/ipcMain.js` 里 `import UNM from '@unblockneteasemusic/rust-napi'`、`new UNM.Executor()`，`ipcMain.handle('unblock-music')` 调 `unmExecutor.search(sourceList, song, context)` + `retrieve()`；默认源 `['ytdl','bilibili','pyncm','kugou']`，`parseSourceStringToList` 用 `executor.list()` 校验用户填的源；bilibili 音频还要二次取流（`getBiliVideoFile`）。渲染侧 `src/utils/Player.js` 的 `_getAudioSourceFromUnblockMusic(track)` 做回退，设置项 `enableUnblockNeteaseMusic` 默认 true。

**签名归属**：完全交给上游包，应用侧零加密代码。这正是它 4 年还能维护的原因。

**值得 Aurora 借鉴**：`moduleDefs` 按需注册 + 「应用只当 REST 客户端」的分层，是 Aurora 已有的思路（Aurora 的 `electron/netease/client.ts` 类似），但 YesPlayMusic 把「服务在本进程内起」这件事做得更干净——只在主进程 `serveNcmApi`，渲染层完全不感知。

### 2.5 nukeop/nuclear ★18,958

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/nukeop/nuclear |
| star / fork | 18,958 / 1,358 |
| 最近推送 | 2026-11-17T02:46:20Z（当天仍在推）|
| 主语言 / License | TypeScript / AGPL-3.0 |

**接入平台**：无内置国内平台。全部平台能力来自外部插件（YouTube 系走 `api.Ytdlp` 集成 yt-dlp，其余由插件自行实现 HTTP）。

**接入方式 = 插件 SDK + 插件市场**（monorepo，2,177 个 entry）：

- `packages/plugin-sdk/src/api/` 定义宿主能力：`Settings` / `Queue` / `Playback` / `Events` / `Favorites` / `Playlists` / `Providers` / `Streaming` / `Metadata` / `Dashboard` / `Discovery` / `Shell` / `Http`（绕 CORS）/ `Logger` / **`Ytdlp`**；
- `packages/docs/core-concepts/plugins-and-providers.md` 把 provider 分成 5 类：**Metadata**（搜索，声明 artists/albums/tracks/playlists/unified 等 capability）、**Streaming**（按歌名+歌手找音频流）、**Dashboard**（首页分区，可多个同时激活）、**Discovery**（队列末尾续歌）、**Playlists**（粘贴 URL 导入）；
- `packages/player/src/services/plugins/`：`PluginLoader.ts`、**`pluginCompiler.ts`（运行时用 esbuild 编译 TS 插件）**、`pluginDownloader.ts`、`pluginRegistry.ts`、`pluginAutoUpdate.ts`、`pluginManifest.ts`；配 `apis/pluginMarketplaceApi.ts` 与 `hooks/useMarketplacePlugins.ts` —— 有真正的插件商店；
- 插件清单 = 标准 npm `package.json` + `nuclear` 元数据字段（displayName / category / icon / permissions）；生命周期钩子 onLoad / onEnable / onDisable / onUnload；
- 分发走独立仓库 `NuclearPlayer/plugin-registry`。

**签名归属**：与核无关——宿主不提供任何平台签名，插件自理。价值在于**工程化的插件宿主**：运行时编译、自动更新、市场、capability 声明。

**值得 Aurora 借鉴**：`api.Providers` 的「provider 类型 + capability 声明」直接对应 Aurora 的 `CAPABILITIES` 概念；`pluginCompiler` 证明「用户写 TS、宿主 esbuild 编译」在 Electron 里可行；Dashboard 多 provider 叠加与 Aurora 首页多数据源结构一致。但 nuclear 的插件沙箱是 Node 侧直接 eval 类，安全边界比 lx-music 的隐藏窗口弱。

### 2.6 anandnet/Harmony-Music ★3,091（任务里的 harmony-hub / Harmony-Music）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/anandnet/Harmony-Music |
| star / fork | 3,091 / 370 |
| 最近推送 | 2025-12-08T10:00:55Z |
| 主语言 / License | Dart（Flutter）/ 见 LICENSE |

**先澄清命名**：GitHub 上不存在 `harmony-hub` 这个组织/用户；同名 `Harmony-HUB` 是韩语音源编辑项目，与此无关。任务所指项目实为 **anandnet/Harmony-Music**（Flutter 跨平台音乐播放器，pubspec name = `harmonymusic`，version 1.12.2+27）。

**接入平台**：**没有接入任何国内平台**。音源是 YouTube 系 + 本地：

- `youtube_explode_dart`（用的是作者自己的 fork：`github.com/anandnet/youtube_explode_dart`，锁定 ref `1d9ec9ba...`）；
- `lib/services/piped_service.dart`（5,764 B）—— 走 **Piped** 公开实例代理 YouTube；
- `lib/services/stream_service.dart`、`nav_parser.dart`（33,673 B，解析 YouTube Music 导航页）；
- 本地文件 + `audiotags` + `just_audio`（`just_audio_media_kit` 也是作者 fork）。

**签名归属**：不存在签名问题——它依赖的是 YouTube 的公开页面/第三方 Piped 实例，等价于 Aurora 里「调第三方聚合 API」那一类。`.gitmodules` 里只有一个 `.flutter` 子模块（Flutter SDK 本身），没有音源子模块。

**值得 Aurora 借鉴**：几乎没有。它的价值是反面参照——**想接国内平台，Flutter/Dart 生态里没有可用的现成签名库**，作者干脆放弃。

### 2.7 maotoumao/MusicFree ★28,615 + MusicFreePlugins ★1,935

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/maotoumao/MusicFree（主程序）/ https://github.com/maotoumao/MusicFreePlugins（官方插件集）|
| star | 28,615 / 1,935 |
| 最近推送 | 2026-10-15T15:16:41Z / 2026-03-19T04:00:04Z |
| 主语言 / License | TypeScript / GPL-3.0（插件集）|
| 本机克隆 | D:\Aurora\.ref-musicfree（version 0.6.2，React Native + Expo）|

**接入平台**：宿主零内置。官方插件集现在只有 13 个：airsonic、audiomack、bilibili、geciqianxun、geciwang、kuaishou、maoerfm、navidrome、suno、udio、webdav、yinyuetai、youtube —— **没有任何国内音乐厂商**。readme 原话：「收到了告知函，因此本示例插件仓库不再提供国内音乐厂商的源。」

**接入方式 = 插件宿主**（`src/core/pluginManager/plugin.ts`，1,121 行）：

- 插件是纯 JS，宿主通过自建 `require` 白名单注入：`cheerio`、`crypto-js`、`axios`、`dayjs`、`big-integer`、`qs`、`he`、`webdav`、`@react-native-cookies/cookies`（后者在 RN 上只是 `notImplementedFunction` 占位）；
- 插件方法集：`search` / `getMediaSource` / `getMusicInfo` / `getLyric` / `getAlbumInfo` / `getArtistWorks` / `getMusicSheetInfo` / `importMusicSheet` / `getMusicComments` / `getTopLists` / `getRecommendSheetTags` / `getRecommendSheetsByTag`；
- 接口定义在 `types/plugin.d.ts`（3,880 B）：`IPluginDefine` 含 `platform` / `appVersion` / `version` / `srcUrl` / `primaryKey` / `defaultSearchType` / `cacheControl` / `userVariables`；`IMediaSourceResult { headers, url, userAgent, quality }`；`IQualityKey = low|standard|high|super`；
- 取流链路（`plugin.ts:193-320`）：① 本地文件 → ② MediaCache（`cacheControl: cache|no-cache|no-store`）→ ③ **替代插件**（`getAlternativePlugin`，可配「用 B 插件解析 A 平台的歌」）→ ④ 插件 `getMediaSource` → ⑤ 兜底 `musicItem.qualities[quality].url`；失败按 `retryCount` 重试，错误文本为 `NOT RETRY` 时不重试；成功后写 MediaCache。

**签名归属**：插件自理。而且——**抽查在用的国内插件，它们并不自己签名**。`martin65536/z-music-plugins`（★49，7 个反编译重写插件）里：

- `plugins/wy.js`（12,017 B / 381 行）第 12 行注释：「通过 ws.suol.cc/api/wy/wy_php.php/ 中转的网易云音乐接口，走的是网易云官方 API（NeteaseCloudMusicApi 风格）的字段结构」；实际代码就是 `axios.get(SERVER + "cloudsearch")`、`"song/url"`、`"lyric"`、`"playlist/track/all"`；
- `plugins/kg.js`（14,862 B / 518 行）同样：「通过 ws.suol.cc/kg/kg.php 中转的酷狗概念版接口」。

也就是说：**MusicFree 插件生态把签名外包给了第三方私人服务器**，插件只剩「字段适配」。这是与 lx-music「脚本自带 crypto 原语、自己签」的关键区别。

**值得 Aurora 借鉴**：`cacheControl` 与「替代插件」两个设计（同一首歌允许用另一平台插件解析音源），和 Aurora 的「音源优先级回退」是同一个问题的两种解法，但 MusicFree 把「换源」做成了用户可见的策略配置。

### 2.8 UnblockNeteaseMusic/server ★7,856（补源引擎的事实标准）

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/UnblockNeteaseMusic/server |
| star / fork | 7,856 / 772 |
| 最近推送 | 2026-11-09T18:42:46Z |
| 主语言 / License | JavaScript / **LGPL-3.0**（npm `@unblockneteasemusic/server` 0.28.0）|

**接入平台**：qq、kugou、kuwo、migu、baidu、bodian、joox、xiami、youtube，全部作为「给网易云缺歌补源」。

**接入方式 = 一平台一 provider 文件 + 统一 match，全部自实现签名，运行时依赖只有 node-windows / pino / pino-pretty**（即不用任何 npm 加密包）：

| provider | 行数 | 做法 |
|---|---|---|
| kugou.js | 84 | 搜索 `mobilecdn.kugou.com/api/v3/search/song`；取流 `trackercdn.kugou.com/i/v2/`，key = md5(hash + 'kgcloudv2') |
| kuwo.js | 90 | 搜索 `search.kuwo.cn/r.s`；取流走 `crypto.kuwoapi.encryptQuery`（`src/kwDES.js` 8.4KB 的 DES），失败回退 `antiserver.kuwo.cn` 明文 convert_url |
| qq.js | 170 | **不需要签名**，靠 `QQ_COOKIE`：`u.y.qq.com/cgi-bin/musicu.fcg` 的 DoSearchForQQMusicDesktop + vkey.GetVkeyServer/CgiGetVkey 取 purl，`sip[0] + purl` 拼接；musickey 到期前 600 秒自动 refresh |
| migu.js | — | 需 cookie |

配套：`src/crypto.js`（4KB）、`src/hook.js`（11.8KB）、`src/server.js`（HTTP 代理 / 虚拟 endpoint，可 MITM 网易云客户端）、`src/cache.js`、`src/sni.js`。

**统一 match（`src/provider/match.js`，最值得抄的部分）**：`find(id, data)` 拿到网易云元信息 → 逐 source 调 `check(info)` → `check(url)` 用 `Range: bytes=0-8191` 探一段字节，解析 MP3 frame header / fLaC / ID3 得**真实码率**，并校验 `Content-Length === 8192` 防假流；按域名补 Referer（bilivideo.com → bilibili）与 md5（126.net 取文件名、qq.com 取 server-md5）。调度三档：默认 `Promise.any` 抢最快源、`FOLLOW_SOURCE_ORDER` 顺序、`SELECT_MAX_BR` 全并发取最高码率。

**值得 Aurora 借鉴**：这段「探字节验码率 + 防假流 + 按域名补 Referer」是跨平台音源回退里唯一经过大规模验证的判定逻辑；YesPlayMusic 直接通过 `@unblockneteasemusic/rust-napi` 复用它。**注意 License**：LGPL-3.0，若把它的代码搬进 Aurora 主仓，需要同许可或动态链接方式处理。

### 2.9 akudamatata/Solara（反面教材，本机克隆 D:\Aurora\.ref-solara）

| 项 | 值 |
|---|---|
| star | 未查到（GitHub API 限流窗口内未取到该仓元数据，仅有本机克隆）|
| 接入平台 | 名义上支持网易云/QQ/酷狗等 |
| 接入方式 | **直接调第三方聚合 API**：`API_BASE_URL=https://music-api.gdstudio.xyz/api.php`（GD音乐台），支持 128K/192K/320K/FLAC |

`server/` 只有 express + cookie-parser，路由是 auth / login / palette / proxy / storage —— **没有任何平台接口**；前端 `js/` + `index.html` 单体，取数全靠那个 `.php` 端点。这类实现不能作为参考：接口随时挂、无音质保证、无版权边界。

## 3. 横评表

图例：**自研** = 主仓自己实现并维护签名；**上游** = 依赖 npm/包管理器里的第三方实现；**脚本** = 平台逻辑在用户可插拔的脚本/插件里；**—** = 不支持。

| 项目 | 网易云 | QQ | 酷狗 | 酷我 | 咪咕 | 汽水 | 其他 | 签名归属 | 换版维护成本 | License |
|---|---|---|---|---|---|---|---|---|---|---|
| Mineradio ★11.4k | 上游 `NeteaseCloudMusicApi ^4.32.0` | 仅会员判定（`qq-vip-api.js`）| 自研 2,266 行 | — | — | 自研 136KB + 官方 web 风控 | Spotify 自研 62KB | 自研为主 | **极高**（300KB+ 自研，但有 30+ 单平台测试）| GPL-3.0 |
| lx-music ★55.4k | 内置（crypto 55 行，抄上游）+ 脚本 | 内置 `zzcSign` 29 行 + 脚本 | 内置 `infSign` vendor + 脚本 | 内置 + 脚本 | 内置 + 脚本 | — | 虾米(死)/百度(注释) | 自维护副本 + 脚本双轨 | **中**（双轨兜底）| Apache-2.0 |
| listen1 ★12.1k | 自签 weapi/eapi 963 行 | 老 fcg 接口免签 868 行 | 老接口免签 516 行 | 自签 token 791 行 | 自签 RSA 922 行 | — | B站/太合/虾米 | 全自研 | **极高**（已半死：migu 签名被注释、2025-06 后无推送）| MIT |
| YesPlayMusic ★33.6k | 上游 `@neteaseapireborn/api` | 经 UNM | 经 UNM | 经 UNM | 经 UNM | — | UNM: ytdl/bilibili/pyncm | 全部上游 | **低**（应用侧 0 签名代码）| MIT |
| nuclear ★19.0k | — | — | — | — | — | — | YouTube 经 yt-dlp 插件 | 插件自理 | 宿主**低** / 插件高 | AGPL-3.0 |
| Harmony ★3.1k | — | — | — | — | — | — | YouTube + Piped | 无签名问题 | **低**（但也接不了国内）| 见仓库 |
| MusicFree ★28.6k | 社区脚本（多为中转 API）| 社区脚本 | 社区脚本 | 社区脚本 | 社区脚本 | 社区脚本 | 官方 13 插件（无国内）| 脚本作者 | 宿主**低** / 脚本不可控 | GPL-3.0（插件集）|
| UNM/server ★7.9k | 本体（作为补源目标）| `QQ_COOKIE` 170 行 | md5 84 行 | DES 90 行 | cookie | — | 百度/波点/joox/yt | 全自研（但每题极短）| **中** | LGPL-3.0 |
| **Aurora 现状** | `@neteasecloudmusicapienhanced/api` | **自研 ~3,000 行** | `vendor/KuGouMusicApi` **17,315 行** | — | — | `qishui-music-api`（116 行 RSA）| — | 混合：2 上游 + 2 自维护 | **高**（QQ 与酷狗是大头）| — |

## 4. 各项目平台接入方式对照（按平台）

### 4.1 网易云

| 做法 | 项目 | 具体 |
|---|---|---|
| 内嵌 Node API 服务 | YesPlayMusic、Mineradio | `@neteaseapireborn/api ^4.29.7` / `NeteaseCloudMusicApi ^4.32.0`；主进程 `serveNcmApi()` 起本地 HTTP |
| 抄上游 crypto 进主仓 | lx-music | `wy/utils/crypto.js` 55 行，注释直指 Binaryify 的 `util/crypto.js`，自维护副本 |
| 纯前端自签 | listen1 | `js/provider/netease.js` 963 行，forge 做 AES-CBC/RSA modPow |
| 第三方中转 API | MusicFree 社区插件 | `ws.suol.cc/api/wy/wy_php.php/`，字段仿 NeteaseCloudMusicApi |
| 插件脚本自签 | lx-music 自定义源 | 脚本用 `lx.utils.crypto.aesEncrypt/rsaEncrypt/md5` 自己实现 |

**对 Aurora 最省维护**：继续用上游包（现状即最优）。风险在于 `@neteasecloudmusicapienhanced/api` 是个人 fork，需要跟踪其活跃度；可考虑保留 `NeteaseCloudMusicApi` 原版作为备选（Mineradio 仍在用 v4.32，说明原版没死）。

### 4.2 QQ 音乐

| 做法 | 项目 | 具体 |
|---|---|---|
| 自研签名（zzcSign）| lx-music | `tx/utils/crypto.js` **29 行**：SHA1 + 两张索引表乱序取字符 + 20 个常量 XOR + base64 变形 |
| 老接口免签 | listen1、UNM | listen1 用 `c.y.qq.com/v8/fcg-bin/*.fcg` + `g_tk=5381&nosign=1`；UNM 用 `u.y.qq.com/cgi-bin/musicu.fcg` + `QQ_COOKIE` |
| 内嵌上游 Node API | （生态里主要是 `qq-music-api` ★1,136，Aurora 曾评估；本项目组未深入其源码）| — |
| 只判定会员，不做播放 | Mineradio | `qq-vip-api.js` 27KB 全是会员字段名映射 |

**对 Aurora 最省维护**：**UNM 的免签路线**（cookie + musicu.fcg）< 自研 zzcSign < 从零逆向。若 Aurora 已维护 ~3,000 行自研 QQ，首要动作是把签名与业务分开、并把签名段缩到 lx-music 同级（29 行级别），而不是继续加业务代码。

### 4.3 酷狗

| 做法 | 项目 | 具体 |
|---|---|---|
| 极简自签 | UNM | 84 行：搜索 `mobilecdn.kugou.com`，取流 key = md5(hash + 'kgcloudv2') |
| 老接口免签 | listen1 | `www.kugou.com/yy/index.php?r=play/getdata`、`m.kugou.com/app/i/getSongInfo.php` |
| vendor 压缩签名 | lx-music | `vendors/infSign.min.js` 11.8KB |
| 全自研 2,266 行 | Mineradio | Android/H5 双 salt + appid 1005/1014 + gateway 签名，注释追踪官方 `playbyAudio.js` |
| 中转 API | MusicFree 社区插件 | `ws.suol.cc/kg/kg.php` |

**对 Aurora 最省维护**：Aurora 现在 vendored 17,315 行 `KuGouMusicApi` 是四条路线里最重的。UNM 的 84 行证明「搜索 + `kgcloudv2` md5 取流」这条最小路径长期可用（默认启用、多年未改），可以把它作为兜底，只在音质/VIP 场景才走重实现。

### 4.4 酷我

| 做法 | 项目 | 具体 |
|---|---|---|
| DES 自签（90 行）| UNM | `src/kwDES.js` + `crypto.kuwoapi.encryptQuery`，失败回退 `antiserver.kuwo.cn` 明文 |
| 抄站点函数 | listen1 | `js/provider/kuwo.js` 791 行，内嵌酷我站点的 URL 加密函数 `h(t, e)` |
| 内置 SDK | lx-music | `kw/util.js` 约 7KB |
| 聚合源解密 | cdyUuu/lx-music-xinghai-source ★275 | 支持酷我加密音频解密 |

**对 Aurora 最省维护**：Aurora 目前无酷我。若要加，抄 UNM 的 90 行（LGPL 注意）或直接调社区脚本，**不要**从零写。

### 4.5 咪咕

| 做法 | 项目 | 具体 |
|---|---|---|
| cookie 直连 | UNM | `src/provider/migu.js`，需 cookie，默认启用 |
| RSA 自签 | listen1 | `migu.js` 922 行，`forge.pki.publicKeyFromPem().encrypt()` |
| 内置 SDK | lx-music | `mg/` 目录 |

**对 Aurora 最省维护**：UNM 路线（cookie + 直连），代码量最小；但咪咕对 Aurora 收益低（曲库重叠），建议不做。

### 4.6 汽水音乐 / 抖音

| 做法 | 项目 | 具体 |
|---|---|---|
| 官方 web 风控跑签名 | Mineradio | 隐藏 Electron 窗口加载官方 passport 网页 + `qishui-auth-v6/bdms.js`（238KB，按 NOTICE 是字节级保留的官方 Web 安全运行时）；扫码登录拿 cookie，再用自研 `qishui-api.js` 调接口；`qishui-audio-decryptor/` 解音频 |
| npm 包内置协议 | **Aurora 现状** | `qishui-music-api` 的 `src/protocol.cjs` 116 行 RSA |

**对 Aurora 最省维护**：短期维持 `qishui-music-api`（116 行，改版只需改这一处）；中期若要抗改版，把登录/风控挪到隐藏 BrowserWindow 跑官方网页（Mineradio 路线），业务 API 仍留 Node 侧。**这条是 Aurora 唯一的「协议黑盒」风险点**——其余三平台都有成熟上游包或短小自签路径。

## 5. 对 Aurora 的三条具体建议

前置判断：Aurora 现在四平台的**维护面分布极不均衡** —— 网易云、汽水各只有几百行协议代码且有上游包托底；QQ 自研 ~3,000 行、酷狗 vendored 17,315 行，两者合计占平台代码的 87%。所以建议按「先削大头、再加兜底、最后补质量」排序。

### 建议一：把 QQ 签名从业务里剥离，并加一道「上游漂移」提示

**现状**：`D:\Aurora\electron\qq\` 约 3,000 行里，签名/加密与取数/解析混在一起。一旦 QQ 改版，改动点在哪个文件、改哪几行，没有边界可循，只能整体回归。

**对标事实**：lx-music 的 QQ 签名 `src/renderer/utils/musicSdk/tx/utils/crypto.js` 只有 **29 行**（SHA1 → 两张索引表乱序取字符 → 20 个常量 XOR → base64 变形去 `/+=` → 拼 `zzc`）；UNM 的 `src/provider/qq.js` **170 行**且完全不签名（靠 `QQ_COOKIE` 打 `u.y.qq.com/cgi-bin/musicu.fcg` 的 `DoSearchForQQMusicDesktop` 与 `vkey.GetVkeyServer/CgiGetVkey`）。两者都证明：**QQ 的签名部分应该只有几十到一两百行，剩下全是业务**。

**落点**：

1. 新建 `electron/qq/crypto.ts`，只放纯函数（无 IO、无状态、可单测），把 `zzcSign` / `sign` / `vkey` 之类的入口收敛到这里；其余文件只允许 `import { sign } from './crypto'`。目标行数 ≤ 200。
2. 同目录加 `electron/qq/__tests__/crypto.test.ts`，用固定输入 → 固定输出的快照测试锁住行为；改版时一旦签名公式变了，测试立刻红。
3. 加 `scripts/check-upstream-drift.mjs`：用 GitHub API 拉 `lyswhut/lx-music-desktop` 的 `src/renderer/utils/musicSdk/tx/utils/crypto.js` 与 `UnblockNeteaseMusic/server` 的 `src/provider/qq.js` 的 blob SHA，跟 `docs/upstream-drift.md` 里记录的基线比对。SHA 变了就在发版前提示「上游 QQ 实现变过，去 diff」。这一步不需要抄代码，只需要一个提醒机制。
4. 长期选项：评估把 QQ 主路径切到 UNM 的免签（cookie）路线，签名只作为音质升级的补充路径。这是**减少代码**而不是增加代码的唯一方向。

### 建议二：引入「自定义源脚本」作为第五路兜底，把酷狗 17,315 行降级为可选

**现状**：`vendor/KuGouMusicApi` 17,315 行是 Aurora 最重的一块外部代码，且它以 vendor 形式整体引入 —— 上游改版时要么整包替换、要么自己打补丁。

**对标事实**：两个成熟项目的共同结论都是「把平台逻辑挪出主仓」：lx-music 用隐藏窗口跑用户 JS（官方文档 `docs/desktop/custom-source.mdx`），MusicFree 用插件宿主 + `require` 白名单。而 lx 的协议**窄得惊人**：整个自定义源 API 只有 3 个 action —— `musicUrl`（返回 HTTP 直链 + type ∈ 128k/320k/flac/flac24bit）、`lyric`（`{lyric, tlyric, rlyric, lxlyric}`）、`pic`（封面 URL）；宿主只提供 `lx.request`（不受跨域限制、可 cancel）和 6 个 `lx.utils` 加密原语（aesEncrypt / md5 / randomBytes / rsaEncrypt / zlib / buffer）。

**落点**（Aurora 已有 Electron 主进程，改造成本比 lx 更低）：

1. 新建 `electron/source-scripts/` 目录：
   - `loader.ts`：用 `new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } })` 加载一个空白 `user-api.html`，通过 `webContents.send` / `ipcMain` 与脚本互通，**20 秒超时 + cancel**（照抄 lx 的 `requestKey` 机制）；
   - `preload.cjs`：构造 `globalThis.lx = { version, env: 'desktop', on, send, request, utils }`。`lx.request` 转发给主进程用 `net.fetch` 发（绕 CORS 且能带自定义 header）；`lx.utils.crypto` 用 `node:crypto` 包装（AES-128/192/256-CBC、RSA publicEncrypt、md5、randomBytes），`lx.utils.buffer` 用 `Buffer`；
   - `protocol.ts`：把 action 收敛为 **3 个**：`resolveStream(musicItem, quality) → { url, headers?, userAgent?, quality }`、`getLyric(id, source)`、`getCover(id, source)`。**不要**照 MusicFree 抄 12 个方法 —— Aurora 不做插件商店，只需要兜底取流。
2. 主仓只保留两个上游包（网易云 `@neteasecloudmusicapienhanced/api`、汽水 `qishui-music-api`）作为默认源；`vendor/KuGouMusicApi` 与 `electron/qq/` 降级为「内置源（可选）」，用户脚本源排在它们之前，失败再回退。
3. 用户脚本从 `app.getPath('userData')/sources/` 加载，**不进仓库、不打进安装包**。这一条同时解决版权问题：`maotoumao/MusicFreePlugins` 明确因为「收到告知函」下架了全部国内厂商源，主仓不应内置可分发第三方平台源。
4. 协议文档落 `docs/source-script-protocol.md`，与 lx 的字段名保持语义对齐（但不要求二进制兼容），方便用户直接把社区 lx 源改两行搬过来。

### 建议三：给回退链补上「真码率校验」，别把 128k 当真 320k

**现状**：Aurora 的多平台回退是「按优先级取 stream url → 交给渲染层播放」，没有对拿到的流做质量核验。跨平台补源时这是常见坑：声明 `320k` 但服务端回的是 128k，或者回一段 8KB 的假流（防盗链校验失败时的假响应）。

**对标事实**：UNM `src/provider/match.js` 的做法是行业里被验证最多的：发 `Range: bytes=0-8191` 取头 8KB，解析 MP3 frame header / `fLaC` magic / ID3 tag 得到**真实码率**，同时校验 `Content-Length === 8192`（不相等说明服务端忽略了 Range 或返回了假流）；再按域名补 Referer（`bilivideo.com → https://www.bilibili.com/`）与 md5（`126.net` 取文件名、`qq.com` 取 `server-md5`）。YesPlayMusic 就是通过 `@unblockneteasemusic/rust-napi` 复用这套判定。

**落点**：

1. 新建 `electron/fallback/verify.ts`，导出 `verifyStream(url, declaredQuality): Promise<{ ok, actualBitrate, reason }>`：
   - 发 `Range: bytes=0-8191`；
   - 校验 `Content-Length`、解析帧头得实际码率并与 `declaredQuality` 比对（±16kbps 容差）；
   - 域名 → Referer/UA 映射表放同文件常量 `REFERER_BY_HOST`，与现有取流代码里的 header 逻辑合并（现在是散落的）。
2. 接进回退链：`electron/player/` 里现有「网易云 → 汽水 → 酷狗」的顺序不变，在每个源返回后插一次 `verifyStream`；不通过则带错误码 `STREAM_INVALID` / `RATE_MISMATCH` 继续下一个源，并把失败原因写进日志面板（现在这类静默失败最难查）。
3. 加缓存：同一 `(id, source, quality)` 的校验结果在内存里存 10 分钟，避免反复探字节拖慢切歌。
4. **许可提醒**：`UnblockNeteaseMusic/server` 是 LGPL-3.0。上面写的是按机制重实现（几十行，不是拷贝），不构成派生；若直接复制其 `match.js` 代码则需评估。

### 附：可选第四条（汽水登录）

汽水是 Aurora 唯一的「协议黑盒」：`qishui-music-api/src/protocol.cjs` 116 行 RSA，改版只能等包更新。Mineradio 的路线是把**登录/风控**交给隐藏 Electron 窗口加载官方 passport 页面（`qishui-auth-v6/bdms.js` 238KB 是字节级保留的官方 Web 安全运行时，`docs/THIRD_PARTY_PORTS.md` 记为移植自 `Wx2yZx/Mineradio-Qishui-QR-Login`），扫码拿到 cookie 后再由 Node 侧调业务接口。Aurora 已有 Electron，可只把**登录一步**挪进隐藏窗口，业务 API 保持现状 —— 改动面小，但从此不受登录风控改版影响。

## 6. 附录：调研中实际访问过的 URL / 路径

说明：GitHub 核心 API 于 2026-11-17 分两批访问 —— 先直连（60 次/小时用尽后 403），后改经本机 HTTP 代理 `http://127.0.0.1:7890` 的出口（另有一份额度）。`raw.githubusercontent.com` 与 `cdn.jsdelivr.net/gh/...` 在本机网络下均不可达（`fetch failed`），故全部文件内容都走 `contents` API 取 base64 自行解码。以下为实际发起过的请求目标。

### 6.1 GitHub 仓库元数据（`GET https://api.github.com/repos/{owner}/{repo}`）

```
api.github.com/repos/XxHuberrr/Mineradio-paused
api.github.com/repos/lyswhut/lx-music-desktop
api.github.com/repos/lyswhut/lx-music-doc
api.github.com/repos/listen1/listen1_chrome_extension
api.github.com/repos/qier222/YesPlayMusic
api.github.com/repos/nukeop/nuclear
api.github.com/repos/anandnet/Harmony-Music
api.github.com/repos/maotoumao/MusicFree
api.github.com/repos/maotoumao/MusicFreePlugins
api.github.com/repos/UnblockNeteaseMusic/server
api.github.com/repos/pdone/lx-music-source
api.github.com/repos/Macrohard0001/lx-ikun-music-sources
api.github.com/repos/xxnuo/MusicFreePluginsHub
api.github.com/repos/hebijunge/musicfree-plugins
api.github.com/repos/martin65536/z-music-plugins
api.github.com/repos/XCShey/MusicFree-plugin
```

### 6.2 文件树（`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`）

```
api.github.com/repos/XxHuberrr/Mineradio-paused/git/trees/main?recursive=1
api.github.com/repos/lyswhut/lx-music-desktop/git/trees/master?recursive=1
api.github.com/repos/lyswhut/lx-music-doc/git/trees/master?recursive=1
api.github.com/repos/listen1/listen1_chrome_extension/git/trees/master?recursive=1
api.github.com/repos/qier222/YesPlayMusic/git/trees/master?recursive=1
api.github.com/repos/nukeop/nuclear/git/trees/master?recursive=1
api.github.com/repos/anandnet/Harmony-Music/git/trees/main?recursive=1
api.github.com/repos/maotoumao/MusicFree/git/trees/master?recursive=1
api.github.com/repos/maotoumao/MusicFreePlugins/git/trees/main?recursive=1
api.github.com/repos/UnblockNeteaseMusic/server/git/trees/master?recursive=1
api.github.com/repos/martin65536/z-music-plugins/git/trees/main?recursive=1
```

### 6.3 关键文件（`GET /repos/{owner}/{repo}/contents/{path}`，逐条 base64 解码）

| 仓库 | 取过的路径 |
|---|---|
| XxHuberrr/Mineradio-paused | `package.json`、`docs/THIRD_PARTY_PORTS.md`、`qq-vip-api.js`、`kugou-api.js`、`qishui-api.js`、`server.js`（头部）、`tests/` 若干 |
| lyswhut/lx-music-desktop | `src/renderer/utils/musicSdk/api-source.js`、`src/renderer/utils/musicSdk/index.js`、`src/renderer/utils/musicSdk/wy/utils/crypto.js`、`src/renderer/utils/musicSdk/tx/utils/crypto.js`、`src/main/modules/userApi/index.ts`、`src/main/modules/userApi/rendererEvent/rendererEvent.ts` |
| lyswhut/lx-music-doc | `docs/desktop/custom-source.mdx`（全读）、`docs/desktop/open-api.mdx`（取到未展开）|
| listen1/listen1_chrome_extension | `package.json`、`js/provider/{netease,qq,kugou,kuwo,migu,bilibili}.js`、`js/controller/platform.js` |
| nukeop/nuclear | `packages/plugin-sdk/README.md`、`packages/docs/core-concepts/plugins-and-providers.md`、`packages/player/src/services/plugins/pluginCompiler.ts` |
| anandnet/Harmony-Music | `.gitmodules`、`pubspec.yaml`、`lib/services/piped_service.dart` |
| maotoumao/MusicFreePlugins | `readme.md`、`types/plugin.d.ts`、`plugins.json` |
| UnblockNeteaseMusic/server | `src/provider/{kugou,kuwo,qq,migu,match}.js`、`src/crypto.js`、`src/kwDES.js`、`package.json` |
| martin65536/z-music-plugins | `plugins/wy.js`、`plugins/kg.js` |

### 6.4 限流自查与其他端点

```
api.github.com/rate_limit            # 两批额度与 reset 时间（直连 403 后确认、代理出口 31/60）
github.com/{owner}/{repo}            # 网页首页（经 127.0.0.1:7890 代理，用于补充 API 未给的描述/License 显示）
```

### 6.5 未走网络、直接读本机克隆的部分

```
D:\Aurora\.ref-musicfree\src\core\pluginManager\plugin.ts        # 1121 行，插件宿主
D:\Aurora\.ref-musicfree\src\types\… / types/plugin.d.ts           # 插件接口定义
D:\Aurora\.ref-yesplaymusic\src\api\                             # 9 个文件 ~28KB，全薄 axios
D:\Aurora\.ref-yesplaymusic\src\electron\services.js             # 15 行，serveNcmApi
D:\Aurora\.ref-yesplaymusic\src\electron\ipcMain.js              # UNM rust-napi 接入
D:\Aurora\.ref-yesplaymusic\src\utils\Player.js                  # _getAudioSourceFromUnblockMusic
D:\Aurora\.ref-solara\server\                                    # express 路由，无平台接口
D:\Aurora\docs\tauri-refactor-assessment.md §8.2/§8.3             # Aurora 四平台现状基线
```

### 6.6 明确「未查到」的项

- **akudamatata/Solara 的 star 数**：限流窗口内未取到该仓元数据（仅有本机克隆，且 `server/` 无平台代码），报告中标为未查到。
- **`qxdnb/MusicFreePlugins`、`qwerwhr/musicfree-plugins` 的具体平台清单**：仅在搜索结果的仓库描述里见到（76 个插件 / 社区聚合），未逐个读源码，报告正文未把它们当作事实来源。
- **`qq-music-api`（★1,136）源码**：本报告未深入，只在 Aurora 基线对照里引用其活跃度；QQ 的技术细节全部来自 lx-music、UNM、listen1 三个已读实现。
- **Harmony-Music 的 License 名称**：仓库元数据里 license 字段非标准 SPDX，正文未断言具体许可证。

---

报告完。数据采集时间 2026-11-17（Asia/Shanghai）。

