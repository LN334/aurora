# QQ 上游换包方案（@sansenjian → @yakult-green-tea）

> 2026-11-17 实测。所有数字来自本机真装真跑，不是看文档抄的。
> 面向不写代码的读者：只讲「换什么、为什么、有什么好处、代价多大、风险在哪」。

---

## 一、结论

**值得换，但不是一刀切，分四步走，每步都能单独回退。**

换包**不会让你多听到一首歌**——两个包在「未登录取流」这件事上一模一样（都返空）。换的是三件事：

1. **抗停更**：现用包 82 天没更新、月下载 263；候选包 2 天前更新、月下载 1,883
2. **接口从 16 个变 88 个**：黑名单、听歌排行、个人 FM、评论、MV、每日推荐历史，现用包都没有
3. **写接口不用自己写了**：歌单增删改、喜欢歌曲、收藏专辑，候选包原生支持；现在是你代码里手抄协议实现的（`electron/qq/transport.ts:497` 有注释自认）

---

## 二、两个包的硬数据

| | `@sansenjian/qq-music-api`（现用） | `@yakult-green-tea/qq-music-api`（候选） |
|---|---|---|
| 版本 | 2.6.0 | 3.3.7 |
| 最近发布 | 2026-08-27（82 天前） | 2026-11-15（2 天前） |
| 月下载 | 263 | 1,883 |
| 历史版本 | 22 | 21（全在近半年内） |
| 形态 | 纯函数 SDK，`require` 后直接调 | Koa2 服务，起在本地端口上 |
| 接口数 | 16（你只用了这 16 个） | 88 |
| 取播放链接 | `getPlayUrl` | `/getMusicPlay/:songmid` + `/getEncryptedMusicPlay` |
| 写接口 | 无 | `/user/playlist/create`、`/rename`、`/delete`、`/user/song/like`、`/user/album/subscribe` |
| 扫码登录 | `getQQLoginQr` / `checkQQLoginQr` | `/login/qr/key`、`/create`、`/check`、`/cancel` |
| Electron 支持 | 无专门说明 | README 写明「Electron 在主进程加载根模块即可启动」，另有 `configureAuthSessionRepository` 供宿主注入会话存储 |
| 体积 | 未测 | 1.9 MB（不含依赖树） |
| 许可证 | 未标注 | MIT |

### 实测记录

**能起服务**：把包装到临时目录，选一个空闲端口（实测 62386）拉起，`/login/channels` 返回 200。

**匿名搜索能通**：`/search?keyword=晴天&limit=2` → 200，返回周杰伦《晴天》，`total: 980`。

**匿名取流拿不到**：
```json
{"data":{"playUrl":{"000ykdWG0IeAPe":{
  "url":"","error":"暂无播放链接",
  "restriction":{"codes":{"result":104003,"subcode":1}}}}}}
```
这跟现用包的结果**一字不差**。所以换包不改播放能力，QQ 平台不登录就是不给流。

**未登录调用户接口返回 401**：`/user/detail` → `{"code":401,"message":"Login required"}`，符合预期。

**serverless 模式是阉割版**：包里另有一个 `/serverless` 导出（`handleRequest`，不用开端口，很适合 Electron），但实测 `/song/url`、`/song/info` 全部返回 **501 not implemented**。所以**必须走完整服务模式**，不能用 serverless。

---

## 三、换的代价（诚实版）

### 1. 要改成「起一个本地服务」

现在：`require` 一个包，直接调函数。
之后：起一个本地 HTTP 服务，代码去请求 `http://127.0.0.1:端口/...`。

**这不是新问题**——你的酷狗已经是这么做的：`electron/kugou/client.ts:186` 用 `spawn` 起子进程，绑定 `127.0.0.1`，端口用 `net.createServer` 现探一个空闲的。QQ 照抄这套即可。

### 2. 会话管理要移植

现在：cookie 存在 Aurora 自己手里，每次请求传进去。
之后：候选包自己管扫码登录 + 会话持久化。

好消息是它留了口子：`AuthSessionRepository` 接口只有两个方法——`load()` 和 `save(sessions)`，都是同步的，源码注释原话是「Electron's `safeStorage` API ... both are synchronous at this boundary」，**它就是照着 Electron 宿主设计的**。所以可以写一个适配器，把 Aurora 现有的 cookie 存储接上去，用户不用重新扫码。

### 3. 改代码的量

| 文件 | 现在 | 改动 |
|---|---|---|
| `electron/qq/transport.ts` | 914 行 | 改写：函数调用 → HTTP 请求。**主要工作量** |
| `electron/qq/client.ts` | 854 行 | 小幅：返回值结构对齐 |
| `electron/qq/session.ts` | 150 行 | 改写：接 `AuthSessionRepository` |
| `electron/qq/normalize.ts` | 859 行 | 不动（响应结构大同小异） |
| `electron/qq/ipc.ts` | 254 行 | 不动 |

粗估 **4~5 个工作日**，含测试。

---

## 四、风险

| 风险 | 程度 | 应对 |
|---|---|---|
| 会话迁移做错，用户要重新扫码 | 中 | 阶段 0 先并行跑，老路不动，确认新路登录态正常再切 |
| 新包也是个人维护，明年可能一样停更 | 中 | 换来的是「更活跃的现在」，不是永久保险。可加一条上游变更监控 |
| 新包启动慢/占端口 | 低 | 懒加载（酷狗就是懒加载），端口随机 |
| 写接口切换时收藏状态错乱 | 中 | 写接口最后切，先只切读接口 |
| 打包后依赖树变大 | 低 | koa 一套约 10 MB，比现在 vendor 的酷狗 16.9 MB 小 |

---

## 五、分四步走，每步能回退

### 阶段 0：并行接入（半天到 1 天）
- `package.json` 加 `@yakult-green-tea/qq-music-api`
- 新建 `electron/qq/local-server.ts`：照抄酷狗那套 spawn + 探空闲端口 + 等 `/login/channels` 通
- 只打通一个接口：搜索。跟老路结果做对比
- **老代码一行不改**，随时能删掉这个新文件回退

**验收**：应用里触发一次搜索，日志里能看到新服务起来并返回了搜索结果。

### 阶段 1：读接口切换（1~2 天）
搜索、歌曲详情、歌词、歌单详情、专辑、歌手、每日推荐、新歌——全部改走新服务。
取流和写操作**继续走老路**。

**验收**：四个平台各搜一次、各播一首、各看一次歌单，界面无差异。

### 阶段 2：登录与取流切换（1 天）
- 扫码登录改走新服务（`/login/qr/*`）
- 会话仓库适配器接上，老 cookie 直接搬过去
- 取流改走 `/getMusicPlay`

**验收**：你登录 QQ 后播一首 VIP 歌能出声；退出登录后提示要登录（不能静默失败）。

### 阶段 3：写接口 + 摘老包（1 天）
- 收藏、加歌单、删歌单改走新接口
- 删掉 `@sansenjian/qq-music-api` 依赖和 `transport.ts:497` 那段手抄协议
- 跑一遍打包冒烟

**验收**：收藏一首歌、建一个歌单、删掉它，QQ 音乐 App 里能看到对应变化。

---

## 六、如果不想改这么多，还有一条小路

只做**阶段 0**，然后到此为止。

收益：新包在包里躺着，随时能用；多了一个「上游还活着」的实证。
代价：半天。
不改任何现有行为，不承担迁移风险。

适合「先看看这包靠不靠得住」的心态。

---

## 七、我的建议

做阶段 0 和 1（约 2 天）。这两步只动读接口，不碰登录、不碰取流、不碰写操作——**用户的可见行为零变化**，但 QQ 这块的抗风险能力实打实上一个台阶。

阶段 2、3 等阶段 1 跑稳了再说。那时候你已经能看到新包在真实流量下的表现，再决定要不要把身家性命交过去。

---

## 八、实施结果（2026-11-17 已完成）

按上面的四阶段**一次做完**了（用户原话只有一个「换」字）。下面全部是本机实测，不是计划。

### 改了什么

| 文件 | 改动 |
|---|---|
| `electron/qq/local-server.ts`（新建） | 起本地服务：现探空闲端口、`spawn` 子进程、健康检查、30 秒退避重试、退出清理 |
| `electron/qq/transport.ts` | 从「require 上游包的纯函数」整段改成「fetch 本地服务」，14 个上游函数全部重写；新增 `call()` 与 `wrapResponse()` |
| `electron/qq/client.ts` | `ensureLoaded()` 由同步改 async；三处调用点改成 `await` / `void` |
| `electron/qq/normalize.ts` | **一行没改** |
| `package.json` | 删 `@sansenjian/qq-music-api`；`build.asarUnpack` 加 `node_modules/@yakult-green-tea/qq-music-api/**` |
| `electron/qq/smoke.cjs` | 上游对照段改走 HTTP；修了两处过时路径（`dist-electron/remote-protocol.js` → `dist-electron/protocols/remote-protocol.js`） |
| `electron/netease/smoke.cjs` | 同上那处路径修正 |

### 为什么不改 normalize.ts

它的 13 个导出大多已有 `body ?? response` 兜底，所以转换做在 transport 一侧：把新服务的响应**包成它认识的老形状**再交过去。这样 859 行解析和它的快照测试全部继续有效。只有 4 处必须整形：搜索、歌词、新歌、播放。

### 验收

| 项 | 结果 |
|---|---|
| 类型检查 | `npx tsc -p tsconfig.electron.json --noEmit` exit 0 |
| 全量检查 | `npm run check` exit 0（642 测试全过、入口 74 / 可达 370 源文件、CSS 868 class 无死选择器、死导出 0） |
| 主进程探针 | `node electron/qq/smoke.cjs` → SMOKE_OK。搜索 10 首、免费歌 128k 拿到真直链（`aqqmusic.tc.qq.com`，3,413,244 字节，206 + `audio/mpeg` + magic `49443303`）、代理 206 等价、歌词 1209 字符、封面 66463 字节、付费歌 login-required |
| 原始码对照 | 免费/128 = 0 且有 purl；免费/320、免费/flac、付费三档 = 104003；把数字 id 当 songmid = 101404。**与换包前逐项一致** |
| 打包产物 | `release-qq2\Aurora-0.8.12-Setup.exe` |
| 打包版上游 | `startup.log` 里 `[qq] starting upstream → [qq] ready → [qq] upstream ready at http://127.0.0.1:55431`，378ms |
| 打包版接口 | collectedAlbums / loginStatus / status / liked / recommendPlaylists / newSongs / followedArtists / daily 全部 ok，无 `qq:err` |
| 界面冒烟 | `npm run smoke -- --exe=release-qq2/win-unpacked/Aurora.exe` → **12/12 屏通过**，四平台搜索 93 条 |
| 扫码登录（打包版界面） | CDP 探针点开账号页 → QQ 卡「登录」→ 弹层 2 秒内出真实二维码（`data:image/png`，598 字符）。直调 `window.aurora.qq.qrCreate()` 返回 `key` + 602 字符图；`qrCheck` 返回 `waiting`。截图见 [qq-login-qr.png](qq-login-qr.png) |

### 三个坑（下次别重踩）

1. **`spawn` 的 `cwd` 不能指向 asar 内的路径**。打包后包体在 `app.asar` 里，那是 Node 眼里的虚拟路径，`cwd` 必须是真实目录——否则子进程静默起不来，日志只有一行 `starting upstream` 就没了。现在不设 cwd，靠 `-e` 里 require 的绝对路径。
2. **`npm run check` 不产出 `dist-electron`**，它只做 `tsc --noEmit`。验行为前必须先 `npm run build:electron`，否则验的是上一版代码。
3. **试运行时先清 `ELECTRON_RUN_AS_NODE`**。DSH 自己跑在 Electron 里，会把这个变量传给子进程，导致 `npx electron xxx.cjs` 以 node 模式执行并报 `Cannot read properties of undefined (reading 'whenReady')`。

### 已知代价

- **登录态需要重扫一次码**。新上游签发自己的会话 token，旧的 QQ 原生 cookie 不被它认。`session.ts` 的存储结构没变，只是 `cookie` 字段现在装的是 token。
- **搜索的专辑/歌手两栏仍是空的**。新上游的 `/search` 不返 `zhida` 结构，而 UI 目前根本不消费这两栏（`SearchView.tsx` 没读 `albums`/`artists`），所以没做三次请求的聚合。等界面真要用时再开——新上游支持 `type=album` / `type=singer` 真搜索，比旧包强。
- 首次调用 QQ 会慢约 **7 秒**（spawn 子进程 + 加载包），之后毫秒级。子进程常驻，懒启动一次。

### 上游搜索能搜什么（2026-11-17 实测）

新上游的 `/search` 默认只回歌曲，但 `type` 参数是**真的生效**，四种都能搜。同一个关键词「晴天」的结果：

| type | total | item 里的关键字段 |
|---|---|---|
| `song` | 998 | 完整 fcg song 对象（`album.id`/`album.mid`/`album.name`、`bpm`、`pay` 等） |
| `singer` | 7 | `singerID` / `singerMID` / `singerName` / `singerPic` / `albumNum` / `songNum` |
| `album` | 838 | `albummid` / `id` / `name` / `pic` / `publish_date` / `singer` / `song_num` |
| `playlist` | 正常返回 | —— |

四者形状统一：`{ code, type, page, limit, total, more, items[] }`。

本仓目前只用第一种，且是**写死**的：`electron/qq/transport.ts` 的 `requestSearch` 固定发 `type: 'song'`，再把 `items` 包成 `song.list` 交回旧信封。因此 `normalize.normalizeSearch` 永远看不到 `zhida` 块，`artists` 与 `albums` 就恒为空——不是上游不给，是没人要。`electron/qq/client.ts` 里那句 `void type` 说的就是这事；旧注释「upstream has no album or artist search」是换包前的结论，已过期，本轮连同 `normalize.ts` 一起改掉了。

将来要接的话路径很直：`requestSearch` 加一个 `type` 参数透传 → `qqSearch` 不再 `void type` → `normalizeSearch` 按 `type` 走 `items[]` 分支（比旧的 `zhida` 干净得多）。界面那侧才是真成本：`src/app/search/SearchView.tsx` 的设计是「一个词 + 一个音源范围 + 一张 Track 列表」，加「歌曲/专辑/艺人」切换要新的卡片组件，属产品决策，本轮没动。

### 顺手修的：登录二维码被反复重建（2026-11-17）

- **现象**：打包版打开「账号」页、点 QQ 卡片的「登录」，`startup.log` 里 `qq:qrCreate` 连着调了 4 次。
- **原因**：`PlatformLoginDialogs` 传给 `<QqLogin onClose={...}>` 的是内联箭头函数，父组件每渲染一次它就换一个新引用；`QqLogin` 里 `finish = useCallback(..., [onClose])` 因此不稳定，而创建二维码的 `useEffect` 依赖 `finish`，于是父组件每更新一次就重跑一遍 effect，把刚出的码换掉——用户若正在扫，扫到的可能是已被替换的那张。
- **修法**：三处登录弹层（`src/features/qq/QqLogin.tsx`、`src/features/kugou/KugouLogin.tsx`、`src/features/qishui/QishuiLogin.tsx`）把 `onClose` 挂到 ref 上，`finish` 依赖改成空数组。网易云的 `finish` 本来就不依赖 `onClose`，未动。
- **验证**：开发版探针点开 QQ 登录，`qq:qrCreate` 从 4 次降到 **1 次**，二维码 6 秒内不变。酷狗与汽水用干净 profile 各点一次，`startup.log` 里 `kugou:qrCreate ok`、`qishui:qrCreate ok` 各一行，同样没重复。`npm run check` 仍 exit 0（642 测试全过）。
