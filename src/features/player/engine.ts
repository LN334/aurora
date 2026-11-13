import { bridge, isNative } from '../../bridge'
import { coverDataUrl } from './artwork'
import { volumeIntentChanged } from './volume'
import { sourceFor } from '../library/source'
import { pickPlayable } from './pick'
import { swapFadeMs } from './crossfade'
import type { Track } from '../../types'
import { useHistory } from './history-store'
import { EQ_BANDS, usePlayer } from './store'

const FADE_IN_MS = 220
const FADE_OUT_MS = 150

/**
 * How often the playhead is published while the player window is off screen.
 *
 * A quarter of a second, i.e. 4 Hz instead of 60. Only two things read the
 * playhead when nothing is being drawn: the desktop lyric window, whose
 * highlight is `activeLineAt(position)`, and the transport chrome, which is
 * already quantised to an eighth of a second (see components/Bar.tsx). Lyric
 * lines change every few seconds, so sampling the clock four times a second
 * cannot show the wrong line or skip one - it can only delay a switch by less
 * than a quarter second, which is a fraction of the time it takes to read the
 * line. Lower would start to matter (a 1 s step is visible while the overlay is
 * being watched); higher would leave sixty wake-ups a second in place, and with
 * `backgroundThrottling: false` those wake-ups are the whole background cost.
 */
export const HIDDEN_POSITION_MS = 250

/*
 * Window visibility, as a subscription rather than a hook.
 *
 * `useWindowVisibility()` (src/visibility.ts) is the component-facing version of
 * this and cannot be used here, because the ticker is a singleton that lives
 * outside React. The rule is the same one the main process enforces: inside
 * Electron only `isVisible()`/`isMinimized()` decide, so a merely unfocused or
 * partly covered window stays visible and is never slowed down. In a browser
 * there is no tray and no second window, so `document.hidden` is accurate there.
 */
let windowVisible = true
let visibilityBound = false
const visibilityListeners = new Set<(visible: boolean) => void>()

function publishVisibility(next: boolean): void {
  if (next === windowVisible) return
  windowVisible = next
  for (const listener of visibilityListeners) listener(next)
}

function bindVisibility(): void {
  if (visibilityBound) return
  visibilityBound = true
  if (!isNative) {
    const sync = () => publishVisibility(!document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return
  }
  void bridge.app.getVisibility().then((state) => publishVisibility(state.visible))
  bridge.app.onVisibility((state) => publishVisibility(state.visible))
}

/** The current answer from Electron (or from Chromium in a browser tab). */
export function isWindowVisible(): boolean {
  bindVisibility()
  return windowVisible
}

/** Notifies on every change and returns an unsubscribe. */
export function onWindowVisibility(listener: (visible: boolean) => void): () => void {
  bindVisibility()
  visibilityListeners.add(listener)
  return () => visibilityListeners.delete(listener)
}

/**
 * The engine needs to advance the queue on its own (a track ending, or an
 * OS media-key press on the SMTC overlay). Importing the actions module here
 * would close an import cycle, so the actions module plugs itself in instead.
 */
export const engineHooks = {
  next: (fromEnd: boolean): void => void fromEnd,
  prev: (): void => {},
  /**
   * 这一首取不到任何音源（会员曲、下架、取流全失败）。
   *
   * 引擎只如实报告，跳不跳由播放器决定——队列与「连跳几首了」都在 actions
   * 那一侧，引擎不知道。没有这一步时队列会钉死在 0:00。
   */
  unplayable: (track: Track): void => void track,
  /** 这一首有源、装上了：连续跳过链可以归零。 */
  playable: (track: Track): void => void track
}

class AudioEngine {
  private el: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  /**
   * Retained deliberately. A media element gets exactly one source node for its
   * lifetime, and holding the reference guards against any collection of a node
   * the element still points at. Public so the type checker does not read the
   * retention as dead state.
   */
  source: MediaElementAudioSourceNode | null = null
  private preGain: GainNode | null = null
  private bands: BiquadFilterNode[] = []
  private analyser: AnalyserNode | null = null
  private master: GainNode | null = null
  private fade: GainNode | null = null
  // Inferred as Uint8Array<ArrayBuffer>, which is what the analyser API wants.
  private spectrum = new Uint8Array(0)
  private waveform = new Uint8Array(0)
  private raf = 0
  /** Set while the playhead is being published from a timer instead of rAF. */
  private hiddenTimer = 0
  /** True between play() and pause()/ended: the ticker should be clocking. */
  private tickerActive = false
  private unbindVisibility: (() => void) | null = null
  private loadedPath: string | null = null
  /**
   * 正在取流/装配的那一首。
   *
   * 在线曲目的地址是异步来的：取流成功时 store 会回调「补上了，接着放」，
   * 而外层的 load 其实还没返回。若那个回调不管不顾再 load 一次，同一个
   * audio 元素就被指了两次 src，第一次 play() 作废（AbortError），表现是
   * 进度条停在 0:00 不动。这个字段让回调知道「已经有人在装这一首了」。
   */
  private loadingTrack: Track | null = null
  /** Invalidates in-flight fades when the user interrupts one. */
  private fadeToken = 0
  /**
   * 切歌那一次淡入该用多久。
   *
   * 设成 0 时才退回 FADE_IN_MS——普通暂停恢复不该因为交叉淡化调成 6 秒
   * 就跟着慢慢浮起来。
   */
  private pendingFadeInMs = 0

  /**
   * Which metadata update the cover being encoded belongs to. The cover is read
   * asynchronously, and skipping tracks quickly must not let a late image land on
   * the next track's card.
   */
  private artworkToken = 0
  /**
   * 音量意图的订阅句柄。播放条走 actions（那里会主动通知引擎），但歌词页的
   * 滑杆、快捷键、以及从磁盘恢复的偏好是直接写 store 的；这里统一兜住，
   * 免得「改完音量没反应，切一首歌才生效」。
   */
  private unsubscribeVolume: (() => void) | null = null
  /**
   * The track the clock is currently crediting, plus the unstored seconds
   * seen since it started. Kept here rather than in the store because this is
   * the only place that knows how much audio really played (a seek is not
   * listening time, and neither is a paused player).
   */
  private playingTrack: Track | null = null
  private lastProgressAt = 0
  private pendingSeconds = 0

  private build(): void {
    if (this.ctx) return

    const el = new Audio()
    // Load-bearing: without CORS approval a media element routed through Web
    // Audio outputs pure silence, so this must be set before any src.
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.autoplay = false

    const ctx = new AudioContext({ latencyHint: 'playback' })
    const source = ctx.createMediaElementSource(el)

    const preGain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 4096
    // Enough smoothing that the spectrum reads as motion, not as noise.
    analyser.smoothingTimeConstant = 0.8
    const master = ctx.createGain()
    const fade = ctx.createGain()

    const bands = EQ_BANDS.map((freq, i) => {
      const band = ctx.createBiquadFilter()
      band.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      band.frequency.value = freq
      band.Q.value = 0.9
      band.gain.value = 0
      return band
    })

    let node: AudioNode = source
    node.connect(preGain)
    node = preGain
    for (const band of bands) {
      node.connect(band)
      node = band
    }
    node.connect(analyser)
    analyser.connect(master)
    master.connect(fade)
    fade.connect(ctx.destination)

    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration)) usePlayer.getState().setDuration(el.duration)
      usePlayer.getState().setLoading(false)
    })
    el.addEventListener('canplay', () => usePlayer.getState().setLoading(false))
    el.addEventListener('waiting', () => usePlayer.getState().setLoading(true))
    el.addEventListener('error', () => {
      usePlayer.getState().setLoading(false)
      usePlayer.getState().setPlaying(false)
      console.error('[aurora] media error', el.error?.message ?? el.error?.code)
    })
    el.addEventListener('ended', () => {
      this.stopTicker()
      useHistory.getState().flush()
      engineHooks.next(true)
    })

    this.el = el
    this.ctx = ctx
    this.source = source
    this.preGain = preGain
    this.analyser = analyser
    this.master = master
    this.fade = fade
    this.bands = bands
    this.spectrum = new Uint8Array(analyser.frequencyBinCount)
    // 时域长度是 fftSize，不是 frequencyBinCount——这两者差一倍，指错了就是半个波形。
    this.waveform = new Uint8Array(analyser.fftSize)

    this.applyEq()
    this.applyVolume()
    this.installMediaSession()
    this.unsubscribeVolume ??= usePlayer.subscribe((state, prev) => {
      if (volumeIntentChanged(prev, state)) this.applyVolume()
    })
  }

  // --- graph control -------------------------------------------------------

  private ramp(to: number, ms: number): void {
    const ctx = this.ctx
    const fade = this.fade
    if (!ctx || !fade) return
    const now = ctx.currentTime
    fade.gain.cancelScheduledValues(now)
    // Anchor at the current value so an interrupted ramp does not jump.
    fade.gain.setValueAtTime(fade.gain.value, now)
    fade.gain.linearRampToValueAtTime(to, now + ms / 1000)
  }

  private applyVolume(): void {
    const { volume, muted } = usePlayer.getState()
    if (this.master) this.master.gain.value = muted ? 0 : volume
  }

  private applyEq(): void {
    const { eqEnabled, eqGains } = usePlayer.getState()
    const target = eqEnabled ? eqGains : EQ_BANDS.map(() => 0)
    this.bands.forEach((band, i) => {
      band.gain.value = target[i] ?? 0
    })
  }

  /**
   * ReplayGain, with peak-aware headroom: a positive gain on an already-loud
   * master would clip, so the boost is capped by the track's own peak.
   */
  private applyReplayGain(track: Track): void {
    if (!this.preGain) return
    let gain = 1
    if (track.gainDb !== null && Number.isFinite(track.gainDb)) {
      gain = Math.pow(10, track.gainDb / 20)
      if (track.peak !== null && track.peak > 0 && gain * track.peak > 1) {
        gain = 1 / track.peak
      }
    }
    this.preGain.gain.value = gain
  }

  // --- transport -----------------------------------------------------------

  async load(track: Track, autoplay: boolean): Promise<void> {
    this.build()
    const ctx = this.ctx
    const el = this.el
    if (!ctx || !el) return

    if (ctx.state === 'suspended') await ctx.resume()

    this.loadingTrack = track
    const store = usePlayer.getState()
    store.setLoading(true)
    // Show the tag duration immediately; the real one lands on loadedmetadata.
    store.setDuration(track.duration || 0)
    store.setPosition(0)

    const isSameFile = this.loadedPath === track.path
    if (!isSameFile) {
      /*
       * 哪一家来播这一首，由音源优先级决定。
       *
       * 多平台统一之后「这首歌在哪听」不再是一件事：本机有文件、网易云有 320k、
       * QQ 有无损，三者都挂着同一行。pickPlayable 按用户排的顺序挑第一个真能
       * 出流的版本，引擎只管播放它——引擎不需要知道平台有几个。
       */
      const picked = await pickPlayable(track)
      if (!picked) {
        console.error('[aurora] this track has no playable source', track.id)
        /*
         * 清掉 loadedPath：这一首没有真正装上。地址迟到之后 store 会回调
         * reloadCurrent，它靠「装没装上」判断该不该重来——留着上一次的值
         * 会让重试被当成「已经装好了」，于是永远不出声。
         */
        this.loadingTrack = null
        this.loadedPath = null
        store.setLoading(false)
        /*
         * 上一首要停。这一首没装上，元素里还挂着上一首的 src；不停就是
         * 「标题换成这首、响的还是上一首」，比 0:00 更难懂。
         */
        this.pause()
        // 跳哪去由播放器决定，引擎不替它做决定。
        engineHooks.unplayable(track)
        return
      }
      const url = picked.url

      const swapMs = swapFadeMs(store.crossfadeSec)
      /*
       * 这个秒数就是「淡出用多久、淡入也用多久」。上一版读它只当成一个开关，
       * 真正淡的时长写死 190ms，滑到 12 秒和滑到 1 秒一模一样——设置页写着
       * 「两首歌重叠的秒数」就更是空话：整个播放引擎只有一个 audio 元素，
       * 换 src 时上一首已经停了，两首不可能叠在一起。
       */
      const swapping = swapMs > 0 && !el.paused && this.loadedPath !== null

      if (swapping) {
        const token = ++this.fadeToken
        this.ramp(0, swapMs)
        await new Promise((resolve) => window.setTimeout(resolve, swapMs))
        if (token !== this.fadeToken) return
        this.pendingFadeInMs = swapMs
      }

      el.src = url
      el.load()
      this.loadedPath = track.path
    }

    // 有源、装上了：连续跳过链到此为止。
    engineHooks.playable(track)

    this.applyReplayGain(track)
    this.applyEq()
    this.applyVolume()
    this.updateMediaSession(track)
    this.playingTrack = track
    this.lastProgressAt = 0
    this.pendingSeconds = 0
    useHistory.getState().noteStart(track)

    if (autoplay) await this.play()
    else {
      // 没开播就不该留着这一份淡入时长，下次纯手点播放会被它拖慢。
      this.pendingFadeInMs = 0
      store.setLoading(false)
    }
    this.loadingTrack = null
  }

  /**
   * 这一首是不是已经指上了：正在装，或者已经装好。
   *
   * 给「地址迟到」的回填用。为 false 才说明上一次真的没装上，值得再 load
   * 一次；为 true 时再 load 只会把正在进行的 play() 打断。
   */
  isTrackReady(track: Track): boolean {
    if (this.loadingTrack?.id === track.id) return true
    return this.loadedPath !== null && this.loadedPath === track.path
  }

  async play(): Promise<void> {
    this.build()
    const ctx = this.ctx
    const el = this.el
    if (!ctx || !el) return
    if (ctx.state === 'suspended') await ctx.resume()

    this.fadeToken += 1
    try {
      await el.play()
    } catch (error) {
      /*
       * AbortError 只有一个来源：元素在被指到新的 src，这一次 play() 作废。
       * 接管它的是另一次 load，那一次会自己调 play，所以这里既不该记成
       * 「播放被阻止」，也不该把按钮按死——否则界面显示暂停、声音其实在放，
       * 或者反过来：一首都放不出来。
       */
      if ((error as { name?: string } | null)?.name === 'AbortError') return
      console.error('[aurora] playback was blocked', error)
      usePlayer.getState().setPlaying(false)
      return
    }
    this.ramp(1, this.pendingFadeInMs || FADE_IN_MS)
    this.pendingFadeInMs = 0
    usePlayer.getState().setPlaying(true)
    this.startTicker()
  }

  pause(): void {
    const el = this.el
    if (!el) return
    // Fade first, then actually stop, so pausing does not click.
    const token = ++this.fadeToken
    this.ramp(0, FADE_OUT_MS)
    window.setTimeout(() => {
      if (token !== this.fadeToken) return
      el.pause()
      usePlayer.getState().setPlaying(false)
      this.stopTicker()
      useHistory.getState().flush()
    }, FADE_OUT_MS)
  }

  seek(seconds: number): void {
    const el = this.el
    if (!el || !Number.isFinite(seconds)) return
    const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds
    el.currentTime = Math.min(Math.max(0, seconds), Math.max(0, limit - 0.05))
    usePlayer.getState().setPosition(el.currentTime)
  }

  setVolume(): void {
    this.applyVolume()
  }

  setEq(): void {
    this.applyEq()
  }

  getSpectrum(): Uint8Array | null {
    const analyser = this.analyser
    if (!analyser || this.spectrum.length === 0) return null
    analyser.getByteFrequencyData(this.spectrum)
    return this.spectrum
  }

  /**
   * 时域采样，给峰值 / RMS 表用。
   *
   * 频域那一路已经做过平滑（smoothingTimeConstant 0.8），拿它算「这一下有多响」
   * 会永远慢半拍，也看不出削波。真电平得看波形。
   */
  getWaveform(): Uint8Array | null {
    const analyser = this.analyser
    if (!analyser || this.waveform.length === 0) return null
    analyser.getByteTimeDomainData(this.waveform)
    return this.waveform
  }

  /** 输出上下文的采样率与延迟；还没建图时返回 null。 */
  getAudioInfo(): { sampleRate: number; baseLatency: number; state: string } | null {
    const ctx = this.ctx
    if (!ctx) return null
    return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, state: ctx.state }
  }

  /**
   * Credit listened seconds to the history.
   *
   * Called from the position ticker, which runs at 60 Hz on screen and 4 Hz
   * off screen. A frame-sized delta is accumulated until it makes a whole
   * second, because a write per frame would be absurd; a large delta means the
   * user seeked, which is not listening time, so it is dropped rather than
   * counted.
   */
  private recordProgress(el: HTMLAudioElement): void {
    const track = this.playingTrack
    if (!track) return
    const now = el.currentTime
    const delta = now - this.lastProgressAt
    this.lastProgressAt = now
    if (!(delta > 0) || delta > 3) return
    this.pendingSeconds += delta
    if (this.pendingSeconds < 1) return
    const whole = Math.floor(this.pendingSeconds)
    this.pendingSeconds -= whole
    useHistory.getState().noteSeconds(track, whole)
  }

  // --- position reporting --------------------------------------------------

  /**
   * 把元素上的时间写进 store。
   *
   * 换源这一段不写：`load()` 已经把进度归零，真正的元素却还挂着上一首的
   * currentTime——新地址要等网络回来才换上，这中间少则一两百毫秒、多则一秒。
   * 照读就会把进度条写成上一首的位置（标题已是新歌、进度还停在上一首的 0:46），
   * 一秒后才跳回 0:00，看起来像「切歌没归零」。
   *
   * 只挡写入、不挡计时：淡出那几秒上一首确实还在响，listened seconds 照记不误。
   */
  private publishPosition(el: HTMLAudioElement): void {
    if (this.loadingTrack !== null) return
    usePlayer.getState().setPosition(el.currentTime)
  }

  private startTicker(): void {
    this.tickerActive = true
    if (!this.unbindVisibility) this.unbindVisibility = onWindowVisibility(() => this.armTicker())
    this.armTicker()
  }

  /**
   * Arms whichever clock matches the current visibility. Always disarms first, so
   * a visibility change cannot leave a timer and an animation frame both running.
   */
  private armTicker(): void {
    this.disarmTicker()
    if (!this.tickerActive) return
    const el = this.el
    if (!el) return

    if (isWindowVisible()) {
      const tick = () => {
        this.publishPosition(el)
        this.recordProgress(el)
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
      return
    }

    /*
     * Off screen: a timer, not a throttled animation frame. Skipping the write
     * while still being called every frame would keep the renderer waking up
     * sixty times a second, which is the cost worth removing here.
     */
    const tick = () => {
      this.publishPosition(el)
      this.recordProgress(el)
    }
    // Publish once immediately so the desktop lyric window is not a quarter
    // second stale for the whole first interval after the window is hidden.
    tick()
    this.hiddenTimer = window.setInterval(tick, HIDDEN_POSITION_MS)
  }

  private disarmTicker(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.hiddenTimer) {
      window.clearInterval(this.hiddenTimer)
      this.hiddenTimer = 0
    }
  }

  private stopTicker(): void {
    this.tickerActive = false
    this.disarmTicker()
    this.unbindVisibility?.()
    this.unbindVisibility = null
  }

  // --- OS integration ------------------------------------------------------

  private installMediaSession(): void {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    const bind = (action: MediaSessionAction) => {
      try {
        ms.setActionHandler(action, (details) => {
          switch (action) {
            case 'play':
              void this.play()
              break
            case 'pause':
              this.pause()
              break
            case 'nexttrack':
              engineHooks.next(false)
              break
            case 'previoustrack':
              engineHooks.prev()
              break
            case 'stop':
              this.pause()
              this.seek(0)
              break
            case 'seekto':
              if (typeof details.seekTime === 'number') this.seek(details.seekTime)
              break
            case 'seekbackward':
              this.seek((this.el?.currentTime ?? 0) - (details.seekOffset ?? 10))
              break
            case 'seekforward':
              this.seek((this.el?.currentTime ?? 0) + (details.seekOffset ?? 10))
              break
          }
        })
      } catch {
        // Not every Chromium build implements every action; ignoring is correct.
      }
    }

    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'nexttrack',
      'previoustrack',
      'stop',
      'seekto',
      'seekbackward',
      'seekforward'
    ]
    actions.forEach(bind)
  }

  private updateMediaSession(track: Track | null): void {
    if (!('mediaSession' in navigator)) return
    const token = ++this.artworkToken
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    const text = { title: track.title, artist: track.artist, album: track.album }
    // Text first, cover second: the card is correct the moment the track
    // changes, and the thumbnail fills in as soon as the image has been read.
    navigator.mediaSession.metadata = new MediaMetadata({ ...text, artwork: [] })

    const src = sourceFor(track).artUrl(track)
    if (!src) return
    void coverDataUrl(src).then((data) => {
      if (!data || token !== this.artworkToken) return
      navigator.mediaSession.metadata = new MediaMetadata({
        ...text,
        artwork: [{ src: data, sizes: '512x512', type: 'image/jpeg' }]
      })
    })
  }
}

export const engine = new AudioEngine()
