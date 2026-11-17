# Aurora 换壳评估：Tauri 及其他运行时

> 评估日期 2026-11-17，基线版本 v0.8.11 / 0.8.12（工作区）。
> 本文所有「现在」的数字都是**本机实测**，出处与复现命令见文末附录；所有「换壳后」的数字均为**估算**，标注了依据。

---

## 0. 一页结论

1. **技术上能做，但只有一条路走得通**：Tauri 2 做外壳，保留现有的 Node 后端跑在旁路进程（sidecar）里。
2. **「纯 Rust 重写后端」不成立**。Aurora 真正的资产不是窗口那层壳，是四个音乐平台的逆向接口（约 7000 行 Node 代码）。换语言等于把这份资产推倒重来，且上游接口随时可能变。
3. **换壳能拿到的收益只有一项是真的：安装包从 130 MB 降到约 55 MB。**
   - 内存基本不省（193.7 MB → 估计 150~200 MB，WebView2 自己也不轻）
   - 启动快 0.1~0.2 秒，用户感知不到
   - 代价：4~5 个月工作量、更新机制倒退（差分 5 MB 变整包 55 MB）、五套质量脚本与 71 个单测要搬家
4. **我的建议**：先做「不换壳的瘦身」（1~2 天，可省 15~20 MB），把体积焦虑消掉；如果仍然想换，先花 2 周做一个 spike，把六个风险点逐个验掉再决定，而不是直接开工。

---

## 1. 现状基线（本机实测）

### 1.1 体积构成

安装包 `release/Aurora-0.8.11-Setup.exe` = **129.9 MB**。它由四块未压缩内容压成：

| 内容 | 未压缩体积 | 说明 |
| --- | --- | --- |
| Electron 运行时 | **366.9 MB** | `electron.exe` 一个文件就 234.2 MB；`locales/` 48.3 MB；`dxcompiler.dll` 24.6 MB |
| 应用代码（`dist/` + `dist-electron/`） | 10.2 MB | 前端产物 + 主进程编译结果 |
| 生产依赖（asar 内） | **60.6 MB / 334 个包** | 含 jsdom、express、axios（都是网易云那个包拉进来的） |
| `vendor/KuGouMusicApi` | 约 21 MB | 磁盘上 84.3 MB，但打包配置已排掉 63.1 MB 的 devDependencies |
| 合计 | **约 459 MB** | NSIS 压缩后 129.9 MB |

**关键事实：体积的 80% 是 Electron 运行时本身，而这 366.9 MB 里没有任何一行是 Aurora 的代码。**

补充实测：

- `locales/` 55 个语言包 48.3 MB，经 gzip -9 后 12.8 MB。**只留 `zh-CN.pak`（0.56 MB）就能从安装包里省掉约 12 MB**，这是全项目性价比最高的一处改动。
- `electron.exe` 234.2 MB，gzip 后 103.6 MB——它本身已高度压缩，没有可裁剪空间。

### 1.2 运行时开销（本机实测，空闲无播放）

| 指标 | 实测值 | 测法 |
| --- | --- | --- |
| 进程数 | 4 个 | 主进程 / 渲染 / GPU / 工具进程 |
| 总 RSS | **193.7 MB** | 主进程 46.6 + 渲染 82.3 + 47.7 + 17.1 |
| 启动到首屏可交互 | **约 395 ms** | 日志首行 → `react committed` |
| 空闲主线程占用 | 0.73% 单核 | 见 `docs/perf-report.md`，与空白页在噪声内无差别 |

**启动已经是 400 毫秒级，这里没有多少可省的空间。**

### 1.3 代码规模

| 部分 | 文件 | 行数 |
| --- | --- | --- |
| `electron/`（主进程） | 79 | **21,728** |
| `src/`（渲染层） | 210 | 36,486 |
| 单元测试 | 71 个文件 | `node --test` 直跑 TS |
| 前端 IPC 桥 | `src/bridge.ts` 一处 | 486 行，对应 185 个 `invoke` + 11 个事件 |

### 1.4 两个对迁移有利的既有设计

- **前端所有后端调用都经过 `src/bridge.ts` 一个文件**，类型定义在 `src/env.d.ts`。换壳时前端 210 个文件一行不用改，只改这一个适配层。
- **`bridge.ts` 已经支持「没有后端」的降级**（浏览器预览走内存实现）。也就是说适配层是可替换的，这是判断「可行」的核心依据。

---

## 2. 迁移的真正障碍：四个平台的 Node 后端

这是整份评估的重点。窗口、托盘、协议这些都能平移，**唯有这一块搬不动**。

| 平台 | 实现方式 | 代码量 | 对 Node 生态的依赖 |
| --- | --- | --- | --- |
| 网易云 | in-process `require('@neteasecloudmusicapienhanced/api')` | 1,563 行 | **重度**：该包一次 require 拉起 1539 个模块，常驻 29 MB，耗时 1483 ms |
| QQ 音乐 | 自己拼 `musicu.fcg` 请求 + 签名（`fetch`） | 1,041 + 967 + 961 行 | 轻（只用了 `fetch`），但签名逻辑是逆向成果 |
| 酷狗 | spawn 一个 Express 服务（`vendor/KuGouMusicApi`） | 1,078 + 963 行 | **重度**：整个 vendor 是 Node 项目 |
| 汽水 | in-process SDK `qishui-music-api` | 788 行 | **重度**：SDK 只发 Node 包 |

换成 Rust 意味着：

- 网易云的加密登录、token 刷新要用 Rust 重写一遍（现在靠上游包里的 `util/xeapiKey.js` 等）
- 酷狗那 449 个端点里 Aurora 只用 19 个，但要把这 19 个的签名逻辑读懂再用 Rust 实现
- 汽水没有公开协议，只有那个 Node SDK
- **以上四项全部是逆向接口，上游一改就得跟着改。重写一次不是「搬代码」，是「重新逆向一次」。**

**结论：保留 Node 后端是唯一理性的选择。** 这也直接决定了换壳后的体积下限——必须带一个 Node 运行时。

---

## 3. 四条路对比

| | A. 不动 | B. Tauri 2 + Node 侧车 | C. Tauri 2 + Rust 全重写 | D. 留 Electron，瘦身 |
| --- | --- | --- | --- | --- |
| 安装包 | 129.9 MB | **约 55 MB**（估算） | 约 15 MB | 约 118 MB |
| 空闲内存 | 193.7 MB | 150~200 MB（估） | 约 120 MB | 193.7 MB |
| 启动 | 395 ms | 300~400 ms | 200 ms | 395 ms |
| 工作量 | 0 | **17~19 周**（单人） | 40+ 周，且不可预估 | **1~2 天** |
| 风险 | 无 | 中（六个硬骨头，见 §5） | **极高**（四平台协议重写） | 低 |
| 自动更新 | blockmap 差分，通常 5~15 MB | 整包 55 MB 或自研差分 | 整包 | 不变 |
| 可回退 | — | 可以（两套并存一段时间） | 不可 | 不需要 |
| 结论 | 基准 | **唯一可行** | **不推荐** | **建议先做这个** |

### 3.1 为什么 B 的体积只降到 55 MB 而不是 15 MB

去掉 Electron 的 366.9 MB 之后，还得装回一个 Node 运行时：

| 内容 | 未压缩 |
| --- | --- |
| Rust 壳 + 前端产物 | 约 12 MB |
| Node 运行时（`node.exe` 或 SEA 单文件） | **约 90 MB** |
| 生产依赖 | 60.6 MB |
| `vendor/KuGouMusicApi` | 21 MB |
| 合计 | 约 184 MB → 压缩后 **约 55 MB** |

省下的是 Chromium（约 140 MB 未压缩），付回去的是 Node（约 90 MB）。**净省一半左右，不是「从 130 变成 15」。** 那个 15 MB 的诱人数字只在方案 C 才存在，而 C 不成立。

### 3.2 更新机制会倒退

现在是 `electron-updater` + blockmap 差分：改几百 KB 的 JS，用户下载 5~15 MB。
Tauri 官方 updater **不做差分**，每次下载整包——55 MB 起步。社区有 `tauri-delta-updater`，但不成熟。

对一个「每两周发一版」的项目，这是实打实的倒退。

---

## 4. 方案 B 的拆解

### 4.1 目标架构

```
Tauri 2 (Rust)  ── 窗口/托盘/单实例/快捷键/五个自定义协议/更新/壁纸扫描/圆角
      │  invoke (JSON-RPC 转发)
      ▼
Node 侧车进程   ── 四平台客户端/曲库扫描/媒体缓存/转码/歌词匹配
      │  stdio 或 127.0.0.1 本地端口
      ▼
渲染层 (WebView2) ── 现有 React 代码，只改 src/bridge.ts 一处
```

### 4.2 各层工作量

| 工作项 | 估时 | 说明 |
| --- | --- | --- |
| Tauri 壳骨架 | 2 周 | 窗口、单实例、托盘、开机自启、全局快捷键、无边框圆角 |
| 五个自定义协议 | 2 周 | `aurora-app/media/remote/cache/wallpaper`，都要支持 Range 流 |
| 透明歌词浮窗 | 2 周 | **最硬**，见 §5.1 |
| Node 侧车 | 4 周 | 把 `electron/` 里对 `electron` 模块的依赖抽干，换成 host 接口 |
| 更新（Rust 重写下载器） | 1.5 周 | 含镜像回退、Range 续传、sha512 校验 |
| 壁纸引擎扫描 | 1 周 | 读 Steam `libraryfolders.vdf` + `project.json` |
| 前端 `bridge.ts` 适配 | 2 周 | 185 个方法 + 11 个事件逐一对齐 |
| 回归 + 测试搬家 | 3~4 周 | 71 个单测、5 套审计脚本、四平台全功能 |
| **合计** | **17~19 周** | 单人全职，不含意外 |

---

## 5. 六个硬骨头（按风险从高到低）

### 5.1 透明歌词浮窗（最高风险）

现在是 503 行 `electron/lyrics-overlay.ts`，用了三样 Windows 上的特殊能力：

- `setAlwaysOnTop(true, 'screen-saver')`——压过全屏视频和游戏
- `setIgnoreMouseEvents(true, { forward: true })`——鼠标穿透但仍能感知移动
- 每 70 ms 读一次系统光标判断是否悬停（这个已经绕过了 `forward` 的依赖，可以平移）

Tauri 的 `always_on_top` 是普通层级，`screen-saver` 这一档要自己写 Win32 `SetWindowPos`；鼠标穿透 Tauri 有 `set_ignore_cursor_events`，但没有 `forward`。**这一块要写 unsafe Rust，且必须在真机上逐个验证。**

### 5.2 五个自定义协议

Windows 上 Tauri 的 wry 会把自定义协议映射成 `http://<scheme>.localhost/`，而不是 Electron 那种 `scheme://host/`。影响：

- 前端 5 处协议 URL 拼接要改（`aurora-media`、`aurora-remote`、`aurora-wallpaper`）
- CSP 要跟着改
- 好消息：变成真 HTTP origin 之后，Web Audio 的跨源判定可能反而**更**简单，但必须实测确认（现在整条链路依赖 `corsEnabled` + `stream: true`）

### 5.3 Node 侧车把 `electron` 依赖抽干

`electron/` 里直接 import `electron` 的有 21 个文件：`app.getPath`、`safeStorage`、`net.request`、`dialog`、`shell`、`screen`、`powerSaveBlocker`……侧车里没有这些，要逐一换成参数注入或 Rust 端提供。项目里已有 `electron/ipc/host.ts` 这种「只声明接口」的雏形，但只覆盖了很小一块。

### 5.4 更新机制

Electron 的 `electron-updater` 白送差分下载、签名校验、NSIS 静默安装。Tauri 那边要自己拼：`tauri-plugin-updater` + 重写现有 206 行 `update-download.ts`（它已经带了镜像回退、DNS 超时、Range 续传、sha512 校验，逻辑要逐条搬）。

### 5.5 WebView2 版本不可控

Electron 的 Chromium 版本随安装包固定（现在是 Chrome 152）。Tauri 用系统 WebView2，版本随用户的 Edge 走——旧机器上可能是两年前的版本。

要检查：渲染层用了哪些较新的 CSS/JS 特性？旧 WebView2 上会不会塌？**这一项在开工前必须拿一台没更新过 Edge 的机器验。**

### 5.6 测试与审计脚本

71 个单测用 `node --test` 直跑 TS、5 套审计脚本（可达性/CSS/失效路径/导出）都是 Node 生态。

- 如果后端留在 Node 侧车里 → 大部分测试还能跑，但 import 路径要改
- 如果按方案 C 重写 → 71 个测试全部作废重写

---

## 6. 分阶段路线（若确定要换）

### 阶段 0：技术验证（2 周，可止损）

不做完整迁移，只做一个最小 spike，把 §5 的六个风险点各验一次：

| 验证项 | 通过标准 |
| --- | --- |
| 透明浮窗置顶 | 全屏视频/游戏之上仍可见，锁定态鼠标穿透、悬停能出控制条 |
| 自定义协议 + Web Audio | 用 `http://aurora-media.localhost/` 播本地 flac，**出声**，能拖动进度条 |
| Node 侧车 | 侧车起在 127.0.0.1，渲染层经 Tauri invoke 调到它，往返 < 5 ms |
| 更新 | 从 0.8.11 → 0.8.12 走通一遍，含断网续传 |
| WebView2 兼容 | 在一台旧 Edge 机器上，首页/详情页/舞台页三屏无布局错乱 |
| 内存 | spike 版空闲 RSS 实测值 |

**任何一项不过，就停在阶段 0，损失两周，而不是四个月。**

### 阶段 1~4

阶段 1 壳平移（窗口/托盘/协议/圆角）→ 阶段 2 侧车接通（四平台逐个点亮）→ 阶段 3 更新与壁纸 → 阶段 4 全量回归。

每个阶段的可执行验收点与现有 `npm run check`、`npm run smoke`、`npm run perf` 对齐，不另造标准。

---

## 7. 建议

**优先级一：先做方案 D，1~2 天，立刻见效。**

不换壳也能拿到的：

| 动作 | 预计省 | 风险 |
| --- | --- | --- |
| `electron-builder` 加 `electronLanguages: ["zh-CN", "en-US"]` | 语言包 48.3 MB → 1.1 MB，**安装包可省约 12 MB**（已配置，见附注） | 无 |
| 复核 `vendor/KuGouMusicApi` 的排除清单，再排掉不用的构建产物 | 若干 MB | 低 |
| 网易云包改成真正懒加载（现在启动即 warmUp） | 内存 29 MB | 低 |
| `npm ls --omit=dev` 复核 334 个包，去掉未用依赖 | 可能数 MB | 中 |

合计预计 130 MB → 约 118 MB（语言包一项按实测 gzip 压缩率算，是确定的 12 MB）。**拿不到 55 MB，但代价是一行配置，不是五个月。**

> 附注：`electronLanguages` 已写入 `package.json` 的 `build` 段。留 `en-US` 是为了 Chromium 内置页（错误页、右键菜单）的 fallback，多 0.2 MB。下次 `npm run dist` 生效。

**优先级二：如果体积仍是硬指标，就做阶段 0 的 spike，用两周换真实数字。**

**优先级三：不建议现在启动方案 B 的全量迁移，更不建议方案 C。**

如果目标是「想用 Rust 写点东西」，更划算的切入点是**独立的增量模块**，而不是整体换壳：更新下载器（206 行，输入输出清晰，可单独验收）、壁纸引擎扫描（987 行，纯文件解析）。这两块用 Rust 重写、通过 sidecar 或 IPC 接进来，风险低、有实在收益、也不影响现有发版节奏。

### 7.1 已执行（2026-11-17 实测）

方案 D 的两项已经落地，**安装包 129.9 → 115.0 MB（-14.9 MB，-11.5%）**，解包目录约 432 → 359.1 MB。

| 改动 | 落点 | 效果 |
| --- | --- | --- |
| 语言包只留中英 | `package.json` 的 `build.electronLanguages: ["zh-CN","en-US"]` | `locales/` 48.3 → 1.1 MB（剩 2 个 pak） |
| 打包后删 WebGPU 着色器编译器 | 新文件 `build/after-pack.js`，挂到 `build.afterPack` | `dxcompiler.dll` 24.6 MB + `dxil.dll` 1.4 MB |

删除依据：这两个 DLL 是 DirectX Shader Compiler 与它的 DXIL 签名库，Chromium 只在 `navigator.gpu` 真被调用时才加载；Aurora 是 DOM + Canvas 2D 应用，壁纸场景走 2D canvas，全库没有一处 WebGPU 调用。打包日志里能看到 `afterPack 裁掉 dxcompiler.dll, dxil.dll，约省 26 MB`。

不删的三类，理由：

- `vk_swiftshader.dll` + `vulkan-1.dll`（6.2 MB）：没显卡、老驱动、远程桌面、虚拟机上的软件渲染兜底，删了那几类机器会黑屏。
- `d3dcompiler_47.dll`（4.5 MB）：ANGLE 的 D3D11 后端靠它编译着色器，删了 GPU 路径直接断。
- `LICENSES.chromium.html`（19.5 MB）：Chromium 的开源许可清单，合规必需；它是文本，NSIS 压完只占约 2 MB。

**验收**：`node scripts/smoke.mjs --exe=release-new/win-unpacked/Aurora.exe` 12/12 屏全绿——含壁纸场景 canvas 帧差、四平台搜索 98 条、在线播放《夜 (Live)》与音量链路。删 DLL 前后各跑一次，结果一致。

**没继续挖的空间**（都不划算）：`app.asar` 47.8 MB 里 jsdom 占 15.2 MB，是网易云包的 `module/*.js` 在顶层 `require` 拉进来的，裁它得改上游包结构，压缩后只省约 3 MB；`resources/KuGouMusicApi` 16.9 MB 已经排过一遍 devDependencies，剩下的删浏览器构建产物只值 1 MB 且有 `require` 断链风险；其余全是 Electron 自身（`Aurora.exe` 234 MB、`resources.pak`、`icudtl.dat`），没有可动项。

---

## 附录：数据来源与复现

| 数字 | 来源 | 复现方式 |
| --- | --- | --- |
| 安装包 129.9 MB（瘦身前基线） | `D:\\Aurora\\release\\Aurora-0.8.11-Setup.exe` | 资源管理器查看 |
| 安装包 115.0 MB（瘦身后） | `D:\\Aurora\\release-new\\Aurora-0.8.12-Setup.exe` | 资源管理器查看 |
| Electron 运行时 366.9 MB | `node_modules/electron/dist` | `Get-ChildItem -Recurse \| Measure-Object Length -Sum` |
| 生产依赖 60.6 MB / 334 包 | `npm ls --omit=dev --parseable --all` 逐个累加 | 见上 |
| vendor 进包约 21 MB | 磁盘 84.3 MB 减去打包配置排除的 63.1 MB devDependencies | `package.json` 的 `extraResources.filter` |
| 空闲 RSS 193.7 MB / 4 进程 | 清 `ELECTRON_RUN_AS_NODE` 后起 `electron .`，14 秒后 `Get-Process electron` 累加 | 见 `docs/perf-main.md` 同法 |
| 启动 395 ms | `%APPDATA%\aurora-player\startup.log` 首行 → `react committed` | 直接读日志 |
| 主进程 21,728 行 / 79 文件 | `electron/**/*.ts` | `Get-ChildItem electron -Recurse -Filter *.ts` |
| 前端 36,486 行 / 210 文件 | `src/**/*.ts(x)` | 同上 |
| 网易云包 require 1483 ms / 29 MB | `docs/perf-main.md` §0.2 | `node scripts/perf-main.mjs` |

所有「换壳后」的数字都是按上述未压缩体积 × 实测压缩比（129.9 ÷ 459 ≈ 28%）推算，不是实测值。

---

## 8. 如果「完全重写」而不是迁移

前面 §3 的方案 B 是**迁移**：保留 21,728 行主进程 Node 代码，只换外壳。这一节回答另一个问题——**连后端一起用 Rust 重写**。

### 8.1 两者的差别在哪

| | 迁移（方案 B） | 完全重写 |
| --- | --- | --- |
| 外壳 | Rust 重写 | Rust 重写 |
| 四个平台接口 | **保留**（Node 侧车跑现有代码） | **用 Rust 重新实现** |
| 业务编排（播放/歌词/缓存/库） | 保留 | 重新实现 |
| 前端 React | 保留 | 保留（WebView 里照跑，与语言无关） |
| 现有 71 个单测 | 大部分能跑 | 全部作废重写 |

一句话：迁移是把房子挪个地基，重写是把房子拆了重盖。

### 8.2 技术上能不能重写：能，算法都是明文

实测四个平台的签名实现，**没有一个是混淆过的**：

| 平台 | 签名代码位置 | 规模 | 形态 | Rust 重写 |
| --- | --- | --- | --- | --- |
| 网易云 | `@neteasecloudmusicapienhanced/api/util/crypto.js` | **420 行** | 明文 AES + RSA（`node:crypto`） | 可以，有现成 crate |
| 汽水 | `qishui-music-api/src/protocol.cjs` | **116 行** | 明文 RSA 签名（`node:crypto`） | 可以，最短 |
| 酷狗 | `vendor/KuGouMusicApi` 整个项目 | **17,315 行** | 明文，但接口面极宽 | 能，但量大 |
| QQ | `electron/qq/`（Aurora 自研） | 约 3,000 行 | 明文，含自研签名 | 能，逻辑已有 |

所以「逆向算法是黑盒、重写不了」这个担心不成立。**能写。**

### 8.3 但 Rust 生态是空白

去 crates.io 查同类库（2026-11-17 实测）：

| Rust 库 | 版本 | 最后更新 | 总下载 |
| --- | --- | --- | --- |
| `netease-music` | 0.1.1 | 2026-07-01 | 531 |
| `netease-qq-music-api` | 0.1.0 | 2026-04-28 | 261 |
| `kugou_sdk` | 0.2.9 | 2026-07-18 | 298 |

对照 Node 侧：

| Node 库 | Star | 最后更新 |
| --- | --- | --- |
| `api-enhanced`（网易云） | **2,246** | 2026-11-14 |
| `KuGouMusicApi`（酷狗） | **1,102** | 2026-11-13 |
| `qq-music-api`（QQ） | **1,136** | 2026-11-03 |

Rust 侧全是 0.1.x、下载量三位数、几个月才动一次的个人项目；Node 侧是千人 star、每周在更新的活项目。

**这是完全重写真正的代价：不是写不出来，是写完之后没人替你跟着平台改版。**

音乐平台的接口平均几个月就要变一次（签名算法、参数、风控）。现在这件事由上游几百个贡献者在跟；重写之后由你一个人跟。

### 8.4 工作量分解（估）

口径：单人全职、熟练 Rust、有 AI 辅助，**不含逆向试错**（假设照现有实现翻译）。

| 模块 | 现有依据 | Rust 估算行数 | 难度 |
| --- | --- | --- | --- |
| 窗口/托盘/多窗/圆角 | `electron/main.ts` 892 行 + 相关 | 2,000 | 中 |
| 透明歌词浮窗 | `electron/lyrics-overlay.ts` 503 行 | 1,200 | **高**（Win32 置顶档位 + 穿透 + 全屏检测） |
| 五个自定义协议 | `electron/protocols/` 约 1,800 行 | 1,200 | 中 |
| 壁纸引擎 | `electron/wallpaper.ts` 987 行 | 1,000 | 中（vdf/注册表解析） |
| 本地库/媒体缓存/播放 | `electron/` 其余约 6,000 行 | 5,000 | 中 |
| **四平台接口** | 网易云 16,907 + 酷狗 17,315 + 汽水 903 = **35,125 行** | **25,000~30,000** | **极高** |
| QQ 自研部分 | `electron/qq/` 约 3,000 行 | 2,500 | 高 |
| 更新器 | `electron/updates.ts` 592 + `update-download.ts` 206 | 800 | 中 |
| 前端 | `src/` 36,486 行 | 保留（只改 bridge 486 行） | 低 |
| 测试与审计 | 71 个单测 + 5 套脚本 | 重写 | 中 |

**合计约 40,000 行 Rust。**

按业务代码 150~250 行/日、协议类代码 50~100 行/日加权：**12~18 个月**。

对照迁移的 17~19 周，**完全重写约是它的 3~4 倍工期**。

### 8.5 还丢掉一样东西：踩坑经验

现有代码里密度很高的注释，都是「实测发现的上游行为」，例如 `electron/qq/transport.ts` 里写着的：

- 免费歌曲请求 320k/FLAC 时上游返回 `result=104003` 而不是报错，必须走音质阶梯降级
- CDN 域名选择要跳过 `http://ws` 开头的流媒体节点

这类结论来自反复抓包。重写等于把这些清零，重新踩一遍。

### 8.6 如果一定要「完全重写」，正确姿势是绞杀者模式

不要一次性全换，按模块逐步把 Node 替换成 Rust，每步都能发版：

1. **第 1 步（收益最大、风险最低）**：更新下载器、壁纸扫描 → Rust。这两块输入输出清晰、不碰平台接口。
2. **第 2 步**：壳换成 Tauri，业务仍在 Node 侧车（就是方案 B）。
3. **第 3 步**：按模块把侧车里的业务逻辑搬进 Rust（播放器、缓存、歌词匹配），每搬一块删一块 Node。
4. **终点**：如果最后连接口层也想搬，才面对 §8.3 那个问题——**那时你已经有了可运行的 Tauri 版本，退出成本是零。**

这样做的结果是「Rust 主体 + 一个很薄的 Node 接口侧车」，而不是 100% Rust。但它分了 4 个可交付节点，每个节点都能止损。

**不建议**第一天就开一个 40,000 行的 Rust 仓库，18 个月后才知道能不能跑。
