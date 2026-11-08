/**
 * 把「原文 / 译文」拆成两行。
 *
 * 歌词文件里译文常常直接跟在原文后面，用空格斜杠空格隔开。挤成一行时，一句
 * 英文占满宽度，中文被压到第二行还要和英文共享行高，读起来像两段谁也不认识
 * 谁的文字粘在一起。拆开以后原文一行、译文一行小字，和网易云、Apple Music 的
 * 双语歌词一样。
 *
 * 判断依据不是「有没有斜杠」——「周乘羽 / 卡力老虎」这种合作署名也用斜杠，拆了
 * 就把人名劈成两半。只有原文不含中日韩字符、后半段含，才当成翻译。
 */
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/

export interface LyricLineParts {
  main: string
  sub: string
}

export function splitLyricLine(text: string): LyricLineParts {
  const trimmed = text.trim()
  const at = trimmed.indexOf(' / ')
  if (at <= 0) return { main: trimmed, sub: '' }

  const main = trimmed.slice(0, at).trim()
  const sub = trimmed.slice(at + 3).trim()
  if (!main || !sub) return { main: trimmed, sub: '' }
  if (CJK.test(main) || !CJK.test(sub)) return { main: trimmed, sub: '' }
  return { main, sub }
}
