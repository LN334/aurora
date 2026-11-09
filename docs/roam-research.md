# 漫游 / 连续推荐播放 调研

调研日期：2026-11-09
范围：Aurora 左栏「漫游」所在的**连续推荐播放**这一格。不是泛推荐系统，不管首页推荐位怎么排。

## 1. 网易云音乐（本机 3.1.43 真身取证）

证据来源：`D:\CloudMusic\package\orpheus.ntpk`（sha256 7abf88e9…）解包后的
`pub/hybrid/app.chunk.5d77cd4.js` 与 `subApp.chunk.5d77cd4.js`。下文 `@n` 是文件内字符偏移。

### 1.1 它有两种「漫游」，不是一个功能

- **私人漫游**（`fm`）：长期口味流。左栏一项，进去就是一直放。
- **相似歌曲漫游**（`mode=FAMILIAR`）：从当前这首出发。文案 `相似歌曲` / `为你播放相似歌曲推荐`，
  开启时 toast「私人漫游模式开启中」（@820000 一段的 `l`/`c` 映射）。

两者共用一套状态机，靠 `mode` 分桶缓存（`privateFmByMode`，@5303998）。

### 1.2 取歌接口与队列形状

- 取歌：`GET /api/v1/radio/get`，参数 `{ imageFm, mode?, sourceIds? }`（@2388171）。
  `imageFm` 默认 1；`mode` 只在相似歌曲漫游时带；`sourceIds` 用来指种子。
- 客户端队列：`{ fmTracks, currentIndex, isLoadingData, lastSkipTime, playingMode, fmTracksChorus }`（@5303998）。
  `playingMode` 只有 `infinite` 与 `cycleOne` 两种——**漫游默认就是无限**，不是列表循环。
- 批大小由服务端决定，客户端不带 `limit`。这一点很关键：客户端只负责「快没了再要」。

### 1.3 什么时候补歌：剩 2 首

```js
function De(e, t) {            // e = fmTracks, t = currentIndex
  const n = t >= e.length - 2  // 还剩 2 首（含当前）就要
  return n
}
```
（@5299827，日志原文「fm 是否需要获取更多」）

取回后按 `id` 去重再拼到队尾（`Ve`，@5299827），不会出现前后两批重复。

### 1.4 「不感兴趣」怎么做（这是最值得抄的一段）

```js
trash() {
  if (isLoadingData) return                 // 防并发
  if (Date.now() - lastSkipTime < 250) return  // 250ms 节流
  if (De(fmTracks, currentIndex)) loadMore()   // 先补，再删
  fmTracks.splice(currentIndex, 1)             // 把这首从队列里摘掉
  switchTrack({ type: 'TRASH' })               // 原地换下一首
}
```
（@5310049 附近）

三个细节值得注意：
1. **先补再删**：删之前如果已经见底，先要一批，免得删完没歌。
2. **原地换**：不跳页、不弹窗，队列位置不动，当前这首直接换成下一首。
3. **250ms 节流**：连点不会把队列删穿。

上报分两条：`/api/radio/trash/add`（真正的不感兴趣，带 `alg` 与 `playedTime`）与
`/api/v1/radio/skip`（只是跳过）（@2396903）。前者进黑名单，后者只影响排序。
黑名单还有 `/api/v3/radio/trash/get` 拉回、`/api/radio/trash/del/batch` 撤销。

黑名单跨设备同步靠 `checkPoint` 增量轮询 `/api/music/dislike/change`，间隔 600s（@3120286）。

### 1.5 心动模式（playAi）不是电台

播放上报里有一个 `is_heart: 'playAi' === mode ? 1 : 0`（@3943316），说明心动模式的队列是
「一批歌单里的歌 + 相似推荐」混排，而不是电台流；开启失败会 toast「心动模式开启失败」，
且失败时会在「切回来时旧列表丢失」的情况下重建列表（@2555609 一段的错误处理）。

**结论**：网易云把「一直放」做成服务端流 + 客户端只补不攒；「不感兴趣」是原地换歌 + 先补后删。

## 2. 其他主流产品

> 证据分两级：**A**＝原件可查（源码 / 接口 / 条目原文）；**B**＝公开产品行为归纳，未逮到官方原文逐字核对。
> 本轮网络抓取受阻（本机要走本地代理，Apple / Google 支持页又是 JS 渲染且 WAF 拦），B 级条目请把具体数字当待核。

### 2.1 Pandora（A：维基 Pandora Radio 条目原文）

- 推荐基于 **Music Genome Project**：按「流派、共用配器」等音乐特征给单曲分类。
- 原文：「More than 450 musical attributes are considered when selecting the next song. These 450 attributes are combined into larger groups called focus traits, of which there are 2,000.」
- thumbs up / down 决定「该不该在这个 station 里放相似的歌」；
  **对同一艺人第二次 thumbs down 会在该 station 封掉这个艺人**。
- thumbs down 立即跳过，但免费用户**跳过次数有限**（付费或看广告解锁）。

**可抄的**：负反馈是分层级的——「不喜欢这首歌」与「不喜欢这个艺人」是两件事，不是布尔值。
**不该抄的**：跳过配额。我们是本地播放器，没有广告变现动机。

### 2.2 Spotify（B）

- **Autoplay**：播放列表 / 专辑放完后继续放「相似歌曲」，关掉就停。入口在设置里，是隐式续播。
- **Radio**：歌曲 / 艺人 / 歌单电台，显式的「无限」入口，本质是 seed + 推荐。
- 第三方分析常引用「Autoplay 与 Radio 贡献 25% 以上的新艺人发现」（未核，只当方向）。

**可抄的**：把「无限」拆成两个入口——隐式续播与显式电台。我们现在只有后者（左栏漫游）。

### 2.3 Apple Music（B）

- 队列放完有 **Autoplay**（自动播放）续相似音乐；另有 **Infinity（∞）** 图标，用于对某首歌 / 某个艺人发散。
- 与 Spotify 同构：显式开关 + 隐式续播。

**可抄的**：∞ 做成独立按钮比藏进右键菜单更容易发现。我们做「以此歌漫游」时照这个位置摆。

### 2.4 YouTube Music（B）

- 播放器里有「自动播放」开关，关掉则队列播完即停。
- 电台由当前歌曲 / 视频 seed 生成；但用户手动插进队列的歌优先于算法续播。

**可抄的**：续播必须可见、可关；用户手动插歌要压过算法续播。我们目前没有「手动插歌优先」的规则。

### 2.5 QQ 音乐 / 汽水音乐 / 酷狗（B）

- QQ 音乐：「漫游」是显式电台入口，另有「每日 30 首」；负反馈是「不感兴趣」。
- 汽水音乐：以推荐流为核心，上下切换，负反馈是「不感兴趣」。
- 酷狗：电台 / 猜你喜欢。

**可抄的**：国内产品的负反馈交互更重（明确写「不感兴趣」而不是只给跳过），符合中文用户预期。

## 3. 参考项目里怎么做的

四份参考项目里只有 **Twilight Echo** 真做了「能一直放」的漫游，其余是拉一次列表。

### 3.1 Twilight Echo（Electron + 网易云 provider 插件）

文件：`C:\Users\PC\Documents\deepseek-harness\default-workspace\ref-twilight-echo\resources\plugins\ncm-provider\index.mjs`

| 位置 | 事实 |
| --- | --- |
| :29 | `PERSONAL_FM_TARGET_TRACKS = 30` |
| :30 | `PERSONAL_FM_MAX_FALLBACK_BATCHES = 10` |
| :44 | `let personalFmSeenSongIds = new Set()`（模块级去重集合） |
| :241 | 会话重置处 `personalFmSeenSongIds = new Set()` |
| :79 | 左栏入口 `{ id: 'fm', title: '私人漫游', icon: 'pi pi-compass', method: 'fetchPersonalFm' }` |
| :2052 | `appendUniqueSongs(target, seen, songs)`：按 `Number(song.id)` 去重、`<=0` 跳过、到 30 首 break |
| :2065 | `fetchPersonalFm()`：先打 `/personal/fm/mode?mode=DEFAULT&limit=30`，失败 warn 后回退经典 `/personal_fm`，最多 10 轮凑够 30 首 |

**设计思路**：客户端攒一批列表（30 首），不是流。批量接口拿一次，不够就逐轮回退经典接口，直到凑够。
**优点**：首屏一次到位；批量接口失败有降级路径，不会空着；去重集合放在 provider 层，UI 完全不用管。
**缺点**：攒完不会自己续，放到底就停；seen 集合只在「会话重置」清空，中间不重置会越攒越稀。

### 3.2 QueMusic（Qt6 / QML）

- `ref-quemusic\api\platform\NeteaseCloudApi.cpp:743`：`enqueue("getPersonalFm", "personal_fm", {})` —— 只拉一次。
- `ref-quemusic\api\ApiResultRouter.cpp:104`：未登录时 `personalFallbackWarning("私人漫游需要先在设置中登录账号")` —— 前置校验，错误说人话。
- `ref-quemusic\doc\project\05-qml-shell.md:573`：首页另有一个「歌单漫游」（窗口内 tabbar 切分类 → 分类歌单列表）。**同名两义**：一个是私人漫游，一个是歌单分类切换。

**优点**：登录态前置，失败给可执行的话。**缺点**：无续批，无去重；「漫游」这个词被用在两件不相干的事上。

### 3.3 Mineradio / Rhine

- `ref-mineradio` 全仓 grep `私人FM|漫游|personalFm|privateFm|personal_fm` **0 命中**——没有这个功能。
- `ref-rhine` 只有 `scripts\check-packaged-bridge.cjs:275` 的 `'/personal_fm'` 路径白名单，说明它包了接口但没有漫游 UI。

### 3.4 和网易云的核心差别

网易云是**服务端流 + 客户端只补不攒**（剩 2 首就要）；这两个第三方都是**客户端攒一批列表**（Twilight 30 首、QueMusic 一次）。我们（Aurora）现在走的也是「攒一批」：首批 20、之后每次 10。

## 4. 共性做法

把 §1 网易云与 §3 参考项目放在一起，能抽出五条，每条都有证据：

1. **「无限」是补出来的，不是列表长出来的。** 网易云剩 2 首补（`De`），Twilight 一次攒 30 首。差别只在批大小与触发点，没有任何一家把「无限」做成几千首的静态列表。
2. **去重至少做两遍。** 网易云服务端按 `id` 去重后客户端 `Ve` 再拼一遍；Twilight 用 `seen` 集合。只靠一侧，批次边界上就会重。
3. **漫游流与「用户队列」是两个东西。** 网易云单独存 `fmTracks`；Twilight 是列表页。谁把它直接塞进用户队列，退出时就容易把用户自己的队列弄丢。
4. **负反馈必须原地生效。** 网易云的 `trash` 不跳页、不弹窗：先补一批、`splice` 掉当前、`switchTrack` 换下一首；另有 250ms 节流防连点删穿。
5. **「漫游」通常有两个入口。** 口味流（无种子，网易云 `fm`）与种子扩散（当前歌出发，网易云 `mode=FAMILIAR`）。多数第三方只做了一个（Twilight、QueMusic 都只有口味流）。

## 5. Aurora 现状与差距

当前实现（提交 `fd60bd5` / `7255097` / `def22bb`）：

| 维度 | 现在 | 差距 |
| --- | --- | --- |
| 批次 | 首批 20，之后每批 10 | 与网易云一致（小批勤补） |
| 补批触发 | 剩 6 首（`shouldPullMore`） | 网易云是剩 2 首；6 首偏保守，但网络差时更稳 |
| 不重复 | 跨趟「放过」200 首 + 「划掉」300 首，按 `trackKey` | 网易云是服务端保证 + 黑名单；我们靠本地名单 |
| 不主动停 | 循环关掉；到末尾只报错、8s 后重试 | 与网易云一致 |
| 负反馈 | 只有「划掉」（本地隐藏） | **没有「不感兴趣」上报**，也没有种子发散 |
| 种子 | 池子 = 喜欢的 + 每日推荐 + 漫游流 | 没有「从这首出发」的单曲种子漫游 |
| 状态归属 | `useRoam` 全局 store，离开播放页仍续 | 与网易云一致 |
| 队列形状 | 就是播放器的 queue | 网易云把 fm 单独存 `fmTracks`，不污染队列；我们用 queue 更简单，但退出漫游要小心 |

## 6. 可借鉴清单

按「收益 / 成本」排。每条给参考做法、Aurora 落点、成本。

### 6.1 把「划掉」升级成真正的「不感兴趣」（最该做）

- **参考**：网易云 `trash`——先补再删、原地换歌、250ms 节流（§1.4）。
- **现状**：`D:\Aurora\src\views\RoamRail.tsx` 的 × 只调 `hideRoamTrack`，写本地 `aurora.roam.hidden`（300 条），当前这首被划掉后靠 `removeFromQueue` 换歌，**不区分「跳过」与「不想再听」**。
- **落点**：`D:\Aurora\src\features\player\roam-session.ts` 的 `hideRoamTrack` 里加一步：先 `refillIfLow()` 再摘当前；记录增加 `reason: 'skip' | 'dislike'` 两档（`skip` 只记本次会话，`dislike` 进 300 条持久名单）。
- **交互**：轨道卡片悬停出两颗——「跳过本次」与「不想再听这首」；后者原地换歌并给一条 3 秒可撤销提示。
- **成本**：小（改一个 store 函数 + 卡片两颗按钮 + 一个 toast）。

### 6.2 加「从这首出发」的种子漫游

- **参考**：网易云 `mode=FAMILIAR`（§1.1），文案「相似歌曲」。
- **现状**：`startRoam()` 无种子，池子固定是「喜欢的 + 每日推荐 + 漫游流」。
- **落点**：`startRoam(seed?: Track)`；种子存在 `useRoam.seed`，RoamRail 头部显示「从〈孤山春〉出发」并能一键回到无种子。选曲在 `D:\Aurora\src\features\player\roam-pure.ts` 加一个 `rankBySeed(pool, seed)`：同艺人 > 同专辑 > 同平台同标题 > 其他。
- **交互**：播放页「详情」或歌曲右键菜单里加「以此歌漫游」。
- **成本**：中（要排序函数 + 一个入口 + 头部状态）。

### 6.3 触发点从「剩 6 首」改成按剩余时长

- **参考**：网易云剩 2 首（约 6–8 分钟）；Twilight 一次攒 30 首不管后续。
- **现状**：`shouldPullMore(left, ahead)` 用首数，`AHEAD = 6`（`roam-session.ts`）。
- **问题**：6 首短歌约 18 分钟，6 首 8 分钟的现场版约 48 分钟，触发时机会飘。
- **落点**：`roam-pure.ts` 加 `remainingSeconds(tracks, index)`，`refillIfLow` 改判「剩余 < 900 秒」；保留首数判据做兜底（无时长元数据时）。
- **成本**：小（纯函数 + 一处调用）。

### 6.4 批次可调，别再固定 20 / 10

- **参考**：用户 m23750 已明确「一次 60 和 30 太多了」；网易云批大小由服务端定，客户端不管。
- **现状**：`SLOTS.roam = 20`、`ROAM_MORE = 10` 都是编译期常量（`slots.ts`）。
- **落点**：把 `ROAM_MORE` 改成「当前剩余与目标的一半取小」，即 `Math.min(10, Math.ceil(left / 2))`；或在设置页给「漫游一次要多少首」三档（10 / 20 / 30）。
- **成本**：小（一个表达式或一个设置项）。

### 6.5 漫游历史与「为什么是这首」

- **参考**：网易云上报带 `alg` 字段，黑名单可回看、可撤销（§1.4）。
- **现状**：漫游退出即丢队列（`endRoam` 不动 queue，但 `useRoam.tracks` 清空），没有「上一趟」入口。
- **落点**：`useRoam` 加 `lastSession`（退出时存 tracks/heard/seed）；左栏漫游项右键或 RoamRail 空态给「回到上一趟」。
- **成本**：中（多一份状态 + 一个入口）。

---

**不建议照抄的**：网易云的 `cycleOne`（单曲循环）在漫游里没有意义——我们已经把循环关掉了，再给一个循环开关只会和「不重复」打架。Twilight 的「一次攒 30 首」也不适合我们：它攒完就停，而用户明确要求「一直持续、不主动停」。
