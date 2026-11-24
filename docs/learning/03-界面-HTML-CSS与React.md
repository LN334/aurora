# 第 2 站：界面 —— HTML、CSS 与 React

> 目标：能在一个页面里改文案、改配色、改布局，且知道为什么改完不崩。
> 预计：6 周，每天 1 小时。

---

## 一、要解决什么问题

界面 = 结构（HTML）+ 样式（CSS）+ 行为（React）。

这个项目的界面有个特点：**它是一层玻璃，颜色全部来自封面**。听起来玄，实现起来非常朴素：一堆 CSS 变量 + 一个 `--accent` 被封面主色改写。学完这一站你就看得懂那套机制。

**只学这些**：标签与属性、盒模型、flex、CSS 变量、类名约定、React 组件/props/state/列表/hooks。
**这里不用学**：grid 的高级用法、CSS 动画时间曲线理论、`float`、表格布局、React 的 class 组件、Redux、Next.js、SSR。这个项目都不用。

---

## 二、HTML：结构

### 1. 元素、属性、嵌套

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

- `<div>` 是「一个块」，`id="root"` 给它名字。React 会把整个应用塞进这个 `#root`。
- `<script type="module">` 表示这是一个 ES 模块，浏览器按模块规则加载。

这个项目里 HTML 只有三个文件：`index.html`（播放器）、`overlay.html`（桌面歌词窗）、`chat.html`（一起听的聊天窗）。三份文档对应三个独立的 BrowserWindow，各自加载各自的入口。**这是理解「一个应用可以有多页」的第一个例子。**

### 2. `index.html` 里那段吓人的 CSP

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; img-src 'self' data: blob: file: aurora-media: aurora-remote: ..." />
```

翻译：**默认只准加载自己人；图片额外允许 data:/blob:/file: 和几个私有协议。**

这不是装饰。它拦的是「网页被注入一段脚本，把用户文件偷走」。看到 `aurora-media:` 这种奇怪的东西，说明主进程注册了一个自定义协议——第 4 站讲。

新手常犯的错：加了个 CDN 字体，界面不显示，控制台报 CSP 违规。修法是改这张白名单，不是关掉 CSP。

### 3. 语义标签没那么重要，但别乱来

项目里 `<div>` 用得多。这不是罪——桌面应用不是网页，没有爬虫与读屏器的强需求。但 `<button>` 必须是 `<button>`（键盘能聚焦、能回车触发），这个是行为不是语义。

---

## 三、CSS：样式

### 1. 选择器与类名约定

```css
/* 元素选择器 */
div { ... }

/* 类选择器（最常用） */
.rh-card { ... }

/* 组合：类 + 状态 */
.trk.is-current { ... }

/* 伪类 */
.rh-card:hover { ... }
```

这个项目的类名有固定的命名味道：

```
.rh-card              区块
.rh-card__art         区块里的一个零件（双下划线）
.rh-card.is-sk        同一个区块的某种状态（is-xxx）
```

不用背 BEM 理论，只需知道：**双下划线表示「属于」，`is-` 表示「处于」。** 看到 `.trk.is-playing` 就知道是「列表行处于播放中」。

### 2. 盒模型：一图胜千言

每个元素都是一个盒子，从里到外四层：

```
content（内容）
  padding（内边距）
    border（边框）
      margin（外边距）
```

`box-sizing: border-box` 表示「宽高包含 padding 和 border」。项目全局这么设了（见 `src/styles/app.css` 开头），所以你写 `width: 200px` 就是 200px，不用算内边距。

### 3. flex：这个项目的布局主力

```css
.row {
  display: flex;            /* 变成一行的容器 */
  align-items: center;      /* 垂直居中 */
  gap: 12px;                /* 孩子之间留 12px，不用 margin */
}

.row > .grow {
  flex: 1;                  /* 占满剩余空间 */
}
```

记住四个属性就够用九成：`display:flex`、`align-items`、`justify-content`、`gap`。**不要再用 `float` 和绝对定位做常规排版。**

### 4. CSS 变量与设计令牌

这是本项目的核心。`src/styles/tokens.css` 开头自己说了：

```css
/* src/styles/tokens.css:1-16（节选）
   这一版只定三件事：
     1. 一条灰阶 --ink-1000..500，深色从深到浅、浅色从浅到深，角色不变；
     2. 一层玻璃 --wp-glass（壁纸模式四块面共用的不透明度）+ --wp-blur；
     3. 三个文字档 --text-hi/mid/low，深浅各一套，别处不再单独抬。
   组件只认令牌。换主题、开关壁纸都不需要改组件规则。 */
```

变量长这样：

```css
:root {
  --ink-900: rgb(11 14 18);
  --text-hi: #eef2f7;
  --text-mid: #a8b2bf;
  --accent: #7d8899;
}
```

用起来：

```css
.panel {
  background: var(--ink-900);
  color: var(--text-hi);
}
```

好处：改一处，全站变。这个项目换主题、换壁纸模式、封面主色驱动强调色，全靠改这几个变量的值，组件规则一行不动。

**硬规则**（`docs/ui-design.md` 也写了）：改界面前先看 `tokens.css`，颜色只从令牌取，不要写死 `#ffffff`。

### 5. 为什么 CSS 有 1.6 万行、19 个文件

因为按页拆：`shell.css`（外壳）、`player.css`（播放条与播放页）、`panels.css`（各种弹层）、`roam.css`、`overlay.css`……

`app.css` 是老的「大本营」，仍有很多规则；新页优先写进自己的文件。看一个 CSS 类不知道在哪，用 `grep -rn "类名" src/styles` 找。

---

## 四、React：行为

### 1. 组件就是一个返回 JSX 的函数

```tsx
// 极简版，不是项目原文
function Hello({ name }: { name: string }) {
  return <p>你好，{name}</p>
}
```

- 函数名首字母大写 → React 认为是组件。
- `{name}` 是插值，把变量塞进 JSX。
- 参数是一个对象，习惯叫 `props`。这里直接解构成了 `{ name }`。

真例子，读一遍就知道组件能长什么样：

```tsx
// src/ui/EmptyState.tsx（节选）
export function EmptyState({
  icon, title, hint, action, stage = false
}: {
  icon?: ReactNode
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  stage?: boolean
}) {
  if (stage) {
    return (
      <div className="pg-stage">
        <div className="pg-stage__field" aria-hidden="true">
          <i className="pg-stage__band pg-stage__band--a" />
          ...
        </div>
        {action ? <div className="pg-stage__act">{action}</div> : null}
      </div>
    )
  }

  return (
    <div className="pg-empty">
      {icon ? <span className="pg-empty__icon">{icon}</span> : null}
      {title ? <h2>{title}</h2> : null}
      ...
    </div>
  )
}
```

学到四件事：

1. **props 全是可选**（`icon?`），组件要能在「什么都不给」时也不崩。
2. **条件渲染用三元**：`{action ? <div/> : null}`。没东西就不渲染，不是渲染一个空壳。
3. `className` 不是 `class`（JSX 的规矩）。
4. `stage = false` 是**参数默认值**，调用方不传就是 false。

### 2. props 向下，事件向上

这是 React 唯一的心智模型：

- 父组件把数据**传下去**（props）。
- 子组件想改东西，**调父组件传下来的函数**（回调）。

```tsx
// 父
<TrackList tracks={tracks} onPlay={(id) => player.play(id)} />

// 子（内部某处）
<button onClick={() => onPlay(track.id)}>播放</button>
```

子组件永远不直接改父组件的数据。这个项目里 `src/ui/TrackList.tsx` 的 props 就明确写着「Starts the whole list at this position」——列表只负责「告诉外面点了第几首」，不负责播放。

### 3. 列表渲染与 key

```tsx
{tracks.map((track) => (
  <TrackRow key={track.id} track={track} />
))}
```

`key` 是 React 认人的凭据。**必须用稳定且唯一的值**（歌曲 id、文件路径），不要用数组下标——重排后下标会变，React 会把「A 的输入框状态」错挂到 B 上。

项目里遇到没 id 的占位列表才用下标：

```tsx
// src/ui/Skeleton.tsx
{Array.from({ length: count }, (_, at) => (
  <div className="rh-card is-sk" key={'sk-card-' + at} aria-hidden="true">
```

因为骨架永远不重排、不带状态，用下标安全。这是「知道规则、也知道何时例外」的例子。

### 4. state：组件自己的记忆

```tsx
const [open, setOpen] = useState(false)
```

- `open` 是当前值，`setOpen` 是改它的唯一途径。
- 调 `setOpen(true)` 之后，`open` **不会立刻变**——React 会重跑这个组件函数，新一次执行时 `open` 才是 true。

这是新手最困惑的一点：**你读到的 state 永远是「这一次渲染」的旧值。**

### 5. useEffect：跟外部世界同步

```tsx
useEffect(() => {
  const unsubscribe = window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])
```

三件事：

1. 组件挂载后跑一次（依赖数组为空）。
2. 返回值是「清理函数」，组件卸载时跑。
3. 依赖数组里的值变了就跑。**漏写依赖 = 闭包抓到旧值**，是这个项目注释里反复出现的坑。

严格说，**能不写 useEffect 就别写**。React 官方近年一直在说这句话：事件驱动的事放事件里，派生数据用 `useMemo`，不要用 effect 去「同步」两个 state。

### 6. `useMemo` / `useCallback`：缓存计算结果

```tsx
const sorted = useMemo(() => [...tracks].sort(byTitle), [tracks])
```

只有 `tracks` 变了才重算。这个项目大量使用，原因在 `docs/perf-baseline.md`：列表可能有几千行，每帧重排是致命的。

新手不必急着优化。看到它们时理解为「记住上次的结果」。

### 7. 自定义 hook：把逻辑抽出来复用

`useTrackActions`、`useKeyboardShortcuts`、`useDownloads`……文件名字带 `use` 的都是。

这**不是魔法**，就是一个「名字以 use 开头、内部可以调用别的 hook」的普通函数。它把「读状态 + 算东西 + 返回结果」打包，让页面文件只管画。

`src/features/settings/row-density.ts` 是一个极好的完整案例：一个设置项，从 localStorage 读到 CSS 变量，中间用 `useSyncExternalStore` 让 React 跟上。学到这里可以整篇读它（约 120 行）。

---

## 五、项目锚点

| 顺序 | 文件 | 看什么 |
| --- | --- | --- |
| 1 | `src/styles/tokens.css` | 全部变量定义，前 60 行 |
| 2 | `src/ui/EmptyState.tsx` | props、条件渲染、两种形态 |
| 3 | `src/ui/Skeleton.tsx` | 列表渲染、`Array.from`、为什么用下标做 key |
| 4 | `src/styles/app.css` 开头 | 全局 box-sizing、滚动条、字体栈 |
| 5 | `src/features/settings/row-density.ts` | 一个设置项的完整生命周期 |
| 6 | `src/views/HomePage.tsx` | 真页面长什么样（大，先看 import 与 return 的骨架） |
| 7 | `docs/ui-design.md` | 项目自己的界面规则，20 分钟读完 |

---

## 六、自测

1. `.rh-card__art` 里的双下划线是什么意思？`.trk.is-current` 呢？
2. `box-sizing: border-box` 让 `width` 包含了什么？
3. `display: flex` 之后，`gap` 和 `margin` 有什么区别？
4. 为什么颜色不能写死 `#fff`，要写 `var(--text-hi)`？
5. `useState` 里 `setOpen(true)` 之后，同一段代码里 `open` 是 true 吗？
6. 为什么列表的 `key` 不能用数组下标？
7. `useEffect` 的依赖数组漏了一项会发生什么？
8. props 和 state 的区别？（提示：谁给的、会不会触发重渲染）

---

## 七、练手

**练手 1（30 分钟）**：打开 `src/styles/tokens.css`，把 `--accent` 临时改成红色，`npm run dev` 看变化。然后改回来。你会看到「封面主色」在播放时把它盖掉——想清楚为什么（提示：搜 `--accent` 被 set 的地方）。

**练手 2（30 分钟）**：给 `EmptyState` 加一个 prop：`tone?: 'normal' | 'danger'`，danger 时给根节点加一个 `is-danger` 类。只改 TSX，不改 CSS。跑 `npm run typecheck` 确认类型没问题。

**练手 3（1 小时）**：读 `src/ui/TrackList.tsx` 的 `interface TrackListProps`，用中文列出每个 prop 的含义。读不懂的（比如 `onlinePlaylist`）先猜，然后去调用它的页面里找证据。

**练手 4（40 分钟）**：打开 `src/styles/shell.css`，用 `grep -n "\.rail" src/styles/shell.css` 定位左侧栏的样式，找出它的宽度、内边距、以及在窗口变窄时怎么变（搜 `@media`）。用一句话总结：这个侧栏有几个响应档位？

---

## 八、外部读物

- **MDN「CSS 布局入门」**：只读 flex 那篇。
- **React 官方教程（react.dev）**：「Quick Start」「Thinking in React」「Describing the UI」三篇。**不要读 class 组件那一章。**
- **Josh Comeau《CSS for JavaScript Developers》**：如果愿意花钱，这是目前最好的 CSS 教材；只买，别硬啃全本。

**警告**：不要去看「CSS 100 个技巧」「React 面试八股」。这一站的目标是**看懂这个项目的界面代码**，不是成为样式大师。
