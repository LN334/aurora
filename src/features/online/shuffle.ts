/**
 * 按种子洗一遍。
 *
 * 之前首页是四家轮流取，顺序等于写死的：第一行永远是「网易云、QQ、酷狗、
 * 汽水」。换成洗牌之后平台顺序不再可预测，但同一个种子得到的顺序是稳定的
 * —— 页面重渲染不能把卡片换位置（鼠标还没点，图就跑了），只有「换一批」
 * 才换种子。
 *
 * 单独成文件是因为它要能被 node --test 直接导入：调用它的那些模块依赖 React
 * 与平台 store，测试环境解析不了。
 */
export function shuffleWithSeed<T>(list: readonly T[], seed: number): T[] {
  const out = list.slice()
  // 线性同余：够用、无依赖、同一种子必得同一序列。
  let state = Math.imul((seed + 1) >>> 0, 2654435761) >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}
