import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { loadSettings } from './settings'
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
 * then looks signed out even though the cookie is sitting on disk: the liked
 * list and followed artists come back empty with no error to show for it.
 *
 * So pick a profile here as well, in two steps:
 *
 * 1. The id the user last chose. `library:useProfile` writes it into settings
 *    on every switch, so this is a fact rather than an inference. It also
 *    covers the case of deliberately sitting on a profile with no account -
 *    that is a choice, and it should be remembered.
 * 2. Only when that is missing (fresh install, settings written before the key
 *    existed): guess from `profiles/`. The guess used to be "the newest json
 *    wins", which is simply wrong on a machine where an empty profile was
 *    created after the real one - the empty one is newest, so every cold start
 *    began signed out, and only a page reload (which rebinds the real profile)
 *    made the lists appear. Hence the tie-break by session weight, see
 *    `sessionBytes`.
 *
 * The renderer still rebinds when the user switches accounts, and that wins -
 * this is only the starting point.
 */

/** Profile ids double as file names, so the alphabet is narrow on purpose. */
const PROFILE_ID = /^[A-Za-z0-9_-]{1,48}$/

/** `<platform>-session.<profile>.bin`, the shape every client writes. */
const SESSION_FILE = /^(?:netease|qq|kugou|qishui)-session.([A-Za-z0-9_-]{1,48}).bin$/

export function applyStartupProfile(): string {
  const remembered = loadSettings().lastProfile
  const best = typeof remembered === 'string' && PROFILE_ID.test(remembered) ? remembered : guessProfile()

  if (!best) return ''
  setNeteaseProfile(best)
  setQqProfile(best)
  setKugouProfile(best)
  setQishuiProfile(best)
  return best
}

/**
 * The profile most likely to be the one the user means, when nothing is
 * recorded: the one carrying the most session bytes, then the newest.
 */
function guessProfile(): string {
  const bytes = sessionBytes()
  let best = ''
  let bestBytes = -1
  let bestAt = 0
  try {
    const dir = path.join(app.getPath('userData'), 'profiles')
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.endsWith('.library.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (!PROFILE_ID.test(id)) continue
      try {
        const at = fs.statSync(path.join(dir, name)).mtimeMs
        const weight = bytes.get(id) ?? 0
        if (weight > bestBytes || (weight === bestBytes && at > bestAt)) {
          bestBytes = weight
          bestAt = at
          best = id
        }
      } catch {
        // A file that vanished between readdir and stat is not a candidate.
      }
    }
  } catch {
    return ''
  }
  return best
}

/**
 * Bytes of stored session per profile id.
 *
 * The presence of a session file says little: a client writes an empty shell
 * (tens of bytes) the first time it is asked for anything, so a never-signed-in
 * profile still owns one. A real cookie jar is kilobytes. Weighting by bytes
 * picks the account the user actually logged into, which is exactly the signal
 * "which json was written last" was wrongly standing in for.
 */
function sessionBytes(): Map<string, number> {
  const sizes = new Map<string, number>()
  try {
    const dir = app.getPath('userData')
    for (const name of fs.readdirSync(dir)) {
      const match = SESSION_FILE.exec(name)
      if (!match) continue
      try {
        const size = fs.statSync(path.join(dir, name)).size
        sizes.set(match[1], (sizes.get(match[1]) ?? 0) + size)
      } catch {
        // Unreadable metadata simply contributes nothing.
      }
    }
  } catch {
    // No userData directory yet: nothing is signed in.
  }
  return sizes
}
