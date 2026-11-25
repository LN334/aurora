import { useState } from 'react'
import type { useSettingsPage } from '../../../features/settings/store'
import { toast } from '../../../ui/toast'
import { Note, Row, Rows, SettingsCard } from '../parts'

/*
 * 只清「设置」，不能按 aurora* 前缀一把扫。
 *
 * 同一个 localStorage 里还躺着账号（aurora.accounts）、喜欢的歌
 * （aurora.favorites）、自建歌单（aurora.playlists）、播放历史与搜索历史；
 * 它们不是设置。之前按前缀清会把登录与曲库一起删掉，再靠内存里的 store
 * 回写，看起来像没删——换个时序就会真的丢。
 *
 * 所以这里用白名单：新加的偏好键要记得补进来，数据键则永远不会被扫到。
 */
const PREF_KEYS = new Set([
  'aurora.accentFromArt',
  'aurora.backdrop',
  'aurora.backdrop.props',
  'aurora.backdrop.quality',
  'aurora.backdrop.wallpaper',
  'aurora.backdrop.wallpaper.id',
  'aurora.backdrop.wallpaper.strength',
  'aurora.desktopLyrics.size',
  'aurora.home.sections',
  'aurora.hotkeys',
  'aurora.lyrics.size',
  'aurora.motion.reduced',
  'aurora.push.signedOnly',
  'aurora.roam.hidden',
  'aurora.roam.mode',
  'aurora.roam.platforms',
  'aurora.rows.density',
  'aurora.search.source.v2',
  'aurora.sourceOrder',
  'aurora.sourceOrder.localLast',
  'aurora.stage.particles',
  'aurora.stage.style',
  'aurora.startup.last',
  'aurora.startup.page',
  'aurora.theme'
])

/** 播放偏好按档案分槽，所以是前缀；其余偏好都是固定键。 */
const PREF_PREFIXES = ['aurora.player.prefs']

function clearOwnStorage(): number {
  const doomed = new Set<string>()
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue
    if (PREF_KEYS.has(key) || PREF_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      doomed.add(key)
    }
  }
  for (const key of doomed) localStorage.removeItem(key)
  try {
    sessionStorage.removeItem('aurora.settings.page')
  } catch {
    // 隐私模式下读不了，也不影响重置本身。
  }
  return doomed.size
}

/**
 * 恢复默认。
 *
 * 分两处：主进程的 settings.json（窗口、托盘、缓存上限、桌面歌词）和渲染层的
 * localStorage（主题、背景、字号、首页分区……）。两处都退回默认之后必须重载一次：
 * 主题与背景是在启动时应用到 <html> 上的，只改存储不会让当前画面回退。
 *
 * 只重置偏好，不碰曲库、登录状态、下载的文件与在线缓存——那是数据，不是设置。
 */
export function ResetPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await page.resetAll()
      const removed = clearOwnStorage()
      toast(`已恢复默认，清掉 ${removed} 项界面偏好；正在重新加载。`)
      window.setTimeout(() => window.location.reload(), 500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsCard title="会重置什么" hint="主进程设置与界面偏好一起退回初始值。">
        <Rows>
          <Row label="窗口与托盘" desc="关窗行为、最小化到托盘、托盘单击与界面缩放。">
            <span className="settings__number">默认</span>
          </Row>
          <Row label="播放与歌词" desc="交叉淡化、在线歌词、播放页与桌面歌词的字号、对齐和显示项，以及音源顺序与各平台音质。">
            <span className="settings__number">默认</span>
          </Row>
          <Row label="外观与首页" desc="主题、背景与模糊、封面取色、列表密度、首页分区、动态壁纸、舞台粒子、减少动效。">
            <span className="settings__number">默认</span>
          </Row>
          <Row label="启动与更新" desc="启动时打开的页面、开机自启、恢复上次队列、自动检查更新与检查频率。">
            <span className="settings__number">默认</span>
          </Row>
          <Row label="下载与缓存" desc="下载目录、格式与码率回到默认；在线缓存上限回到 2 GB，已下载的文件与缓存本身不删。">
            <span className="settings__number">默认</span>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="不会动的" hint="重置不是清空应用，下面这些保持原样。">
        <Rows>
          <Row label="曲库与收藏" desc="本地曲库、喜欢的歌、最近播放、自建歌单。">
            <span className="settings__number">保留</span>
          </Row>
          <Row label="账号与登录" desc="四家平台的登录状态与会员信息。">
            <span className="settings__number">保留</span>
          </Row>
          <Row label="文件与缓存" desc="下载到硬盘的歌、在线音频缓存、导出的日志与备份。">
            <span className="settings__number">保留</span>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="恢复默认" hint="做之前先想一下：这一步不能撤销。">
        <Rows>
          <Row
            label="恢复全部默认设置"
            desc="等同于刚装好这个版本时的状态；重置后窗口会重新加载，正在播的歌会停。"
            id="reset-all"
          >
            <button className="btn btn--danger" type="button" disabled={busy} onClick={() => setConfirming(true)}>
              恢复默认
            </button>
          </Row>
        </Rows>
        {confirming ? (
          <>
            <p className="settings__confirm">
              确定把设置与界面偏好全部退回初始值？曲库、登录状态与下载的文件不会动，但这一步不能撤销。
            </p>
            <div className="settings__danger">
              <button className="btn btn--danger" type="button" disabled={busy} onClick={() => void run()}>
                {busy ? '正在恢复' : '确认恢复'}
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => setConfirming(false)}>
                取消
              </button>
            </div>
          </>
        ) : null}
      </SettingsCard>

      <Note tone="danger">恢复默认后如果要找回原来的外观，只能重新调一遍；备份与导出在「维护」里，恢复不包含它们。</Note>
    </>
  )
}
