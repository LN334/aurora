# Aurora

<p align="center">
  <img src="build/icon.png" width="96" height="96" alt="Aurora" />
</p>

<p align="center">五家平台加本机文件夹，同一首歌只占一行。</p>

Aurora 是一个 Windows 音乐播放器，把几个平台的账号和电脑里的音乐文件夹拼成同一个曲库。同一首歌在几家都有，列表里也只占一行；点播放时按你自己排的音源顺序，挑一个能放的。

网易云、QQ 音乐、酷狗、汽水和本机文件夹都在里面。B 站没有单独的入口，它的视频能直接当歌放——取的是视频里的音频轨。

[English](README.en.md) · [下载](https://github.com/LN334/aurora/releases/latest) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/LN334/aurora/issues)

## 下载

到 [Releases](https://github.com/LN334/aurora/releases/latest) 下 `Aurora-x.y.z-Setup.exe`。装到当前用户目录，不需要管理员权限。

安装包没有代码签名，Windows SmartScreen 会拦一次：点「更多信息」，再点「仍要运行」。个人开发者打包基本都是这个状态。

系统要求 Windows 10 或 11，64 位。

## 它会什么

### 曲库

- 五个在线平台加本机文件夹，搜索、歌单、专辑、艺人收在同一处。不登录能搜能播免费歌，登录后才有每日推荐、红心、收藏、关注。
- 同一首歌只占一行，行上标出哪几家能放。收藏的专辑与关注的艺人按名字合并。
- 本机音乐扫文件夹，读标签、内嵌封面和同目录 `.lrc`。
- 曲目详情页有歌词和评论区。四家都能读评论，发评论支持网易云、QQ、酷狗，汽水只能读。

### 播放

- 同一首歌几家都有时，按你排的音源顺序挑第一个能放的，本机排最后。
- 音质按平台设档，换档从下一首起生效，正在播的不中断。
- 在线歌可以存到本地，听过的自动留一份（默认 2 GB，可改可关）。
- 倍速五档，调音台在播放界面按 E。
- 音源地址会过期，播放前和播放出错时会自动重取，接回原来的位置。

### 一起听

- 同一 WiFi 下开个房间，别人用邀请链接进来，或者照「地址 + 房间码」手填，房间可以再加密码。
- 跨网络点「开公网」，用 Cloudflare 快速隧道把房间挂到 `wss://` 上，不用账号也不用备案。
- 音频各自取，房间里只同步当前歌曲和播放进度。

### 歌词

- 全屏歌词页，当前一句放大，译文贴在其下，点任意一行跳到那个时间点。
- 桌面歌词是独立透明窗口，锁定时鼠标穿透，移上去仍可拖动和点击。

### 外观

- 深浅两套主题，可跟随系统。界面颜色从当前封面取。
- 首页从上到下：每日推荐、上次听到、四个入口、三块推荐、最近八张。
- 漫游放完一首自动接下一首，去听歌单或专辑就退出。
- 动态背景接 Steam 版 Wallpaper Engine，场景包、视频、网页、图片都行。

### 设置与系统

| 分区 | 内容 |
| --- | --- |
| 播放与音质 | 交叉淡化、调音台、音质档位、在线歌词 |
| 推荐来源 | 哪几个平台参与推荐 |
| 首页 | 各分区的显隐与顺序 |
| 外观与桌面 | 主题、背景、模糊程度、跟随封面取色、桌面歌词、动态背景 |
| 快捷键 | 全部键位一张表 |
| 下载 | 保存位置、格式、码率、缓存上限 |
| 启动与系统 | 开机自启、放歌时阻止休眠、点关闭按钮的行为 |
| 清理与维护 | 释放内存、垃圾文件、打开数据目录、备份与恢复 |

关窗口只是收进托盘，音乐继续播；真正退出走托盘右键菜单。任务栏缩略图按钮、媒体控制面板、硬件媒体键都接上了。备份导出一个 JSON，里面是设置、曲库、歌单、播放历史与收听统计，登录状态不在里面。

## 它不做什么

- **不做曲库。** 拿不到版权，它一直是各平台的客户端。
- **不绕过付费。** 能播的只有你账号本来就有权限播的。加密音频、会员音质、付费专辑都不碰，界面会直说原因（需要会员 / 地区限制 / 只有试听 / 已下架）。
- **不上传。** 曲库、歌单、播放历史、收听统计都存本地，没有遥测，没有崩溃上报。

## 音源

| 来源 | 状态 |
| --- | --- |
| 本机文件 | 可用 |
| 网易云音乐 | 可用，不登录也能搜和播一部分 |
| QQ 音乐 | 可用，不登录只能播免费歌 |
| 酷狗音乐 | 可用（含概念版签名） |
| 汽水音乐 | 可用 |
| B 站 | 可用，把视频当歌听（DASH 音频轨，最高 192k），没有歌词 |
| Spotify / Apple Music / Navidrome / Jellyfin | 未实现，代码里留了接入位置 |

五个平台都是**非官方接入，没有得到任何授权**。网易云走社区逆向接口 [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced)，QQ 音乐走 [@yakult-green-tea/qq-music-api](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)（在主进程里当本地 Koa 服务跑），酷狗和汽水是照着网页端与 App 的接口自己接的。

四家的官方开放接口都不面向个人桌面软件，所以只有逆向这一条路。这意味着：

- 仅供个人学习自用。这类接口属于未授权访问，也违反平台服务条款。
- 随时可能失效。平台改版、风控升级都可能让它坏掉，账号也有被风控的风险。
- 未登录时，网易云给免费曲整首、付费曲试听；QQ 音乐能播免费曲（128k），会员曲拿不到，点下去会说明原因。

## 你的数据

默认什么都不上传。需要联网的地方只有这几处，多数要你主动触发：

- **音乐文件与索引**：全在本机，不上传。
- **登录凭据**：用 Windows 的 DPAPI 加密后只存本机，明文不落盘、不进日志。每个档案一份，退出登录就清掉。
- **在线歌词**：优先读音频旁的 `.lrc`；本机没有且开着「在线歌词」（默认关）时才去 [lrclib.net](https://lrclib.net) 查，结果缓存在本机。
- **缓存**：在线音频在 `%APPDATA%\aurora-player\media-cache`（默认 2 GB，超了按最久未听先删），封面在 `cover-cache`（200 MB）。
- **更新检查**：读 GitHub 公开接口，可以改成手动。

例外是首页的推荐歌单——打开首页会向平台要一次公开推荐，不需要登录。另外在线播放本身，搜索词和 cookie 最终都会发到平台服务器，上面说的是 Aurora 自己怎么存，不是「用了就不联网」。

## 常见问题

**安装时被 Windows 拦了？** 点「更多信息」→「仍要运行」。

**不登录能听吗？** 能。免费歌不登录也能搜能播，付费曲看账号权限。

**弹窗说这首歌播不了？** 界面会写明是哪一种原因。这是平台的权限判断，软件不会绕过。

**点关闭按钮没退出？** 这是故意的，关窗口只是收进托盘。要退出走托盘右键菜单，或在设置里改成关闭即退出。

**换了账号，歌单没变？** 侧栏底部「我的」里切换档案。每个档案绑一套账号、文件夹和播放偏好。

**壁纸库说读不到壁纸？** 需要 Steam 版 Wallpaper Engine，并且创意工坊里下载过至少一张。

## 已知限制

- 四个在线平台都依赖第三方逆向接口，随时可能失效。
- 安装包没有代码签名。
- 歌词：四个平台能取词（B 站没有），译文是平台自带的另一条轨，界面把它并到原文行下。逐字只对增强 LRC 生效，四家接口都只给整行时间。
- 关注艺人里 QQ 与酷狗的艺人没有可打开的详情页（平台协议里没这个接口），卡片不抬升，悬停会说明。
- 界面只有中文；音质、外观、快捷键这些设置是设备级的，不跟档案走。

## 开发者

工程流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，每版改了什么见 [CHANGELOG.md](CHANGELOG.md)，接下来做什么见 [docs/roadmap.md](docs/roadmap.md)，维护与回滚见 [docs/maintenance.md](docs/maintenance.md)，架构与技术细节见 [docs/architecture.md](docs/architecture.md)。

需要 Node.js 22 或更新版本。

```bash
npm install
npm run dev        # 开发模式：热更新 + Electron 窗口
npm run check      # 类型检查 + 测试 + 四项审计
```

国内网络下 `npm install` 可能卡在下载 Electron 二进制。在项目根目录建一个 `.npmrc`（这个文件有意没有提交）：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
```

### 代码结构

```
src/app/            外壳：路由、侧栏、标题栏、跨功能 hook
src/features/       功能模块：accounts discover downloads favorites glass kugou library lyrics netease online overlay perf player playlists qishui qq refs settings updates wallpaper
src/views/          页面与面板
src/ui/             共享基元：卡片、封面、图标、列表、时间格式化
src/stage/          歌词页与可视化
electron/pure/      零 Electron 依赖、能在裸 Node 下测试的纯逻辑
electron/protocols/ 私有协议：aurora-app / aurora-media / aurora-remote / aurora-wallpaper / aurora-cache
electron/ipc/       通用 IPC：播放器、库、歌词、设置、更新、壁纸、下载、悬浮窗
electron/netease/   网易云接口、会话、IPC
electron/qq/        QQ 音乐接口、会话、传输、本地服务
electron/kugou/     酷狗接口、会话、签名
electron/qishui/    汽水接口、会话
```

依赖方向单向：`views → features → ui`。`electron/pure` 不依赖其它 electron 模块，否则测试里加载不了。

技术栈：Electron 44、React 19、TypeScript 5、Vite 7、Zustand 5、music-metadata。没有 UI 组件库、没有图标库（图标是手写 SVG）、没有 CSS 框架。

### 加一个平台

音源接缝在 `src/features/library/source.ts` 的 `TrackSource`：

```ts
id / name / summary / online / streamUrl(track) / artUrl(track) / lyrics(track)
```

两个必须遵守的约束：`artUrl` 必须同源或带 CORS 头（否则封面进不了 Canvas 取色）；音频要经主进程代理（`aurora-remote:`），渲染层的 CSP 只放行私有协议。账号侧在 `src/features/accounts/providers.ts`，状态不是 `ready` 的平台不会出现在界面上。

### 发版

```bash
# 1. 改 package.json 的 version（更新检查拿它和远端 Release 比）
# 2. 打包
npm run dist
# 3. 提交、打 tag、推送
git add -A && git commit -m "release X.Y.Z"
git tag vX.Y.Z && git push && git push origin vX.Y.Z
```

然后建 Release，把三个文件拖进附件区：`Aurora-X.Y.Z-Setup.exe`、`.blockmap`、`latest.yml`。`latest.yml` 不能漏，自动更新只读它。更新检查读的仓库地址来自 `package.json` 的 `repository.url`（electron-builder 打包时会剥掉 `build` 字段）。

## 致谢

界面与交互参考过下面几个播放器，没有使用它们的任何代码。

- [Mineradio](https://github.com/XxHuberrr/Mineradio)（XxHuberrr，GPL-3.0，已停更）：电影镜头、粒子视觉与歌词舞台。Aurora 的歌词页方向受它启发，视觉系统与播放内核是独立实现。
- [folia](https://github.com/chthollyphile/folia-major)（chthollyphile，闭源）：搜索页的来源标签、本地与在线共用一套卡片。
- [QueMusic](https://github.com/bronekox/quemusic)（GPL-3.0）：导航与搜索的分工（搜索是动作，不是目的地）。
- [Rhine Music Database](https://github.com/MikeQu223/Rhine-Music-Database)（MIT）：一级导航按意图分，平台与来源不进一级。
- [webwallgl](https://github.com/oneincase/webwallgl)（oneincase，MIT）：Wallpaper Engine 场景（`.pkg`）的 WebGL 渲染器。
- [Klang](https://github.com/gwj0323/klang)（GPL-3.0）：设计文档的写法与「处理过程可查看」的态度。

演示曲库里的歌词是为这个项目原创写的，不是任何已发表歌曲的歌词。

## 许可

MIT，见 [LICENSE](LICENSE)。
