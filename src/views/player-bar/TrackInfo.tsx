import { artworkFor } from '../../features/library/source'
import type { Track } from '../../types'
import { Artwork } from '../../ui/Artwork'
import { ArtistName } from '../../ui/NameRef'
import { Note } from '../../ui/icons'

/**
 * 底栏左侧：封面、标题、艺人。
 *
 * 换歌时整块按 track.id 重挂一次，CSS 那边就有一支淡入可以播。以前这里直接
 * 换字，标题是一瞬间跳过去的，播放条看着很硬。
 */
export function TrackInfo({ track, onOpenNow }: { track: Track | null; onOpenNow(): void }) {
  return (
    <div className="pb-info">
      {/* 点封面进沉浸模式，是播放器里的老规矩。 */}
      <button
        type="button"
        className="pb-art"
        onClick={onOpenNow}
        disabled={!track}
        title={track ? '沉浸模式 (L)' : undefined}
        aria-label="打开沉浸模式"
      >
        <Artwork
          src={artworkFor(track)}
          fallback={
            <span className="pb-art__empty">
              <Note size={20} />
            </span>
          }
        />
      </button>

      <div className="pb-meta" key={track ? String(track.id) : 'idle'}>
        {track ? (
          <>
            <div className="pb-title" title={track.title}>
              {track.title}
            </div>
            {/* 多艺人逐段渲染：每位都是一个可点的名字，与队列、舞台同一套。 */}
            <ArtistName track={track} className="pb-artist" />
          </>
        ) : (
          <div className="pb-title pb-idle">没有在播放</div>
        )}
      </div>
    </div>
  )
}
