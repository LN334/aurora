/**
 * Track matching for online lyric lookups, with no Electron or Node imports so
 * it can be tested directly from `tests/`.
 *
 * Why this exists: LRCLIB's search endpoint answers with anything whose title
 * or artist shares a word with the query, and the old client-side ranking was
 * "synced first, then closest duration". That picks a karaoke cover over the
 * real recording whenever the cover happens to be the only synchronised hit,
 * and it has no way to reject a result that simply is not the same song.
 *
 * The scoring follows Lyricify's shape, which is a sensible split of what
 * actually identifies a recording:
 *
 *   title   1.0    the strongest signal, after version tags are stripped
 *   artist  1.0    a different artist means a different recording
 *   album   0.4    often missing from file tags, so it must not dominate
 *   length  1.0    quantised into levels - tag durations are whole seconds
 *
 * Only the parts both sides actually have take part in the average, so a file
 * without an album tag is not punished for it. A candidate whose version tags
 * disagree with the query (a live take when the file is the studio cut) is
 * discounted rather than rejected: it is still the same song, just not the
 * recording the user pressed play on.
 */

export interface TrackFacts {
  title: string
  artist: string
  album?: string
  /** Seconds. Missing or zero means "unknown", which drops it from scoring. */
  duration?: number
}

/** Below this a search result is treated as "not the same song". */
export const MIN_MATCH_SCORE = 0.55

/** Level 5 means "further apart than 3.5s", i.e. no evidence at all. */
type DurationLevel = 0 | 1 | 2 | 3 | 4 | 5

const DURATION_SIMILARITY = [1, 0.92, 0.8, 0.62, 0.3, 0] as const

/*
 * Traditional / simplified pairs, one character each. Music tags are written in
 * whichever script the tagger's tool produced, so 「愛人」 and 「爱人」 are the same
 * song and must compare equal. Only unambiguous one-to-one pairs are listed:
 * forms such as 乾/幹/干 or 髮/發 all collapse to 发 in the simplified direction
 * but the reverse would be guesswork, so ambiguous characters are left alone.
 */
const TRADITIONAL_PAIRS = [
  '愛爱 罷罢 擺摆 敗败 辦办 幫帮 寶宝 報报 備备 貝贝 筆笔 邊边 變变 賓宾 補补 參参',
  '層层 產产 長长 場场 車车 徹彻 塵尘 陳陈 襯衬 稱称 懲惩 遲迟 衝冲 蟲虫 處处 觸触',
  '傳传 創创 純纯 詞词 從从 叢丛 湊凑 竄窜 錯错 達达 帶带 貸贷 擔担 單单 膽胆 當当',
  '擋挡 黨党 蕩荡 檔档 導导 島岛 燈灯 鄧邓 敵敌 遞递 點点 電电 墊垫 澱淀 調调 丟丢',
  '東东 動动 棟栋 鬥斗 獨独 讀读 賭赌 斷断 對对 隊队 噸吨 頓顿 奪夺 墮堕 兒儿 爾尔',
  '發发 髮发 罰罚 範范 釩钒 煩烦 飯饭 訪访 紡纺 飛飞 緋绯 廢废 費费 紛纷 墳坟 奮奋',
  '憤愤 豐丰 風风 瘋疯 馮冯 鳳凤 膚肤 輻辐 撫抚 輔辅 賦赋 復复 複复 負负 訃讣 婦妇',
  '縛缚 該该 蓋盖 幹干 趕赶 剛刚 鋼钢 崗岗 槓杠 鎬镐 鴿鸽 閣阁 個个 給给 龔龚 鞏巩',
  '溝沟 鉤钩 購购 夠够 關关 觀观 貫贯 廣广 歸归 龜龟 規规 貴贵 國国 過过 還还 漢汉',
  '號号 賀贺 紅红 後后 華华 畫画 懷怀 壞坏 歡欢 環环 換换 黃黄 揮挥 會会 繪绘 輝辉',
  '毀毁 彙汇 擊击 機机 積积 齊齐 濟济 計计 記记 紀纪 繼继 夾夹 駕驾 堅坚 間间 監监',
  '見见 劍剑 將将 獎奖 講讲 醬酱 膠胶 嬌娇 驕骄 攪搅 繳缴 較较 階阶 節节 潔洁 結结',
  '緊紧 謹谨 進进 盡尽 勁劲 驚惊 競竞 淨净 靜静 舊旧 覺觉 劇剧 據据 決决 絕绝 開开',
  '凱凯 殼壳 顆颗 課课 墾垦 懇恳 庫库 誇夸 塊块 虧亏 擴扩 臘腊 來来 賴赖 藍蓝 欄栏',
  '蘭兰 爛烂 纜缆 撈捞 勞劳 樂乐 淚泪 離离 裡里 裏里 禮礼 麗丽 厲厉 聯联 連连 憐怜',
  '練练 煉炼 戀恋 鏈链 糧粮 兩两 輛辆 療疗 遼辽 獵猎 臨临 鄰邻 靈灵 嶺岭 領领 劉刘',
  '龍龙 樓楼 盧卢 蘆芦 爐炉 陸陆 虜虏 錄录 慮虑 亂乱 輪轮 論论 羅罗 絡络 駱骆 馬马',
  '罵骂 嗎吗 買买 賣卖 邁迈 麥麦 蠻蛮 滿满 貓猫 貿贸 麼么 沒没 門门 悶闷 夢梦 彌弥',
  '謎谜 廟庙 滅灭 憫悯 鳴鸣 銘铭 謬谬 謀谋 畝亩 納纳 難难 鬧闹 惱恼 腦脑 內内 擬拟',
  '膩腻 釀酿 鳥鸟 聶聂 寧宁 擰拧 農农 濃浓 諾诺 歐欧 嘔呕 鷗鸥 盤盘 龐庞 賠赔 噴喷',
  '鵬鹏 騙骗 飄飘 貧贫 頻频 憑凭 蘋苹 評评 潑泼 鋪铺 樸朴 譜谱 騎骑 豈岂 啟启 氣气',
  '棄弃 遷迁 簽签 謙谦 錢钱 淺浅 譴谴 槍枪 牆墙 強强 搶抢 橋桥 竅窍 竊窃 親亲 輕轻',
  '傾倾 請请 慶庆 窮穷 區区 驅驱 趨趋 權权 勸劝 確确 讓让 擾扰 熱热 認认 榮荣 繞绕',
  '軟软 銳锐 潤润 灑洒 薩萨 賽赛 傘伞 喪丧 掃扫 澀涩 殺杀 紗纱 曬晒 閃闪 陝陕 傷伤',
  '賞赏 燒烧 紹绍 設设 紳绅 審审 腎肾 滲渗 聲声 繩绳 勝胜 聖圣 濕湿 時时 實实 識识',
  '駛驶 勢势 適适 釋释 飾饰 視视 試试 壽寿 獸兽 書书 屬属 術术 樹树 帥帅 雙双 誰谁',
  '順顺 說说 絲丝 鬆松 蘇苏 訴诉 雖虽 隨随 歲岁 孫孙 縮缩 瑣琐 鎖锁 臺台 態态 攤摊',
  '灘滩 湯汤 燙烫 濤涛 討讨 騰腾 題题 體体 條条 貼贴 鐵铁 聽听 廳厅 銅铜 統统 頭头',
  '圖图 團团 頹颓 脫脱 窪洼 襪袜 彎弯 灣湾 網网 韋韦 違违 圍围 維维 偉伟 衛卫 溫温',
  '紋纹 聞闻 穩稳 問问 蝸蜗 烏乌 無无 吳吴 務务 霧雾 誤误 錫锡 細细 戲戏 蝦虾 轄辖',
  '峽峡 狹狭 廈厦 鮮鲜 顯显 現现 獻献 縣县 線线 憲宪 鄉乡 詳详 響响 項项 銷销 曉晓',
  '諧谐 寫写 瀉泻 謝谢 興兴 須须 許许 敘叙 續续 緒绪 選选 學学 詢询 尋寻 訓训 訊讯',
  '遜逊 壓压 亞亚 啞哑 煙烟 鹽盐 嚴严 顏颜 閻阎 艷艳 厭厌 硯砚 驗验 陽阳 楊杨 養养',
  '樣样 謠谣 藥药 爺爷 業业 葉叶 頁页 義义 億亿 憶忆 藝艺 議议 譯译 異异 陰阴 銀银',
  '應应 營营 蠅蝇 贏赢 穎颖 喲哟 擁拥 傭佣 踴踊 優优 憂忧 郵邮 猶犹 遊游 誘诱 於于',
  '餘余 魚鱼 娛娱 與与 嶼屿 語语 鬱郁 譽誉 淵渊 園园 員员 圓圆 緣缘 遠远 願愿 約约',
  '躍跃 鑰钥 雲云 勻匀 運运 韻韵 雜杂 災灾 載载 贊赞 臟脏 鑿凿 棗枣 責责 擇择 澤泽',
  '賊贼 贈赠 軋轧 詐诈 齋斋 債债 氈毡 盞盏 斬斩 嶄崭 戰战 趙赵 這这 貞贞 針针 偵侦',
  '診诊 陣阵 掙挣 睜睁 猙狰 爭争 幀帧 鄭郑 證证 織织 職职 執执 紙纸 摯挚 擲掷 滯滞',
  '鐘钟 終终 種种 眾众 軸轴 皺皱 晝昼 驟骤 諸诸 豬猪 燭烛 囑嘱 築筑 鑄铸 專专 轉转',
  '賺赚 樁桩 莊庄 裝装 妝妆 壯壮 狀状 錐锥 贅赘 準准 濁浊 茲兹 資资 漬渍 綜综 總总',
  '縱纵 鄒邹 詛诅 組组 鑽钻'
].join(' ')

const SIMPLIFIED = new Map<string, string>()
for (const pair of TRADITIONAL_PAIRS.split(' ')) {
  const [traditional, simplified] = Array.from(pair)
  if (traditional && simplified && traditional !== simplified) {
    SIMPLIFIED.set(traditional, simplified)
  }
}

/**
 * Folds the spelling differences that are not musical: full-width punctuation,
 * curly quotes, traditional characters, and runs of whitespace. Case is kept
 * because LRCLIB's exact lookup is case-sensitive and this string is also used
 * to retry that lookup; the comparison helpers lower-case on their own.
 */
export function normalizeName(text: string): string {
  let out = text.normalize('NFKC')
  out = out.replace(/[\u2018\u2019`\u00B4]/g, "'").replace(/[\u201C\u201D]/g, '"')
  out = out.replace(/[\u2013\u2014\u2015]/g, '-')
  out = out.replace(/[\u00B7\u30FB\u2022]/g, ' ')
  out = Array.from(out, (character) => SIMPLIFIED.get(character) ?? character).join('')
  return out.replace(/\s+/g, ' ').trim()
}

/** Everything that is not a letter, digit, or CJK character, lower-cased. */
function compact(text: string): string {
  return normalizeName(text)
    .toLowerCase()
    .replace(/[^0-9a-z\u3400-\u9fff]+/g, '')
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let index = 0; index < text.length - 1; index += 1) {
    const key = text.slice(index, index + 2)
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/** Sorensen-Dice over character pairs; robust for short CJK titles. */
function dice(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0
  const a = bigrams(left)
  const b = bigrams(right)
  let shared = 0
  for (const [key, count] of a) shared += Math.min(count, b.get(key) ?? 0)
  return (2 * shared) / (left.length - 1 + (right.length - 1))
}

/**
 * 0..1 similarity of two names. An exact match after folding is 1; one name
 * containing the other scores high but never perfect, so 「晴天」 does not fully
 * credit 「晴天娃娃」; anything else falls back to character-pair overlap.
 */
export function textSimilarity(left: string, right: string): number {
  const a = compact(left)
  const b = compact(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
    const shorter = Math.min(a.length, b.length)
    const longer = Math.max(a.length, b.length)
    return 0.6 + 0.35 * (shorter / longer)
  }
  return dice(a, b)
}

const ARTIST_SPLIT =
  /[,\uFF0C\u3001&+\/]|\bfeat\.?\b|\bft\.?\b|\bwith\b|\u5408\u5531/i

function splitArtists(value: string): string[] {
  return value
    .split(ARTIST_SPLIT)
    .map((part) => compact(part))
    .filter(Boolean)
}

/**
 * Duet credits are written both as 「A、B」 and 「A feat. B」 or just 「A」, so an
 * overlap on any credited name counts. Full credit still beats a partial one.
 */
function artistSimilarity(left: string, right: string): number {
  const direct = textSimilarity(left, right)
  const a = splitArtists(left)
  const b = splitArtists(right)
  if (!a.length || !b.length) return direct

  let shared = 0
  for (const name of a) {
    if (b.some((other) => textSimilarity(name, other) >= 0.85)) shared += 1
  }
  if (!shared) return direct
  if (shared === Math.min(a.length, b.length)) return 1

  const overlap = shared / Math.min(a.length, b.length)
  return Math.max(direct, 0.7 + 0.25 * overlap)
}

/**
 * Quantised duration distance. LRCLIB reports whole seconds and a file's tag is
 * rarely the same rip, so sub-second precision carries no information.
 */
export function durationLevel(diff: number): DurationLevel {
  const gap = Math.abs(diff)
  if (!Number.isFinite(gap)) return 5
  if (gap < 0.1) return 0
  if (gap < 0.3) return 1
  if (gap < 0.7) return 2
  if (gap < 1.5) return 3
  if (gap < 3.5) return 4
  return 5
}

const BRACKET = /[([\u3010]([^()\[\]\u3010\u3011]{1,28})[)\]\u3011]/g
const DASH_TAIL = /\s+[-\u2013\u2014]\s+([^-\u2013\u2014]{1,28})$/
const VERSION_WORD =
  /\blive\b|\u73B0\u573A|\u6F14\u5531\u4F1A|\u4F34\u594F|\u7EAF\u97F3\u4E50|instrumental|inst\.?|\bremix\b|\u6DF7\u97F3|\bdj\b|acoustic|\u4E0D\u63D2\u7535|\bkaraoke\b|\bcover\b|\u7FFB\u5531|\u7FFB\u81EA|\bdemo\b|\u5C0F\u6837|remaster|\u6BCD\u5E26|\u91CD\u5236|\bedit\b|\bmix\b|\u7248|\bversion\b/i

const VERSION_TAGS: Array<[RegExp, string]> = [
  [/live|\u73B0\u573A|\u6F14\u5531\u4F1A/i, 'live'],
  [/\u4F34\u594F|\u7EAF\u97F3\u4E50|instrumental|inst/i, 'instrumental'],
  [/remix|\u6DF7\u97F3|\bdj\b/i, 'remix'],
  [/acoustic|\u4E0D\u63D2\u7535/i, 'acoustic'],
  [/karaoke/i, 'karaoke'],
  [/cover|\u7FFB\u5531|\u7FFB\u81EA/i, 'cover'],
  [/\bdemo\b|\u5C0F\u6837/i, 'demo'],
  [/remaster|\u6BCD\u5E26|\u91CD\u5236/i, 'remaster']
]

function versionTag(phrase: string): string {
  for (const [pattern, tag] of VERSION_TAGS) if (pattern.test(phrase)) return tag
  return 'version'
}

/**
 * Splits a title into its base name and the version tags that were stripped:
 * 「晴天 (Live)」 becomes 「晴天」 plus ['live']. Tags that say nothing about the
 * recording (「(电影主题曲)」) are left in the name on purpose.
 */
function splitVersion(raw: string): { base: string; tags: string[] } {
  const normalized = normalizeName(raw)
  const tags: string[] = []
  const note = (phrase: string) => {
    tags.push(versionTag(phrase))
    return ' '
  }

  let base = normalized.replace(BRACKET, (whole, inner: string) =>
    VERSION_WORD.test(inner) ? note(inner) : whole
  )
  const tail = DASH_TAIL.exec(base)
  if (tail && VERSION_WORD.test(tail[1])) {
    base = base.slice(0, tail.index) + note(tail[1])
  }

  return {
    base: base.replace(/\s+/g, ' ').trim(),
    tags: Array.from(new Set(tags)).sort()
  }
}

const UNKNOWN_ARTIST = '\u672A\u77E5\u827A\u672F\u5BB6'

function usableArtist(value: string): string {
  const name = normalizeName(value)
  return name === UNKNOWN_ARTIST ? '' : name
}

function versionPenalty(wanted: string[], found: string[]): number {
  if (!wanted.length && !found.length) return 1
  // The file is the plain song and the candidate is a live take: still the same
  // song, but the wrong recording, so it loses to a plain candidate.
  if (!wanted.length) return 0.82
  // The user asked for that specific version and the candidate is not it.
  if (!found.length) return 0.9
  return wanted.join('|') === found.join('|') ? 1 : 0.78
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * How much `candidate` looks like the same recording as `query`, 0..1.
 * Missing fields on either side are dropped and the remaining weights are
 * re-normalised, so an untagged file is compared on what it does have.
 */
export function scoreTrack(query: TrackFacts, candidate: TrackFacts): number {
  const wanted = splitVersion(query.title)
  const found = splitVersion(candidate.title)
  if (!wanted.base && !found.base) return 0

  let total = 0
  let weight = 0
  const add = (value: number, share: number) => {
    total += value * share
    weight += share
  }

  const titleScore = textSimilarity(wanted.base, found.base)
  add(titleScore, 1)

  const askedArtist = usableArtist(query.artist)
  const foundArtist = usableArtist(candidate.artist)
  if (askedArtist && foundArtist) add(artistSimilarity(askedArtist, foundArtist), 1)

  const askedAlbum = normalizeName(query.album ?? '')
  const foundAlbum = normalizeName(candidate.album ?? '')
  if (askedAlbum && foundAlbum) add(textSimilarity(askedAlbum, foundAlbum), 0.4)

  const askedLength = query.duration ?? 0
  const foundLength = candidate.duration ?? 0
  if (askedLength > 0 && foundLength > 0) {
    add(DURATION_SIMILARITY[durationLevel(askedLength - foundLength)], 1)
  }

  if (!weight) return 0
  let score = (total / weight) * versionPenalty(wanted.tags, found.tags)

  /*
   * A weak title is not a spelling variant, it is another song: no amount of
   * artist, album and length agreement turns 「稻香」 into 「晴天」. Everything else
   * is a correction on top of the title, so a title below half similarity caps
   * the whole score below the acceptance threshold.
   */
  if (titleScore < 0.5) score = Math.min(score, titleScore * 0.6)

  return clamp01(score)
}

interface MatchResult<T> {
  item: T
  score: number
}

/**
 * Picks the best candidate, or null when even the best one is not a match.
 * Ties keep the earlier candidate, so callers can put a preferred shape (a
 * synchronised result, say) first and win ties without a second score.
 */
export function pickBest<T>(
  items: readonly T[],
  query: TrackFacts,
  toFacts: (item: T) => TrackFacts,
  threshold: number = MIN_MATCH_SCORE
): MatchResult<T> | null {
  let best: MatchResult<T> | null = null
  for (const item of items) {
    const score = scoreTrack(query, toFacts(item))
    if (!best || score > best.score) best = { item, score }
  }
  if (!best || best.score < threshold) return null
  return best
}
