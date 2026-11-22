# 本机四家音乐桌面应用拆解（Cloudy / RHINE / AlgerMusicPlayer / BiliMusic）

> 对象：用户桌面上四家**已安装**的同类应用，不是 GitHub 仓库。
> 采集日期：2026-11-22。全部事实来自本机文件：`.lnk` → 安装目录 → `resources/app.asar` / Qt 资源 / exe 字符串 / `%APPDATA%`。
> 行号约定：**AlgerMusicPlayer 的 `src/...:N` 是 app.asar 内源码的行号；BiliMusic 的 `dist-electron/main.js:N` 是打包后主进程的行号**。两者都不是本仓路径。

## 0 身份卡

| 应用 | 技术栈 | 体量 | 版本 | 数据源 | 一句话 |
|---|---|---|---|---|---|
| Cloudy | **Go + mygo（WebView2 壳）** | 18.3 MB 单 exe | 1.3.4 | 网易云（自带实现，eapi） | 不用 Electron 也做完了同一张功能表 |
| RHINE MUSIC DATABASE | **Qt6 Quick + Quick3D + Node 插件桥** | 303 MB（内含 node.exe 81 MB） | — | 本地库 + 塞壬唱片官网 | 把「音源」做成纯数据 descriptor |
| AlgerMusicPlayer | Electron + Vue3 + naive-ui | 57 MB asar（含完整 src） | 5.1.0 | 网易云（本地 NeteaseCloudMusicApi + unblock + LX 脚本 + GD 音乐台） | 取流做成策略链，工程细节最全 |
| BiliMusic | Electron + React 19 | 46.5 MB asar | 1.0.2 | B 站（wbi 签名） | 外壳与渲染层分开热更，带回滚 |

安装目录：`%LOCALAPPDATA%\Programs\{Cloudy,RhineMusicDatabase,AlgerMusicPlayer,BiliMusic}`。
数据目录：`%APPDATA%\{Cloudy,AlgerMusicPlayer,bilimusic}`、Rhine 在安装目录 `data\`。

---

## 1 BiliMusic：外壳/渲染层分离的 OTA（本次最值得抄的一条）

**机制**（`dist-electron/main.js`）

- 启动时先算「该用哪份渲染层」：`activeVersion/activeFile/verified` 三字段存在 `userData/ota/state.json`（`:166` 起），有已验证的新包就用它，否则回退到打包内置的 `bundledRendererRoot`。
- 更新清单是 GitHub Release 上的 `ota.json`（`:159`），字段只有 `rendererVersion / shellVersion / minShellVersion / file / sha512`。判定顺序：渲染层可热更 → 否则外壳版本更高才走 electron-updater（`:232` 一带）。
- 下载流式写盘、**sha512 不对直接抛错**（`:232` 附近 `校验失败：渲染包指纹不匹配`），校验通过才 `rename` 成正式文件。
- **回滚**：新版本激活后先不置 `verified`；渲染层加载成功会回发 `updater:renderer-ready`（`:500` 之前），此时才置位。若下次启动仍 `!verified`，就把该版本打进 `failedVersions` 并删文件（`:205` / `:249`）——一个「装上、试跑、失败自动退回」的闭环，全在 electron-updater 之外。
- 另有两条配套：`app://` 自定义协议 serve 渲染层（`:428`），以及把请求 Origin 回填进响应头的 CORS 处理（`:446`）。

**取舍**：多一个状态机、多一份清单要维护，换来「改一行 CSS 不用发 200 MB 安装包」。风险是渲染层与外壳 API 不匹配——所以才有 `minShellVersion`。

**可借鉴**：Aurora 现在 `electron/updates.ts` 只有 electron-updater 整包。可加一条**只热更 `dist/` 渲染层**的旁路：
- 落点：新 `electron/ota.ts`（状态机）+ `electron/protocols/` 里让 `aurora-app://` 指向活动版本 + `src/features/updates/` 加一行「界面包已更新」。
- 骨架（manifest 判定）：
```ts
type OtaManifest = { rendererVersion: string; shellVersion: string; minShellVersion: string; file: string; sha512: string }
function shouldPatch(m: OtaManifest, shell: string, state: OtaState): boolean {
  return !state.failedVersions.includes(m.rendererVersion)
    && cmp(m.rendererVersion, state.activeVersion ?? shell) > 0
    && cmp(m.minShellVersion, shell) <= 0   // 外壳太老就不装
}
```
- 验收：把渲染层版本号 +1 打一个 asar，本机断网启动确认仍回落内置；联网启动后 `startup.log` 出现 `ota: active=<ver>`，且改过的界面文案可见；手工把 sha512 改错一个字符，必须拒绝安装。
- 回滚：删 `userData/ota` 目录即回到内置渲染层，不动安装包。

## 2 AlgerMusicPlayer：取流策略链与本地库增量

**机制**

- 取流不是 if-else，是**策略数组按 priority 排序**：`LxMusic(0) → CustomApi(1) → GDMusic(3) → UnblockMusic(4)`（`src/renderer/api/musicParser.ts:434`）。每个策略实现 `canHandle / parse`，失败写「失败缓存」后由下一个接。
- 三条工程参数（`musicParser.ts:34`）：URL 缓存 **30 min**；失败缓存 **1 min（内存 Map，重启即失效）**；重试 **2 次、1 s 起指数退避**（`RetryHelper:185`）。缓存还带「音源配置指纹」——用户改了启用音源就作废旧 URL。
- 本地库：主进程只做扫描（`SUPPORTED_AUDIO_FORMATS` 六种格式，`localMusicScanner.ts:11`）+ music-metadata 解析（并发 `min(8, cores)`，`:12`；封面 >1 MB 丢弃 `:13`），**增量判定在渲染层**：按 `mtime` 只重解析变更文件（`store/modules/localMusic.ts:145`），结果进 IndexedDB。
- 遥控：主进程起 express（默认 31888，IP 白名单），`/api/toggle-play` 等直接把命令经 IPC 丢回窗口（`main/modules/remoteControl.ts:160`）。手机浏览器就能控。
- 本地 API：NeteaseCloudMusicApi 起在 30488，**只监听 127.0.0.1**，端口被占自动 +1 并写回设置（`main/server.ts`）。

**取舍**：IndexedDB 存曲库让「扫描状态」与 UI 同进程，但主进程窗口重建或清缓存后要重扫；Aurora 的主进程增量索引（`electron/library-scan.ts` + `src/features/library/scan.ts`）在这一点上更对，不要换。

**可借鉴**：
1. 把 30 min / 1 min / 2 次退避搬到 `src/features/online/streams.ts`，key 用 `(provider, id, quality)` 并混入音源顺序指纹。验收：切歌时同一首来回切 5 次，日志里取流请求只发生 1 次；把某源配成不可用，1 分钟内不再重打它。
2. 遥控接口与 `src/features/party` 合并思考：局域网一台手机当遥控器，比再写一个客户端便宜。

## 3 RHINE MUSIC DATABASE：provider 即数据

**机制**

- 每个音源是一份 `descriptors/<id>.json`（schemaVersion 2），Qt 侧只读它渲染，Node worker 侧只读 manifest 执行。以 `siren.json` 为例，字段分十组：
  `capabilities`（search/login/likes/mutations/playlistManagement…）、`library`（五列名、`sourceOrder`、`likedModel`、`playlistEditableRule:"owned"`）、`quality`（档位 + tier 标签 + 本地文件名后缀识别表）、`discover`（tabs）、`lyrics`（来源/回退/matchMode/**rateLimitMs**）、**`media`（`hosts`/`coverHosts` 白名单 + `allowHttp` + `schemePolicy`）**、**`cache`（version + `ttlByOperation` + `ttlByRoute` + maxEntries）**、`links`（webTemplates）、`strings`（文案）、`operations`（request/songs/wiki/trackPage/catalog/capabilities/vip 白名单）。
- 插件契约写在 `resources/MusicBridge/plugins/sdk/README.md`：`schemaVersion 2` / `apiVersion 2.0`、CommonJS 单文件 `plugin.cjs`、`operations` 白名单由入口自行拒绝未声明项；**安装不验签**，只校验 id、manifest 结构、安全相对路径、入口存在；`data/plugins-state.json` 的 `disabled[]` 控制启用。
- 运行时是**随包发行的 `node.exe`（81 MB）+ `worker.cjs`**，而非进程内 JS。播放另起 `RhinePlaybackService.exe`。
- 视觉上走了 Qt Quick 3D：`resources/archive-assembly.bin` + 烘焙贴图（`baked-light/normal/surface-bc7`）+ 透射材质（KHR_materials_transmission 0.72~0.78），把封面做成放在场景里的卡带。

**取舍**：descriptor 化让「加平台」变成加 JSON + 一个 adapter，也让「这个平台有没有收藏/能不能建歌单/缓存多久」变成可校验的数据；代价是 schema 膨胀（`manifest.schema.json` 43 KB、`descriptor.schema.json` 29 KB）以及 Qt/worker 两份元数据必须同步——README 明确警告不同步会「UI 显示支持、实际 dispatch 不支持」。

**可借鉴**：Aurora 的 `ProviderCapabilities`（`src/features/online/types.ts:455`）现在是布尔对象。不必一步到 schema，但可先补三项已在四家反复出现、Aurora 却散在代码里的**数据**：
- `media.hosts`：封面/音频域名白名单（现在散在 `electron/upstream-headers.ts` 与各 provider）；
- `cache.ttlByOperation`：热搜/歌单详情/歌词各多久（现在各 provider 自己拍脑袋）；
- `quality.labels`：档位显示名与 badge（现在 `src/features/online/quality.ts` 里按平台 if）。
验收：新增一个平台只改 provider 文件 + 一个 JSON 常量，不碰 `quality.ts`。

## 4 Cloudy：Go 单 exe 的功能密度

**机制**：Go 模块 `netease-music-mygo` + `github.com/egoist/mygo`（Go 的 WebView 壳，≈ Tauri 的 Go 版）。`embed.FS` 内嵌前端，实例间走 `mygo://localhost/`。字符串里可见：
- `internal/player` 自带 **DSF/DFF/DSD 解码**（`readDSFHeader`/`readDFFHeader`/`openDSDStream`）与频谱；
- 网易云端点直连（`eapi`、`/api/v1/cloud/get`、`/api/cloud/pub/v2`、`/api/v1/radio/get`），无中间 Node 服务；
- 系统层：SMTC、托盘、全局热键、下载队列（`downloads-*.json`）、`upload-queue.json`；
- 内嵌 `sherpa-onnx`（`encoder.int8.onnx`/`decoder.int8.onnx`/`libonnxruntime.so`）。

**取舍**：18 MB、冷启动与内存都赢 Electron 一个数量级；代价是 UI 迭代要重编二进制、没有 Chromium 生态、调试工具链差。

**功能密度**（从 exe 的中文文案直接读出，`%APPDATA%\Cloudy\settings.json` 佐证）：私人雷达/时光雷达/宝藏雷达/小众好歌/新歌雷达/乐迷雷达/神秘雷达/热点雷达/会员雷达；空间音频（`Room`: 浴室/教堂/大厅/房间 + `Spatial`/`Orbit`）；均衡器 10 段 + `Bass/Width/Treble/Depth` 预设；歌词 `lyricTilt/lyricBounce/lyricBlur` 三个 0–1 连续参数；`notch`（灵动岛）、`tray-card`、`mini` 小窗；主题 `glassClear/glassBend/glowLevel` 三个连续玻璃参数。

**可借鉴**：
1. **连续参数胜过开关**：它的歌词与玻璃都是 0–1 滑杆（`lyricTilt: 0.5`），Aurora 的 `desktop lyrics` 与 glass 目前多是布尔 + 几档预设。落点 `src/features/lyrics/`、`src/features/glass/`。验收：拖动滑杆屏幕即时变化，值写进设置并能重启保持。
2. **雷达系列**是网易云现成接口的聚合（私人/时光/宝藏/小众等），比「换一批」更像产品。落点 `src/features/discover/`。

---

## 5 横向对照

| 维度 | Cloudy | RHINE | Alger | Bili | Aurora 现状 |
|---|---|---|---|---|---|
| 壳 | Go+WebView2 | Qt6 | Electron | Electron | Electron ✅ |
| 音源抽象 | 模块内直连 | **descriptor 数据** | 策略链 | 单源 | provider 接口 + capabilities |
| 插件 | 无 | Node worker + manifest | LX 脚本沙箱(Worker) | 无 | `source-script-protocol` |
| 取流缓存 | 未知 | **按操作/路由 TTL** | 30 min + 失败 1 min | 无 | 部分（无统一 TTL） |
| 本地库 | 有 | 主进程 SQLite | 渲染层 IndexedDB | 下载目录 | 主进程增量索引 ✅ |
| 更新 | 整包 | 整包 | 整包 | **整包 + 渲染层 OTA** | 整包 |
| 托盘 | 原生+卡片 | 原生 | 原生菜单 | **自绘 HTML 胶囊** | 原生菜单 |
| 遥控 | 无 | 无 | **HTTP + IP 白名单** | 无 | 无 |
| 同步 | 无 | 无 | 无 | **WebDAV（safeStorage 加密）** | 备份本地 |

---

## 6 判据：什么该学，什么只该记

> 学方法，不抄做法。看到一个实现先问三句，答不全就不动手：

1. **它治的是我们的病吗？** 要有我们自己的证据（日志、用户原话、可复现的坏路径），不是「人家有」。
2. **约束一样吗？** 栈、维护人数、发布节奏、用户预期。Cloudy 一个人用 Go 撑得住，是因为它没有六个平台适配器。
3. **做完哪个指标会动、怎么验？** 答不上来就只记，不施工。

三条全过 → 做；过两条 → 记成待观察；只过「看起来更好」→ 丢掉。

### 6.1 过判据的（两条）

| 项 | 学的是方法 | 我们的病（证据） | 验收 |
|---|---|---|---|
| 失败状态机 | Alger 把失败当一等状态：策略按优先级、失败有记忆、重试有预算、配置变了旧结论作废 | `streams.ts` 已有缓存与去重，但「换源的判据」仍散在各 provider，退避只有一处 | 同曲来回切 5 次只打一次网；失败源在冷却期内请求数 0；日志能读出每次换源的原因 |
| 连续参数 | Cloudy 用 0–1 滑杆而不是档位，因为「再柔一点」是程度问题 | 桌面歌词与玻璃是几档预设，调到「差一点」时只能换档 | 参数即时生效、重启保持、两档之间能停住 |

### 6.2 待观察（先记，不动）

| 项 | 为什么不急 |
|---|---|
| provider descriptor（RHINE） | 病是真的（`quality.ts` 里按平台分支），但他们只有两个源、我们有六个，先等下一家平台接入时看重复度 |
| 雷达系列（Cloudy） | 概念好，但接口可用性未验证，不先改 `discover` |
| 渲染层 OTA（Bili） | 病不明确：发版频率低、每次都是真改动，热更省的是下载等待而不是我们的时间 |

### 6.3 否决

| 项 | 理由 |
|---|---|
| **托盘自绘胶囊面板（Bili）** | 原生菜单在 Windows 上就是正确观感，自绘等于在应用里重造一个系统控件；任务栏四个方位、DPI、多显示器、焦点与键盘可达性这些边角比面板本身贵。且托盘不是主路径——隐藏后回来有全局键与缩略图按钮。Bili 做它是因为封面临场信息是它的卖点，约束不同。 |
| 空间音频/房间预设（Cloudy） | 可听性无法在本机验收，先不动。 |
| Go 栈、DSD、Qt3D 卡带 | 已列入「明确不搬」。 |

**四个实现各对应一条方法，不对应一个功能**：Bili = 按变更频率分层；RHINE = 同一事实只留一份真源；Alger = 失败要有记忆和预算；Cloudy = 程度用连续量表达。

**明确不搬**：Cloudy 的 Go 栈与 DSD 解码（Aurora 不换栈、目标用户无 DSD 库）；RHINE 的 81 MB `node.exe` 桥与 Qt3D 卡带场景（成本远超收益，且 Aurora 已有 wallpaper/stage）；Alger 的 naive-ui 与 Vue 组件树；Bili 的单源模型与第三方歌词站（Aurora 歌词链路自足）；任何一家的皮肤。

---

## 7 证据附录

| 对象 | 路径 |
|---|---|
| Alger 源码 | `%LOCALAPPDATA%\Programs\AlgerMusicPlayer\resources\app.asar`（`src/` 随包发布，4110 文件） |
| Alger 取流 | `src/renderer/api/musicParser.ts:34,185,434`；`src/main/modules/localMusicScanner.ts:11-13`；`src/main/server.ts` |
| Bili 主进程 | `resources/app.asar` → `dist-electron/main.js`（885 行）；OTA `:159-260`，托盘 `:500`，CORS `:446`，WebDAV `:418` |
| Bili 接口 | `dist/assets/bilibiliApi-*.js`（wbi 签名 + 音乐榜 `/x/centralization/interface/music/...`） |
| RHINE | `resources/MusicBridge/plugins/descriptors/siren.json`、`plugins/sdk/README.md`、`resources/slots.json`、`data/session.json` |
| Cloudy | `Cloudy.exe` 字符串（Go 模块 `netease-music-mygo`、`embed.FS`、`internal/player.*DSD`）；`%APPDATA%\Cloudy\settings.json` |

**未验证项**：Cloudy 的取流/缓存策略（二进制内无字符串证据，未动态抓包）；RHINE 的 `RhinePlaybackService.exe` 具体解码链（仅见 Qt6 依赖）；Bili 的 `ota.json` 线上真实内容（未联网读取）。以上均按「字符串证据」标注，不当作实现事实。
