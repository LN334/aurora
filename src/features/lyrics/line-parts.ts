/**
 * 把「原文 / 译文」拆成两行。
 *
 * 歌词文件里译文常常直接跟在原文后面，用空格斜杠空格隔开。挤成一行时，一句
 * 英文占满宽度，中文被压到第二行还要和英文共享行高，读起来像两段谁也不认识
 * 谁的文字粘在一起。拆开以后原文一行、译文一行小字，和网易云、Apple Music 的
 * 双语歌词一样。
 *
 * 判断依据不是「有没有斜杠」——「周乘羽 / 卡力老虎」这种合作署名也用斜杠，拆了
 * 就把人名劈成两半。原则上凡是译文都拆：英文原文接中文译文、日文原文接中文译文、
 * 中文原文接英文译文都算双语歌词。只有两种不拆——两段都是纯中文（合作署名），
 * 或两段都没有中日韩字符（同一句的重复/语气变体）。别拿「原文含 CJK」当「原文是
 * 中文」：日文就在 CJK 区间里，旧规则因此把日文歌的译文全留在了原文一行。
 */
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
/** 假名与韩文：出现了就不可能是「中文原文配中文译文」那种署名。 */
const KANA = /[\u3040-\u30ff]/
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/

/** 纯中文（汉字与中文标点），不含假名、韩文。 */
function isChinese(text: string): boolean {
  return !KANA.test(text) && !HANGUL.test(text) && CJK.test(text)
}

interface LyricLineParts {
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
  // 两段都是纯中文：合作署名（周乘羽 / 卡力老虎），拆了会把人名劈开。
  if (isChinese(main) && isChinese(sub)) return { main: trimmed, sub: '' }
  // 两段都没有中日韩字符：同一句的重复或语气变体（(oh-oh / oh-oh)），不是译文。
  if (!CJK.test(main) && !CJK.test(sub)) return { main: trimmed, sub: '' }
  return { main, sub }
}
