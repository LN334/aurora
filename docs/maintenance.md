# 仓库维护

这份文件讲**仓库与发版的维护节奏**：多久做什么、目录怎么归、坏了怎么回滚。

应用里「设置 → 清理与维护」是另一个功能（释放内存、清垃圾文件），实现在 `electron/maintenance.ts`，见 [architecture.md](architecture.md)。

## 目录归位

| 位置 | 放什么 | 谁往里增删 |
| --- | --- | --- |
| `src/` | 渲染层源码（app / features / views / ui / stage / styles） | 功能开发 |
| `electron/` | 主进程：窗口、协议、各平台接口、IPC | 主进程开发 |
| `tests/` | 不依赖 Electron 的纯逻辑测试，`node --test` 直接跑 | 每次动纯函数 |
| `scripts/` | 构建、审计、巡检、性能与维护脚本 | 见下表 |
| `docs/` | 设计记录与口径（架构、界面、性能基线、维护） | 决定变了才改 |
| `build/` | 图标源文件（`icon.ico` 直接给 electron-builder，跳过 png→ico 转换） | 换图标时 |
| `assets/` | 运行时资源 | 少动 |
| `.github/` | CI、定期体检、issue / PR 模板 | 流程改动 |

这些**不入库**（`.gitignore` 已拦）：`node_modules/`、`dist*/`、`release*/`、`vendor/`、`design/`、`shots/`、`.smoke/`、`.refs/`、`.probe-*`。它们都能重新生成，被带进提交通常是用了 `git add -f`。

## scripts 里各管什么

| 脚本 | 什么时候跑 |
| --- | --- |
| `audit-reachability.mjs` / `audit-css.mjs` / `audit-stale-paths.mjs` / `audit-exports.mjs` | 每次 `npm run check`，CI 也跑 |
| `clean-electron.mjs` | `npm run build` 开头自动跑 |
| `make-icons.mjs` | 换图标时（`npm run icons`） |
| `inline-preview.mjs` | `npm run preview` 尾部，把预览页压成单文件 |
| `smoke.mjs` | 改界面后（`npm run smoke`），起独立窗口逐页点 |
| `scan-probe.mjs` | 排查扫描器把某个文件读成了什么 |
| `perf-*.mjs` / `measure-dom.mjs` | 动渲染循环前后测数字（口径见 perf-baseline.md） |
| `gpu-*.mjs` | Wallpaper Engine 场景壁纸的合成与清单，本机排查用 |
| `asar-probe.mjs` | 核对打包后的 asar 里有什么 |
| `clean.mjs` | 清本机产物（见下） |

## 节奏

### 每次改动

`npm run check` 必须绿：类型、单元测试、四项审计（可达性 / 死 CSS 选择器 / 失效路径 / 多余导出）。界面改动加一次 `npm run smoke`。

### 每周（自动）

`.github/workflows/maintenance.yml` 每周一 03:00 UTC 跑一次 `npm run check` + 构建，并在运行摘要里附 `npm outdated` 与 `npm audit --omit=dev`。

它红了说明**主分支本身坏了**，不是这周的提交弄坏的 —— 优先修它。过期与漏洞只记录不判定失败，扫一眼就够。

### 每月（手工，十分钟）

1. `npm outdated` 看有没有 major 版本落后太多；
2. 清本机产物：`npm run clean`（构建与探针输出），偶尔 `npm run clean -- --all`（连安装包与账号副本，能腾 1 GB）；
3. `git count-objects -vH` 看 `.git` 体积。超过 200 MB 就要查是不是把大文件提交进去了；
4. 看一眼 Actions 用量，别让缓存把配额吃满。

### CI 只检查，不打包

`.github/workflows/ci.yml` 在 **windows-latest** 上跑 `npm run check` 与 `npm run build`。选 Windows 不是为了跟产品对齐好看：单元测试断言的是 Windows 路径语义（Steam 库路径、反斜杠穿越、盘符），在 ubuntu 上会稳定假红。

它**不产安装包**。安装包要把 `vendor/KuGouMusicApi` 一起带进 `resources`，而 `vendor/` 不入库，CI 上没有这份东西。所以发版只能在本机做，也就没有「推 tag 自动发版」这种流程。

### 每次发版

1. 把 `CHANGELOG.md` 的「未发布」整段挪到新版本号下，改成 `## X.Y.Z — YYYY-MM-DD`；
2. 改 `package.json` 的 `version`；
3. `npm run dist`；
4. 提交、打 tag `vX.Y.Z`、推送；
5. 建 Release，传三个附件：`Setup.exe`、`.blockmap`、`latest.yml`（漏 latest.yml 自动更新就断）；
6. Release 正文写这一版改了什么，附安装包的 SHA256（没签名，用户只能自己对）。

**发版前必须先征得项目所有者同意**，这是这个仓库的硬规则。

## 依赖升级

- **patch / minor**：直接升，跑 `npm run check`；红了就一次只退一个包定位。
- **major**：单独一个提交，标题写明升了什么、为什么现在升。React、Vite、Electron 的大版本往往要一起改配置，别和功能混在一个提交里。
- **Electron**：升级后要跑 `npm run smoke` 与 `npm run perf`。它是唯一一个「装得上但界面全白」的依赖。
- **平台接口包**（`@neteasecloudmusicapienhanced/api`、`@sansenjian/qq-music-api`、`qishui-music-api`）：这些包直接决定能不能搜、能不能放。升级后至少验证：搜索一首、放一首、看一次每日推荐。
- 不要为了「版本新」而升。这个项目已经踩过多次「上游改了返回结构」的坑，升级的收益通常不如修一个真实 bug。

## 平台接口失效了怎么办

顺序固定，别跳步：

1. 看 `%APPDATA%\aurora-player\startup.log`（开发版在 `.probe-profile\startup.log`），搜平台前缀：`[kugou:err]`、`qq daily empty`、`[netease]`；
2. 用 `npm run scan` 或直接调 `window.aurora.<platform>` 确认是「应用传错参数」还是「上游返回空/报错」；
3. 上游关掉某个接口时，找**同一家平台的另一条官方路径**（例：QQ 日推从 `get_recommend` 换到 Mac 首页的「今日私享」歌单），不要换到别家平台；
4. 确实拿不到，就在界面上说清楚（「这家需要登录」「这首要会员」），不要静默失败，也不要为了「看起来能用」而绕过平台付费。

## 仓库体积

- `vendor/`（KuGouMusicApi，83 MB）按需 vendor，不入库；打包时由 `extraResources` 带进 resources。
- 安装包留在 `release/`，不入库，也不上传到 GitHub 之外的别处。
- 截图、录屏、探针产物一律不进仓库。要给别人看，贴到 issue 或 Release 正文里。

## 回滚

代码回滚用 `git revert <sha>`，不要 `git reset --hard` 推上去 —— 这个仓库的历史被改写过一次（改作者信息），再改一次会让所有 tag 与 Release 对不上。

发布出去的错误版本：

1. `git revert` 有问题的提交；
2. 发一个**更高**的补丁版本（例：0.6.8 → 0.6.9），不要复用或删除已发布的 tag；
3. 在 Release 正文写清这一版修了什么、为什么建议升级。

已发布的 Release **不要删**：`latest.yml` 与自动更新的差分下载都按 tag 找文件，删了会让还留在旧版本的用户更新失败。
