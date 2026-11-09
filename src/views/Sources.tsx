import { Folder, Plus, Trash } from '../ui/icons'

interface SourcesProps {
  roots: string[]
  busy: boolean
  onAdd(): Promise<void>
  onRemove(root: string): Promise<void>
}

/**
 * 音乐文件夹：这一页只管磁盘上的目录。
 *
 * 在线平台曾经也列在这里，作为一张「本版本接了哪些来源」的说明表。那是文档，
 * 不是设置：左栏已经把它们做成入口，再列一遍等于告诉用户「你刚点过的东西叫
 * 什么名字」。所以这一页只留真正会增删的东西——被监听的文件夹。
 */
export function Sources({ roots, busy, onAdd, onRemove }: SourcesProps) {
  return (
    <div className="col src">
      <header className="rh-sec__head">
        <h3>音乐文件夹</h3>
        <span className="src__hint">{roots.length > 0 ? `共 ${roots.length} 个` : '还没有加入任何文件夹'}</span>
        <span className="src__sp" />
        <button className="dbtn" type="button" onClick={() => void onAdd()} disabled={busy}>
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
