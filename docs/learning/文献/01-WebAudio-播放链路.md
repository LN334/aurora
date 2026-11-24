# 文献 1 · Web Audio 播放链路详解

> **读这篇之前**：读完第 2 站（语言）和第 3 站（界面）的「React state」部分。
> **读完之后**：你应该能解释「为什么音量要经过三个 GainNode」，以及「为什么跨源音频会静音」。

本篇以 `src/features/player/engine.ts`（796 行）为教材，逐层拆开一条真实的播放链路。
**这是整个项目里注释最密的文件之一**，也是最好的音频课。

---

## 一、先建立心智模型：Web Audio 是一张图

浏览器里播放声音有两种方式：

| 方式 | 长什么样 | 能力 |
| --- | --- | --- |
| `<audio>` 元素 | 一个标签，自带播放/暂停/进度 | 简单，但**没法处理音频数据**（做不了 EQ、频谱、淡入淡出） |
| Web Audio API | 一张**节点图**（node graph），音频流经过一个个节点 | 能做一切，但你要自己连线 |

Aurora 用的是**两者结合**：

```ts
// engine.ts:172-180
const el = new Audio()
el.crossOrigin = 'anonymous'
const ctx = new AudioContext({ latencyHint: 'playback' })
const source = ctx.createMediaElementSource(el)
```

`createMediaElementSource(el)` 这个调用是整座桥：它把 `<audio>` 元素里的音频流**接进 Web Audio 图**，返回一个可以作为图起点的节点。

**代价**（原注释写得很清楚）：

> A media element gets exactly one source node for its lifetime, and holding the reference guards against any collection of a node the element still points at.

一个媒体元素**一生只能创建一次 source node**。第二次调用会抛错。所以 `engine.ts` 把它存成字段（第 107 行附近的 `preGain` 注释就在讲这件事），而不是每次播放重新建。

**`latencyHint: 'playback'`** 也不是随便写的：它告诉浏览器「这是放音乐，不是做实时乐器」，浏览器会选择更大的缓冲区换更稳的输出。

---

## 二、Why crossOrigin：一行代码决定有没有声音

```ts
// engine.ts:173-175
// Load-bearing: without CORS approval a media element routed through Web
// Audio outputs pure silence, so this must be set before any src.
el.crossOrigin = 'anonymous'
```

这是 Web Audio 最容易踩的坑，值得单独一节。

**规则**：一旦媒体元素的输出接进了 Web Audio，浏览器就把这份音频数据当成「可以被 JS 读取的字节」。而跨源资源默认不允许 JS 读——于是浏览器采取最保守的做法：**照放，但静音**（不是报错，不弹提示，`el.error` 是 `null`）。

所以你会遇到这种情况：

- 直接用 `<audio src="https://cdn.example/a.mp3">` → 有声音；
- 加上 `createMediaElementSource` → **静音**；
- 加上 `el.crossOrigin = 'anonymous'`，并且**服务器返回了 `Access-Control-Allow-Origin`** → 有声音。

三个条件缺一不可。本项目里 `aurora-cache:` 和 `aurora-remote:` 的 handler 都返回 `access-control-allow-origin: *`（`cache-protocol.ts:34-37`），就是为了满足第二个条件。

**顺序也很重要**：`crossOrigin` 必须在**第一次设置 `src` 之前**设好。浏览器在开始加载 url 时就决定了这次请求带不带 CORS 模式，之后再改属性不会重新协商。

> 顺带说一个相关的坑：`el.crossOrigin` 只影响「页面能否读音频数据」。**视觉**上的图片（封面）是另一个故事——那受 `<img>` 的 CORS 与 canvas 污染规则管，跟这里无关。

---

## 三、图长什么样

```ts
// engine.ts:199-209
let node: AudioNode = source
node.connect(preGain);      node = preGain
for (const band of bands) { node.connect(band); node = band }
node.connect(analyser)
analyser.connect(master)
master.connect(fade)
fade.connect(ctx.destination)
```

画成图：

```
<audio>
   │  createMediaElementSource
   ▼
source ──► preGain ──► [band0] ─► [band1] ─► … ─► [bandN] ──► analyser ──► master ──► fade ──► destination
            ▲                                                                   ▲           ▲
            │                                                                   │           │
       ReplayGain / 峰值保护                                              总音量      淡入淡出
```

**四个 GainNode 各管一件事**，这是这段代码最值得学的地方：

| 节点 | 管什么 | 为什么不能合并 |
| --- | --- | --- |
| `preGain` | 单曲的 ReplayGain（不同专辑音量不同，需要拉平） | 它必须在 EQ **之前**，否则拉音量会影响 EQ 的输入电平 |
| `master` | 用户设的总音量 | 用户调音量不应该改动单曲的增益计算 |
| `fade` | 淡入淡出 | 淡出必须只作用在「输出」上，不能把用户音量一起改了 |

合并成一个 GainNode 的话：切歌淡出时用户音量被一起拉低、调音量时把淡入淡出的曲线冲掉。**「一个节点只负责一个决定」**——这句是整篇的核心。

---

## 四、EQ：为什么是这三种滤波器

```ts
// engine.ts:190-197
const bands = EQ_BANDS.map((freq, i) => {
  const band = ctx.createBiquadFilter()
  band.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
  band.frequency.value = freq
  band.Q.value = 0.9
  band.gain.value = 0
  return band
})
```

BiquadFilter 的三种 type 对应三种「形状」：

- **lowshelf**（第一个频段）：低于截止频率的部分整体升降，像货架的左半边。
- **peaking**（中间各段）：在频率附近鼓一个包/挖一个坑，影响范围由 `Q` 控制。
- **highshelf**（最后一个频段）：高于截止频率的部分整体升降。

**为什么首尾用 shelf**：音乐的极端频段（比如 40 Hz 以下、16 kHz 以上）没有「中频」可言，用 peaking 会在两端留下没人管的区域。shelf 把它们兜住，才是均衡器的行为。

**`Q = 0.9`**：Q 越大越尖锐（窄带），越小越平缓。0.9 大约是「一个倍频程」宽度的口子，听感自然。**这个值没有理论最优，是耳朵定的**——工程里很多常数属于这一类。

**默认 `gain = 0`**：所有频段先不增不减。`applyEq()` 在 `build()` 末尾被调用一次，把 store 里用户存的 EQ 设置灌进去。

---

## 五、分析器：频谱与时域，两个长度的坑

```ts
// engine.ts:183-186
const analyser = ctx.createAnalyser()
analyser.fftSize = 4096
// Enough smoothing that the spectrum reads as motion, not as noise.
analyser.smoothingTimeConstant = 0.8
```

**`fftSize` 决定两件事**：

1. **频率分辨率** = `sampleRate / fftSize`。44.1 kHz 采样率、4096 点时，每个频点覆盖约 **10.8 Hz**。想看清低频细节就得加大 fftSize。
2. **输出数组长度**：频域数组长度是 `frequencyBinCount`，等于 **`fftSize / 2`**（Nyquist）。

于是有了下面这处容易写错的地方：

```ts
// engine.ts:276-278
this.spectrum = new Uint8Array(analyser.frequencyBinCount)   // 频域：fftSize / 2
// 时域长度是 fftSize，不是 frequencyBinCount——这两者差一倍，指错了就是半个波形。
this.waveform = new Uint8Array(analyser.fftSize)             // 时域：fftSize
```

**同一份音频，两条数据通道，两个长度。** 用错不会报错，只会画出一半的波形（或者数组越界被静默截断）。这类 bug 极难发现，因为「看起来有图」。

**`smoothingTimeConstant = 0.8` 的取舍**（注释：让频谱看起来是「运动」而不是「噪声」）：它让每个频点的值向上一帧滑 20%，频谱条就不会疯狂抖动。但正因为平滑，**它不适合测电平和削波**：

```ts
// engine.ts:571-575
// 时域采样，给峰值 / RMS 表用。
// 频域那一路已经做过平滑（smoothingTimeConstant 0.8），拿它算「这一下有多响」
// 会永远慢半拍，也看不出削波。真电平得看波形。
```

**结论**：频谱给人看，波形给算法用。**同一个数据源，不同用途要不同的处理**——这是数据可视化的通用经验。

---

## 六、三条增益控制：ramp 而不是直接赋值

```ts
// engine.ts:304 附近
private ramp(to: number, ms: number): void
```

GainNode 的 `gain` 是 `AudioParam`，它不是一个数字，而是一条**时间曲线**。你给它目标值 + 时长，浏览器在音频采样级别上平滑过渡。

**为什么不能直接 `gain.value = 0`**：那是一个瞬间跳变，波形出现一个垂直的台阶——听感上是「咔哒」声（pop），示波器上是削波。所有正规播放器的淡入淡出、静音、暂停，都必须用 ramp。

**项目里的两个时长**：

```ts
// engine.ts:13-14
const FADE_IN_MS = 220
const FADE_OUT_MS = 150
```

为什么淡入比淡出长？因为**淡出时人耳已经预期要断**，稍微急一点不突兀；**淡入时要接上一个突然消失的声音**，太急会显得突兀。这类参数属于「审美常量」。

另外注意这一段注释：

```ts
// engine.ts:140-144
// 设成 0 时才退回 FADE_IN_MS——普通暂停恢复不该因为交叉淡化调成 6 秒
// 就跟着慢慢浮起来。
```

**默认值不能只有一个入口**。用户把交叉淡化调到 6 秒，只应该影响「切歌」，不应该让「暂停后继续」也慢慢浮起来 6 秒。所以有个 `pendingFadeInMs`，只有切歌那次才设值。

---

## 七、错误处理：一套四级回退链

`el.addEventListener('error', ...)`（第 228-261 行）不是简单报错，而是一条**有意识的回退链**。这是全篇工程价值最高的部分。

**第一级：换 src 造成的中断不算失败**

```ts
// 换 src 造成的中断由那一次 load 自己接上，不算失败。
if (!el.error) return
```

**第二级：一起听里房主给的地址坏了，退回自己解析**

```ts
// 一起听里这一首用的是房主给的地址。它放不出来（对面断了、穿透没了、
// 平台拒了），不该让客人干坐着——退回自己解析一次，听得差一点也比没有强。
// 每首只回退一次，否则地址一直坏就是无限重试。
if (sharedStreamFor(current.id)) {
  if (this.streamFallback.has(current.id)) return
  this.streamFallback.add(current.id)
  rememberSharedStream(null)
  void this.load(current, wasPlaying)
  return
}
```

**第三级：普通在线歌的地址过期，丢掉缓存重新要**

```ts
// 普通在线歌：地址还在缓存里，不代表它还能用——签错、CDN 拒、上游提前
// 换了域名都有可能，而缓存只能保证「取的时候是好的」。
if (sourceFor(current).online !== true) return
if (this.sourceRetried.has(current.id)) return
this.sourceRetried.add(current.id)
void this.load(current, wasPlaying, true)
```

**第四级：什么都不做**

本地文件坏了就是坏了，报错让人看见。

这套设计的三个可学之处：

1. **每一级都有 `Set` 记「这首已经试过」**。没有它，坏地址会让播放器在「加载中 / 暂停」之间无限打转——**比直接报错更难懂**（注释原话）。**重试必须有上限，而且上限要写进代码，不能靠运气。**
2. **回退时保留播放位置**。`load` 里有 `pendingSeek`，元素被指了新地址后进度归零，但用户只是按了下播放键，不该从头再来。

   ```ts
   // engine.ts:213-222
   const resume = this.pendingSeek
   if (resume !== null) {
     this.pendingSeek = null
     const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.05 : resume
     el.currentTime = Math.max(0, Math.min(resume, limit))
   }
   ```

   注意那个 `- 0.05`：新文件可能比旧的短一点，硬设到超出时长会抛 `DOMException`。**防御性编程不是「加 if」，是「知道边界在哪」。**

3. **失败的原因不同，走的路径也不同**。一起听失败 vs 普通在线失败，归到不同代码段里各自处理，而不是一个 `catch` 兜所有。

---

## 八、ticker 与「不可见时到底该多快」

这是本项目最讲究的一处性能决策，原文注释（第 17-29 行）值得整段读三遍：

```ts
/**
 * How often the playhead is published while the player window is off screen.
 *
 * A quarter of a second, i.e. 4 Hz instead of 60. Only two things read the
 * playhead when nothing is being drawn: the desktop lyric window, whose
 * highlight is `activeLineAt(position)`, and the transport chrome... Lyric
 * lines change every few seconds, so sampling the clock four times a second
 * cannot show the wrong line or skip one - it can only delay a switch by less
 * than a quarter second... Lower would start to matter (a 1 s step is visible
 * while the overlay is being watched); higher would leave sixty wake-ups a
 * second in place, and with `backgroundThrottling: false` those wake-ups are
 * the whole background cost.
 */
export const HIDDEN_POSITION_MS = 250
```

拆解这个推理链：

1. **谁在读这个值？** 只有两个消费方（桌面歌词高亮、播放条）。
2. **它们的变化频率是多少？** 歌词行几秒才换一次。
3. **采样太慢会怎样？** 最多延迟四分之一秒才切换高亮——比人读一行的时间还短，感知不到。
4. **采样太快会怎样？** 因为 `backgroundThrottling: false`（见第 4 站），后台窗口不会被浏览器降频，60 次/秒的唤醒就是真实的 CPU 开销。
5. **结论**：250 ms，正好在「感知不到」和「省下 59/60 的开销」之间。

**这是性能优化的正确姿势**：不是「先测出来热再说」，而是**先问「这个值被谁读、它们多快需要它」**。答案往往直接把优化空间算出来了。

还有个细节值得学：可见性判断为什么不用 React hook？

```ts
// engine.ts:33-40
// `useWindowVisibility()` 是面向组件的版本，这里不能用，因为 ticker 是
// 活在 React 外面的单例。主进程的规则一样：在 Electron 里只有
// `isVisible()`/`isMinimized()` 决定，一个只是失焦或者被部分遮挡的窗口
// 仍然是 visible，绝不减速。浏览器里没有托盘也没有第二个窗口，
// `document.hidden` 在那里才是准的。
```

**同一个概念（可见性），在渲染层用 hook 实现，在引擎里用订阅实现**——因为两者的宿主不同。这是「接口相同、实现不同」的又一个例子。

---

## 九、播放速率为什么改元素属性

```ts
// engine.ts:290-295
// 倍速。
// 直接写元素属性——Web Audio 的播放速率要走 source.playbackRate，可这里的
// 元素与解码器是绑在一起的，改元素属性才会真的加速（包括音高处理由浏览器定）。
```

理论上 `AudioBufferSourceNode.playbackRate` 是标准做法，但**这里没有 AudioBufferSourceNode**（用的是 media element source）。对 media element，真正控制解码器速率的是 `el.playbackRate`。改 `source.playbackRate` 只是把已经解码出来的数据放得更快——那是变调。

**教训**：API 文档告诉你「有这个方法」，但**在你这张特定的图里，哪个节点才真正起作用，要自己判断**。

---

## 十、ReplayGain：为什么要看峰值

```ts
// engine.ts:329-331
// ReplayGain, with peak-aware headroom: a positive gain on an already-loud
// master would clip, so the boost is capped by the track's own peak.
```

ReplayGain 是「把不同专辑的音量拉平」的行业做法：每首歌在文件元数据里带一个建议增益（比如 +3.2 dB）。

问题在于：如果这首歌本身已经很响（峰值接近 0 dBFS），再加 3 dB 就会**削波**。所以：

```
实际增益 = min(建议增益, 峰值允许的余量)
```

**这是「知道物理上限在哪」的典型工程判断**：数学上 +3 dB 没问题，物理上（数字音频的满刻度）有问题。

---

## 十一、把这一篇的知识点收成清单

读完这章，你应该能回答：

| 问题 | 答案的一句话 |
| --- | --- |
| `createMediaElementSource` 能调几次？ | 每元素一次，所以节点要存成字段 |
| 为什么跨源音频会静音？ | 接进 Web Audio 后数据可被 JS 读，浏览器用静音保护跨源内容 |
| `crossOrigin` 什么时候设？ | 第一次设 `src` 之前 |
| fftSize 4096 的频域数组多长？ | 2048（fftSize / 2） |
| 频谱和时间波形能共用数组吗？ | 不能，长度差一倍 |
| 为什么四个 GainNode？ | 一个节点只负责一个决定（单曲增益 / 总音量 / 淡入淡出 / EQ 前级） |
| 淡入淡出为什么必须 ramp？ | 直接赋值会产生阶跃，听感是爆音 |
| 地址坏了重试几次？ | 每首一次，用 Set 记录 |
| 后台多久更新一次进度？ | 250 ms，因为只有歌词高亮和播放条读它 |
| ReplayGain 为什么要看峰值？ | 加到已经满刻度的歌上会削波 |

---

## 十二、延伸阅读

- **MDN · Web Audio API**（`developer.mozilla.org` 搜 “Web Audio API”）：先读「AudioNode 基础」与「AudioParam」两节。前者讲图，后者讲 ramp。
- **MDN · `createMediaElementSource`**：注意「同一元素只能创建一次」的规范说明，和浏览器实现差异。
- **MDN · `AnalyserNode`**：`fftSize`、`frequencyBinCount`、`smoothingTimeConstant` 三个属性讲得很清楚。
- **规范本身**（`webaudio.github.io/web-audio-api/`）：只有遇到「为什么浏览器要求 CORS」这类问题时才需要读，读 `MediaElementAudioSourceNode` 那一节。
- **项目内**：`docs/perf-baseline.md` 里有这个引擎的实测开销数字，读完本章再看，会更有感觉。

**建议的动手**：把 `HIDDEN_POSITION_MS` 改成 `1000`，用 `npm run dev` 打开应用，把窗口最小化，看桌面歌词的高亮是不是肉眼可见地慢了一拍。**亲眼看到缓慢**比读十遍注释管用。
