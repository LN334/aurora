import { Folder, Plus, Trash, Wave } from '../ui/icons'
import { SOURCES } from '../features/library/source'

interface SourcesProps {
  roots: string[]
  busy: boolean
  onAdd(): Promise<void>
  onRemove(root: string): Promise<void>
}

/**
 * 音乐文件夹：这台机器上的东西从哪来。
 *
 * 分两段说清楚——「能出声的来源」和「扫进曲库的文件夹」。上面那段是事实陈述
 * （这个版本接了什么），下面那段是可以增删的配置；混在一张表里会让人以为能
 * 把在线平台也「移出曲库」。
 */
export function Sources({ roots, busy, onAdd, onRemove }: SourcesProps) {
  return (
    <div className="col src">
      <header className="rh-sec__head">
        <h3>来源</h3>
        <span className="src__hint">来源</span>
      </header>
      <ul className="src-list">
        {SOURCES.map((source) => (
          <li className="src-row" key={source.id}>
            <span className="src-row__icon">
              {source.online ? <Wave size={16} /> : <Folder size={16} />}
            </span>
            <span className="src-row__body">
              <span className="src-row__name">{source.name}</span>
              <span className="src-row__note" title={source.summary}>
                {source.summary}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <header className="rh-sec__head src__sec">
        <h3>本地文件夹</h3>
        <span className="src__hint">
          {roots.length > 0 ? `共 ${roots.length} 个` : '还没有加入任何文件夹'}
        </span>
        <span className="src__sp" />
        <button className="rh-btn" type="button" onClick={() => void onAdd()} disabled={busy}>
          <Plus size={14} />
          添加文件夹
        </button>
      </header>

      {roots.length === 0 ? (
        <p className="pg-note">加一个文件夹，里面的音频文件会扫进本机音乐。</p>
      ) : (
        <ul className="src-list">
          {roots.map((root) => (
            <li className="src-row" key={root}>
              <span className="src-row__icon">
                <Folder size={16} />
              </span>
              <span className="src-row__body">
                <span className="src-row__name src-row__path" title={root}>
                  {root}
                </span>
              </span>
              <button
                className="icon-btn"
                onClick={() => void onRemove(root)}
                title="移出曲库"
                aria-label={`移出曲库：${root}`}
              >
                <Trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
