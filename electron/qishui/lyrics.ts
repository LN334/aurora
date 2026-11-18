/**
 * 汽水的歌词：一份逐字正文 + 若干条语言轨。
 *
 * 实测 `display_info.lyric_info` 长这样（2026-11，未登录也能取）：
 *
 *   lyric_entity.content   `[1540,2380]<0,810,0>沈<810,450,0>む…`   起止毫秒 + 逐字段
 *   lang_translations      { 'ZH-HANS-CN': { content: '[00:01.54]仿佛沉溺其中…' } }
 *
 * 两边的差别不只是单位：正文是「[起始,时长]」加尖括号逐字标记，译文是标准
 * LRC。播放在别处只认标准 LRC（`parseLrc`），所以这里必须先把正文翻过去。
 * 中文歌没有语言轨，译文就是空串。
 */

/** 逐字标记：`<offset,duration,speed>`，紧贴文字之前。 */
const WORD_TAG = /<\d+,\d+,-?\d+>/g
/** 逐字正文行：`[起始毫秒,时长毫秒]` 后跟逐字段。 */
const KARAOKE_LINE = /^\[(\d+),(\d+)\](.*)$/
/** 已经是标准 LRC 的行（译文就是这种），原样留着。 */
const LRC_LINE = /^\[\d+:\d{2}(?:[.:]\d{1,3})?\]/

/** 至少含一个汉字/假名/谚文的行才算译文候选。 */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

export interface QishuiLyrics {
  lrc: string
  /** 标准 LRC 的译文；没有语言轨时是空串。 */
  translation: string
}

/** 毫秒 -> `[mm:ss.xx]`。 */
function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return (
    '[' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    '.' +
    String(centis).padStart(2, '0') +
    ']'
  )
}

/**
 * 任意一种上游格式 -> 标准 LRC。
 *
 * 逐字行换算成时间戳、剥掉尖括号标记；已经是标准 LRC 的行原样留下（译文和
 * 部分老歌走这条路）；`[ti:]`、`[ar:]` 这类元信息行丢掉——播放器只读时间戳。
 */
export function qishuiLrc(content: string): string {
  const out: string[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const karaoke = KARAOKE_LINE.exec(line)
    if (karaoke) {
      const text = karaoke[3].replace(WORD_TAG, '').trim()
      if (text) out.push(stamp(Number.parseInt(karaoke[1], 10)) + text)
      continue
    }
    if (LRC_LINE.test(line)) {
      out.push(line.replace(WORD_TAG, ''))
    }
  }
  return out.join('\n')
}

/**
 * 从 `lyric_info` 里取正文与译文。
 *
 * 译文挑法：优先简体中文（`ZH-HANS-CN`），否则取第一条含 CJK 的语言轨。与正文
 * 一字不差的那种也跳过——中文歌偶尔会把正文原样放进语言轨，拿出来只会两行重复。
 */
export function qishuiLyricsFromInfo(info: unknown): QishuiLyrics | null {
  if (!info || typeof info !== 'object') return null
  const bag = info as Record<string, unknown>
  const entity = bag.lyric_entity as { content?: unknown } | undefined
  const body = typeof entity?.content === 'string' ? entity.content : ''
  const lrc = qishuiLrc(body)
  if (!lrc) return null

  const translations = bag.lang_translations as Record<string, { content?: unknown }> | undefined
  let translation = ''
  if (translations && typeof translations === 'object') {
    const candidates = Object.entries(translations)
      .map(([lang, value]) => ({
        lang,
        text: typeof value?.content === 'string' ? qishuiLrc(value.content) : ''
      }))
      .filter((entry) => entry.text && entry.text !== lrc)
    const preferred =
      candidates.find((entry) => entry.lang.toUpperCase().startsWith('ZH-HANS')) ??
      candidates.find((entry) => CJK.test(entry.text))
    if (preferred) translation = preferred.text
  }

  return { lrc, translation }
}
