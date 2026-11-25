/**
 * 设置页的目录与搜索索引。
 *
 * 三级结构：一级分组 → 二级页 → 页内卡片 → 行。目录只在这里定义一次，
 * 左侧导航、页标题、搜索都读同一份，免得三处各写一套名字。
 */

type SettingsGroupId = 'look' | 'listen' | 'app' | 'advanced'

export type SettingsIcon =
  | 'sliders'
  | 'library'
  | 'wave'
  | 'desktopLyrics'
  | 'play'
  | 'volume'
  | 'lyrics'
  | 'compass'
  | 'user'
  | 'settings'
  | 'list'
  | 'download'
  | 'folder'
  | 'album'
  | 'refresh'
  | 'trash'

export type SettingsPageId =
  | 'appearance'
  | 'home'
  | 'motion'
  | 'overlay'
  | 'playback'
  | 'quality'
  | 'lyrics'
  | 'recommend'
  | 'party'
  | 'general'
  | 'keys'
  | 'downloads'
  | 'storage'
  | 'platforms'
  | 'update'
  | 'maintenance'
  | 'reset'

interface SettingsPageDef {
  id: SettingsPageId
  label: string
  group: SettingsGroupId
  icon: SettingsIcon
  /** 页标题下面的一句话：说清这一页管什么，不重复标题。 */
  blurb: string
  /** 搜索用的别名：口语叫法、相关功能。 */
  words: string
}

export const SETTINGS_PAGES: SettingsPageDef[] = [
  {
    id: 'appearance',
    label: '外观',
    group: 'look',
    icon: 'sliders',
    blurb: '主题、背景玻璃与动态壁纸。改完立刻生效。',
    words: '主题 深色 浅色 跟随系统 背景 模糊 亚克力 磨砂 取色 主色 图标 壁纸'
  },
  {
    id: 'home',
    label: '首页与媒体库',
    group: 'look',
    icon: 'library',
    blurb: '首页上摆哪几块推荐；列表一行排多高。',
    words: '首页 推荐 歌单 专辑 新歌 最近听过 分区 媒体库 列表 密度 行高'
  },
  {
    id: 'motion',
    label: '动效',
    group: 'look',
    icon: 'wave',
    blurb: '减少动画与舞台粒子。卡顿、眩晕时先来这里。',
    words: '动画 动效 减少动效 粒子 舞台 密度 速度 大小 性能'
  },
  {
    id: 'overlay',
    label: '桌面歌词',
    group: 'look',
    icon: 'desktopLyrics',
    blurb: '歌词浮在桌面上时的字号、对齐与锁定。',
    words: '桌面歌词 悬浮 锁定 悬停 字号 下一句 翻译 译文 对齐'
  },
  {
    id: 'playback',
    label: '播放控制',
    group: 'listen',
    icon: 'play',
    blurb: '切歌时前后两首重叠多久。',
    words: '播放 切歌 交叉淡化 淡入淡出 过渡'
  },
  {
    id: 'quality',
    label: '音源与音质',
    group: 'listen',
    icon: 'volume',
    blurb: '先问哪一家、每家用哪一档；自动挑源按这个顺序走。',
    words: '音源 优先级 顺序 音质 标准 较高 极高 无损 会员 网易云 QQ 酷狗 汽水'
  },
  {
    id: 'lyrics',
    label: '歌词',
    group: 'listen',
    icon: 'lyrics',
    blurb: '歌词从哪来、播放页显示多大。',
    words: '歌词 在线歌词 逐字 翻译 字号 播放页'
  },
  {
    id: 'recommend',
    label: '推荐与漫游',
    group: 'listen',
    icon: 'compass',
    blurb: '推荐位收多少、从哪几家要、漫游接哪些平台。',
    words: '推荐 漫游 每日推荐 歌单 专辑 新歌 平台 登录 引导'
  },
  {
    id: 'party',
    label: '一起听',
    group: 'listen',
    icon: 'user',
    blurb: '房间端口与樱花隧道；账号与密钥在那边改。',
    words: '一起听 房间 端口 转发 隧道 樱花 frpc 密钥'
  },
  {
    id: 'general',
    label: '通用',
    group: 'app',
    icon: 'settings',
    blurb: '启动、关窗、托盘和窗口缩放。',
    words: '通用 启动页面 开机自启 关闭窗口 托盘 最小化 休眠 恢复队列 缩放 全屏'
  },
  {
    id: 'keys',
    label: '快捷键',
    group: 'app',
    icon: 'list',
    blurb: '窗口内与全局热键；点键位即可重录。',
    words: '快捷键 热键 键位 全局 录制 冲突 重置'
  },
  {
    id: 'downloads',
    label: '下载',
    group: 'app',
    icon: 'download',
    blurb: '存在哪、存成什么格式、要不要转码。',
    words: '下载 目录 保存 格式 原格式 MP3 FLAC M4A 码率 转码 ffmpeg'
  },
  {
    id: 'storage',
    label: '存储与清理',
    group: 'app',
    icon: 'folder',
    blurb: '在线缓存多大、垃圾文件在哪、数据目录占多少。',
    words: '存储 缓存 上限 清理 垃圾 日志 崩溃 数据目录 磁盘'
  },
  {
    id: 'platforms',
    label: '在线平台',
    group: 'app',
    icon: 'album',
    blurb: '四家后端现在是什么状态；失败可当场重连。',
    words: '在线平台 网易云 QQ 音乐 酷狗 汽水 登录 重连 状态'
  },
  {
    id: 'update',
    label: '更新与关于',
    group: 'app',
    icon: 'refresh',
    blurb: '版本、更新检查与这个程序的来路。',
    words: '更新 版本 检查 自动 关于 协议 反馈 Issue 仓库 运行环境'
  },
  {
    id: 'maintenance',
    label: '维护',
    group: 'advanced',
    icon: 'settings',
    blurb: '内存、显卡加速、日志与备份。',
    words: '维护 内存 释放 显卡 加速 GPU 日志 导出 备份 导入 重启'
  },
  {
    id: 'reset',
    label: '恢复默认',
    group: 'advanced',
    icon: 'trash',
    blurb: '把设置与外观偏好全部退回初始状态。',
    words: '恢复默认 重置 清空 设置 偏好 还原'
  }
]

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string; pages: SettingsPageDef[] }[] = [
  {
    id: 'look',
    label: '界面',
    pages: SETTINGS_PAGES.filter((page) => page.group === 'look')
  },
  {
    id: 'listen',
    label: '播放',
    pages: SETTINGS_PAGES.filter((page) => page.group === 'listen')
  },
  {
    id: 'app',
    label: '应用',
    pages: SETTINGS_PAGES.filter((page) => page.group === 'app')
  },
  {
    id: 'advanced',
    label: '高级',
    pages: SETTINGS_PAGES.filter((page) => page.group === 'advanced')
  }
]

export function settingsPage(id: SettingsPageId): SettingsPageDef {
  return SETTINGS_PAGES.find((page) => page.id === id) ?? SETTINGS_PAGES[0]
}

interface SearchRow {
  page: SettingsPageId
  /** 与 Row 的 id 对应；跳到这一行并高亮。 */
  key: string
  label: string
  words?: string
}

/**
 * 行级搜索索引。
 *
 * 只收「用户会拿名字去找」的行，不再给每一条解释都建索引：搜「弹窗」这种词
 * 落到说明文字里，命中一大堆反而不好挑。
 */
const SEARCH_ROWS: SearchRow[] = [
  { page: 'appearance', key: 'appearance-theme', label: '主题', words: '深色 浅色 系统 黑夜 白天' },
  { page: 'appearance', key: 'appearance-backdrop', label: '背景玻璃', words: '亚克力 模糊 磨砂 透明' },
  { page: 'appearance', key: 'appearance-blur', label: '背景模糊', words: '模糊 亚克力 玻璃' },
  { page: 'appearance', key: 'appearance-accent', label: '封面取色', words: '主色 配色 颜色' },
  { page: 'appearance', key: 'appearance-icon', label: '应用图标', words: '图标 换图标 logo' },
  { page: 'appearance', key: 'appearance-wallpaper', label: '动态背景', words: '壁纸 Wallpaper Engine 可见度 画质' },
  { page: 'home', key: 'home-sections', label: '首页分区', words: '推荐歌单 推荐专辑 最近新歌 最近听过 关掉' },
  { page: 'home', key: 'home-density', label: '列表密度', words: '行高 紧凑 宽松 标准' },
  { page: 'motion', key: 'motion-reduce', label: '减少动效', words: '动画 过渡 系统设置' },
  { page: 'motion', key: 'motion-particles', label: '舞台粒子', words: '粒子 舞台 密度 速度 大小' },
  { page: 'overlay', key: 'overlay-open', label: '显示桌面歌词', words: '开关 悬浮窗' },
  { page: 'overlay', key: 'overlay-hover', label: '锁住时也能悬停', words: '悬停 工具条 穿透' },
  { page: 'overlay', key: 'overlay-lock', label: '锁住歌词位置', words: '锁定 挡住鼠标' },
  { page: 'overlay', key: 'overlay-size', label: '桌面歌词字号', words: '字体 大小' },
  { page: 'overlay', key: 'overlay-next', label: '显示下一句', words: '预告 下一行' },
  { page: 'overlay', key: 'overlay-translation', label: '显示译文', words: '翻译 中文' },
  { page: 'overlay', key: 'overlay-align', label: '歌词对齐', words: '居中 左对齐' },
  { page: 'playback', key: 'playback-crossfade', label: '交叉淡化', words: '淡入淡出 过渡 切歌' },
  { page: 'quality', key: 'quality-order', label: '音源优先级', words: '顺序 先问哪家 本地 在线' },
  { page: 'quality', key: 'quality-netease', label: '网易云音质', words: '标准 较高 极高 无损 黑胶 VIP' },
  { page: 'quality', key: 'quality-qq', label: 'QQ 音质', words: '标准 较高 极高 无损 绿钻' },
  { page: 'quality', key: 'quality-kugou', label: '酷狗音质', words: '标准 较高 无损 蝰蛇' },
  { page: 'quality', key: 'quality-qishui', label: '汽水音质', words: '标准 较高 无损' },
  { page: 'lyrics', key: 'lyrics-online', label: '在线歌词', words: '平台歌词 逐字' },
  { page: 'lyrics', key: 'lyrics-size', label: '播放页歌词字号', words: '字体 大小 全屏' },
  { page: 'recommend', key: 'recommend-shelves', label: '推荐位收多少', words: '今日推荐 推荐歌单 推荐专辑 新歌 漫游' },
  { page: 'recommend', key: 'recommend-signed', label: '只用我登录了的平台', words: '未登录 推荐来源' },
  { page: 'recommend', key: 'recommend-roam', label: '漫游平台', words: '漫游 私人电台 平台' },
  { page: 'recommend', key: 'recommend-onboarding', label: '新手引导', words: '重看 引导' },
  { page: 'party', key: 'party-relay', label: '替房间转发音频', words: '转发 房间 流量' },
  { page: 'party', key: 'party-port', label: '房间端口', words: '端口 防火墙 随机' },
  { page: 'party', key: 'party-token', label: '访问密钥', words: 'token 密钥 隧道' },
  { page: 'general', key: 'general-startup', label: '启动时打开', words: '启动页面 首页 上次 每日推荐' },
  { page: 'general', key: 'general-login', label: '开机自启', words: '登录时启动 自启动' },
  { page: 'general', key: 'general-sleep', label: '放歌时阻止系统休眠', words: '休眠 睡眠 屏幕' },
  { page: 'general', key: 'general-close', label: '点关闭按钮时', words: '托盘 退出 关闭窗口' },
  { page: 'general', key: 'general-minimize', label: '最小化到托盘', words: '最小化 托盘 隐藏' },
  { page: 'general', key: 'general-tray', label: '点一下托盘图标', words: '托盘 单击 显示 隐藏' },
  { page: 'general', key: 'general-restore', label: '启动时恢复上次队列', words: '队列 继续播放' },
  { page: 'general', key: 'general-zoom', label: '界面缩放', words: '缩放 放大 缩小 字号 DPI' },
  { page: 'general', key: 'general-fullscreen', label: '全屏', words: '全屏 F11 窗口' },
  { page: 'keys', key: 'keys-list', label: '快捷键键位', words: '热键 录制 重置 全局' },
  { page: 'downloads', key: 'download-dir', label: '下载保存到', words: '目录 文件夹 路径' },
  { page: 'downloads', key: 'download-format', label: '下载格式', words: '原格式 MP3 FLAC M4A 转码' },
  { page: 'downloads', key: 'download-bitrate', label: '下载码率', words: '128 192 256 320' },
  { page: 'storage', key: 'storage-limit', label: '在线缓存上限', words: '缓存 大小 不缓存' },
  { page: 'storage', key: 'storage-usage', label: '缓存占用', words: '清空 打开 缓存目录' },
  { page: 'storage', key: 'storage-junk', label: '垃圾文件', words: '扫描 清理 日志 崩溃 数据目录' },
  { page: 'platforms', key: 'platform-netease', label: '网易云音乐连接状态', words: '重连 登录 离线' },
  { page: 'platforms', key: 'platform-qq', label: 'QQ 音乐连接状态', words: '重连 登录 离线' },
  { page: 'platforms', key: 'platform-kugou', label: '酷狗音乐连接状态', words: '重连 登录 离线' },
  { page: 'platforms', key: 'platform-qishui', label: '汽水音乐连接状态', words: '重连 登录 离线' },
  { page: 'update', key: 'update-auto', label: '自动检查更新', words: '新版本 升级' },
  { page: 'update', key: 'update-about', label: '关于与版本', words: '版本 运行环境 反馈 开源协议' },
  { page: 'maintenance', key: 'maintenance-memory', label: '内存与显卡', words: '释放 占用 GPU 加速' },
  { page: 'maintenance', key: 'maintenance-backup', label: '备份与恢复', words: '导出 导入 设置' },
  { page: 'maintenance', key: 'maintenance-logs', label: '导出日志', words: '诊断 startup.log' },
  { page: 'reset', key: 'reset-all', label: '恢复全部默认设置', words: '重置 清空 还原' }
]

export interface SettingsSearchHit {
  page: SettingsPageId
  /** 空表示只跳到页面顶部。 */
  key?: string
  title: string
  /** 命中所在的页名，结果第二行显示。 */
  context: string
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 搜索。
 *
 * 先匹配行（更精确），再补页面（搜「外观」时整页也该出现）。结果去重后最多给
 * 十二条——再多就不叫搜索，叫列表了。
 */
export function searchSettings(query: string): SettingsSearchHit[] {
  const needle = normalize(query)
  if (!needle) return []
  const hits: SettingsSearchHit[] = []
  const seen = new Set<string>()

  for (const row of SEARCH_ROWS) {
    const page = settingsPage(row.page)
    const haystack = normalize(page.label + ' ' + row.label + ' ' + (row.words ?? ''))
    if (!haystack.includes(needle)) continue
    const id = page.id + ':' + row.key
    seen.add(id)
    hits.push({ page: page.id, key: row.key, title: row.label, context: page.label })
    if (hits.length >= 12) return hits
  }

  for (const page of SETTINGS_PAGES) {
    const haystack = normalize(page.label + ' ' + page.blurb + ' ' + page.words)
    if (!haystack.includes(needle)) continue
    const id = page.id + ':page'
    if (seen.has(id)) continue
    hits.push({ page: page.id, title: page.label, context: '整页' })
    if (hits.length >= 12) return hits
  }

  return hits
}
