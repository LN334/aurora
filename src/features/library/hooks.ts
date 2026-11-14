import { useCallback, useEffect, useState } from 'react'
import { isNative } from '../../bridge'
import { emptyLyrics, parseLrc, type Lyrics } from '../lyrics/lrc'
import type { Track } from '../../types'
import { extractPalette, IDLE_PALETTE, type Palette } from './palette'
import { artworkFor, sourceFor } from './source'
import { useAccentFromArt } from '../settings/accent'

/**
 * Resolve the current track's palette and publish it as CSS custom properties.
 *
 * This is the single mechanism behind "the interface owns no colour": nothing
 * downstream needs to know about artwork, it just reads `var(--accent)`.
 */
export function usePalette(track: Track | null): Palette {
  const [palette, setPalette] = useState<Palette>(IDLE_PALETTE)
  const trackId = track?.id ?? null
  const fromArt = useAccentFromArt()

  useEffect(() => {
    const source = artworkFor(track)
    // 关掉「跟着封面取色」时连取色都不做：没有壁纸也想要一套静止的冷灰，
    // 而且省掉每次换歌的一次 canvas 采样。
    if (!source || !fromArt) {
      setPalette(IDLE_PALETTE)
      return
    }
    let cancelled = false
    void extractPalette(source).then((next) => {
      if (!cancelled) setPalette(next)
    })
    return () => {
      cancelled = true
    }
    // Keyed on the track id, not the object: an equal track must not re-extract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, fromArt])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', palette.accent)
    root.style.setProperty('--accent-rgb', palette.accentRgb)
    root.style.setProperty('--accent-strong', palette.colors[1] ?? palette.accent)
  }, [palette])

  return palette
}

 interface LyricsState {
  lyrics: Lyrics
  /** Whether online lookup is allowed; the stage offers to turn it on. */
  onlineEnabled: boolean
  /** Force a re-resolve, e.g. right after enabling online lookup. */
  reload(): void
  setOnline(enabled: boolean): Promise<void>
}

/**
 * 平台都不给词时，去公共库问一次。
 *
 * 本地文件的扫描路径早就用上了 LRCLIB（见 source.ts 的 localSource），但那只在
 * 「本地文件且没有随附 .lrc」时走。在线歌一条路都不问它，于是酷狗与汽水（没有歌词
 * 接口）永远空白。歌词只跟词有关，不问是哪一家唱的这一版。
 *
 * 开关由主进程把关：设置里关掉在线歌词时，这个调用会直接返回 null。
 */
async function lookupSharedLyrics(track: Track): Promise<string | null> {
  const bridge = typeof window === 'undefined' ? undefined : window.aurora?.lyrics
  if (!bridge) return null
  const hit = await bridge
    .lookup({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration
    })
    .catch(() => null)
  return hit?.text ?? null
}

/**
 * 一首歌的歌词文本。
 *
 * 先问「这一版」的源。它没有的时候，挨个问同一首的其它版本：歌词只跟词有关，
 * 跟哪一家出声无关。酷狗与汽水目前都没有歌词接口（electron 侧只接了网易云和
 * QQ），不这样回退的话，漫游池里这两家的歌一律显示「这首歌还没有歌词」——
 * 而同一首在网易云或 QQ 上多半是有词的。
 *
 * 全部都空，才去公共库按歌名找一份：这是只有一首版本、且那一家恰好没有歌词时
 * 唯一的出路。
 */
async function resolveLyrics(subject: Track): Promise<string | null> {
  const own = await sourceFor(subject)
    .lyrics(subject)
    .catch(() => null)
  if (own) return own
  for (const alt of subject.versions ?? []) {
    if (alt.source === subject.source) continue
    const raw = await sourceFor(alt)
      .lyrics(alt)
      .catch(() => null)
    if (raw) return raw
  }
  return lookupSharedLyrics(subject)
}

/**
 * 一首歌的歌词原文，给「没有播放器上下文」的地方用——喜欢页那张词卡就是。
 *
 * 走的是和 useLyrics 同一条三级回退（本家 → 同一首的其它版本 → 公共库），
 * 只是不解析、不订阅：那里要的是三行文本，不是时间轴。
 */
export function lyricsTextFor(track: Track): Promise<string | null> {
  return resolveLyrics(track)
}

/** Lyrics for the current track. The owning source decides where they come from. */
export function useLyrics(track: Track | null): LyricsState {
  const [lyrics, setLyrics] = useState<Lyrics>(() => emptyLyrics())
  const [onlineEnabled, setOnlineEnabled] = useState(false)
  // Bumped to re-run the lookup against the same track.
  const [revision, setRevision] = useState(0)
  const trackId = track?.id ?? null

  useEffect(() => {
    if (!isNative) return
    void window.aurora?.lyrics.isOnlineEnabled().then(setOnlineEnabled)
  }, [])

  useEffect(() => {
    const subject = track
    if (!subject) {
      setLyrics(emptyLyrics())
      return
    }

    let cancelled = false
    void resolveLyrics(subject)
      .then((raw) => {
        if (!cancelled) setLyrics(raw ? parseLrc(raw) : emptyLyrics())
      })
      .catch(() => {
        if (!cancelled) setLyrics(emptyLyrics())
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, revision])

  const reload = useCallback(() => setRevision((value) => value + 1), [])

  const setOnline = useCallback(async (enabled: boolean) => {
    if (!isNative) return
    const applied = await window.aurora?.lyrics.setOnlineEnabled(enabled)
    setOnlineEnabled(Boolean(applied))
    // Re-resolve immediately so the user sees the result of their choice.
    setRevision((value) => value + 1)
  }, [])

  return { lyrics, onlineEnabled, reload, setOnline }
}
