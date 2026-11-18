
# 升级路线

这份文件是 Aurora 接下来做什么、按什么顺序做、每件事落到哪儿、怎么算做完。现状基线是 0.7.16。

## 进度（2026-11-15）

全部落地并真机验收：**P0 匹配器、P2-3 喜欢页词卡、P1-2 播放历史、P1-1 在线缓存、P2-1 本机视图与歌单排序、P1-3 全屏让位（含系统级）、P2-2 封面预算、P3-1 增强 LRC 逐字**。P4 按计划不做。`npm run check` 全绿（583 项测试，四道审计全零）。

与计划字面不同的几处：

1. P0 的匹配器落在 `electron/pure/lyrics-match.ts`，不是 `src/features/library/match.ts`——它既要给 `electron/lyrics.ts` 用，又要能被 `tests/` 直跑，而 electron 工程的 `rootDir` 在 `electron/`，跨不过去。
2. P2-1 没有把本机数据拆成「歌曲 / 歌单 / 关系」三份表——现有 `Track`（带 `addedAt`）加播放明细已够支撑三种视图与歌单排序，重写数据层只增风险、不改可见行为。「最多播放」用播放明细聚合，不再存第二份计数器。
3. P1-3 没有加 `koffi`：改用常驻 PowerShell 进程每 1.5 秒查一次 `SHQueryUserNotificationState`，只在歌词窗开着时启动。实测全屏的 Electron 窗口与浏览器窗口都返回 2（`QUNS_BUSY`）而不是 3（`QUNS_RUNNING_D3D_FULL_SCREEN`）——3 只给 D3D 独占，所以判据取 2/3/4。
4. P2-2 的封面缓存早就在 `remote-protocol.ts` 里（按 URL 哈希落盘、48 MB 内存），缺的只是字节上限——原来只按文件数 prune（>4000 降到 3000），单张最大 3 MB，最坏能占十几 G。改成 200 MB 预算、清到 90% 保留线。
5. P3-1 的上游逐字确认失败：`lyric` 与 `lyric_new` 都不返回 `yrc`，`klyric` 是空串。只做了增强 LRC（行内 `<mm:ss.xx>`）的解析与播放页/舞台按词点亮；P3-2 与 P3-3 按原计划不做。

P1-1 的两处实现要点：缓存键是渲染层给的 `provider:onlineId`（签名地址每次播放都变，拿它做键永不命中）；未命中时另起一次无 Range 请求把整首存盘，不用 tee——切歌会连带取消写盘，且播放器请求的是 Range 片段，拼不出完整文件。新增自定义协议后必须同步 `index.html` 的 CSP 两处（`media-src` 与 `connect-src`），漏了就是 `Failed to fetch`。

## 一、现在有什么

| 块 | 落在哪 | 状态 |
| --- | --- | --- |
| 四家平台接入 | `src/features/online/*-provider.ts`、`electron/{netease,qq,kugou,qishui}/` | 搜索、歌单、专辑、艺人、取流、喜欢（QQ 与酷狗部分写接口缺失） |
| 播放 | `src/features/player/`（engine / driver / actions / pick / queue / crossfade / roam） | 取流去重入、无源跳过、跨源版本合并、漫游流式补池 |
| 歌词 | `src/features/library/hooks.ts` 的 `resolveLyrics`、`electron/lyrics.ts`、`src/stage/LyricsStage.tsx`、`src/views/NowPlayingPage.tsx` 的 LyricRoll | 本家 → 跨源版本 → LRCLIB 三级兜底；译文分行；逐行平滑滚动；桌面歌词窗 |
| 评论 | `electron/comments.ts`、`src/features/comments/api.ts`、`src/views/CommentSection.tsx` | 四家可读、游标翻页；网易云/QQ/酷狗可发，网易云可赞；汽水只读 |
| 库 | `src/views/{Playlists,Collections,FollowedArtists,Local,Liked,Recent}Page.tsx`、`src/features/library/` | 歌单两档、收藏专辑、关注艺人、本机、最近播放 60 条、口味统计 |
| 设置 | `src/views/settings/` | 13 个分区，含首页分区开关、材质、歌词字号、行密度、隐藏窗口等 |
| 更新 | `electron/updates.ts`、`src/features/updates/` | 检查→下载→手动装；左栏红点与托盘气泡提示 |
| 壁纸与主题 | `src/features/wallpaper/`、`src/styles/tokens.css` | 视频、场景、网页壁纸；标准/轻薄亚克力；跟随系统明暗 |

## 二、参考项目能借什么

翻过的仓库在 `D:/Aurora/.ref-*`（`.gitignore` 的 `.ref-*/` 已挡住，不入库）。

| 仓库 | 借什么 | 用在哪 | 做不做 |
| --- | --- | --- | --- |
| Lyricify | 匹配打分（标题 1、艺人 1、专辑 0.4、时长 1，缺项重新归一）；名称归一化（全角括号逗号、`'`/`’`、简繁、多空格）；逐字歌词模型；多语言发音 | 歌词匹配、版本合并、以后的替代源 | 打分与归一化做；逐字与发音看上游接口 |
| FluentFlyout | `SHQueryUserNotificationState` 判独占全屏；`SetWindowPos` 兜底置顶 | 桌面歌词窗 | 全屏隐藏做（见风险）；置顶兜底先不做 |
| YesPlayMusic | 库页结构（喜欢大卡 + 六 tab）；随机歌词卡；播放历史的周/全部；Dexie 缓存音源 | 库、播放历史、播放缓存 | 结构与历史做；随机歌词卡做 |
| MusicFree | 插件能力 = 一组可选函数（`search`/`getMediaSource`/`getLyric`…）；本地歌单模型；`mediaCache` LRU；启动校验本地文件存在 | provider 架构、缓存、本机库 | 缓存与文件校验做；provider 函数化列中期 |
| Musicoco | 本地库表结构（歌曲/歌单/多对多关系）；歌单内排序；视图模式（最近添加、最多播放）；封面 `DiskLruCache` | 本机库 | 做 |
| Solara | 音源切换与音质四档；本地存储同步到自建服务端 | 音源优先级已有；同步 | 同步不做（要服务端） |
| UnblockNeteaseMusic | 跨源同曲匹配 | —— | 只借匹配，不照搬替换（见第四节） |
| wpfui / NAudio / VueMusic-PC | 无（WPF 控件、.NET 音频、练手项目） | —— | 不做 |

## 三、计划

### P0 地基：匹配器（半天）

**做什么**：新增 `src/features/library/match.ts`，纯函数：

- `normalizeName(text)`：全角括号与逗号转半角、`'`/`’` 统一、去多余空格、去 `(Live)` 类后缀前先记下、简繁统一（需要一张常用字表，先用最小集）。
- `scoreTrack(query, candidate)`：标题 1、艺人 1、专辑 0.4、时长 1，缺项按可比较项归一，返回 0–1。
- `durationLevel(diff)`：0 / <0.3s / <0.7s / <1.5s / <3.5s 五档。
- `pickBest(results, query)`：返回最优解与分数，低于阈值返回 null。

**接进哪**：`electron/lyrics.ts` 的 `lookupLyrics`。当前先用 `track_name`/`artist_name` 精确查，失败再 `search`；改法是把归一化后的名字也拿去查一次，并让 `search` 的结果按 `scoreTrack` 排序，而不是现在的「同步优先 + 时长最近」。

**验收**：`tests/match.test.ts` 覆盖这些用例——全角括号、`’`、简繁、`(Live)` 后缀、同名不同艺人、时长偏差 2 秒；再挑三首冷门曲真机对比修前修后是否命中。

**风险**：简繁表若太大就别硬做，先只做标点与空格，简繁留 TODO。

### P1 播放体验

**P1-1 在线音源本地缓存（2–3 天）**

现状：每次播放都向平台现取流，同一首歌听第五遍还是走网络。
做法：新增 `electron/media-cache.ts`，用 `app.getPath('userData')/media-cache` 存音频，上限默认 2 GB，超了按最近使用时间删。取流时先查缓存，命中返回自定义协议 `aurora-cache://<key>`；未命中返回原地址，并在播放开始后后台落盘（边播边存，播完补全）。
落点：`electron/protocols/` 注新增协议、`src/features/player/pick.ts` 与 `electron/*/streamUrl` 之间加一层、设置页「下载」分区加缓存上限与「清空缓存」。
验收：同一首歌连播两次，第二次主进程日志显示命中缓存、无外网请求；设置上限改到 1 MB 后再播会删除最旧条目。
风险：部分平台地址需要 referer/UA，缓存下载必须走同一个 transport；缓存是「自己听的歌留在自己机器上」，设置页要写明位置与占用。

**P1-2 播放历史（1–2 天）**

现状：`src/features/player/history.ts` 已有 `recent`（60 条）与 `days`（30 天，每天秒数与去重曲数）。缺的是「按周/全部看」和明细。
做法：新增 `plays` 明细（曲目、开始时间、来源），保留 180 天；`RecentPage` 增加周/全部切换与按天分组；首页「最近听过」继续读 `recent`。
落点：`src/features/player/history.ts`、`history-store.ts`、`src/views/RecentPage.tsx`。
验收：播 5 首不同日期（用系统时间或注入时间）后，周视图只显示 7 天内，全部视图按天分组；迁移旧存档不丢。

**P1-3 桌面歌词全屏隐藏（1 天，有前置）**

做法：主进程定时（约 2 秒）查 `SHQueryUserNotificationState`，返回 `QUNS_RUNNING_D3D_FULL_SCREEN` 时隐藏歌词窗。
**前置问题**：Electron 没有直接绑定，要么加原生模块（`koffi`），要么用 PowerShell 起进程轮询——后者每次开销大。
**实际做法**：先做「Aurora 自己进全屏/舞台时隐藏」，再补系统级：歌词窗开着时起一个常驻 PowerShell（`-EncodedCommand` 避开引号问题），每 1.5 秒查一次、只回报状态变化；两路原因共用一个 `hiddenReasons` 集合，互不撤销。没有引入原生依赖。
验收：桌面歌词开着时全屏播视频，歌词窗自动隐藏，退出全屏恢复。

### P2 库

**P2-1 本机库视图与排序（3–4 天）**

现状：`LocalPage` 一页平铺 + 重新扫描，没有视图维度，歌单不能排序。
做法：照 Musicoco 的表结构把本机数据拆成「歌曲元数据 / 歌单 / 歌单-歌曲关系」三份，`scan.ts` 扫描后写元数据；`LocalPage` 加三个视图——最近添加、最多播放、文件夹；歌单详情加排序（添加时间、标题、艺人、时长）。
落点：`src/features/library/{scan,tree,store}.ts`、`src/views/LocalPage.tsx`、`FolderTree.tsx`、`PlaylistDetailPage.tsx`。
验收：加一个文件夹、扫描、切三个视图看到不同顺序；歌单内改排序后重开仍在。

**P2-2 封面磁盘缓存（1 天）**

现状：封面缓存本来就有——`remote-protocol.ts` 的 `createCoverCache`，按 URL 哈希落盘、48 MB 内存层。缺的是磁盘上限：原来只按文件数 prune（>4000 降到 3000），单张最大 3 MB，最坏能占十几 G。
做法：把淘汰规则抽成纯函数 `electron/pure/cover-cache-rules.ts` 的 `coverEvictions`，磁盘预算 200 MB、超了清到 90% 保留线（文件数上限一并保留）。
验收：断网后已看过的封面仍显示（判据是同一 key 的文件 mtime 没变，只看目录文件数会被首页其它封面干扰）。

**P2-3 「我喜欢的音乐」页顶部（半天）**

照 YesPlayMusic 的做法，在喜欢页顶部放一张大卡，背景用随机一首喜欢的歌的三行歌词（过滤「作词」「作曲」「纯音乐，请欣赏」），点击播放全部。
**实际做法**：卡面不铺封面底图——喜欢页常常一首带封面的都没有，压暗加白字在浅色主题里像贴错地方；改成浅色玻璃卡，三行词就是卡面。一首带歌词的收藏都没有时收成一条 84px 的入口条，不留大块空白。
落点：`src/views/LikedPage.tsx`、`src/features/lyrics/excerpt.ts`。

### P3 歌词

**P3-1 逐字歌词（评估后定）**

需要先确认上游给不给逐字格式：网易云有 `yrc`、QQ 有 QRC（加密）、酷狗有 KRC（加密）。当前只取 LRC。
**结论**：用 `@neteasecloudmusicapienhanced/api` 打了 `lyric` 与 `lyric_new`（含 `lv/kv/tv/rv=-1`），返回里没有 `yrc`，`klyric.lyric` 是空串——上游拿不到逐字，按「确认可取再做」不碰加密格式。
做法：只做增强 LRC（行内 `<mm:ss.xx>` 词级标签）。`src/features/lyrics/lrc.ts` 的 `parseLrc` 给行带 `words`，`spokenWords` 数已开始的段；播放页与舞台都按词点亮（只改透明度，不动字号行高，否则按行高算的位移会错位）。
风险：加密格式要逆向，属于随时会失效的活；未做。

**P3-2 多语言发音（依赖 P3-1）**

日文罗马音、中文拼音做副行。数据源要有发音字段（TTML 之类），没有就不做假。

**P3-3 更多歌词源（方向待定）**

Lyricify 接了八家，其中 Apple Music / Spotify / Musixmatch 需要鉴权或商业授权，不适合直接抄。不新增非授权源。

### P4 架构（中期，非必须）

- **provider 函数化**：把四家 provider 的能力从 `CAPABILITIES` 常量改成「实现了哪些函数」，为接第五家或自定义源留口。好处是加源不改核心，代价是一次跨四个平台的重构，当前四家够用，等真要接新平台再做。
- **跨设备同步**：设置与歌单同步到自建服务端（Solara 路线）。需要服务端与账号体系，明确不在当前范围。

## 四、不做的事

- **不绕付费墙**：QQ 会员曲、网易云灰色曲，不在别家找免费替代。取不到就跳过并说明，这是产品立场。
- **不做 MV 与云盘**：不是播放器的核心，且要额外的存储与带宽。
- **不接需要商业授权的歌词源**。
- **不移植 WPF / .NET 代码**：wpfui 只当视觉校对，NAudio 与 Web Audio 不同路。

## 五、顺序与依赖

```
P0 匹配器
 ├─→ P1-1 缓存（独立）
 ├─→ P1-2 历史（独立）
 ├─→ P1-3 全屏隐藏（独立，受原生模块限制）
 └─→ P2-1 本机库（独立）
      └─→ P2-2 封面缓存（独立）
P2-3 喜欢页（独立，半天）
P3 歌词（依赖上游接口确认）
P4 架构（有空再说）
```

先做 P0 与 P2-3（都在半天内、都能立刻验证），再做 P1-2、P1-1，P2-1 排其后。P1-3 与 P3 受外部条件限制，不能承诺时间。

## 六、每步都要过的门

- 纯函数改动必须有 `tests/` 用例。
- 改界面的，先 `npm run build` 再用 CDP 探针截图，不看源码猜效果。
- 收尾统一跑 `npm run check`，四道审计必须全零。
- 发版前问用户，不自行改版本号发包。
