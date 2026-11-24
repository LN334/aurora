# Aurora 动效实验室

一个不依赖框架、双击即开的可交互示范站，用来把「其他软件的页面动画 / 切屏动画 / UI 动画」翻译成 Aurora 自己的语言。
**它不改 Aurora 一行代码**，只是把动效参数、时序、交互都做成能上手摸的样子，看顺了再往主工程搬。

打开：`docs/motion-lab/index.html`（file:// 直接跑，无构建、无服务）

直接看某一页：

| 地址 | 页面 |
|---|---|
| `index.html` | 首页 · 每日推荐扇形 + 三分区 + 精选栏 |
| `index.html?v=playlists` | 歌单网格（透视卡片） |
| `index.html?v=stage` | 播放舞台（唱片 + 可视化 + 歌词） |
| `index.html?v=detail` | 歌单详情（档案头部 + 曲目） |

右上「动效」面板可逐项关掉，用来对比「有」和「没有」的差别：

- **切页扫光** — 关闭后换页只剩淡入
- **卡片 3D 倾斜** — 关闭后 hover 不再跟指针
- **手绘层** — 关闭后标题下划线、纸屑不出现
- **颗粒质感** — 关闭后整层噪点消失
- **节拍** — 关闭后 `--beat` 不再跳，唱片与封面停止呼吸
- **慢放 ×4** — 所有时长 ×4，用来看清 90 ms 的触感到底做了什么

操作：滚轮在扇形上转、点侧边封面把它转到中间、点卡片飞进详情、空格播放、`←/→` 转扇形、`1–4` 切页。

---

## 一、这一版落地的动效语言

### 1. 时间是一条带方向的谱，不是一个数

当前 Aurora 的时长集中在 120 ms（56 处）和 140 ms（40 处），等于所有动作一样快，所以「没有层次」。
示范站把距离拆成五档，写进 `:root`，全部再乘一个 `--sp`（慢放开关）：

| 令牌 | 值 | 用在哪 |
|---|---|---|
| `--t-press` | 90 ms | 按下反馈（卡片、按钮、唱片） |
| `--t-track` | 120 ms | 指针跟随（hover、高亮） |
| `--t-near` | 200 ms | 菜单、Toast、小浮层 |
| `--t-mid` | 320 ms | 面板、详情展开 |
| `--t-far` | 520 ms | 整页/整层转场 |
| 环境层 | 1.4–5.4 s | 极光帘幕、唱片呼吸（不是过渡，是常驻节奏） |

### 2. 三条曲线，跟 Aurora 现有的不是一回事

```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);   /* 一脚到底，绝大多数出场 */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 会过头一点，用于按下/吸附 */
--ease-dock:   cubic-bezier(0.32, 0.72, 0, 1);   /* 收尾很重，用于浮层落位 */
```

关键差别：Aurora 现有的 `--ease-out` 是 `(0.22, 0.61, 0.36, 1)`，第二控制点 y=0.61，起步慢；同样是 `0.22, 1, 0.36, 1` 的那条是**先冲出去再收住**——这就是 Folia、folia-major、Twilight_Echo 三家的公共曲线。

开慢关快：进场用 420/520 ms，退场一律 280 ms 左右。人眼对「出现」有耐心，对「消失」没耐心。

### 3. 切页：两个对象交叉，不是一个对象淡入

Aurora 现在是 `<div className="main__body" key={view + ':' + id}>`——React 换 key 直接重建，旧页一帧消失，所以永远只有「新页淡入」，看不出「切」。
示范站的切法是：新页 `translateY(14px) scale(.985) → 0` 220 ms，旧页同时 `opacity → 0`（若有），再加一道 520 ms 的斜向扫光从左上扫过。**旧页必须还在**，交叉才有「切」的体感。

### 4. 首页主视觉：扇形沿轨道排，运动带惯性

每日推荐那排封面同时用了两件事：

- **构图是扇形**（参考 Aurora 现有首页 + 用户给的存档界面）：中间最大正面，两侧按 `rotateZ ± ad*10°`、`scale 1-0.13*ad`、`opacity 0.97-0.145*ad` 递减收进去。
- **运动是轨道**：位置不是「第 i 张的固定坐标」，而是一个连续浮点 `pos`，`d = i - pos`；每帧 `pos += (target - pos) * 0.16`，卡片沿椭圆弧滑动。滚一次 = target ±1，滑过去而不是跳过去。
- 位置方程 `x = sin(d*0.285)*356`、`y = (1 - cos(d*0.285))*124`——正好是椭圆 (356, 124) 的下半弧，所以底下那条淡环是真的「它们排在这条弧上」，不是装饰。
- 每张再 `rotateY(-d*12.5°)` 朝环心偏一点，配 `perspective:1400px`，中间与两侧的纵深差就出来了。

### 5. 歌单网格：真透视，但只有一层

`.grid { perspective: 1200px }`，卡片 `rotateX/rotateY` 由指针在卡片内的归一化坐标驱动（最大 ±9°/±11°），`translateZ(0)` 留在平面上，hover 时整卡 `translateZ(18px)`。
**不要 `preserve-3d`**：一旦开了，卡内所有 `position:fixed` 子元素都会以卡片为定位祖先，弹层会错位。Aurora 的 `shellBlockIn` 只敢做 opacity 就是这个坑。

### 6. 卡片飞进详情：FLIP

点卡片时取起点矩形 → 目标页封面矩形 → 用一个 fixed 的 `.fly-ghost` 从起点 WAAPI 飞到终点（460 ms，`--ease-out`），真卡片先 `opacity:0`，落地再换。这是「同一件东西移动了」的唯一廉价做法。

### 7. 极光层：形学极光，色守自己

Aurora 的设计前提是「the shell carries no colour of its own，唯一的彩色来自封面」。
所以极光只借形态，不借颜色：

- **帘幕**：`repeating-linear-gradient(90deg, …)` 竖纹 + `blur(10px)` + 上实下虚的 `mask-image`，26 s 横向漂移一次（一像素级都不显眼，但画面不死）。
- **蠕动**：两层正弦（6.1 与 13.7 频率）叠出「光的下缘」，相位随时间走，永远不重复。
- **脉动**：`--beat` 由 118 BPM 的节拍器写，封面 `scale(1 + var(--beat)*0.03)`，90 ms linear 跟随。
- **无硬边**：所有退场用 blur + brightness 衰减，不用纯 opacity。
- **两重时间尺度**：手的动作 90–120 ms，光的动作 600–1200 ms；两者不能同一条曲线。

### 8. 手绘层

标题下划线的 `stroke-dashoffset` 0.6 s 描出、纸屑层 20–30 粒 60–120 s 漂移。这一层只负责「有人的痕迹」，不承载信息。

### 9. 质感层

整屏叠一层 SVG `feTurbulence` 颗粒（baseFrequency ≈ .95，opacity 3–5%），把纯数字的平坦感压掉。参考 RhineLabUI 的 `screen-finish.ts`。

---

## 二、搬到 Aurora 的对照表

| 示范站里的 | 落到 Aurora 的 |
|---|---|
| `styles.css` 的令牌段 | `src/styles/tokens.css:107-115` 旁边加 `--ease-out-quint` / `--ease-spring` / `--ease-dock` / 五档时长 |
| `fanGeom` + `pos` 惯性 | 新建 `src/ui/page-transition.ts` 的噪声与时间轴（已实现），首页「每日推荐」换成分区组件 |
| `.sweep` 切页扫光 | `src/styles/app.css:2052-2107` 的 `pageIn` 换掉；或 `src/App.tsx:461-474` 的 `is-enter` 逻辑改造 |
| 双页交叉 | `src/App.tsx:1322` 的 `key` 保留（用于数据隔离），另加一个 `cloneNode` 的 fixed 退场层 180–200 ms |
| `.fly-ghost` FLIP | 新建 `src/ui/page-transition.ts`（已实现）；接 `PlaylistsPage` → `PlaylistDetailPage` |
| `.grid` 透视 | `src/styles/app.css` 歌单网格段；注意别开 `preserve-3d` |
| 极光 `.sky` | `src/features/wallpaper/Backdrop.tsx` 或新建 `src/ui/page-transition.ts` 的帘幕段（已实现）（写在 `--accent-rgb` 上） |
| `--beat` | `src/stage/levels.ts:26` 的 `createLevelReader` 已有 112 段电平，把 `levels` 写成 `:root` 变量即可复用 |
| 手绘层 / 颗粒 | 新建 全局质感层（未做）（一个 `<svg><filter>`） |
| 6 个开关 | `src/features/settings/motion.ts` 从布尔扩成 `full/reduced/custom` + 逐项 key（参考 RhineLabUI 的 14 个 MotionKey） |

---

## 三、这一版没做的（有意留白）

- 真实音频分析：现在节拍是定时器模拟。真接要 `AnalyserNode`，而跨源音频会让 `createMediaElementSource` 静音，得只在本地音源上开。
- 3D 场景（Three.js）：示范站全用 CSS 3D + canvas 2D。播放页「一个盒子」式的 3D 舞台另议。
- 设置页、搜索、桌面歌词页的动效。
- 入场序列（启动镜头）：这版没有，因为每次打开都演一遍会烦。

---

文件：`index.html`（结构）、`styles.css`（令牌 + 视觉）、`app.js`（数据 + 交互）、`assets/cover1-8.jpg`（同一张极光照片切的 8 个区段，调性统一）。
