import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import {
  classifyKind,
  decodeId,
  editableProperties,
  encodeId,
  isInside,
  mimeFor,
  parseLibraryFolders,
  pickEntry,
  selectedWallpaperFiles
} from '../electron/pure/wallpaper-rules.ts'

/*
 * The rules behind the Wallpaper Engine backdrop, with no file system, no
 * registry and no Electron involved.
 *
 * Two of these are security boundaries rather than conveniences:
 * `isInside` and `pickEntry` decide whether `aurora-wallpaper://` may open a
 * file at all, and the project directory is third-party input - a Workshop
 * wallpaper can declare `"file": "../../../Windows/win.ini"` in its own
 * manifest. Those are tested against what an attacker would send, not only
 * against the paths a normal project happens to use.
 *
 * The rest pins behaviour that is easy to "improve" by accident: the MIME table
 * decides how Chromium consumes a response, the id escape is part of the URL
 * shape the renderer builds, and the config reader exists because a blind walk of
 * `config.json` reports a wallpaper the user switched away from as current.
 */

const dir = path.join('C:', 'Program Files (x86)', 'steam', 'steamapps', 'workshop', 'content', '431960', '3363252053')

test('mimeFor maps every extension a project can ship', () => {
  assert.equal(mimeFor('scene.pkg'), 'application/octet-stream')
  assert.equal(mimeFor('clip.mp4'), 'video/mp4')
  assert.equal(mimeFor('loop.webm'), 'video/webm')
  assert.equal(mimeFor('index.html'), 'text/html; charset=utf-8')
  assert.equal(mimeFor('scene.js'), 'text/javascript; charset=utf-8')
  assert.equal(mimeFor('preview.png'), 'image/png')
})

test('mimeFor ignores case and falls back to a byte stream', () => {
  assert.equal(mimeFor('CLIP.MP4'), 'video/mp4')
  assert.equal(mimeFor('PREVIEW.JPG'), 'image/jpeg')
  // An unknown extension must not become text/html: that would let a project
  // turn its own bytes into a document the renderer executes.
  assert.equal(mimeFor('notes.flac'), 'application/octet-stream')
  assert.equal(mimeFor('project.json'), 'application/json')
  assert.equal(mimeFor('no-extension'), 'application/octet-stream')
})

test('classifyKind lets the declared type win over the entry file', () => {
  // A video wallpaper that ships a scene container: only the manifest knows.
  assert.equal(classifyKind('video', 'scene.pkg'), 'video')
  assert.equal(classifyKind('web', 'index.html'), 'web')
  // Manifests are hand-written, so their case is not trusted.
  assert.equal(classifyKind('Video', null), 'video')
  assert.equal(classifyKind('gif', null), 'image')
})

test('classifyKind falls back to the entry extension, then to scene', () => {
  assert.equal(classifyKind(null, 'clip.mp4'), 'video')
  assert.equal(classifyKind(null, 'wallpaper.html'), 'web')
  assert.equal(classifyKind(null, 'still.png'), 'image')
  assert.equal(classifyKind(null, 'scene.pkg'), 'scene')
  // A project with no readable entry is still a scene: the engine may render it
  // from the package next to the manifest.
  assert.equal(classifyKind(null, null), 'scene')
  assert.equal(classifyKind('', null), 'scene')
})

test('pickEntry refuses a candidate that escapes the project directory', () => {
  const asked: string[] = []
  const found = pickEntry(dir, ['../../../Windows/win.ini', 'clip.mp4'], (target) => {
    asked.push(target)
    return true
  })

  assert.equal(found, 'clip.mp4')
  // The escaping candidate never reached the file system: refusing after asking
  // would mean a stat on a path outside the project.
  assert.deepEqual(asked, [path.join(dir, 'clip.mp4')])
})

test('pickEntry skips the directory itself and returns nothing when empty', () => {
  assert.equal(pickEntry(dir, ['.'], () => true), null)
  assert.equal(pickEntry(dir, [null, undefined, ''], () => true), null)
  assert.equal(pickEntry(dir, ['scene.pkg'], () => false), null)
})

test('pickEntry returns the candidate exactly as the manifest wrote it', () => {
  const nested = path.join('media', 'clip.mp4')
  assert.equal(pickEntry(dir, [nested], () => true), nested)
})

test('isInside accepts the directory itself and everything under it', () => {
  assert.equal(isInside(dir, dir), true)
  assert.equal(isInside(dir, path.join(dir, 'scene.pkg')), true)
  assert.equal(isInside(dir, path.join(dir, 'media', 'clip.mp4')), true)
})

test('isInside refuses a sibling that only shares a textual prefix', () => {
  const sibling = path.join('C:', 'Program Files (x86)', 'steam', 'steamapps', 'workshop', 'content', '431960', '33632520530')
  // "33632520530" starts with "3363252053"; a plain string prefix test would let
  // this through.
  assert.equal(isInside(dir, sibling), false)
  assert.equal(isInside(dir, path.join(dir + '2', 'scene.pkg')), false)
})

test('isInside compares case-insensitively, because Windows paths do', () => {
  assert.equal(isInside(dir, dir.toUpperCase()), true)
  assert.equal(isInside(dir, path.join(dir, 'SCENE.PKG')), true)
})

test('encodeId and decodeId round-trip the ids a project can have', () => {
  for (const id of ['3363252053', 'my-project_2', 'local-my wallpaper']) {
    assert.equal(decodeId(encodeId(id)), id)
  }
  // %-escapes are restored rather than left in the decoded id.
  assert.equal(encodeId('local-my wallpaper'), 'local-my%20wallpaper')
})

test('decodeId survives a segment that is not valid percent-encoding', () => {
  assert.equal(decodeId('%E0%A4%A'), '%E0%A4%A')
  assert.equal(decodeId('plain'), 'plain')
})

test('the id escape is byte-blind, and that limitation is pinned', () => {
  // Inherited from 0.3.6: encodeId writes one %XXXX per UTF-16 code unit while
  // decodeURIComponent reads %XX as bytes, so a non-ASCII id does not round-trip.
  // Changing the escape would change the URL shape the renderer builds.
  assert.equal(encodeId('中'), '%4E2D')
  assert.equal(decodeId('%4E2D'), 'N2D')
})

test('parseLibraryFolders reads every path and restores the separators', () => {
  const vdf = String.raw`
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
	"2"
	{
		"path"		"E:\\SteamLibrary"
	}
}
`

  assert.deepEqual(parseLibraryFolders(vdf), [
    'C:' + path.sep + 'Program Files (x86)' + path.sep + 'Steam',
    'D:' + path.sep + 'SteamLibrary',
    'E:' + path.sep + 'SteamLibrary'
  ])
})

test('parseLibraryFolders drops duplicates and tolerates a different shape', () => {
  const vdf = '"path" "D:\\SteamLibrary" "path" "D:\\SteamLibrary"'
  assert.deepEqual(parseLibraryFolders(vdf), ['D:' + path.sep + 'SteamLibrary'])
  assert.deepEqual(parseLibraryFolders('"libraryfolders" { }'), [])
})

test('selectedWallpaperFiles reads the exact monitor map, not the recent history', () => {
  const current = 'C:/Program Files (x86)/steam/steamapps/workshop/content/431960/3363252053/scene.pkg'
  const recent = 'C:/Program Files (x86)/steam/steamapps/workshop/content/431960/1111111111/scene.pkg'

  const config = {
    PC: {
      general: {
        wallpaperconfig: {
          selectedwallpapers: { Monitor0: { file: current } }
        },
        // A blind walk of the document finds this first and reports the previous
        // wallpaper as the one on the desktop.
        wallpaperconfigrecent: [{ config: { selectedwallpapers: { Monitor0: { file: recent } } } }]
      }
    }
  }

  assert.deepEqual(selectedWallpaperFiles(config), [current])
})

test('selectedWallpaperFiles reads every account and every monitor', () => {
  const config = {
    PC: { general: { wallpaperconfig: { selectedwallpapers: { Monitor0: { file: 'a.mp4' } } } } },
    '14114': { general: { wallpaperconfig: { selectedwallpapers: { Monitor1: { file: 'b.png' } } } } }
  }
  assert.deepEqual(selectedWallpaperFiles(config), ['a.mp4', 'b.png'])
})

test('selectedWallpaperFiles falls back to a differently shaped document', () => {
  const config = { Weird: { selectedwallpapers: { Monitor0: { file: 'c.webm' } } } }
  assert.deepEqual(selectedWallpaperFiles(config), ['c.webm'])
})

test('selectedWallpaperFiles never takes a file from a recent subtree', () => {
  const config = {
    PC: {
      general: {
        wallpaperconfigrecent: [{ config: { selectedwallpapers: { Monitor0: { file: 'old.mp4' } } } }]
      }
    }
  }
  assert.deepEqual(selectedWallpaperFiles(config), [])
})

test('selectedWallpaperFiles tolerates a value that is not a config at all', () => {
  assert.deepEqual(selectedWallpaperFiles(null), [])
  assert.deepEqual(selectedWallpaperFiles('nonsense'), [])
  assert.deepEqual(selectedWallpaperFiles({ PC: { general: { wallpaperconfig: {} } } }), [])
})

test('editableProperties drops labels that are only image-tag debris', () => {
  // A real manifest: the author wrote an <img> into the property text and left the
  // tag unclosed, so stripping it leaves a run of attribute text with no spaces.
  const properties = {
    gift: {
      type: 'bool',
      value: true,
      text: '<img src="https://photogz.photo.store.qq.com/psc?/V12uhwit/abc&viewer_4&width=2000&height=200'
    },
    real: { type: 'bool', value: true, text: '<b>显示帧率 Frame rate display</b>' },
    tabs: { type: 'slider', value: 3, min: 1, max: 6, text: '&nbsp;&nbsp;&nbsp;镜头位置X Lens position' }
  }
  const names = editableProperties(properties).map((property) => property.name)
  assert.deepEqual(names, ['real', 'tabs'])
  const tabs = editableProperties(properties).find((property) => property.name === 'tabs')
  assert.equal(tabs?.text, '镜头位置X Lens position')
})

test('editableProperties drops sponsorship banners and wallpaper music rows by label', () => {
  // 属性名是 WE 用文案生成的哈希（`bigweixinbrimgsrchttp…`、`hrb`），挡不住任何人；
  // 只能按文案过滤。下面这几条照抄「初音未来 光与影」那张图的 project.json。
  const properties = {
    bbyy: { type: 'bool', value: false, text: '<br/><big><b>显示赞助信息<br>Display sponsorship information' },
    hrb: { type: 'bool', value: true, text: '<hr><b>喜欢的话，可以小小支持一下吗？你们的支持就是我更新最大的动力' },
    bigweixinbrimgsrchttpmqpiccnpsc: {
      type: 'bool',
      value: true,
      text: '<hr/><big><b>国内微信赞助码<br/>Domestic sponsorship code'
    },
    imgsrcfilecusersasusdesktop: {
      type: 'bool',
      value: true,
      text: '<img src="http://m.qpic.cn/psc?/V54UQdlK3n"><br/><big><b>可以给个好评收藏支持一下吗？<br/><big><b>Thank You！'
    },
    mousetrail: { type: 'bool', value: true, text: '鼠标尾迹 Mouse Trail' },
    musicsize: { type: 'slider', value: 1, min: 0, max: 1, text: '音乐大小 Music Size' },
    parallax: { type: 'bool', value: true, text: '🔘鼠标视差效果 Mouse Parallax Effect' },
    speed: { type: 'slider', value: 1, min: 0, max: 2, text: '播放速度 Playback speed' }
  }
  const names = editableProperties(properties).map((property) => property.name)
  assert.deepEqual(names, ['parallax', 'speed'])
})

test('editableProperties drops the author banner rows and survives a missing semicolon', () => {
  // 作者常在属性里塞「手机壁纸获取方式」「我的主页」「原画师」，这些不是画面参数；
  // `&nbsp` 还常常漏掉结尾分号，剥不干净就会顶着 `&nbsp` 显示。
  const properties = {
    a: { type: 'bool', value: true, text: '<b>手机壁纸获取方式（点击跳转）' },
    b: { type: 'bool', value: true, text: '<b>我的个人主页 夜莺Night的个人空间' },
    c: { type: 'bool', value: true, text: '<b>原画师：奇诺777（点击跳转）' },
    d: { type: 'slider', value: 0, min: -1, max: 1, text: '&nbsp镜头位置X Lens position X' },
    e: { type: 'bool', value: true, text: '🔘流星 Meteor' }
  }
  const list = editableProperties(properties)
  assert.deepEqual(
    list.map((property) => property.text),
    ['镜头位置X Lens position X', '🔘流星 Meteor']
  )
})

test('editableProperties keeps audio, custom text and frame rate rows but marks them muted', () => {  // 播放器里没有壁纸音频、没有自定义文字的输入框、帧率显示是给作者调试的。
  // 这几项不能只是「藏起来」：工程默认值常常是 true，不传给引擎等于没关。
  const properties = {
    _01: { type: 'slider', value: 1.4, min: 0, max: 2, text: '🔘组件随音频感应变化大小（拉至0取消）' },
    newproperty50: { type: 'bool', value: true, text: '🔘组件自定义文字' },
    newproperty46: { type: 'bool', value: true, text: '🔘当前帧率显示' },
    frameratecolor: { type: 'color', value: '1 1 1', text: '帧率显示颜色 Frame rate color' },
    bigbmeteor: { type: 'bool', value: true, text: '🔘流星 Meteor' }
  }
  const list = editableProperties(properties)
  assert.deepEqual(
    list.map((property) => [property.name, property.muted === true]),
    [
      ['_01', true],
      ['newproperty50', true],
      ['newproperty46', true],
      ['frameratecolor', true],
      ['bigbmeteor', false]
    ]
  )
})

test('editableProperties reads every control type a wallpaper declares', () => {
  // The shapes below are copied from real Workshop manifests, including the
  // HTML an author writes into a label.
  const properties = {
    glow: {
      condition: '',
      index: 2,
      order: 102,
      min: 0.5,
      max: 2,
      step: 0.001,
      text: '<b>HDR切换后亮度',
      type: 'slider',
      value: 0.9
    },
    hdr: { index: 1, order: 101, text: 'HDR关闭', type: 'bool', value: true },
    _21: { index: 45, order: 145, text: '自定义文字2颜色', type: 'color', value: '1 1 1' },
    bgm: { index: 94, order: 194, text: 'bgm：', type: 'textinput', value: 3 },
    b1: {
      index: 66,
      order: 166,
      text: '<b>字体',
      type: 'combo',
      value: '4',
      options: [{ label: '字体1', value: '1' }, { value: '2' }]
    }
  }

  assert.deepEqual(editableProperties(properties), [
    { name: 'hdr', type: 'bool', text: 'HDR关闭', value: true },
    {
      name: 'glow',
      type: 'slider',
      text: 'HDR切换后亮度',
      value: 0.9,
      min: 0.5,
      max: 2,
      step: 0.001
    },
    { name: '_21', type: 'color', text: '自定义文字2颜色', value: '1 1 1', muted: true },
    {
      name: 'b1',
      type: 'combo',
      text: '字体',
      value: '4',
      options: [{ label: '字体1', value: '1' }, { label: '2', value: '2' }]
    }
    // 上面 manifest 里的 bgm 是 textinput：设置页没有文本框，这一类在解析层就被
    // 丢掉了，所以它不出现在结果里。
  ])
})

test('editableProperties drops banners, groups, conditional and incomplete rows', () => {
  const properties = {
    // The author's HTML banner: not a control.
    b: { index: 6, order: 106, text: '<center><b>我的主页', type: 'text', value: '' },
    group: { index: 0, order: 100, text: '滤镜', type: 'group', value: '' },
    picker: { index: 3, order: 103, text: '封面', type: 'file', value: '' },
    folder: { index: 4, order: 104, text: '目录', type: 'directory', value: '' },
    // Only visible while another property has a value; showing a dead control
    // would be worse than hiding it.
    conditional: { condition: 'time.value', index: 5, order: 105, text: '24 小时制', type: 'bool', value: true },
    // No value means there is nothing for the control to start from.
    noValue: { index: 7, order: 107, text: '无值', type: 'slider', value: undefined },
    // A slider whose value is not a finite number is corrupt, not a slider.
    badSlider: { index: 8, order: 108, text: '坏', type: 'slider', value: '0.5' },
    // A bool whose value is not a boolean is corrupt too.
    badBool: { index: 9, order: 109, text: '坏', type: 'bool', value: 'true' },
    comboNoOptions: { index: 10, order: 110, text: '空', type: 'combo', value: '1', options: [] },
    kept: { condition: '', index: 2, order: 102, text: '保留', type: 'bool', value: false }
  }

  assert.deepEqual(editableProperties(properties), [
    { name: 'kept', type: 'bool', text: '保留', value: false }
  ])
})

test('editableProperties orders by order, then index, then file order', () => {
  const properties = {
    late: { order: 3, index: 0, text: 'c', type: 'bool', value: true },
    noOrder: { index: 1, text: 'a', type: 'bool', value: true },
    first: { order: 1, index: 5, text: 'b', type: 'bool', value: true },
    last: { index: 9, text: 'd', type: 'bool', value: true }
  }

  // The two order-1 rows tie, and the engine keeps the manifest's own order for
  // a tie; noOrder has no order, so its index (1) is its key.
  assert.deepEqual(
    editableProperties(properties).map((property) => property.name),
    ['noOrder', 'first', 'late', 'last']
  )
})

test('editableProperties strips HTML from labels and truncates them', () => {
  const properties = {
    link: {
      order: 1,
      text: "<center><big><b>预览</b><br/><a href='https://example.com'>点我</a>",
      type: 'bool',
      value: true
    },
    dangling: { order: 2, text: '<big', type: 'bool', value: true },
    blank: { order: 3, text: '<b> </b>', type: 'bool', value: true },
    long: { order: 4, text: 'x'.repeat(80), type: 'bool', value: true }
  }

  assert.deepEqual(
    editableProperties(properties).map((property) => property.text),
    [
      '预览 点我',
      // The author left the tag open; the name is the only usable label.
      'dangling',
      'blank',
      'x'.repeat(60)
    ]
  )
})

test('editableProperties keeps only colour triples as colours', () => {
  const properties = {
    good: { order: 1, text: '颜色', type: 'color', value: '0.5 1 0' },
    outOfRange: { order: 2, text: '范围', type: 'color', value: '255 0 0' },
    tooFew: { order: 3, text: '少', type: 'color', value: '0 0' },
    notAString: { order: 4, text: '数', type: 'color', value: 0 }
  }

  assert.deepEqual(editableProperties(properties), [
    // Kept verbatim: the renderer owns the rgb() conversion.
    { name: 'good', type: 'color', text: '颜色', value: '0.5 1 0' }
  ])
})

test('editableProperties skips the configuration window colour scheme', () => {
  // Real projects carry schemecolor at order 100; it is the wallpaper's own
  // settings UI colour, not a control, so the first real control is hdr.
  const properties = {
    schemecolor: { index: 0, order: 100, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0 0 0' },
    hdr: { index: 1, order: 101, text: 'HDR关闭', type: 'bool', value: true }
  }

  const parsed = editableProperties(properties)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].name, 'hdr')
})

test('editableProperties tolerates a value that is not a property map', () => {
  assert.deepEqual(editableProperties(undefined), [])
  assert.deepEqual(editableProperties(null), [])
  assert.deepEqual(editableProperties('nonsense'), [])
  assert.deepEqual(editableProperties([]), [])
  assert.deepEqual(editableProperties({ broken: null, list: [1, 2] }), [])
})

test('editableProperties hides the wallpaper audio, music and sponsor panels', () => {
  /*
   * 场景挂载时 volume 恒为 0（壁纸不该出声），所以音量滑杆是一条按了没反应的
   * 行；music/media 是壁纸自带的播放器面板，sponsor 是作者赞助入口。这三组都
   * 不是背景的可调项。音频监听（audio）不同：它让壁纸跟着正在播的歌动，要留。
   */
  const properties = {
    volume: { type: 'slider', value: 20, min: 0, max: 100, text: '音量' },
    music: { type: 'bool', value: true, text: '壁纸音乐' },
    media: { type: 'bool', value: true, text: '媒体播放' },
    sponsor: { type: 'bool', value: true, text: '赞助' },
    audio: { type: 'bool', value: true, text: '音频监听' },
    parallax: { type: 'slider', value: 1, min: 0, max: 2, text: '鼠标视差' }
  }

  const names = editableProperties(properties).map((property) => property.name)
  assert.deepEqual(names, ['audio', 'parallax'])
})


