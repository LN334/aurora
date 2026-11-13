import type { Track } from '../../types.ts'
import { getProvider } from './registry.ts'
import type { PlatformBackend } from './store.ts'
import type { ProviderPlaylistWriteApi, ProviderId } from './types.ts'
import { showFlash } from '../../ui/flash.ts'

/**
 * 平台歌单的写入，界面这一侧只认这四件事：改名、删单、加歌、移出歌。
 *
 * 四家能力并不齐：网易云与 QQ 五件事都能做，酷狗能点红心、歌单只读，汽水能加歌/
 * 移出歌与喜欢。所以这里全部返回「可不可以 + 结果」而不是抛错——页面据此决定
 * 摆不摆按钮。宁可少一个按钮，也不摆一个点下去没反应的。
 */

/** 这一家的写通道；没有就是这家还写不了。 */
function playlistWriter(providerId: ProviderId | string): ProviderPlaylistWriteApi | null {
  const provider = getProvider(providerId as ProviderId)
  return provider?.playlists ?? null
}

/**
 * 这张单子能不能改。
 *
 * 账号里收藏来的单子，上游一律只让读（那是别人的东西）。平台分不清自建和收藏
 * 时（QQ/酷狗/汽水的列表接口都不给归属），退回 subscribed；两样都没有才按
 * 「不能改」处理——没把握的事不要摆成按钮。
 */
export function canWritePlaylist(
  providerId: ProviderId | string,
  summary: unknown
): boolean {
  if (!playlistWriter(providerId)) return false
  if (!summary || typeof summary !== 'object') return true
  const row = summary as { subscribed?: boolean; ownership?: string }
  // 收藏来的、以及平台明确说是别人的，都只让读。
  if (row.ownership === 'collected') return false
  /*
   * `'unknown'` 是推荐位上的卡片：平台推给你的单子，不是你建的。这里以前漏判，
   * 于是从首页推荐点进一张别人的歌单，详情页照样摆着「改名 / 删除」——点了上游
   * 只会拒绝，看起来像按钮坏了。没把握是谁的，就不摆。
   */
  if (row.ownership === 'unknown') return false
  return row.subscribed !== true
}

/** 平台侧的歌 id：写接口都吃这个，不吃 Track.id。 */
function platformSongIdOf(providerId: ProviderId | string, track: Track): number {
  const provider = getProvider(providerId as ProviderId)
  const backend = provider?.backend as PlatformBackend | undefined
  return backend?.songIdOf(track) ?? 0
}

interface WriteResult {
  ok: boolean
  /** 失败时给用户看的一句话。 */
  message?: string
}

async function run(
  providerId: ProviderId | string,
  label: string,
  action: (writer: ProviderPlaylistWriteApi) => Promise<boolean> | undefined
): Promise<WriteResult> {
  const writer = playlistWriter(providerId)
  if (!writer) return { ok: false, message: '这个平台还不支持改歌单' }
  try {
    const ok = await action(writer)
    if (ok) return { ok: true }
  } catch {
    // 上游拒绝的理由五花八门（会话过期、会员限制、别人的歌单），不猜。
  }
  const provider = getProvider(providerId as ProviderId)
  const account = provider?.auth ? await provider.auth.loginStatus().catch(() => null) : null
  const name = provider?.shortName ?? provider?.displayName ?? providerId
  return { ok: false, message: account ? label + '没成功，稍后再试' : '登录' + name + '后才能改这张歌单' }
}

export async function renameOnlinePlaylist(
  providerId: ProviderId | string,
  id: number,
  name: string
): Promise<WriteResult> {
  const next = name.trim()
  if (!next) return { ok: false, message: '名字不能是空的' }
  return await run(providerId, '改名', (writer) => writer.rename?.(id, next))
}

export async function deleteOnlinePlaylist(
  providerId: ProviderId | string,
  id: number
): Promise<WriteResult> {
  return await run(providerId, '删除', (writer) => writer.remove?.(id))
}

export async function addTrackToOnlinePlaylist(
  providerId: ProviderId | string,
  playlistId: number,
  track: Track
): Promise<WriteResult> {
  const songId = platformSongIdOf(providerId, track)
  if (!songId) return { ok: false, message: '这首歌没有平台编号，加不进去' }
  return await run(providerId, '加入歌单', (writer) => writer.addTracks?.(playlistId, [songId]))
}

export async function removeTrackFromOnlinePlaylist(
  providerId: ProviderId | string,
  playlistId: number,
  track: Track
): Promise<WriteResult> {
  const songId = platformSongIdOf(providerId, track)
  if (!songId) return { ok: false, message: '这首歌没有平台编号' }
  return await run(providerId, '移出歌单', (writer) => writer.removeTracks?.(playlistId, [songId]))
}

/** 结果直接弹一句：这类动作没有第二个落点，静默失败等于没做。 */
export function reportWrite(result: WriteResult, done: string): void {
  if (result.ok) showFlash(done)
  else if (result.message) showFlash(result.message)
}