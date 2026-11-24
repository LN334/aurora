# Aurora 动效改造方案（布局不动版）

> 前提：**保持 Aurora 现有布局**。首页分区、左栏、播放条、详情页结构一律不改。
> 只做三类东西：① 切页动效 ② 打开歌单的动效 ③ 少量细节（歌单页头、卡片手感）。
> 参照的图：扇形封面墙（已在产品里）、游戏存档界面的手绘与档案排版、动效开关。
> 本文只是方案，**未改任何代码**。

---

## 0 先说三件已经成立的事，免得重复造

1. **首页那个扇形不用重做。** `src/features/discover/DiscWall.tsx`（12 KB）已经是完整实现：九个固定槽位、连续 `pos`、速度模型 + 弹簧收尾（`SPRING_K=190 / SPRING_C=14`，ζ≈0.36）、滚轮/拖拽/方向键、取模循环、零重渲染。它比外面的开源实现都细。**这块一行不用动。**
2. **布局不改。** 我上一版演示站（`docs/motion-lab`）里的整宽 hero、右侧精选栏、三分区重排，全部**不采纳**，那只是参数试验台。
3. **View Transition 不走。** `src/App.tsx:157-170` 已经记录过失败原因：新旧页整页快照的 scrollTop 不同，对不齐，上半截新页下半截旧页。这个结论继续有效，下面的方案不碰它。

---

## 1 令牌：只加四条，不动老的

`src/styles/tokens.css:107-115` 现有：

```css
--ease-out:   cubic-bezier(0.22, 0.61, 0.36, 1);
--ease-spring: cubic-bezier(0.18, 0.89, 0.24, 1.03);
--dur-1/2/3/4: 120 / 200 / 320 / 460 ms;
```

**新增（老的保留，新动效才用）：**

| 令牌 | 值 | 用在哪 | 为什么 |
|---|---|---|---|
| `--ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | 切页、飞行、面板 | 和老 `--ease-out` 差在第二控制点 y：0.61 → 1。起步一脚到底，这是 Folia / folia-major / Twilight_Echo 三家的公共曲线 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 按下回弹、吸附 | 会过头一点，手感用 |
| `--t-press` | 90 ms | 按下反馈 | 现有最短 120 ms，按下去没有「咔」的感觉 |
| `--t-far` | 520 ms | 整页/整层 | 现有最长 720 ms 但没人用，实际换页只有 320 ms |

---

## 2 切页动效（重点）

### 现状为什么「感觉不到」

`src/App.tsx:1322`：

```tsx
<div className="main__body" key={shell.view + ':' + (shell.id ?? '')}>{body()}</div>
```

换页时 key 变 → React 卸载旧树、挂新树 → **旧页在一帧内消失**，能动的只剩新页自己（`pageIn`：opacity .35→1 + translateY 28→0，320 ms）。
一个物体自己淡入，人的解读是「加载完了」，不是「切换了」。**必须有第二个物体。**

### 做法：加一个退场快照层，不碰 key

```
点击导航
  ├─ 1. 抓当前 .main__body 的 rect + scrollTop
  ├─ 2. cloneNode(true) 一份，塞进 #page-ghost（position:fixed，同 rect，overflow:hidden，
  │      内部按 -scrollTop 偏移，pointer-events:none，aria-hidden）
  ├─ 3. 切换 shell 状态（key 重建，新页照旧）
  ├─ 4. 新页 .is-enter：opacity .55→1、translateY 10px→0、240 ms --ease-out-quint
  ├─ 5. ghost 同时：opacity 1→0、scale 1→0.994、filter blur(0→2px)、180 ms --ease-out-quint
  └─ 6. #page-sweep 一道 45° 高光从 -20% 扫到 120%，520 ms，延迟 60 ms
```

**为什么这次不会再踩 View Transition 的坑**：ghost 不是「旧页继续存在」，是「旧页正在离开的一张照片」——它不需要和下面的新页对齐，因为它 180 ms 内就没了。当初失败的是让**两个真页面**同时在场并对齐。

**改动点（三处）**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `src/App.tsx` | `commitPageChange` 附近 | 切换前置快照；切后 180 ms 移除 |
| `src/App.tsx` | `:461-474` 的 `is-enter` 逻辑 | 时长 320→240，位移 28→10 |
| `src/styles/app.css` | `:2052-2107` `pageIn` | 换成新的 `pageIn`；新增 `#page-ghost` `#page-sweep` 样式 |

**参数依据**：交叉窗口 ≈ 120 ms（新页先进 60 ms，ghost 再退），人眼在这个窗口里看到的是「两页叠着错开」，不是「闪一下」。扫光只在 520 ms 里走一遍，斜率 18°，不改变任何布局。

**减少动效时**：不建 ghost、不跑 sweep，只保留新页 opacity 淡入（等于现状）。

---

## 3 打开歌单的动效（卡片 → 详情）

### 做法：一张封面飞过去，页头逐项落地

```
点 .pl-card
  ├─ 1. 取 .rh-card__art 的 rect
  ├─ 2. 建 .fly-ghost：position:fixed，从那个 rect 开始，background 用同一张封面
  ├─ 3. 立即导航（key 重建，详情页照常渲染）
  ├─ 4. 详情页 .dp__art 的 rect 拿到，WAAPI 把 ghost 从起点矩形飞到终点矩形
  │      460 ms，--ease-out-quint，途中 border-radius 12→12、scale 略过冲 1.01
  ├─ 5. ghost 落地那一帧设 opacity 0，同时 .dp__art 的 opacity 0→1（只在 200 ms 内）
  └─ 6. 页头逐项入场：kicker → 标题 → meta → 分隔线 → stats → 操作行
         每项 40 ms 错开，各 180 ms，opacity 0→1 + translateY 8→0
```

**为什么用 FLIP 不用 View Transition**：VT 要两个真页面在场并对齐；FLIP 只需要两个矩形，中间一个 fixed 的假元素，没有对齐问题。`app.css:1994` 的 `view-transition-name: playlist-cover` 可以删掉或留着不用。

**返回**：同样反向飞。如果来源卡片不在视口里（用户滚过或从别处进来），就不飞，只做页面退场。

**曲目表**：首屏前 8 行按 22 ms 错开入场，只做一次。不做无限交错——那是「慢」的观感，不是「好」。

---

## 4 卡片手感（全局，很小）

现有 `.rh-card` 有 hover 位移和按下缩放，但：

| 项 | 现在 | 改成 |
|---|---|---|
| hover 抬升 | 时长 200 ms（`--dur-2`） | 200 ms 不变，曲线换 `--ease-out-quint` |
| 按下 | `scale(0.978)` 140 ms | `scale(0.985)`，**90 ms**（`--t-press`） |
| 封面内缩 | 无 | hover 时封面 `scale(1.02)`，200 ms |

### 指针 3D 倾斜（默认关，设置里开）

就是你截图里那个开关「卡片倾斜 / 指针跟随的 3D 浮起」。

- `.pl-grid` 和专辑墙加 `perspective: 1200px`
- 只有**当前 hover 的那一张**写 `rotateX/rotateY`（最大 ±8° / ±10°），离开重置
- **不开 `preserve-3d`**：一开，卡内所有 `position:fixed` 子元素会以卡片为定位祖先，弹层全错位（`shellBlockIn` 只敢做 opacity 就是这个坑）
- 设置项写进 `src/features/settings/motion.ts`

---

## 5 歌单详情页头（细节，照你发的那张）

只改 `src/views/DetailHero.tsx` 的**呈现**，不改结构，所以专辑/艺人/歌曲三页同时受益。

现在：

```
[kicker 歌单]
[标题（可编辑）]
[meta: 16 首 · 63 分钟]
[播放全部] [导出 m3u]
[stats: 曲目 16 / 时长 63 分钟]
```

改成：

```
PLAYLIST // 歌单                      ← kicker 中英双写（kicker 传 <span> 或加 prop）
极夜                                  ← 标题原样（仍是可编辑 input）
────────────────────────────────      ← 手绘锯齿线，0.6 s 描出（SVG stroke-dashoffset）
曲目      时长        来源            ← stats 加「来源」：本机 / 网易云 / QQ
16 首     63 分钟     本机
◆ PLAY // 播放全部     ← RETURN // 返回
```

三处改动：
1. `kicker` prop 支持 ReactNode（已是 ReactNode，只要页面传字符串改一下）
2. `stats` 增加一项「来源」，从 `playlist` 的 provider 字段读
3. 操作行加一个「返回」，图标用 `←`，文案 `RETURN // 返回`

手绘锯齿线单独做一个 JaggedRule 组件（**已实现又删除**：preserveAspectRatio 取 none 会把 400 单位宽的折线拉到 1400px，折点间距变成 65px、起伏只剩 1px，锯齿消失成一条平线）。标题与 meta 之间的分隔改由 .dp__m 的 margin-top 空白承担。

**边界**：只做细节，不动大图位置、不动 stats 的横排方式、不动标题的可编辑行为。

---

## 6 设置项（把开关做成真的）

`src/features/settings/motion.ts` 现在是布尔（`aurora.motion.reduced`）+ 宿主的 `prefers-reduced-motion`。

扩成三档 + 逐项：

```ts
type MotionLevel = 'full' | 'reduced' | 'custom'
type MotionKey   = 'pageTransition' | 'openDetail' | 'cardTilt' | 'handDrawn' | 'ambient'
```

- 存储：`aurora.motion.v2 = { preset, keys }`，**读旧布尔迁移一次**（旧 true → reduced）
- 面板：每项一行，标题 + 一句说明（就是你截图那个形状）
- `custom` 时逐项开关；`reduced` 时全部关；`full` 时全开

---

## 7 分期

| 期 | 内容 | 估时 | 验收 |
|---|---|---|---|
| 一 | 令牌 4 条 + 切页 ghost + sweep + 卡片 hover/press | 半天 | 换页能录到 ghost 与 sweep 两段动画先后结束；不换页时零开销 |
| 二 | FLIP 打开歌单 + 页头逐项入场 + 歌单页头三处细节 | 一天 | 起点/终点矩形与实际飞行轨迹一致；返回能反向飞 |
| 三 | 指针 3D 倾斜 + 手绘锯齿线 + 设置面板三档 | 半天 | 关掉开关后逐项复查为「现状」 |
| 四（可选） | 极光帘幕环境层（首页 banner 背后）+ 唱片呼吸接 `--beat` | 一天 | 静止时不掉帧（`npm run perf` 不退化） |

---

## 8 验收口径（每个都要能拿截图或日志说话）

1. **切页**：在 `document` 上监听 `animationstart/animationend`，一次换页必须收到 ghost 与 enter 两段；中间帧截图里 ghost 可见且 opacity 在递减。
2. **FLIP**：起终点矩形打印出来，中间帧位置单调、不跳。
3. **开关**：关掉 `pageTransition` 后重跑 1，**收不到**任何动画事件。
4. **回归**：`npm run check` 全绿（typecheck + test + 四个 audit）；`npm run perf` 不退化；CLS 仍为 0。
5. **减少动效**：`prefers-reduced-motion: reduce` 下 ghost 不建、sweep 不跑、倾斜不响应。

---

## 9 明确不做

- 不改 `.main__body` 的 key 结构（数据隔离有价值，用 ghost 补视觉层）
- 不引入 framer-motion / three.js / GSAP
- 不改首页分区顺序、不改左栏、不改播放条布局
- 不启用 View Transition
- 不给「每张卡都常驻 3D」（只 hover 的那张写 transform）
- 不做开场动画（每次打开都演一遍会烦）

---

## 10 需要你点头的三个判断

1. **切页用 ghost 快照**（而不是改成双层常驻）——改动小、可回滚，但快照本身是一张图，页面里的动画在退场时是静止的。能接受吗？
2. **歌单页头照图改**——kicker 中英双写 + 加「来源」+ 加 RETURN。这三处会同时出现在专辑/艺人/歌曲页（共用 DetailHero）。要一起改，还是只给歌单开一个例外？
3. **3D 倾斜默认开还是默认关**？倾向默认关，在设置里给开关。
