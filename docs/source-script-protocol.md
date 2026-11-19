# 自定义音源：脚本协议与宿主设计（方案，已决定不做）

> 状态：**暂缓，2026-11-19 拍板现在不做**。结论与重新评估的条件见 §0；下面是完整设计，
> 留着是为了将来真要做时不用重想一遍。工作区里没有对应实现。
> 前置调研：[other-players-platform-adapters.md](other-players-platform-adapters.md) 的建议二。
> 本篇是在那条建议上再往前走一步的方案，不是重复它。

## 0. 决定：现在不做

2026-11-19 与持有者确认，**不实现**，保持「每个平台一份内置 client」的现状。三条理由：

1. **做出来没有用户。** 持有者不写脚本，这套机制的唯一消费者是外部贡献者；而国内源的现实
   是 MusicFree 官方插件仓因告知函下架了全部国内厂商源（见前置调研 §1.5）。最可能的结局
   是宿主做完了、目录里只有一个示例。
2. **它不解决「平台改版就坏」。** 脚本化只是把坏掉的代码从主仓挪到 `%APPDATA%\sources\`，
   签名的难度不变：酷狗仍是那三张盐，QQ 仍是那 29 行 zzc，汽水仍要官方风控运行时的 cookie。
3. **成本是常驻的。** 协议 v1 字段只能加不能改；沙箱、设置页分区、示例与文档、跨 realm 的坑
   都要长期养着，换来的却是一条大概率无人使用的管道。

**重新评估的触发条件**（任一发生再看）：

- 要接主仓写起来不划算的小平台（YouTube Music、Spotify 这类接口简单、签名少的）；
- 决定让外部贡献者往 Aurora 里加源，需要先有协议才能谈。

届时从 §2（v1 是否只做兜底取流）与 §5（vm 还是隐藏窗口）两个决定开始。

## 1. 要解决的一件事

Aurora 现在加一家音源 = 写一个 `electron/<platform>/client.ts` + 在 `src/features/online/<x>-provider.ts` 里登记 + 改 README + 重新打包发版。

目标是换一种代价：**放一个文件进去，界面上就多一家**，不重新构建、不改主仓代码。这是 Muonium（内嵌 LX 脚本运行时）真正值得学的地方——它在 Minecraft 里也做不到重新编译时，就靠这条路把音源数量从 1 变到 8。

不学的地方：不吃 LX 的脚本格式，不装它的生态。那套脚本默认能访问任意 URL，社区里现成的「国内源」大量把请求转给私人中转服务器（调研文档 §1.3 记了实例）；用它的格式等于把那些东西一起请进来。

## 2. 与既有建议的差异（要拍板的第一个点）

调研文档建议二把脚本能力限定成 3 个 action 的**兜底取流**（`resolveStream` / `getLyric` / `getCover`），理由是主仓已能搜索，脚本只补「放不出声」的那一段。

但那不算「加一家」，只算「救一首」。既然要做，我倾向 v1 就做**完整源**的最小集：

| 能力 | v1 | 说明 |
| :-- | :-- | :-- |
| `search` | 要 | 搜索框里多一个标签页，结果进现有列表 |
| `resolveStream` | 要 | 点播放能出声 |
| `songById` | 可选 | 队列恢复时用；不实现就退回搜索结果缓存 |
| 歌词 / 歌单 / 专辑 / 艺人 / 登录 | 不做 | v2 再议，接口先留位 |

代价：协议比「3 个 action」宽一圈，脚本作者要把平台的搜索结果映射成我们认的歌曲形状。收益：它真的能当第六家、第七家用。

## 3. 脚本长什么样

一个 `.js` 文件，CommonJS 风格导出（不解析 AST，直接 `module.exports = {...}`）：

```js
module.exports = {
  id: 'itunes',                 // 小写字母/数字/连字符，也是 Track.id 的前缀
  name: 'iTunes 试听',
  hosts: ['itunes.apple.com'],  // 允许访问的域名；子域算在内
  quality: ['standard'],        // 声明自己能给哪几档；缺省 standard

  async search(keywords, limit) {
    const data = await aurora.http.getJson(
      'https://itunes.apple.com/search?term=' + encodeURIComponent(keywords) + '&media=music&limit=' + limit
    )
    return data.results.map((row) => ({
      id: String(row.trackId),
      title: row.trackName,
      artist: row.artistName,
      album: row.collectionName || '',
      duration: Math.round((row.trackTimeMillis || 0) / 1000),
      cover: row.artworkUrl100 || '',
      stream: row.previewUrl || '',   // 30 秒试听，够当示例
    }))
  },

  async resolveStream(songId, quality) {
    return { url: '…', headers: { Referer: 'https://itunes.apple.com/' } }
  },
}
```

字段就这些，没有第二个形状。`search` 直接返回歌曲数组；`resolveStream` 返回地址与可选请求头。

## 4. 宿主给什么（能力面越小越好）

| 给 | 不给 |
| :-- | :-- |
| `aurora.http.getJson / getText / postJson`（只允许 https，只允许清单里的域名，15 秒超时） | `fetch`、`XMLHttpRequest`、任意 URL |
| `console.log/warn/error`（统一前缀 `[source:id]`，写进 startup.log） | `require`、`process`、`fs`、`child_process` |
| `aurora.crypto.md5 / sha1 / hmac / aesEncrypt / rsaEncrypt / base64` | 整个 `node:crypto` |
| `aurora.version`（协议版本，脚本据此分支） | 主进程对象、窗口、托盘、播放器 |

加密原语是必须给的：网易云、QQ、酷狗那几家都要算摘要或签名，不给就没法写国内源。给的是**具名函数**，不是模块——脚本作者用它算，但拿不走别的。

## 5. 宿主怎么跑它（要拍板的第二个点）

两条路，我推荐 A：

| | A. 主进程 `node:vm` | B. 隐藏 BrowserWindow + preload（调研建议二的做法） |
| :-- | :-- | :-- |
| 重量 | 每个脚本一个 context，进程内 | 一个隐藏窗口，带完整 Chromium |
| 能拿到的东西 | 只有我们注入的 | DOM、CORS、fetch、甚至 WebAssembly |
| 测试 | `node --test` 直接跑，不启窗口 | 必须真起 Electron，跑不进单测 |
| 隔离强度 | 弱：vm 不是安全边界 | 强：`sandbox: true` + contextIsolation |
| 适合 | 自己写的脚本、少量 | 用户从网上捡的脚本 |

定位决定选择：这一版面向「用户自己写/自己改的源」，不是「吃别人发的脚本」。所以选 A，并在文档与界面上直说「脚本是本机可信代码，别放来路不明的」。

真要走 B 也行，代价是每个脚本要一个窗口、单测得另起一套真窗口用例。

## 6. 加载与生命周期

- 目录：`%APPDATA%\aurora-player\sources\*.js`（按档案分不放这里——音源是这台机器的能力，不是某个人的偏好）。
- 首次启动：目录不存在就建，并写一份 `examples/itunes.js`，让用户有个能改的样板。
- 加载：启动时扫描一次；设置页有「重新扫描」，热加载不重启。
- 失败隔离：单个脚本语法错、清单缺字段、加载超时（5 秒）→ 这一家标记为「加载失败 + 原因」，其余四家正常。
- 调用超时：一次动作 15 秒；超时按这家失败处理，继续用别家。
- 跨 realm：脚本返回的对象要过一次 JSON 再进主进程（原型不同会让 `instanceof`、深比较出怪事，原型上已实测踩到）。

## 7. 接进现有界面

好消息：`ProviderId` 已经是 `string`，注册表就是一张 Map，不需要改类型系统。

要做的是：

1. `src/features/custom-sources/`：读已装脚本清单，为每个启用的源构造一个 `OnlineMusicProvider` + `PlatformBackend`，`backend.search / streamUrl / songById` 转发到主进程的 `custom-source:*` 通道。
2. 启动顺序：`registerProviders()` 之后、首屏渲染之前 `await registerCustomSources()`；失败只影响自定义源。
3. 设置页「听歌」分区加一块「自定义音源」：列出、启用/停用、重新扫描、打开目录、看失败原因。
4. 搜索页不需要改：它读注册表，多一家就多一个标签页。

## 8. 安全与版权边界（要写在文档里的话）

- **脚本是本机可信代码**：沙箱挡误用，不挡恶意。要挡恶意得上 B 方案或独立进程。
- **不内置任何第三方平台源**，安装包里只有示例（iTunes 试听这种公开接口）。理由与调研文档一致：MusicFree 插件仓收到告知函后下架全部国内源。
- **域名白名单**是硬要求：一个源只能碰它声明的域名，避免变成通用中转。
- 日志：脚本的 console 进 startup.log，出问题能查。

## 9. 分阶段

| 阶段 | 内容 | 验收 |
| :-- | :-- | :-- |
| v1 | 协议 + 宿主 + 动态注册 + 设置页 + 示例源 | 把 `itunes.js` 放进目录 → 搜索页多一个标签 → 搜得到 → 点得响 |
| v2 | 歌词、登录（宿主注入 per-source cookie 存储）、歌单 | 一个国内源能出词、能登录 |
| v3 | 取流真码率校验、失败回退链、上游漂移提示 | 见调研文档建议一/三 |

## 10. 风险

- 协议一旦发出去就要长期兼容：v1 的字段只能加不能改，改要升 `aurora.version`。
- 脚本能做的事越多，越像「给盗版生态做基建」；不内置源、只留示例，是这条线的底线。
- vm 里的脚本卡死只能靠超时放弃，无法真正杀掉一个死循环（同步死循环靠 `runInContext` 的 5 秒超时挡，异步卡住只能放弃等待）。

## 11. 原型已经验证到的（写方案前做的，已撤）

为了确认这条路不是纸上方案，用 `node:vm` 写了个最小宿主加 8 条测试，跑通了：

- 脚本里 `typeof require / process / __dirname / fetch` 全是 `undefined`；
- 未声明的域名在**发请求之前**就被拒，替身 fetch 的调用计数为 0；
- `notexample.com` 不会被 `example.com` 的白名单放行，子域 `api.example.com` 会；
- `http://` 直接拒；
- 非法 id、缺 name 在加载期就报错；
- 跨 realm 返回值必须过一次 JSON，否则深比较与 `instanceof` 都会出问题（这一点是原型里踩出来的，已写进 §6）。

这些结论对 A / B 两条路都成立；先写下来，免得实现时再踩一遍。
