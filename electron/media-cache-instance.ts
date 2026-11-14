import { app } from 'electron'
import path from 'node:path'
import { createMediaCache, type MediaCache } from './media-cache'
import { loadSettings } from './settings'

/**
 * The one audio cache the main process owns.
 *
 * It lives in `userData/media-cache` next to the cover cache, so uninstalling
 * the app is enough to remove it. One instance rather than one per call site:
 * the protocol handler and the settings page must see the same file list and the
 * same budget, or "clear cache" would report a size that the player then serves
 * a hit from.
 */

let instance: MediaCache | null = null

export function mediaCache(): MediaCache {
  if (!instance) {
    instance = createMediaCache(
      path.join(app.getPath('userData'), 'media-cache'),
      loadSettings().mediaCacheLimitMb
    )
  }
  return instance
}
