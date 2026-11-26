import type { Track } from '../../types'
import type { PlatformBackend } from './store'
import type { OnlineMusicProvider } from './types'
import { mergeVersions } from './unify.ts'

/**
 * 一家的这一批歌。抛错就当这一家这一轮没给。
 *
 * 传进来的 backend 已经确认存在：先拿 backend 再问，是因为「问」这件事本身
 * 就要用它把平台的歌转成通用曲目。
 */
type CollectAsk = (
  provider: OnlineMusicProvider,
  backend: PlatformBackend
) => Promise<readonly Track[]>

/**
 * 分别问几家，最后并成一行。
 *
 * 每日推荐、最近新歌、漫游池、艺人页四处原先各写了一遍同样的四件事：并发问、
 * 单家失败折空、把各家的歌拼起来、按音源优先级合并版本。四份抄写的坏处不是
 * 代码长短，而是「某一家挂了怎么办」有四种答案——改一处忘三处，页面之间就
 * 开始不一致。
 *
 * 这里只做这四件事；「问什么」由调用方给。顺序参数是用户设定的音源优先级，
 * 决定同一首歌哪一版当主行。
 */
export async function collectTracks(
  providers: readonly OnlineMusicProvider[],
  order: readonly string[],
  ask: CollectAsk
): Promise<Track[]> {
  if (providers.length === 0) return []
  const rounds = await Promise.all(
    providers.map(async (provider) => {
      const backend = provider.backend as PlatformBackend | undefined
      // 没有 backend 的平台这一轮没有东西可给：不是错误，别记日志。
      if (!backend) return [] as readonly Track[]
      try {
        return await ask(provider, backend)
      } catch {
        return [] as readonly Track[]
      }
    })
  )
  return mergeVersions(rounds.flat() as Track[], order)
}
