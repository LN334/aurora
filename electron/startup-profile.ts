import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { setActiveProfile as setKugouProfile } from './kugou/client'
import { setActiveProfile as setNeteaseProfile } from './netease/client'
import { setActiveProfile as setQishuiProfile } from './qishui/client'
import { setActiveProfile as setQqProfile } from './qq/client'

/*
 * Tell the platform clients which profile is in use before the renderer speaks.
 *
 * The active profile used to be set only from the renderer, through each
 * platform's `setProfile` channel. That path can be skipped - the online store
 * returns early while a provider is still being wired up - and when it is, the
 * clients fall back to `'default'`, whose session file does not exist. The user
 * then looks signed out even though the cookie is sitting on disk: collections
 * and followed artists come back empty with no error to show for it.
 *
 * So pick a profile here as well: the most recently written one under
 * `profiles/`. The renderer still rebinds when the user switches accounts, and
 * that wins - this is only the starting point.
 *
 * Returns the chosen id, or '' when there is nothing to choose.
 */
export function applyStartupProfile(): string {
  let best = ''
  let bestAt = 0
  try {
    const dir = path.join(app.getPath('userData'), 'profiles')
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.endsWith('.library.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (!id) continue
      try {
        const at = fs.statSync(path.join(dir, name)).mtimeMs
        if (at > bestAt) {
          bestAt = at
          best = id
        }
      } catch {
        // A file that vanished between readdir and stat is simply not a candidate.
      }
    }
  } catch {
    return ''
  }
  if (!best) return ''
  setNeteaseProfile(best)
  setQqProfile(best)
  setKugouProfile(best)
  setQishuiProfile(best)
  return best
}
