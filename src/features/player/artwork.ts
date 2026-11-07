/**
 * Cover art for the OS media card.
 *
 * Chromium does not pass `navigator.mediaSession.metadata.artwork` straight to
 * the system: the platform media integration loads the image itself, and that
 * loader only understands http(s), data and blob URLs. An app-private scheme
 * such as `aurora-media://` or `aurora-remote://` is silently dropped, so
 * Windows got a session with a title and artist but no thumbnail - and anything
 * that mirrors the session (taskbar lyric bars, media widgets, other players'
 * now-playing handoff) drew a placeholder instead of the cover.
 *
 * Re-encoding the cover into a data URL fixes that without giving up the private
 * schemes: the page can still read both, and the encoded bytes are exactly what
 * the platform needs. 512 px is the size Windows asks for; a larger cover only
 * makes the URL longer for no visible gain.
 */

export const COVER_MAX_SIZE = 512
export const COVER_QUALITY = 0.85

/** Long enough for a slow CDN, short enough that a dead URL is not a hang. */
const COVER_TIMEOUT_MS = 8000

/** Covers repeat across a session (album view, queue, replay), so keep a few. */
const CACHE_LIMIT = 40

/**
 * Centre-crop box for a cover of `width` x `height`.
 *
 * Covers are square almost everywhere, but scraped artwork is not always, and
 * stretching it into the card looks broken. Taking the largest centred square
 * keeps the subject and throws away the letterbox.
 */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  // A decoded image always reports finite pixel counts, but the guard keeps a
  // broken or absurd value from leaking Infinity/NaN into `drawImage`.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { sx: 0, sy: 0, size: 0 }
  }
  const size = Math.min(width, height)
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size }
}

const cache = new Map<string, string | null>()

function remember(key: string, value: string | null): string | null {
  if (cache.size >= CACHE_LIMIT && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
  return value
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), COVER_TIMEOUT_MS)
    image.onload = () => {
      clearTimeout(timer)
      finish(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      finish(null)
    }
    // Both private schemes send `access-control-allow-origin: *`, so the canvas
    // can read the pixels back; without this the canvas is tainted and
    // `toDataURL` throws instead of returning a cover.
    image.crossOrigin = 'anonymous'
    image.src = src
  })
}

/**
 * The cover at `src` as a JPEG data URL, or null when there is no usable image.
 *
 * Never throws: a missing cover is normal (most of a local library has none) and
 * must not cost the caller a try/catch around the metadata update.
 */
export async function coverDataUrl(src: string | null | undefined): Promise<string | null> {
  if (!src) return null
  if (cache.has(src)) return cache.get(src) ?? null
  try {
    const image = await loadImage(src)
    if (!image) return remember(src, null)
    const crop = squareCrop(image.naturalWidth, image.naturalHeight)
    if (crop.size <= 0) return remember(src, null)
    const size = Math.min(COVER_MAX_SIZE, crop.size)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) return remember(src, null)
    context.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, size, size)
    return remember(src, canvas.toDataURL('image/jpeg', COVER_QUALITY))
  } catch {
    return remember(src, null)
  }
}

