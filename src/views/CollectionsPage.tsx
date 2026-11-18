import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { anySourceSigned, useCollectedAlbums, useSignedInPlatforms } from '../features/online/platform-collections'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlineAlbum } from '../features/refs/navigate'
import { Artwork } from '../ui/Artwork'
import { ArtistById } from '../ui/NameRef'
import { Note } from '../ui/icons'
import { ShelfSearch, shelfMatches } from '../ui/ShelfSearch'
import { sourceLabelById } from '../features/online/registry'

/**
 * 收藏专辑。
 *
 * 只放平台账号里收藏的专辑。收藏歌单在隔壁「收藏歌单」，自己建的歌单在「我的歌单」，
 * 本机专辑在「本机音乐」——各有各的去处，这一页不重复它们。
 * 平台只是卡片上的一行来源标注，不按平台分段：收藏本来不多，分段只会让人多翻一次。
 */
export function CollectionsPage({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const albums = useCollectedAlbums()
  const signed = useSignedInPlatforms()
  const [query, setQuery] = useState('')

  /* 数据已经在手里，筛选就只是本地过滤——不该为一次输入再打一轮平台接口。 */
  const shown = useMemo(
    () => albums.filter((album) => shelfMatches(query, album.name, album.artistName)),
    [albums, query]
  )

  /*
   * 空页要说清是哪一种空。
   *
   * 「还没有收藏专辑」在三种情况下都是同一句话：没登录、登录过期、真的没收藏。
   * 前两种用户其实什么都没做错，只说「还没有」等于把问题丢回给他——所以按登录
   * 状态分开说，并给出下一步该点哪里。
   *
   * 文案里不点名平台：收藏是「平台账号」里的关系，四家谁有这条通道是接口的事，
   * 不该让用户在空页上学一遍哪些平台支持收藏。
   */
  if (albums.length === 0) {
    const anySigned = anySourceSigned('collectedAlbums', signed)
    return (
      <div className="pg-empty">
        <h2>{anySigned ? '没读到收藏的专辑' : '还没有登录'}</h2>
        <p>
          {anySigned
            ? '如果在平台上收藏过专辑，可能是登录过期了，重新登录一次就会回来。'
            : '收藏的专辑存在平台账号里，登录之后这里才有东西可看。'}
        </p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'me' })}>
          {anySigned ? '去重新登录' : '去登录'}
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <section className="rh-sec">
        {/*
          * 这一页整页只有一个分区，页头已经写着「收藏专辑」——这里再写一遍
          * 「专辑」，等于同一句话说两次。总数跟搜索并成一行，够用了。
          */}
        <div className="shelf-bar">
          <ShelfSearch value={query} placeholder="搜索专辑或歌手" onChange={setQuery} />
          <span className="shelf-bar__count">
            {query.trim() ? `${shown.length} / ${albums.length} 张` : `${albums.length} 张`}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="shelf-empty">没有匹配的专辑。</p>
        ) : (
          <div className="rh-row">
            {shown.map((album) => (
              <button
                className="rh-card"
                type="button"
                key={album.key}
                onClick={(event) => openOnlineAlbum(album.providerId, album.id, event.currentTarget)}
              >
                <span className="rh-card__art" style={{ background: tint(album.key) }}>
                  <Artwork
                    src={album.coverUrl ? remoteImageUrl(sizedImage(album.coverUrl, 300), 300) : null}
                    alt=""
                    fallback={<Note size={18} />}
                  />
                </span>
                {/* 色点必须在封面外面：圆形封面会把它裁掉。悬停才说名字，不给卡片加高度。 */}
                <span className="rh-card__dots">
                  {album.providers.map((id) => (
                    <span key={id} className={'src-dot src-dot--' + id} title={sourceLabelById(id)} />
                  ))}
                </span>
                <span className="rh-card__title">{album.name}</span>
                <span className="rh-card__sub">
                  {album.providerLabel}
                  {album.artistName ? ' · ' : null}
                  {album.artistName ? (
                    <ArtistById providerId={album.providerId} id={album.artistId} name={album.artistName} />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * 收藏页的封面底：和首页同一套按 id 取的低饱和渐变。有图时它是图片加载前的
 * 底色，没图时它就是封面本身 —— 两种情况都不该露出壁纸。
 */
function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `linear-gradient(150deg, hsl(${hue} 32% 28% / 0.26), hsl(${(hue + 42) % 360} 28% 14% / 0.34))`
}