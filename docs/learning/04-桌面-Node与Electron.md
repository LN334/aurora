# 第 3 站：桌面 —— Node 与 Electron

> 目标：能画出「页面点一下 → 磁盘上读一个文件 → 界面显示出来」的完整链路。
> 预计：4–6 周，每天 1 小时。

---

## 一、要解决什么问题

浏览器里的网页只能碰浏览器给它的东西：不能读 `D:\Music`，不能开系统通知，不能改任务栏图标。

桌面应用能。靠的是**把程序分成两半**：

- 一半跑在浏览器内核里（渲染进程），管界面；
- 另一半跑在 Node.js 里（主进程），管系统。

它们不能直接说话——**必须经过一座桥**。这一站学的就是这座桥。

**只学这些**：Node 的 `fs`/`path`、ESM 模块、进程概念、`BrowserWindow`、preload、三种 IPC 形态、私有协议。
**这里不用学**：Node 的 `stream` 细节、`Buffer` 编码大全、worker_threads、cluster、Electron 的 `webContents` 全部 API。用到了再查。

---

## 二、Node.js 是什么

一个能跑 JavaScript 的「非浏览器」环境。删掉了 DOM（没有 `document`），加上了系统能力：

```ts
import fs from 'node:fs'
import path from 'node:path'

fs.readdirSync('D:\\Music')                 // 列目录
fs.readFileSync('C:\\x.json', 'utf8')       // 读文件
path.join('a', 'b')                         // 拼路径（跨平台）
path.extname('song.flac')                   // '.flac'
```

注意 `node:` 前缀：它明确表示「这是 Node 内置模块」。项目里全部这么写，一眼就能与现实世界区分。

这个项目里 Node 用得最重的地方：

```ts
// electron/library-scan.ts:1-4
import fs from 'node:fs'
import path from 'node:path'
import type { IAudioMetadata } from 'music-metadata'
import { libraryIndexFile, libraryPaths } from './library-paths'
```

扫描整个音乐库：列目录、读每个文件的标签（`music-metadata` 这个 npm 包）、把结果写成一个索引 JSON。

### ESM 与 `package.json` 的 `type`

项目的 `package.json` **没有** `"type": "module"`。这意味着：

- `.mjs` 文件一定是 ESM；
- `.ts` 文件经过 tsc 编译后变成 `.js`，按 `tsconfig.electron.json` 的 `module: "nodenext"` 输出；
- 渲染层由 Vite 处理，它不关心 Node 的规则。

你会在跑测试时看到一句警告：

```
Reparsing as ES module because module syntax was detected.
To eliminate this warning, add "type": "module" to package.json.
```

这是 Node 24 的善意提醒，**不是错误**。项目没加 `type: module` 是有意的：主进程编译产物要按 `nodenext` 的规则走，改成纯 ESM 会牵动整个构建链。看到警告忽略即可。

---

## 三、Electron 的三层结构

```
┌──────────────────────────────────────────────────────────┐
│  主进程 main process                                      │
│  electron/main.ts  一个应用只有一个                       │
│  能：开窗口、读文件、连网、托盘、全局快捷键、自动更新       │
│  不能：画界面                                             │
└───────────────┬──────────────────────────────────────────┘
                │  preload.ts（桥）
                │  contextBridge.exposeInMainWorld('aurora', api)
┌───────────────▼──────────────────────────────────────────┐
│  渲染进程 renderer  每个窗口一个                          │
│  src/main.tsx  → React 应用                               │
│  能：画界面、播音频、读 localStorage                       │
│  不能：直接读文件、开系统对话框（要走桥）                   │
└──────────────────────────────────────────────────────────┘
```

### 为什么要分

三个理由，缺一不可：

1. **能力**：文件系统、托盘、协议注册，只有 Node 侧有。
2. **安全**：网页是不可信的。如果页面代码能直接 `require('fs')`，一个被注入的脚本就能删你的文件。
3. **稳定**：界面崩了，主进程还能活；主进程崩了，整个应用才死。

### 三个安全开关（`electron/main.ts:371-380`）

```ts
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,     // 页面脚本与 preload 各在一层，不能互相改
  nodeIntegration: false,     // 页面里没有 require / process
  sandbox: true,              // 渲染进程跑在系统沙箱里
  autoplayPolicy: 'no-user-gesture-required',
  backgroundThrottling: false  // 窗口在后台时定时器不被降频（播放器需要）
}
```

`contextIsolation: true` 是现代的默认且必须。它和执行 `nodeIntegration: false` 一起，保证**页面拿到的一切都是 preload 明确给它的**。

`backgroundThrottling: false` 是本项目特有的：一个音乐播放器缩到后台还得继续走进度条、继续取数据。代价是耗电，值得。

---

## 四、桥：preload 与 contextBridge

`electron/preload.ts` 只做一件事：**列出一份能力清单，挂到 `window.aurora` 上**。

```ts
// electron/preload.ts:759
contextBridge.exposeInMainWorld('aurora', api)
```

`api` 是什么？一个大对象，每个字段是一组能力：

```ts
// electron/preload.ts:176-199（节选）
library: {
  useProfile: (profileId: string | null) =>
    ipcRenderer.invoke('library:useProfile', profileId) as Promise<string[]>,
  getRoots: () => ipcRenderer.invoke('library:getRoots') as Promise<string[]>,
  getIndex: () => ipcRenderer.invoke('library:getIndex') as Promise<LibraryIndex>,
  scan: () => ipcRenderer.invoke('library:scan') as Promise<LibraryIndex>,
  cancelScan: () => ipcRenderer.invoke('library:cancelScan') as Promise<boolean>,
  onProgress: (handler) => { ... }   // 注意：返回取消订阅函数
}
```

三条硬规矩，这个文件每条都遵守了：

1. **只暴露函数，不暴露 `ipcRenderer` 本身**。否则页面可以往任意通道发消息，等于把桥拆了。
2. **每个函数都标注返回类型**（`as Promise<LibraryIndex>`）。这是给页面用的合约。
3. **订阅类接口返回「取消订阅」函数**。注释里写得很直白：`Returns an unsubscribe function; call it or the listener leaks.`

页面上不会直接写 `window.aurora`。它走一个中间层：

```ts
// src/bridge.ts
const native: AuroraApi | undefined = typeof window !== 'undefined' ? window.aurora : undefined
export const isNative = Boolean(native)
```

为什么要这层？看注释：**在普通浏览器里（设计预览、截图）`window.aurora` 不存在，于是退回一套内存实现**。这样界面不是只能在 Electron 里验证——这个决定在第 5 站会反复出现（自动化探针都靠它）。

---

## 五、IPC：三种形态

IPC = Inter-Process Communication，进程间通信。Electron 只给了三种，够了。

### 形态一：请求-响应（`invoke` / `handle`）

页面问，主进程答，异步。

```ts
// 页面（preload 里）
ipcRenderer.invoke('library:scan')

// 主进程
ipcMain.handle('library:scan', async () => { ... })
```

这是本项目的主流。名字统一成 `域:动作`（`library:scan`、`player:reportState`、`wallpaper:list`）。

**为什么不用 `send`？** 因为 `send` 没有返回值，靠事件回来配，配对逻辑得自己写。`invoke` 直接给你 Promise，一次搞定。

### 形态二：单向通知（`send` / `on`）

页面告诉主进程「我现在在放歌」，不需要回答。

```ts
// electron/ipc/player.ts:8-18
ipcMain.handle('player:reportState', (_event, state: { playing?: boolean } | null) => {
  const playing = Boolean(state?.playing)
  if (playing === deps.playing()) return true
  deps.setPlaying(playing)
  syncSleepBlocker(playing)
  const window = deps.window()
  if (window && !window.isDestroyed()) {
    installThumbar(window, playing, deps.sendCommand)
  }
  return true
})
```

这段代码值得逐行看，它示范了三件事：

1. **幂等**：状态没变就早退（第 10 行）。防抖在源头。
2. **一个事实，多处副作用**：任务栏按钮、电源休眠，都在「播放状态」这一个切换点更新。
3. **别信任事件对象**：`state` 被当成「可能有、可能是 null」处理。IPC 进来的东西和网络请求一样不可信。

### 形态三：主进程推给页面（`webContents.send` / `on`）

进度、更新状态、平台状态变化。页面订阅：

```ts
// src/features/library/scan.ts:75
unsubscribeProgress = bridge.library.onProgress(applyProgress)
```

主进程侧用 `win.webContents.send('library:progress', payload)`。

**这里有个经典坑**：订阅了不取消 = 内存泄漏 + 回调重复执行。所以 `scan.ts` 把取消函数存在模块级变量 `unsubscribeProgress` 里，下次扫描先取消上一次。

---

## 六、私有协议：`aurora-media:` 是什么

页面要播 `D:\Music\a.flac`。但 `<audio src="file:///D:/Music/a.flac">` 有几重麻烦：

1. 生产环境页面本身是 `file://`，开发环境是 `http://127.0.0.1:5173`——**同一个地址在两种模式下安全性不同**。
2. 这个项目用 Web Audio 做可视化与均衡器。**跨源的音频接到 Web Audio 会输出静音**（安全限制，不是 bug）。
3. 需要 Range 请求才能拖动进度条。

解法：主进程注册一个自己的协议，把文件「当成网站资源」服务出去。

```ts
// electron/protocols/media-protocol.ts:20-35
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,        // 'aurora-media'
      privileges: {
        standard: true,            // 当作标准协议，URL 能正确解析
        secure: true,              // 算安全上下文
        supportFetchAPI: true,
        stream: true,              // 关键：支持 range，才能 seek
        corsEnabled: true          // 关键：同源/跨源关系明确
      }
    }
  ])
}
```

然后 `protocol.handle('aurora-media', ...)` 里把请求路径映射到真实文件，带 CORS 头返回。

这个项目一共五个私有协议，分工清楚：

| 协议 | 服务什么 |
| --- | --- |
| `aurora-app:` | 生产环境的页面本身（`dist/`） |
| `aurora-media:` | 本地音频与封面，支持 Range |
| `aurora-remote:` | 在线音频/封面的代理（绕 CORS、转发 Range、白名单域名） |
| `aurora-cache:` | 在线音频的本地缓存（命中就发文件，没命中透传并顺手存） |
| `aurora-wallpaper:` | Wallpaper Engine 的库（缩略图、视频、场景包） |

**记住这条链**：页面里的 `<audio src="aurora-remote://...">` → 主进程的 handler → `fetch` 上游 → 加 CORS 头 → 回给渲染进程。所以这个项目里「封面取色」和「音频可视化」才都能工作。

---

## 七、一条完整链路走查：扫描音乐库

这是本项目的「样例链路」，所有 IPC 都长这样。跟着走一遍：

**第 1 步 · 页面发起**
用户在设置页点了「扫描」。界面代码调用：

```ts
// src/features/library/scan.ts:83
const index = await bridge.library.scan()
```

**第 2 步 · 桥**
`src/bridge.ts` 里的 `bridge` 是 `window.aurora`（桌面版）。所以实际执行的是 preload 里那个函数。

**第 3 步 · 过桥**
```ts
// electron/preload.ts:198
scan: () => ipcRenderer.invoke('library:scan') as Promise<LibraryIndex>
```
发出一个名为 `library:scan` 的请求。

**第 4 步 · 主进程接住**
```ts
// electron/ipc/library.ts:184
ipcMain.handle('library:scan', async () => { ... })
```
handler 内部调 `scanLibrary()`。

**第 5 步 · 真正干活**
`electron/library-scan.ts` 用 `fs` 遍历目录、用 `music-metadata` 读标签、比较 `mtimeMs` 决定哪些文件能复用缓存、把结果写进索引 JSON。

**第 6 步 · 原路返回**
返回值被 IPC 序列化成纯数据（不能传函数、类实例、Date 对象——`src/types.ts` 开头专门注释了这条），回到页面。

**第 7 步 · 进 store**
```ts
useLibrary.getState().setTracks(index.tracks ?? [])
```
界面重渲染，歌单出来了。

**第 8 步 · 进度是另一条路**
扫描过程中主进程不断 `send('library:progress', ...)`，页面通过 `onProgress` 订阅，更新那行「正在读取 xxx」。**进度不走返回值，因为返回值要等全部完成。**

这八步是模板。以后读任何一个 IPC 都这么拆：**页面函数 → preload → channel 名 → ipcMain.handle → 主进程实现 → 回到 store**。

---

## 八、安全：一个必须看懂的例子

私有协议意味着「别人可以通过 URL 让你读文件」。写错了就是任意文件读取漏洞。

```ts
// electron/pure/app-paths.ts:13-36（节选）
export function resolveAppAsset(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null      // 坏的百分号编码
  }

  if (decoded.includes('\0')) return null   // NUL 字节会截断路径

  const relative = decoded.replace(/^\/+/, '') || 'index.html'
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, relative)

  if (target === resolvedRoot) return null
  if (!target.startsWith(resolvedRoot + path.sep)) return null   // 关键一行
  return target
}
```

三个防御，每个都对应一种真实攻击：

1. **`..\..\Windows\System32`**：`path.resolve` 之后必须还在 `root` 里面。`startsWith(root + sep)` 是判据。
2. **`%00` 截断**：某些系统 API 遇 NUL 就当字符串结束，能绕过后缀检查。
3. **畸形编码**：`decodeURIComponent` 会抛，抛了就拒绝。

注释里说得很实在：「这是挡在请求与任意文件读取之间的唯一一道门，属于那种看起来显然正确、其实未必的代码。」——所以它被拆成纯函数，好在 `tests/` 里测。

---

## 九、项目锚点

| 顺序 | 文件 | 看什么 |
| --- | --- | --- |
| 1 | `electron/main.ts:355-390` | `webPreferences` 六个开关，每个都有注释 |
| 2 | `electron/preload.ts` 的头 60 行 | 桥的写法；注意 `import type` 的用法 |
| 3 | `electron/ipc/player.ts` | 最短的 IPC 处理器（20 行） |
| 4 | `src/bridge.ts` 的头 60 行 | 浏览器回落为什么必要 |
| 5 | `electron/protocols/media-protocol.ts` | 五个 privilege 各管什么 |
| 6 | `electron/pure/app-paths.ts` | 安全，且可测 |
| 7 | `src/features/library/scan.ts` | 页面侧的编排：订阅、取消、错误处理 |
| 8 | `docs/introduction.md` 的「进程与协议」一节 | 项目自己的说法，对照着读 |

---

## 十、自测

1. 主进程和渲染进程分别能干什么、不能干什么？
2. `contextIsolation: true` 挡住的是什么？
3. 为什么 preload 不应该直接 `exposeInMainWorld('ipc', ipcRenderer)`？
4. `invoke/handle` 和 `send/on` 各自适合什么场景？
5. 订阅类接口为什么必须返回「取消订阅」函数？漏了会怎样？
6. 为什么不用 `file://` 直接播本地音频？（提示：三个理由）
7. `aurora-remote:` 存在的两个必要性是什么？
8. `resolveAppAsset` 里 `startsWith(root + path.sep)` 少了 `+ path.sep` 会怎样？

---

## 十一、练手

**练手 1（30 分钟）**：在 `electron/ipc/library.ts` 里找到 `library:getRoots` 的 handler，写下它从收到请求到返回的完整调用栈（用文件:行号标注）。

**练手 2（40 分钟）**：给 `electron/ipc/player.ts` 加一个 `player:ping` 通道，返回 `'pong'`。同时在 `preload.ts` 里暴露、在 `src/env.d.ts` 里声明、在页面某处调一次并 `console.log`。跑 `npm run typecheck` 与 `npm run dev`，看控制台。**这是你第一次完整穿过桥。**

**练手 3（30 分钟）**：读 `electron/protocols/cache-protocol.ts`，回答：缓存命中时它返回什么？没命中时它做了什么额外的事？

**练手 4（1 小时）**：用 `grep -rn "ipcMain.handle" electron/ | wc -l` 数一下总共有多少通道，再用 `grep -rn "ipcMain.handle" electron/ | sed 's/.*handle(//' | cut -d, -f1 | sort` 看命名规律。你会发现绝大多数是 `域:动作` 格式——命名一致本身就是文档。

---

## 十二、外部读物

- **Electron 官方文档**：「Process Model」「Context Isolation」「ipcRenderer / ipcMain」三篇。**只读这三篇。**
- **Node.js 官方文档**：`fs`、`path` 两个模块的目录级浏览，不用逐条读。
- **《深入浅出 Node.js》**：只读事件循环那一章。

**不要读**：Electron 的安全 checklist 全集（太长且大部分与本项目无关）、`nodeIntegration: true` 的历史教程（已经过时十年）。
