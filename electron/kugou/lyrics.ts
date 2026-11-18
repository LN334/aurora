import { inflateSync } from 'node:zlib'
import type { KugouSong } from './types'

/**
 * 酷狗歌词：KRC 加密歌词的取回、解密与解析。
 *
 * 这条线不走本地 vendor 服务，理由有三条，都是实测出来的：
 * 1. **歌词接口本来就不需要签名**。\`lyrics.kugou.com\` 的 \`/search\` 与
 *    \`/download\` 都是裸 GET，带上 \`hash\`、\`id\`、\`accesskey\` 就能拿到东西。
 * 2. **vendor 的 \`module/lyric.js\` 只做了下载那一跳**，候选搜索（\`/v1/search\`）
 *    在它那里是注了签名的另一支接口，实际返回空体——我们不必绕那条路。
 * 3. 参考库 Lyricify 的整套实现（\`Providers/Web/Kugou/Api.cs\`、
 *    \`Decrypter/Krc/Helper.cs\`）也是裸 GET，两家一致。
 *
 * 这条线只有「取回」需要网络；解密与解析是纯函数，可以直接单测。
 */

/**
 * KRC 的异或密钥。
 *
 * 与 Lyricify 的 \`Decrypter/Krc/Decrypter.cs:8\` 逐字节相同；酷狗没有公开密钥，
 * 这是社区长期沿用的那一份。
 */
const KRC_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69
])

/** KRC 里的一个时间点，单位是毫秒（上游原样，不做二次换算）。 */
interface KrcLine {
  time: number
  text: string
}

/** 一份 KRC 文档：正文行 + 可选译文行（按行号与正文对齐）。 */
interface KrcDocument {
  lines: KrcLine[]
  /** 正文行 -> 译文；没有译文时是空数组。 */
  translation: KrcLine[]
  /** 上游语言轨里识别出的译文语言标签；没有译文时是 null。 */
  language: string | null
}

/**
 * base64 的 KRC 载荷 -> 明文 KRC 文本。
 *
 * 三步：base64 解码后丢掉前 4 字节（魔数 \`krc1\`）、按 16 字节密钥循环异或、
 * zlib 解压。解出来的文本开头带着一个 BOM（或单字节前缀），要一并剥掉。
 */
export function decryptKrc(content: string): string {
  const raw = Buffer.from(content, 'base64')
  if (raw.length <= 4) throw new Error('KRC 载荷为空')
  const body = Buffer.from(raw.subarray(4))
  for (let i = 0; i < body.length; i += 1) body[i] ^= KRC_KEY[i % KRC_KEY.length]
  const text = inflateSync(body).toString('utf8')
  return text.replace(/^\uFEFF/, '').replace(/^\u0001/, '')
}

/** KRC 的逐字标记：\`<offset,duration,speed>\`，紧贴文字之前。 */
const KRC_WORD_TAG = /<\d+,\d+,-?\d+>/g
/** 正文行：\`[起始毫秒,时长毫秒]\` 后跟逐字段。 */
const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/
/** 语言轨：\`[language:<base64>]\`，值里是 JSON，右侧到行尾为止。 */
const KRC_LANGUAGE = /^\[language:([^\]]+)\]/

/** 至少含一个汉字/假名/谚文的行才算「译文候选」。 */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/**
 * 把 KRC 文本拆成正文行与译文行。
 *
 * 正文行按 \`[start,duration]\` 出现顺序收；译文藏在 \`[language:...]\` 那一行的
 * base64 里，解开来是 \`{ content: [{ lyricContent: string[][] }, ...] }\`，
 * 数组按行号与正文一一对应（实测 88 行对 88 行）。
 *
 * 语言轨可能不止一条：实测日文歌是「中文译文 + 罗马音」两条，中文歌则没有
 * language 行。挑法不能按序号，只能按内容——取含 CJK 比例最高的那条，罗马音
 * 一条 CJK 都不会有。
 */
export function parseKrc(krc: string): KrcDocument {
  const lines: KrcLine[] = []
  const languages: string[][] = []
  let language: string | null = null

  for (const raw of krc.split(/\r?\n/)) {
    const line = KRC_LINE.exec(raw)
    if (line) {
      lines.push({
        time: Number.parseInt(line[1], 10),
        text: line[3].replace(KRC_WORD_TAG, '').trim()
      })
      continue
    }
    const lang = KRC_LANGUAGE.exec(raw)
    if (lang) {
      const decoded = decodeLanguage(lang[1])
      if (decoded) {
        languages.push(...decoded.tracks)
        if (!language && decoded.language) language = decoded.language
      }
    }
  }

  // 从语言轨里挑译文：含 CJK 的行数最多、且至少过半的那些才算。
  const best = languages
    .map((track) => ({ track, hits: track.filter((line) => CJK.test(line)).length }))
    .filter((entry) => entry.hits > 0 && entry.hits * 2 >= entry.track.length)
    .sort((a, b) => b.hits - a.hits)[0]

  const translation: KrcLine[] = []
  if (best) {
    for (let i = 0; i < lines.length; i += 1) {
      const text = (best.track[i] ?? '').trim()
      if (text) translation.push({ time: lines[i].time, text })
    }
  }

  return { lines, translation, language }
}

/**
 * 解码 \`[language:...]\` 的值。
 *
 * 上游给的 base64 不保证补齐到 4 的倍数，缺的补 \`=\`；解出来的 JSON 里
 * \`content\` 是若干条语言轨，每条带 \`lyricContent\`（按行排列的字符数组）。
 * 语言标签在样本里恒为 0，分不出中/日/英，所以只当元信息带着，判断交给内容。
 */
function decodeLanguage(
  payload: string
): { tracks: string[][]; language: string | null } | null {
  try {
    let padded = payload
    while (padded.length % 4 !== 0) padded += '='
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      content?: Array<{ language?: unknown; lyricContent?: Array<string[] | string> }>
    }
    const entries = parsed.content ?? []
    if (entries.length === 0) return null
    // 一封 language 值里可以带多条轨（实测日文歌是「中文译文 + 罗马音」两条）；
    // 全部交回去，由调用方按内容挑。
    const tracks = entries.map((entry) =>
      (entry.lyricContent ?? []).map((row) => (Array.isArray(row) ? row.join('') : String(row ?? '')))
    )
    const first = entries[0]
    const tag = typeof first.language === 'number' ? String(first.language) : null
    return { tracks, language: tag }
  } catch {
    return null
  }
}

// --- 取回 ---------------------------------------------------------------

/** 歌词候选。\`krctype=1\` 是带语言轨的完整版，\`2\` 是纯正文。 */
interface KrcCandidate {
  id: number
  accesskey: string
  krctype: number
  /** 毫秒。 */
  duration: number
}

/** 一次上游取回的成品：两份 LRC 文本，时间戳来自同一份 KRC，天然对齐。 */
export interface KugouLyricsPayload {
  lrc: string
  translation: string
  /** 是否拿到了译文（空字符串也算没拿到）。 */
  hasTranslation: boolean
}

const REQUEST_TIMEOUT = 8000

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      // 两个域名都只认一个像浏览器的 UA；带 Referer 只是照着参考库的请求照抄。
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
      Referer: 'https://www.kugou.com/'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return (await response.json()) as unknown
}

/**
 * 按歌曲身份找歌词候选。
 *
 * \`hash\` 是关键词，实测只给关键词会返回 \`status:200 OK\` 加空候选；带上
 * \`hash\` 与 \`duration\` 才有结果。\`duration\` 参与匹配，所以单位用毫秒。
 */
async function findCandidates(song: KugouSong): Promise<KrcCandidate[]> {
  const query = new URLSearchParams({
    ver: '1',
    man: 'yes',
    client: 'pc',
    keyword: song.name,
    duration: String(Math.round(song.duration * 1000)),
    hash: song.hash
  })
  const body = (await getJson('https://lyrics.kugou.com/search?' + query.toString())) as {
    candidates?: KrcCandidate[]
  }
  return body.candidates ?? []
}

function downloadUrl(candidate: KrcCandidate): string {
  const query = new URLSearchParams({
    ver: '1',
    client: 'pc',
    id: String(candidate.id),
    accesskey: candidate.accesskey,
    fmt: 'krc',
    charset: 'utf8'
  })
  return 'https://lyrics.kugou.com/download?' + query.toString()
}

/** 毫秒 -> \`[mm:ss.xx]\`，LRC 的惯用写法。 */
function lrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return '[' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + String(centis).padStart(2, '0') + ']'
}

function toLrc(lines: KrcLine[]): string {
  return lines.map((line) => lrcTime(line.time) + line.text).join('\n')
}

/**
 * 一首歌的歌词：候选 -> KRC -> 正文 + 译文。
 *
 * 失败一律返回 null：歌词是可选内容，界面按「没有歌词」处理，而不是报错。
 * 候选里优先 \`krctype=1\`，它们才带语言轨；都挑不到时退回第一个。
 */
export async function fetchKugouLyrics(song: KugouSong): Promise<KugouLyricsPayload | null> {
  const candidates = await findCandidates(song)
  if (candidates.length === 0) return null

  const preferred =
    candidates.find((candidate) => candidate.krctype === 1) ?? candidates[0]
  const body = (await getJson(downloadUrl(preferred))) as { content?: string }
  if (!body.content) return null

  const document = parseKrc(decryptKrc(body.content))
  if (document.lines.length === 0) return null

  const lrc = toLrc(document.lines)
  const translation = toLrc(document.translation)
  return { lrc, translation, hasTranslation: translation.length > 0 }
}
