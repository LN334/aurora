import { openOnlineAlbum, openOnlineArtist, refOfTrack } from '../features/refs/navigate'
import type { Track } from '../types'

/**
 * 页面上所有「艺人名 / 专辑名」都从这里出。
 *
 * 从前每个页面各写一遍：列表里做了按钮，播放条做了，详情页做了，但舞台、
 * 队列、正在播放、首页卡片、歌单里的三列全是纯文字——同一个名字在一处能点、
 * 在另一处不能点，看起来像漏了，实际是每一处都得单独接一次。集中到一个组件
 * 之后，加一处名字就自动带跳转。
 *
 * 为什么是 span 而不是 button：这些名字常常长在「整行本身就是一枚按钮」的
 * 位置里（歌单行、队列行、首页卡片），button 不能嵌套 button。span 配
 * role="link" 既能被 Tab 聚焦、回车触发，也不破坏父按钮的语义。
 */

/** 一行里的艺术家拆成独立的几个名字，各自带平台 id（配不上 id 的给 0）。 */
export function artistParts(track: Track): { id: number; name: string }[] {
  const refs = track.artistRefs ?? []
  const names = track.artist
    .split(/[/\u3001&]|\sfeat\.?/i)
    .map((part) => part.trim())
    .filter(Boolean)
  if (names.length <= 1) return refs
  return names.map((name) => {
    const hit = refs.find((ref) => ref.name === name)
    return { id: hit?.id ?? 0, name }
  })
}

interface NameProps {
  track: Track
  className?: string
  /** 显示别于 track 上的名字时用（例如把空名字换成「未知艺人」）。 */
  text?: string
}

function join(base: string, extra?: string): string {
  return extra ? base + ' ' + extra : base
}

/** 能点的名字：hover 时变亮并出下划线，和列表里的做法一致。 */
function NameRef({
  className,
  title,
  go,
  children
}: {
  className?: string
  title: string
  go: () => void
  children: string
}) {
  return (
    <span
      role="link"
      tabIndex={0}
      className={join('name-ref', className)}
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        go()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        go()
      }}
    >
      {children}
    </span>
  )
}

/**
 * 艺人名。
 *
 * 多艺人逐段判断：有 id 的那几个人能点，配不上的那几个退化成文字——总好过
 * 整串只有一个入口、点下去永远只有第一个人。
 */
export function ArtistName({ track, className, text }: NameProps) {
  const providerId = track.source ?? ''
  const parts = artistParts(track)

  if (parts.length > 1) {
    return (
      <span className={join('name-parts', className)}>
        {parts.map((person, index) => (
          <span key={person.id + ':' + index}>
            {index > 0 ? <span className="name-sep">/</span> : null}
            {person.id ? (
              <NameRef
                title={'去 ' + person.name + ' 的页面'}
                go={() => openOnlineArtist(providerId, person.id)}
              >
                {person.name}
              </NameRef>
            ) : (
              <span>{person.name}</span>
            )}
          </span>
        ))}
      </span>
    )
  }

  const label = text ?? track.artist
  const id = refOfTrack(track).artist
  if (!id) return <span className={className}>{label}</span>
  return (
    <NameRef className={className} title={'去 ' + label + ' 的页面'} go={() => openOnlineArtist(providerId, id)}>
      {label}
    </NameRef>
  )
}

/** 专辑名。这一行没带专辑 id 时就是纯文字，不假装能点。 */
export function AlbumName({ track, className, text }: NameProps) {
  const label = text ?? track.album
  if (!label) return null
  const id = refOfTrack(track).album
  if (!id) return <span className={className}>{label}</span>
  return (
    <NameRef className={className} title={'去《' + label + '》'} go={() => openOnlineAlbum(track.source ?? '', id)}>
      {label}
    </NameRef>
  )
}

/**
 * 没有曲目行、只有「平台 + 艺人 id」时用这个：推荐专辑卡、收藏专辑卡上的
 * 那行艺人名。id 缺了就退化成纯文字，不假装能点。
 */
export function ArtistById({
  providerId,
  id,
  name,
  className
}: {
  providerId: string
  id?: number
  name: string
  className?: string
}) {
  if (!id) return <span className={className}>{name}</span>
  return (
    <NameRef className={className} title={'去 ' + name + ' 的页面'} go={() => openOnlineArtist(providerId, id)}>
      {name}
    </NameRef>
  )
}
