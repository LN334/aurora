import { useLayoutEffect, useEffect, useRef } from 'react'

/** 一张封面：底色（CSS background 值）+ 图（图可能为空，只画底色） */
interface DiscTile {
  key: string
  /** 读屏用的名字（曲名 · 艺人），空串表示占位 */
  label: string
  art: string | null
  /** 缺封面时的底色，直接就是要写进 style.background 的值 */
  tint: string
}

/*
 * 弧线上相邻两张的横向步长。往外的间距再按 d^1.7 收一次，远处更挤，
 * 这样一排看过去是弧形摊开，不是等距平移。
 */
const STEP = 88
const ARC = 5
const DROP = 22
const TILT = 8.5
const SHRINK = 0.09
/** 正中那张比邻居大一点，一眼能认出焦点在哪 */
const CENTER_GROW = 0.05
/** 同时摊开的张数（左右各四张）。再多就小得看不清，轮转到后面的靠循环补。 */
const REACH = 4
/** 滚轮一格（deltaY 约 100）翻几张：除以这个数就是位移量。 */
const WHEEL = 110
/** 单次滚轮事件最多翻几张。触控板惯性滚动会甩出很大的 delta，不设上限会跳。 */
const WHEEL_MAX = 2
/** 停手多久之后吸附到整张，避免停在两张中间。 */
const HOLD_MS = 220
/** 按下到拖动生效之间的死区，手感用。 */
const SLOP = 4
/**
 * 追随的速度：离目标一格就给八张每秒，越过越慢，收到跟前再一点点蹭过去。
 * 每帧推进多少只跟「离目标多远」有关，与滚轮事件什么时候来无关——
 * 早先让滚轮事件直接瞬移位置，事件间隔一不均匀，画面就一跳一跳。
 */
const GAIN = 8
/** 速度上限（张/秒）。一帧最多也就走这么多，别追成闪现。 */
const SPEED_MAX = 11
/** 速度逼近的软硬。越大越紧跟目标速度，越小越飘。 */
const REACT = 26
/** 小于这个量就直接落到目标，省得无限逼近。 */
const EPS = 0.004
/**
 * 收尾用弹簧，中段用速度。
 *
 * 只靠速度模型（速度正比于距离）其实会单调逼近，一帧一帧蹭到最后——稳，
 * 但看着是「停住了」而不是「落位」。最后一张半的行程交给欠阻尼弹簧：
 * 冲过头、再弹回来、余一下站住，这才是拨唱片的手感。
 * 阻尼比 ζ = C / (2√K) ≈ 0.36，回弹幅度约三成，正好一眼看得出来、又不晕。
 */
const SPRING_ZONE = 1.2
const SPRING_K = 190
const SPRING_C = 14

function wrap(value: number, count: number): number {
  return ((value % count) + count) % count
}

/**
 * 今日推荐的封面墙。
 *
 * 一条沿弧线摊开的封面带：中间那张正对、最大、最亮，越往外越小、越往下沉、
 * 越斜，像一叠唱片在架子上被拨开。滚轮、拖动、左右键都能翻，点中间的放那首。
 *
 * 位置用连续量 pos 表示，且**不做边界截断**——取模到 tiles 上，所以翻到最后
 * 一张会接回第一张，三十首也能一路转下去。
 *
 * 丝滑靠三件事，缺一样都会抖：
 * ① 九个槽位的 DOM 从挂载到卸载都不变，位置写在内联 transform 上，图片写在内联
 *    background 上，**整段滚动里 React 一次都不重渲染**。早先每跨一格 setState，
 *    React 会重排九个节点，那一帧的位移和换图对不上，看起来就是抽。
 * ② 每帧推进的位移只由「离目标多远」决定，不由滚轮事件何时到达决定。
 * ③ 换图只在槽位真正滚到另一首时发生，且换的是 background 不是 <img src>，
 *    不会触发图片元素重建。
 */
export function DiscWall({
  tiles,
  onPlay
}: {
  tiles: DiscTile[]
  /** 点了正中的那张，参数是它在 tiles 里的下标。 */
  onPlay: (index: number) => void
}) {
  const count = Math.max(1, tiles.length)
  const countRef = useRef(count)
  countRef.current = count
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  const wall = useRef<HTMLDivElement | null>(null)
  const nodes = useRef<(HTMLDivElement | null)[]>([])
  /* 每个槽位现在画的是哪一首：变了才去改 background */
  const shown = useRef<number[]>([])
  const posEl = useRef<HTMLSpanElement | null>(null)
  const nameEl = useRef<HTMLSpanElement | null>(null)
  const posRef = useRef(0)
  const aimRef = useRef(0)
  const holdRef = useRef(0)
  const paintedRef = useRef(Number.NaN)
  const rafRef = useRef(0)
  const velRef = useRef(0)
  const clockRef = useRef(0)
  /* 上一帧写进去的值：没变就别碰 DOM，省掉每帧几十次样式重算 */
  const memoRef = useRef({ t: [] as string[], z: [] as number[], c: [] as boolean[], o: [] as number[] })
  const dragRef = useRef<{
    id: number
    x: number
    base: number
    moved: boolean
    at: number
    lastX: number
    speed: number
    /** 按下时命中的槽位：pointer capture 之后 pointerup 的 target 会变成墙本身 */
    slot: number
  } | null>(null)

  const paint = (slot: number, index: number): void => {
    const el = nodes.current[slot + REACH]
    const tile = tilesRef.current[index]
    if (!el) return
    if (!tile) {
      el.style.background = 'none'
      return
    }
    el.style.background = tile.art
      ? 'url("' + tile.art + '") center / cover no-repeat, ' + tile.tint
      : tile.tint
    el.setAttribute('aria-label', tile.label || '封面占位')
  }

  /* 数据换了（首次到货、换一批）：把九个槽位重新认一遍，丢掉旧的对应关系 */
  useLayoutEffect(() => {
    shown.current = []
    paintedRef.current = Number.NaN
  }, [tiles])

  useEffect(() => {
    let alive = true
    const tick = (now: number): void => {
      if (!alive) return
      const previous = clockRef.current || now
      clockRef.current = now
      /* 掉帧或切后台回来时 dt 会很大，夹住，免得一步跨过头。 */
      const dt = Math.min(0.05, Math.max(0.004, (now - previous) / 1000))
      if (!dragRef.current && now > holdRef.current) {
        aimRef.current = Math.round(aimRef.current)
      }
      const aim = aimRef.current
      const gap = aim - posRef.current
      if (!dragRef.current) {
        if (Math.abs(gap) < EPS && Math.abs(velRef.current) < 0.06) {
          posRef.current = aim
          velRef.current = 0
        } else if (Math.abs(gap) > SPRING_ZONE) {
          /*
           * 远距离：想要的速度随距离线性增长，再留一点爬行速度把最后几个像素走完。
           * 实际速度用指数逼近跟上去，避免一帧内速度突变（那也会看起来一顿）。
           * 关键在于每帧走多远只由 gap 决定，与滚轮事件何时到达无关。
           */
          const want = Math.max(-SPEED_MAX, Math.min(SPEED_MAX, gap * GAIN + Math.sign(gap) * 0.45))
          velRef.current += (want - velRef.current) * Math.min(1, dt * REACT)
          posRef.current += velRef.current * dt
        } else {
          /* 收尾：加速度正比于剩余距离、反比于速度，冲过头自己会弹回来。 */
          const acc = gap * SPRING_K - velRef.current * SPRING_C
          velRef.current += acc * dt
          posRef.current += velRef.current * dt
        }
      }
      const pos = posRef.current
      const anchor = Math.round(pos)
      const frac = pos - anchor
      const total = countRef.current
      const list = tilesRef.current
      const memo = memoRef.current

      for (let slot = -REACH; slot <= REACH; slot += 1) {
        const i = slot + REACH
        const el = nodes.current[i]
        if (!el) continue
        const expected = wrap(anchor + slot, total)
        if (shown.current[i] !== expected) {
          shown.current[i] = expected
          paint(slot, expected)
        }
        const offset = slot - frac
        const far = Math.abs(offset)
        const spread = far * STEP - Math.pow(far, 1.7) * ARC
        const x = Math.sign(offset) * spread
        /*
         * 竖向：正中那张抬起来，往外逐级下沉。这里必须是连续函数——
         * 原来在 far=1 处分段，中张一偏就整块跳 12px，看着像上下抽。
         */
        const lift = far < 1 ? -6 * (1 - far * far) : 0
        const y = lift + Math.max(0, far - 1) * DROP + (far > 1 ? Math.min(far - 1, 2) * 6 : 0)
        const rot = Math.sign(offset) * Math.min(far, 3) * TILT
        const scale = 1 + CENTER_GROW - Math.min(far, REACH) * SHRINK
        const transform =
          'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) rotate(' + rot.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')'
        if (transform !== memo.t[i]) {
          el.style.transform = transform
          memo.t[i] = transform
        }
        /*
         * 层次要按距离细分。整档取值时两张远的近距离接近会拿到同一个 z，
         * 谁压谁由 DOM 顺序决定，右边的卡会压到左边的卡上——看着就是穿模。
         */
        const z = Math.round((REACH + 1 - Math.min(far, REACH)) * 100)
        if (z !== memo.z[i]) {
          el.style.zIndex = String(z)
          memo.z[i] = z
        }
        /*
         * 这里曾经加过按档 brightness 压暗远处的卡，想让「谁在前」多一个信号。
         * 结果 filter 会给每张卡单开一层，快速滑动时跨档就重建，边缘对不齐，
         * 穿模反而更明显——撤了。层次改由 CSS 的描边与投影交代。
         */
        const center = far < 0.5
        if (center !== memo.c[i]) {
          el.classList.toggle('is-center', center)
          memo.c[i] = center
        }
        /*
         * 最外两档淡出。墙没有遮罩（遮罩会让整块每帧重新合成），
         * 边缘的卡原本是硬切在墙的边界上，快速滑动时进进出出像被削掉一块。
         * 按整档给透明度、靠 CSS 的 opacity 过渡补间，既平滑又不重建层。
         */
        const band = Math.min(REACH, Math.round(far))
        const alpha = band >= 4 ? 0.42 : band === 3 ? 0.78 : 1
        if (alpha !== memo.o[i]) {
          el.style.opacity = String(alpha)
          memo.o[i] = alpha
        }
      }

      /* 读数与选中提示只在跨到下一张时更新，不参与每帧 */
      if (anchor !== paintedRef.current) {
        paintedRef.current = anchor
        const index = wrap(anchor, total)
        const tile = list[index]
        if (posEl.current) posEl.current.textContent = (index + 1) + ' / ' + total
        if (nameEl.current) nameEl.current.textContent = tile ? tile.label : ''
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  /*
   * 滚轮要自己挂：React 的 onWheel 走 passive 监听，preventDefault 无效，
   * 页面会跟着一起滚。触控板横向滑（deltaX）也算翻页。
   */
  useEffect(() => {
    const el = wall.current
    if (!el) return
    const wheel = (event: WheelEvent): void => {
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!raw) return
      event.preventDefault()
      const delta = Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, raw / WHEEL))
      /*
       * 只挪目标，位置由帧循环按距离平滑推过去。滚轮事件什么时候来、
       * 来得多密都不影响每一帧走多远——这正是「不抽」的关键。
       */
      aimRef.current += delta
      holdRef.current = performance.now() + HOLD_MS
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const step = (delta: number): void => {
    aimRef.current += delta
    holdRef.current = performance.now() + HOLD_MS
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]')
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      base: aimRef.current,
      moved: false,
      at: performance.now(),
      lastX: event.clientX,
      speed: 0,
      slot: hit ? Number(hit.dataset.slot) : 0
    }
    wall.current?.classList.add('is-drag')
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = dragRef.current
    if (!active || active.id !== event.pointerId) return
    const dx = event.clientX - active.x
    if (!active.moved && Math.abs(dx) > SLOP) active.moved = true
    if (!active.moved) return
    /* 拖动要不延迟：渲染位置直接跟着指针走，不走帧追赶。 */
    const next = active.base - dx / STEP
    aimRef.current = next
    posRef.current = next
    velRef.current = 0
    const elapsed = performance.now() - active.at
    if (elapsed > 0) active.speed = (event.clientX - active.lastX) / elapsed
    active.at = performance.now()
    active.lastX = event.clientX
  }

  const endDrag = (cancelled: boolean): void => {
    const active = dragRef.current
    if (!active) return
    dragRef.current = null
    wall.current?.classList.remove('is-drag')
    if (cancelled) {
      aimRef.current = Math.round(posRef.current)
      velRef.current = 0
      return
    }
    if (!active.moved) {
      /* 点正中的才开唱；点边上的先把它转到中间，免得手一抖就切歌。 */
      const offset = active.slot - (posRef.current - paintedRef.current)
      if (Math.abs(offset) < 0.5) {
        onPlay(wrap(paintedRef.current + active.slot, countRef.current))
        return
      }
      aimRef.current += offset
      holdRef.current = performance.now() + HOLD_MS
      return
    }
    /*
     * 松手：把最后一瞬的指针速度交给帧循环，它自己滑出去再收在整张上。
     * 不在这里预算「应该滑几张」——让速度决定，手感才连贯。
     */
    const thrown = (-active.speed * 1000) / STEP
    velRef.current = Math.max(-SPEED_MAX, Math.min(SPEED_MAX, thrown))
    aimRef.current = posRef.current + velRef.current * 0.16
    holdRef.current = performance.now() + 160
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPlay(wrap(Math.round(aimRef.current), countRef.current))
    }
  }

  const slots: number[] = []
  for (let slot = -REACH; slot <= REACH; slot += 1) slots.push(slot)

  return (
    <div
      ref={wall}
      className="rh-disc"
      role="group"
      aria-roledescription="封面墙"
      aria-label="每日推荐封面，滚轮、拖动或左右键翻看，点中间的播放"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(false)}
      onPointerCancel={() => endDrag(true)}
    >
      {slots.map((slot) => (
        <div
          key={slot}
          className="rh-disc__tile"
          data-slot={slot}
          role="button"
          ref={(el) => {
            nodes.current[slot + REACH] = el
          }}
        />
      ))}
      <div className="rh-disc__readout">
        <span className="rh-disc__pos" ref={posEl} />
        <span className="rh-disc__name" ref={nameEl} />
      </div>
    </div>
  )
}
