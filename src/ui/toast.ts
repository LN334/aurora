import { create } from 'zustand'

/**
 * 右下角那一条提示。
 *
 * 全应用只有这一种「说一句话」的方式：收藏结果、导入导出、取流失败、更新提醒
 * 都走这里。以前有两套——操作反馈在页头下面插一条，更新提示在右下浮着——同一句
 * 话有两个可能出现的位置，眼睛得先猜它在哪。现在只有右下这一列。
 *
 * 三条规矩，写在这里而不是散在调用点：
 *   1. 自动消失，除非给了 ttl: 0 或带了要人点的按钮；
 *   2. 同时最多四条，挤掉最旧的那条（新提示永远看得见）；
 *   3. 同一个 key 只留一条——「连点三次收藏」不该堆出三行一模一样的字。
 */

type ToastTone = 'info' | 'success' | 'error'

interface ToastAction {
  label: string
  /** 点按钮之后这条自动收起；要留着就自己再 push 一条。 */
  onSelect(): void
}

interface ToastInput {
  message: string
  /** 视觉语义：普通/成功/失败。只影响左边那条竖线的颜色。 */
  tone?: ToastTone
  /** 一个可选的动作，比如「撤销」「去登录」。 */
  action?: ToastAction
  /** 毫秒。0 表示不自动消失；默认 4.5 秒。 */
  ttl?: number
  /** 去重键：同 key 的新提示替换旧的，不叠加。 */
  key?: string
}

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
  ttl: number
  action?: ToastAction
  /** 正在退场：还留在列里占位，等动画放完才真正删掉。 */
  leaving?: boolean
}

/** 读完一句话要多久：长句给得比短句宽一点，但要有个上限。 */
const DEFAULT_TTL = 4500
const LONG_TTL = 6500
/** 同时最多几条。再多就不是「提示」，是一堵墙。 */
const MAX_VISIBLE = 4

/** 每条提示的自动收起定时器。 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** 退场动画的收尾定时器：到点才把卡片从列里摘掉。 */
const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/**
 * 退场动画多久。
 *
 * 与样式里 `.toast` 的 transition 是同一个数（--dur-2 = 200ms）。两边对不上时
 * 会看到两种难看的样子：定时器短了，卡片在动画中途被拔掉，跳一下；长了，它已经
 * 透明还占着位置，下面的提示迟迟不上来。
 */
const LEAVE_MS = 200
/** key → id：同 key 的新提示要先把旧的那条收掉。 */
const byKey = new Map<string, string>()
let seed = 0

function nextId(): string {
  seed += 1
  return 'toast-' + seed
}

function stopTimer(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

interface ToastState {
  items: ToastItem[]
  push(input: ToastInput): string
  dismiss(id: string): void
  clear(): void
}

/** 到点真删：清掉两套定时器，再从列里摘掉。 */
function removeNow(id: string): void {
  const leave = leaveTimers.get(id)
  if (leave) {
    clearTimeout(leave)
    leaveTimers.delete(id)
  }
  stopTimer(id)
  for (const [key, value] of byKey) if (value === id) byKey.delete(key)
  useToast.setState((state) => ({ items: state.items.filter((each) => each.id !== id) }))
}

export const useToast = create<ToastState>()((set, get) => ({
  items: [],

  push(input) {
    /*
     * 只收字符串。
     *
     * 传进来的若是对象，String() 会得到 "[object Object]"——一条长得像 bug 的
     * 提示，既没说清原因，还让人以为是界面坏了。宁可什么都不显示，也不显示这句。
     */
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (!message) return ''
    const ttl = input.ttl ?? (message.length > 24 ? LONG_TTL : DEFAULT_TTL)
    const item: ToastItem = {
      id: nextId(),
      message,
      tone: input.tone ?? 'info',
      ttl,
      action: input.action
    }

    /* 同 key：旧的那条直接摘掉，新的接手它那一格。这里不做退场——同一个位置
       上新卡同时在长，两条叠着淡出会看起来像一次重影。 */
    if (input.key) {
      const previous = byKey.get(input.key)
      if (previous) removeNow(previous)
      byKey.set(input.key, item.id)
    }

    set((state) => {
      const items = [...state.items, item]
      /* 挤掉最旧的：同时四条已经够多，再堆就看不到界面了。 */
      while (items.length > MAX_VISIBLE) {
        const dropped = items.shift()
        if (dropped) {
          stopTimer(dropped.id)
          for (const [key, id] of byKey) if (id === dropped.id) byKey.delete(key)
        }
      }
      return { items }
    })

    if (ttl > 0) {
      timers.set(
        item.id,
        setTimeout(() => get().dismiss(item.id), ttl)
      )
    }
    return item.id
  },

  dismiss(id) {
    const item = get().items.find((each) => each.id === id)
    /* 不认识的 id、或者已经在退场了：重复调用不该再拖一次。 */
    if (!item || item.leaving) return
    stopTimer(id)
    set((state) => ({
      items: state.items.map((each) => (each.id === id ? { ...each, leaving: true } : each))
    }))
    leaveTimers.set(
      id,
      setTimeout(() => removeNow(id), LEAVE_MS)
    )
  },

  clear() {
    for (const item of get().items) get().dismiss(item.id)
  }
}))

/**
 * 说一句话。
 *
 * `toast('已收藏')` 是最常见的写法；要动作、要颜色、要去重时给对象。
 * 返回 id，可以用 `dismissToast` 提前收掉。
 */
export function toast(input: string | ToastInput): string {
  return useToast.getState().push(typeof input === 'string' ? { message: input } : input)
}
