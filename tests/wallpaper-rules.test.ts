import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import {
  classifyKind,
  decodeId,
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
