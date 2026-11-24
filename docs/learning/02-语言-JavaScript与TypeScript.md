# 第 1 站：语言 —— JavaScript 与 TypeScript

> 目标：能逐行读懂 `src/features/player/crossfade.ts` 和 `electron/pure/invite-arg.ts`。
> 预计：6–8 周，每天 1 小时。急不得。

---

## 一、要解决什么问题

代码是给两个读者看的：机器，和下一个改它的人。

JavaScript 管「机器怎么跑」，TypeScript 管「改的人别写错」。这一站把这两层分开学，最后合起来。

**只学这些**：值、变量、函数、对象与数组、条件、闭包、模块、`async/await`、类型标注、接口、联合类型。
**这里不用学**：原型链、`this` 的四种绑定、class 继承、生成器、Proxy、装饰器、正则的完整语法。这个项目几乎不用它们；需要时再查。

---

## 二、最小知识

### 1. 程序 = 值 + 名字 + 动作

```ts
const MAX_SWAP_MS = 6000                    // 值：数字
const name = 'Aurora'                       // 值：字符串
const ready = false                         // 值：布尔
const nothing = null                        // 值：空（有意的空）
let count = 0                               // 可改的变量
```

- `const`：名字绑死后不再变。这个项目**默认全用 `const`**，只有在真需要改时才 `let`。
- `let`：可改。见到 `++`、`=` 重赋值就得是它。

为什么这么讲究？因为「可变的范围越小，出错的可能越少」。你以后会读到 `let blockedWrites = 0` 这种少数派，一眼就知道「这里有个会变的东西，留意」。

### 2. 函数：三副面孔

```ts
// 一、普通声明（有名字，会被提升）
export function swapFadeMs(crossfadeSec: number): number { ... }

// 二、箭头函数（常用在回调里）
const fade = (sec: number) => Math.round(sec * 1000)

// 三、对象里的方法简写（这个项目里到处都是）
const localSource: TrackSource = {
  id: 'local',
  streamUrl: (track) => (isNative ? mediaUrl(track.path) : null)
}
```

参数后面的 `: number` 是**类型**，返回类型写在括号后。`=>` 后面没有花括号表示「直接返回这个表达式」。

这个项目里的函数名与注释会告诉你它属于哪一类：

| 名字样式 | 含义 | 例子 |
| --- | --- | --- |
| `useXxx` | React hook，只能在组件里调 | `useTrackActions` |
| `registerXxx` | 注册一些处理器，启动时调一次 | `registerPlayerIpc` |
| `readXxx` / `writeXxx` | 读/写某个持久化状态 | `readRowDensity` |
| `xxxOf` | 从某物算出某值，纯函数 | `modeOf`、`sourceLabelById` |
| `isXxx` / `hasXxx` | 布尔判断 | `isNative` |
| `xxx-pure.ts` | 不碰框架、可裸测的逻辑 | `roam-pure.ts` |

读懂命名，等于免费获得半张地图。

### 3. 对象与解构

```ts
// 定义
const state = { playing: true, volume: 0.85 }

// 取值
state.playing            // true
state.missing            // undefined（不存在不报错）

// 解构：从对象里挑出来
const { playing, volume } = state

// 函数参数里解构
function f({ playing }: { playing?: boolean }) { ... }
```

Electron 的 IPC 处理器就是靠这个：

```ts
// electron/ipc/player.ts:8
ipcMain.handle('player:reportState', (_event, state: { playing?: boolean } | null) => {
  const playing = Boolean(state?.playing)
```

- `(_event, state)`：两个参数，`_event` 下划线开头表示「我收到了但不用」。
- `{ playing?: boolean } | null`：要么是一个可能没有 `playing` 的对象，要么是 `null`。
- `state?.playing`：**可选链**。`state` 是 `null` 时整段变 `undefined`，不炸。
- `Boolean(...)`：任何值转布尔。`undefined` 变 `false`。

这三行值得背下来：**「外部来的数据一律当它可能缺失」**。界面和主进程之间传的东西，永远不可信。

### 4. 数组五件套

这个项目 80% 的数据处理是这五个方法的组合：

```ts
const ids = ['a', 'b']

ids.map((id) => trackById.get(id))      // 逐个变换 → [Track | undefined, ...]
ids.filter((id) => id !== 'b')          // 过滤 → ['a']
ids.find((id) => id === 'b')            // 找第一个 → 'b'（没有则 undefined）
ids.some((id) => id === 'b')            // 有没有符合的 → true
ids.every((id) => id.length > 0)        // 是不是全都符合 → true
```

真实用法，一行就能翻译成中文：

```ts
// src/app/useTrackActions.ts:23-25
const queue = album.trackIds
  .map((id) => trackById.get(id))          // 把 id 换成歌
  .filter((item): item is Track => Boolean(item))  // 把「查无此歌」的洞滤掉
```

注意 `.filter` 里的 `(item): item is Track` 是 **类型守卫**：它不只过滤，还告诉 TypeScript「剩下的都是 `Track`，不是 `Track | undefined`」。没有它，下一行 `player.playQueue(queue, 0)` 就过不了类型检查。

还有 `reduce`（把一串压成一个值）。项目里用得少，见到时按字面理解：`reduce(函数, 初始值)`。

### 5. 条件：早退是美德

```ts
// src/features/player/crossfade.ts:12-15
export function swapFadeMs(crossfadeSec: number): number {
  if (!Number.isFinite(crossfadeSec) || crossfadeSec <= 0) return 0
  return Math.min(Math.round(crossfadeSec * 1000), MAX_SWAP_MS)
}
```

第一行处理所有「坏输入」，第二行只处理正常情况。这叫**卫语句**：把异常挡在门口，主逻辑就不用缩进。

对照 `electron/ipc/player.ts:10` 的另一种写法：

```ts
if (playing === deps.playing()) return true   // 没变化，什么都不做
```

同样是早退——「先问最省事的分支」。

另一个常用形态是三元：

```ts
streamUrl: (track) => (isNative ? mediaUrl(track.path) : null)
// 在桌面版里：给一个私有协议地址；在浏览器预览里：没有
```

本项目三元只写一行内的简单选择。超过一行就写 `if`——可读性优先。

### 6. 闭包：函数会记住它出生时的环境

难懂但一定会遇到。看这段真实代码：

```ts
// src/features/player/store.ts（节选）
let prefsReady = false
let blockedWrites = 0

const guardedStorage = {
  getItem: (name) => createProfileScopedStorage().getItem(name),
  setItem: (name, value) => {
    if (!prefsReady) {
      blockedWrites += 1     // 闭包：这个函数记住了外面的 blockedWrites
      return
    }
    createProfileScopedStorage().setItem(name, value)
  }
}
```

`setItem` 每次被调用，看到的是**同一个** `blockedWrites`。这个变量没人从外面能碰，只活在这些函数之间。这就是闭包的用处：**给一组函数一份私有的记忆**。

再进一步，`useState`、`create()`（zustand）本质都是闭包 + 订阅。第 3 站你会再见到它。

### 7. 模块：import 与 export

```ts
import { ipcMain } from 'electron'                 // 命名导入
import type { PlaybackBridge } from './host'       // 只导类型，编译后消失
import './features/player/actions'                 // 只为副作用：跑一遍，不要任何名字
export function registerPlayerIpc(...) {}          // 命名导出
export default function App() {}                   // 默认导出（本项目少用）
```

三条规则：

1. **`import type`** 只拿类型，不产生运行时代码。项目用它防止「主进程代码漏进页面包」。
2. **副作用 import**（第三条）是「我只要它执行一遍」。这个项目只在极少几处用，且都加了注释说明——因为副作用 import 让依赖关系变隐晦，是双刃剑。
3. 路径 `./host` 是相对当前文件；`../../types` 往上两层。

### 8. 异步：`async` / `await`

有些事要等（读磁盘、发网络请求）。JS 不等——它先往下跑，事办完了再通知你。`async/await` 是让「等」写起来像同步的方式。

```ts
// src/features/library/scan.ts:19-32（节选）
export async function loadInitialIndex(): Promise<void> {
  if (!isNative) return
  try {
    const index = await bridge.library.getIndex()   // 等主进程回话
    useLibrary.getState().setRoots(index.roots ?? [])
    useLibrary.getState().setTracks(index.tracks ?? [])
  } catch (error) {
    useLibrary.getState().setError(error instanceof Error ? error.message : String(error))
  }
}
```

逐个讲：

- `async` 表示「这个函数里会有等待」，它一定返回 Promise。
- `await` 表示「等到结果再往下」。等的时候 CPU 不闲着，别的代码照跑。
- `try/catch` 抓错误。异步里的错误**必须**这么抓，否则就是「控制台一条未处理拒绝，界面毫无反应」。
- `index.roots ?? []`：**空值合并**。左边是 `null` 或 `undefined` 才用右边；`0` 和 `''` 都算有值。它和 `||` 的区别很重要：`0 || []` 会变成 `[]`，`0 ?? []` 还是 `0`。
- `error instanceof Error ? error.message : String(error)`：错误可能是任何东西，先判断再用。

**异步是这个项目的心脏。** 播放器要等音频流、扫描要等磁盘、在线平台要等接口。第 4 站的 IPC 全是异步的。

---

## 三、TypeScript：类型到底在干嘛

一句话：**类型在编译时检查，运行时全部擦掉。** 它不保护你，保护的是明天的你。

### 1. 基本标注

```ts
const n: number = 1
const s: string = 'x'
const b: boolean = false
const list: string[] = ['a']
const maybe: string | null = null           // 联合：字符串或空
const fn: (x: number) => number = (x) => x
```

多数时候 TypeScript 能自己推出来（`const n = 1` 就够了），标注留给**函数边界**和**数据结构**。

### 2. 接口：描述一个对象的形状

```ts
// src/app/routing.ts:10-15
export interface Route {
  view: ViewId
  artistId?: string
  albumId?: string
  playlistId?: string
}
```

`artistId?` 的问号表示「这个字段可以不存在」。读接口就是在读一个对象能长什么样。

### 3. 联合类型：让不可能的状态写不出来

```ts
// src/types.ts:7 起（节选）
export type ViewId =
  | 'discover'
  | 'albums'
  | 'artists'
  | 'playlists'
  | 'accounts'
  | 'sources'
  | 'settings'
  | ...
```

`ViewId` 只能是这些字符串之一。写错一个字母，编译器立刻红。这比「运行时发现页面白屏」便宜得多。

项目里最常见的联合形态是「状态机」：

```ts
'idle' | 'starting' | 'ready' | 'error' | 'offline'
```

五种状态，一眼看完，不会有第六种偷偷存在。

### 4. 泛型：类型的参数

```ts
Map<string, Track>        // 键是字符串，值是 Track
Promise<void>             // 一个还没完成、完成后没有返回值的操作
ReadonlyMap<string, ReadonlySet<string>>   // 只读的映射，值是只读集合
```

读法：**`X<Y>` = 一个 X，里面装的是 Y**。不需要会写泛型，先会读就够。

### 5. `as const` 与字面量

```ts
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
```

`as const` 表示「这个数组不打算改，而且里面的值是精确的字面量」。这样 TypeScript 能推出「长度 10 的只读元组」，而不是「随便什么数字的数组」。

### 6. `strict: true` 意味着什么

项目两个 tsconfig 都开了 `strict`。它对新手最直接的影响是：

- 可能为 `null`/`undefined` 的东西，**不判就用会报错**。
- 这就是为什么项目里满地 `?.` 和 `??`。不是啰嗦，是编译器的要求。

看到「Object is possibly 'undefined'」不要烦，它在替你挡一次线上崩溃。

---

## 四、项目锚点

按顺序读，每个都短：

| 顺序 | 文件 | 行数 | 学什么 |
| --- | --- | --- | --- |
| 1 | `electron/pure/invite-arg.ts` | 12 | 最短的完整模块：正则、`find`、`replace`、返回 `string \| null` |
| 2 | `src/features/player/crossfade.ts` | 15 | 卫语句、`Math.min/Math.round`、数字边界 |
| 3 | `tests/crossfade.test.ts` | 20 | 测试就是一个函数 + 断言，读起来像句子 |
| 4 | `src/app/routing.ts` | 15 | 接口、可选字段、纯类型文件 |
| 5 | `electron/ipc/player.ts` | 20 | 参数解构、可选链、`Boolean()`、依赖注入（`deps`） |
| 6 | `src/features/library/scan.ts` | 100+ | `async/await`、`try/catch`、模块级状态 |
| 7 | `src/types.ts` | 200+ | 领域模型全貌，当字典翻 |

读第 6 个时别逐字啃，只看函数头和 `await` 的位置。

---

## 五、自测

1. `const` 和 `let` 的区别？项目为什么几乎只用 `const`？
2. `state?.playing` 在 `state` 为 `null` 时得到什么？`Boolean()` 之后呢？
3. `a || b` 和 `a ?? b` 在 `a = 0` 时结果一样吗？
4. `.filter((item): item is Track => Boolean(item))` 里，`item is Track` 有什么用？删掉会怎样？
5. `import type` 和普通 `import` 编译后有什么不同？
6. `await` 后面跟的函数一定返回什么？
7. 为什么 `try/catch` 在异步代码里不能省？

---

## 六、练手

**练手 1（30 分钟）**：不看答案，把 `crossfade.ts` 默写一遍。然后跑 `node --test tests/crossfade.test.ts` 验证。

**练手 2（20 分钟）**：给 `swapFadeMs` 加一条边界测试——输入 `0.0005`（半毫秒），你希望得到什么？先写下期望，再加测试，跑，看是否一致。

**练手 3（40 分钟）**：打开 `electron/ipc/player.ts`，用中文给每一行写注释，写在一个临时文件里。然后对照 `docs/architecture.md` 里关于「播放状态镜像」的说法，看有没有理解偏差。

**练手 4（1 小时）**：找 `src/features/player/queue.ts`，只读它的 `export` 行（`grep -n "export" src/features/player/queue.ts`）。用一句话说出每个函数干什么。读不懂的先跳过——这个文件是第 4 站的内容。

---

## 七、外部读物（挑两样，别贪）

- **MDN 的 JavaScript 指南**：只读「JavaScript 第一课」「函数」「对象」「数组」「Promise」五篇。
- **TypeScript 官方 Handbook**：只读「Everyday Types」「Narrowing」两章。
- **《你不知道的 JavaScript》**：读闭包那一章。读不懂就放下，第 3 站回来再读。

**不要读**：任何「从原型链讲到柯里化」的完整教程。这个项目不用那些，学了也会忘。
