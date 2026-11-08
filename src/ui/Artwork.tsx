import { useState, type ReactNode } from 'react'

interface ArtworkProps {
  src: string | null
  alt?: string
  /** Rendered when there is no artwork at all, or when loading it fails. */
  fallback: ReactNode
  /**
   * First screenful: fetch immediately instead of waiting for the layout to
   * decide the picture is close enough to the viewport to be worth loading.
   */
  priority?: boolean
}

/**
 * Artwork with a graceful fallback.
 *
 * The scanner no longer decodes every file's embedded picture just to answer
 * "does this track have a cover" - that cost a Buffer per file. Artwork is
 * instead resolved lazily by the media protocol, which means `track.hasArt` is
 * an optimistic guess until the request comes back.
 *
 * The fade is done entirely in CSS (`animation: artIn ... both` in app.css), not
 * by waiting for `onLoad`: when the picture is already in the HTTP cache the
 * load event can fire before React attaches its handler, and anything gated on
 * that state would stay invisible forever. CSS starts from the moment the
 * element exists, so the worst case is "appeared without a fade".
 * The caller's tint stays visible underneath while the bytes are on their way.
 *
 * Without an error handler the optimistic guess produces a broken-image icon
 * for every track whose cover is missing, so the failure path is the whole
 * point of this component rather than an edge case.
 */
export function Artwork({ src, alt = '', fallback, priority = false }: ArtworkProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      draggable={false}
      className="artwork__img"
      onError={() => setFailed(true)}
    />
  )
}
