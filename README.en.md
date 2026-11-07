# Aurora

A desktop music player for Windows. It doesn't ship any music. It connects to your own NetEase Cloud Music and QQ Music accounts, or reads the files already on your disk. Window colours follow the album cover that's playing.

[中文](README.md) · [Download](https://github.com/LN334/aurora/releases/latest) · [Issues](https://github.com/LN334/aurora/issues)

<a href="https://github.com/LN334/aurora/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/LN334/aurora?style=flat-square&color=4c8bf5"></a>
<img alt="Platform" src="https://img.shields.io/badge/platform-Windows-4c8bf5?style=flat-square">
<a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-6b7280?style=flat-square"></a>

---

## What it does

- Plays local files: folder scanning, tag and cover reading, 14 audio formats
- Connects to NetEase Cloud Music and QQ Music. Search and play free tracks without signing in; signing in brings in daily recommendations, liked songs, cloud drive and playlists
- Full-screen lyrics page with a visualiser that reacts to the music
- Desktop lyrics: a transparent always-on-top window that can be locked to click through
- Playlists, a play queue, a 10-band equaliser, crossfade, ReplayGain
- If Wallpaper Engine is installed, workshop wallpapers can run behind the UI: scene, video, web and image wallpapers
- Tray icon, taskbar thumbnail buttons, Windows media controls and hardware media keys

## Install

Grab the latest `Aurora-x.y.z-Setup.exe` from [Releases](https://github.com/LN334/aurora/releases/latest).

Windows 10 or 11, 64-bit.

The installer isn't code-signed, so Windows will warn once. Click "More info", then "Run anyway". Most software from individual developers looks like this.

## First launch

Aurora looks for your music folder on first start (usually "Music" in your user directory) and begins scanning if it finds one. If it guessed wrong, or you keep music on another drive, add folders yourself from the account page (the avatar at the bottom of the sidebar). It won't add them back after you remove them.

To hear something online: type a song name into the search box at the top and press Enter, then switch the results to NetEase Cloud Music. No account needed for that.

## Where the music comes from

| Source | What you need | Status |
| --- | --- | --- |
| Local files | Music files somewhere on your disk | Works |
| NetEase Cloud Music | A NetEase account; search and part of the catalogue work signed out | Works |
| QQ Music | A QQ Music account; signed out, only free tracks play | Works |
| Spotify / Apple Music / Navidrome / Jellyfin | — | Not implemented; the integration point is in the code |

Music is licensed, and no player can bundle a catalogue. Either you use the permissions your own account already has, or you read your own files. There's no third route here that goes around platform payments.

## About the two online platforms

Both are **unofficial and unlicensed**. NetEase goes through a community reverse-engineered API, [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced); QQ Music goes through [qq-music-api](https://github.com/Rain120/qq-music-api).

That means:

- For personal study and use only. These APIs are unauthorised access and violate the platforms' terms
- It can break at any time, and an account used this way carries some risk
- No paywall bypass. Encrypted audio isn't decrypted, membership quality isn't unlocked, paid albums aren't opened. You get what your account can already play
- Nothing is downloaded or reposted. Playback only

Neither platform offers an official API for individual desktop software. QQ Music's developer docs say outright that individual developers can't apply, and list only mobile apps, mini programs, smart hardware and in-car as supported clients, with requirements for a dedicated section, branding and usage reporting. NetEase's open platform is partner-only too. The unofficial route is the only one that works, and you take the risk.

### Signed out, the two platforms differ a lot

| | NetEase | QQ Music |
| --- | --- | --- |
| Search | Yes | Yes |
| Free tracks | Full playback | Full playback (128 kbps) |
| Paid tracks | Preview clip | Unavailable; clicking does nothing |
| Playable while signed out (measured) | Free tracks in full, paid tracks preview | 18.4% of a 293-track sample |

The QQ Music number is measured: popular tracks are almost all paid (`payplay === 1`) and return `result=104003` when signed out. Sign in for QQ Music, or most clicks will just show an explanation.

When something can't play, the UI says which reason applies: needs membership, region lock, preview only, taken down, rate limited, network error. It doesn't just say "playback failed".

## The UI

### Navigation

Four entries on the left, each with its own children:

| Entry | Children | What it's for |
| --- | --- | --- |
| Home | Recently played, My music, Picks for you, Today's listening | What to play next |
| Library | Songs, Albums, Artists, Folders | What's on disk |
| Collection | Liked songs, My playlists | What you picked |
| Settings | — | Preferences |

Platforms and local files aren't top-level entries. They're the source tabs inside Library: the first row switches source (Local / NetEase / QQ Music), the second row switches the section.

There's exactly one search box, in the title bar. Enter opens the results page, and the page only switches source; it doesn't have a second input.

The avatar at the bottom of the sidebar opens the account page: local profiles, the online account each profile is bound to, and local music folders. Accounts aren't a preference; you open them whenever you switch profiles or scan a login code, so they don't live in Settings.

### Home

The app opens here. One screen answers three questions: what to play next, what's in the library, how much you've listened today.

The top card is the current track, or the last one you played when nothing is playing, with a play button. Below it, four shortcut cards: continue, library, picks, recently played. Then today's listening (time, track count, most played artist) and the recent list. At the bottom are platform recommendations: recommended songs, recommended playlists, curated playlists. These work signed out, and "shuffle" loads another batch.

Listening history stays on disk: daily totals, the last 60 entries, with repeats within three minutes counted once. It's flushed on pause, track change and window close; scrubbing the progress bar doesn't count.

### Library and Collection

Library is organised by disk. Scanning reads tags, embedded covers and a sibling `.lrc`; rescans only re-read files that changed. Sections are songs, albums, artists and folders, plus album detail in disc order.

Collection is organised by you: liked songs and playlists you built. A song belongs to your collection regardless of which folder or platform it came from, so a playlist can hold both local and online tracks. Playlists support rename and delete, drag to reorder (or `Alt+Up` / `Alt+Down`), and m3u / m3u8 import and export. Importing tells you how many entries weren't found in the library.

### Playback

The bar at the bottom has cover, title, artist, progress, previous / play / next, shuffle, repeat, queue, equaliser, desktop lyrics and volume.

Clicking the cover opens the lyrics page: the current line large in the middle, neighbouring lines fading with distance, a visualiser moving behind them. With no lyrics, it shows the cover and title and offers an online lookup.

- 10-band equaliser with 5 presets; double-clicking a slider resets it
- Crossfade with adjustable overlap
- ReplayGain normalisation with peak limiting, so nothing clips
- Queue panel in real playback order; click to jump, remove what you don't want
- "Play next" lives in the context menu and the `⋯` menu on each row

### Desktop lyrics

A separate window that shows one line of lyrics with a faint halo and no background panel. Hover and a control strip appears (smaller, larger, lock, close); move away and it fades.

While locked, clicks pass through to whatever is underneath, but hovering still lets you drag it and use the controls without unlocking first.

### System integration

- Tray: closing the window keeps the music playing by default. Settings can switch it to quit on close. Exiting properly is in the tray menu
- Taskbar thumbnail buttons: previous, play/pause, next
- Windows media controls and hardware media keys

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Seek 5 seconds |
| `Ctrl + ←` `Ctrl + →` | Previous / next track |
| `↑` `↓` | Volume |
| `L` | Lyrics page |
| `E` | Equaliser |
| `Ctrl + K` | Focus the search box |
| `F11` | Toggle full screen |
| `Esc` | Close the topmost panel, then go back a page |
| `Ctrl + Alt + L` | Show / hide desktop lyrics |
| `Ctrl + Alt + K` | Lock / unlock desktop lyrics |

None of these fire while a text field has focus.

## Settings

One page, five sections:

| Section | Contents |
| --- | --- |
| 01 Playback & quality | Crossfade, equaliser switch, per-platform quality, online lyrics |
| 02 Appearance & desktop | Desktop lyric size, motion, Wallpaper Engine background and library, wallpaper project options, wallpaper quality, wallpaper visibility, full screen, close-button behaviour |
| 03 Keyboard | Every shortcut in one table |
| 04 Update & about | Version, check frequency, auto install, data folder, GitHub |
| 05 Cleanup & memory | Free memory, junk files, data folder |

Rows have three shapes only: switch, segmented buttons, slider. Label on the left, one line of explanation in the middle, control on the right.

**Dynamic background** needs the Steam version of Wallpaper Engine installed with at least one workshop wallpaper downloaded. Scene wallpapers (`.pkg`) are rendered by a built-in WebGL scene engine, from the same project Wallpaper Engine uses; video, web and image wallpapers play directly. Aurora only reads Wallpaper Engine's config and wallpaper folders; it never launches or modifies it. "Follow current wallpaper" tracks whatever you switch to in Wallpaper Engine, and you can pin one instead. Wallpaper quality has three levels: saver (20 fps), balanced (30 fps), sharp (60 fps at physical pixel density, capped by a total pixel budget).

**Cleanup & memory**: freeing memory hands unused page memory back to the system without interrupting playback. Junk files are split into cache, logs and crash dumps. Logs and dumps are deleted immediately. Cache (GPU and shader) is held open by Chromium while the player runs, so Windows accepts the delete and reclaims nothing; those directories are queued and removed at the next start, before the window exists. That's what "cleaned at next start" means in the UI.

## Your data

Nothing is uploaded and there is no telemetry. Only the items below touch the network, and most of them need you to ask. The exception is "Picks for you" on Home: opening Home requests one round of public recommendations, no sign-in needed.

- **Music files and the index**: all local, nothing uploaded
- **Login credentials**: encrypted with Windows DPAPI and stored locally per profile. No plaintext on disk, nothing in logs. Signing out removes them
- **Online lyrics (off by default)**: a sibling `.lrc` is always preferred. Without one, Aurora can query [lrclib.net](https://lrclib.net), and it tells you before enabling that the track title and artist are sent. Results are cached locally
- **Update check**: reads GitHub's public API, no usage data, can be set to manual
- **Online playback itself**: search terms, the tracks you play and the account cookie go to the platform. The notes above describe how Aurora stores things, not a claim that nothing leaves the machine

No telemetry, no usage statistics, no crash reporting.

## FAQ

**Windows blocked the installer.**
The build isn't code-signed. "More info" → "Run anyway".

**Can I use it without signing in?**
Yes. NetEase search and free tracks work signed out. Signing in adds your playlists, daily recommendations, cloud drive and liked songs.

**A track won't play.**
The UI states the reason. That's the platform's permission check, and Aurora doesn't work around it.

**My music isn't showing up.**
Add folders from the account page. If it's added but still empty, the UI lists the paths it's scanning, so you can tell a wrong path from a folder with no music in it.

**Closing the window doesn't quit.**
That's intentional. It goes to the tray and keeps playing. Quit from the tray menu.

**Cache size didn't change after cleanup.**
GPU and shader caches are held open while the player runs. They're queued and deleted at the next start. Logs and crash dumps are removed immediately.

**The wallpaper library says it can't find any wallpapers.**
It needs the Steam version of Wallpaper Engine and at least one downloaded workshop wallpaper.

**I switched NetEase accounts but my playlists didn't change.**
Open the account page from the avatar and switch profile. Each profile is bound to one account.

## Known limitations

- Both online platforms depend on unofficial reverse-engineered APIs and can break at any time
- Profiles isolate playlists, liked songs and online accounts only. The library, playback preferences and equaliser are device-wide
- Signed out, online content is thin; the public recommendations on Home are a stopgap
- QR sign-in, membership-restricted tracks, the tray menu, the desktop lyric window and the auto-update install have no automated tests. They're verified by hand
- The first scan of a large library is I/O bound, since every file's metadata is parsed. Rescans are fast
- The equaliser is a fixed 10-band design, not parametric
- Online lyrics have a single source: lrclib.net
- The radial Canvas gradients on dark backgrounds band slightly; no dithering
- Rows show a source label only in lists that mix sources
- Dynamic background is Windows-only and requires Wallpaper Engine
- The installer isn't code-signed
- The interface is Chinese only

## Development

### Setup

Node.js 22 or newer.

```bash
npm install
npm run dev        # hot reload plus an Electron window
npm test           # pure-logic tests, no Electron needed
```

`npm install` can stall on the Electron binary download in mainland China. Create an `.npmrc` in the project root (it's deliberately not committed, since it would force a mirror on everyone who clones):

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
```

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development mode |
| `npm run build` | Compile the main process and build the renderer |
| `npm run preview` | Browser preview as a single HTML file |
| `npm test` | Tests |
| `npm run typecheck` | Type check |
| `npm run check` | Type check, tests and three dead-code audits |
| `npm run smoke` | Real-window walkthrough: page screenshots, an online search, online playback, and a wallpaper check when Wallpaper Engine is present. Exits 1 on failure |
| `npm run perf` | Runtime usage measurement |
| `npm run scan -- <folder>` | Run only the scanner and print what it made of each file |
| `npm run dist` | Build the Windows installer |

### Layout

```
src/app/            Shell: routing, sidebar, title bar, cross-feature hooks
src/features/       accounts library lyrics netease online player playlists settings wallpaper home discover favorites qq
src/views/          Pages and panels
src/ui/             Shared primitives: cards, artwork, icons, lists, formatting
src/stage/          Lyrics page and visualiser
electron/pure/      Pure logic with no Electron imports, loadable in plain Node tests
electron/protocols/ Private protocols: aurora-app / aurora-media / aurora-remote / aurora-wallpaper
electron/netease/   NetEase API, session and IPC
electron/qq/        QQ Music API, session and transport
```

Dependencies point one way: `views → features → ui`. `electron/pure` imports no other electron module, otherwise the tests can't load it.

Stack: Electron 44, React 19, TypeScript 5, Vite 7, Zustand 5, music-metadata. No UI kit, no icon library (the icons are inline SVG), no CSS framework.

A few UI rules are enforced: one title per page, printed by the shell; local and online share one card component; no sidebars inside pages; colours come from the cover only. Colour decisions live in `src/styles/tokens.css`, not in screenshots. Details are in [docs/ui-design.md](docs/ui-design.md) and [docs/architecture.md](docs/architecture.md).

### Adding a platform

The source seam is `TrackSource` in `src/features/library/source.ts`, seven members:

```ts
id / name / summary / online / streamUrl(track) / artUrl(track) / lyrics(track)
```

The playback core never assumes a track is a file on disk: where audio, artwork and lyrics come from is entirely behind this interface. Two implementations exist, `localSource` and `neteaseSource`.

Two constraints you have to respect:

1. `artUrl` must be same-origin or send CORS headers, or the cover can't be drawn to a canvas for colour extraction
2. Audio has to go through the main process (`aurora-remote:`), because the renderer's CSP only allows private protocols. The proxy also forwards Range requests and filters out hosts on the local machine or private networks

The account side lives in `src/features/accounts/providers.ts`. `ProviderId` already lists `subsonic`, `lastfm`, `listenbrainz`, `spotify` and `apple`, each with what it needs (password, token, OAuth) and its current status. Anything not marked `ready` doesn't appear in the UI.

### Testing

`npm test` runs 397 cases over logic that doesn't need Electron: LRC parsing, m3u encode/decode, queue advancement, folder trees, version comparison, profile isolation, protocol path checks, scan throttling, NetEase pure functions, initial search source, source-label rules, wallpaper selection and quality maths, and daily listening history.

The UI is covered by a real-window walkthrough. `npm run smoke` starts Electron with its own user-data-dir (your actual settings are untouched), clicks through every page from the sidebar, collects console errors, broken images and uncaught exceptions, then runs an online search and plays one online track long enough to prove the bar moved past 0:00. With Wallpaper Engine installed it also picks a wallpaper for real and checks the scene canvas is mounted and still producing frames. Any failure exits 1 and leaves screenshots in `shots/smoke/`.

`npm run check` also runs three audits: reachability (walk the import graph from real entry points and find unloadable files), dead CSS selectors, and path references to files that no longer exist.

These tests have caught two real bugs: playing by folder also played sibling folders sharing a prefix (`C:\Music` matched `C:\Music2`), and an SSRF filter bypass using IPv4-mapped IPv6 addresses.

### Performance

Single-core percentage. Task Manager shows whole-machine usage; divide by logical core count.

| Scenario | Single-core busy | DOM mutations/sec |
| --- | --- | --- |
| Blank page control | 0.72% | 0 |
| Idle (paused) | 0.73% | 0 |
| Playing, no lyrics page | 2.05% | 17.5 |
| Playing with lyrics page | 5.74% | 28.6 |
| Window hidden | 0.16% | 1.7 |

Large library (5,000 tracks): 55,209 DOM nodes, 29 MB JS heap, p95 frame interval 17 ms, zero frames above 33 ms. Virtualisation isn't needed.

Main process startup chain: 37.9 ms, 1.04 MB resident. The NetEase upstream package costs 1,492 ms and 29 MB on first load, but it's lazy, so startup doesn't pay for it.

Consecutive runs of the same build vary by about ±0.3pp; don't call anything under 0.5pp an improvement. Methodology is in [docs/perf-baseline.md](docs/perf-baseline.md).

### Releasing

```bash
# 1. bump version in package.json (the update check compares it with the latest release)
# 2. build
npm run dist
# 3. commit, tag, push
git add -A
git commit -m "release X.Y.Z"
git tag vX.Y.Z
git push && git push origin vX.Y.Z
```

Then create a GitHub Release and attach all three files:

```
release/Aurora-X.Y.Z-Setup.exe
release/Aurora-X.Y.Z-Setup.exe.blockmap
release/latest.yml
```

`latest.yml` is not optional; auto-update reads only that. The in-app update check uses the GitHub Releases API instead.

The repository the update check reads comes from `repository.url` in `package.json`. electron-builder strips the `build` field when packaging, so runtime code cannot read `build.publish`.

## Credits

The UI and interaction model took cues from the players below. None of their code is used.

- [Mineradio](https://github.com/XxHuberrr/Mineradio) (XxHuberrr, GPL-3.0, unmaintained): cinematic framing, particles and the lyrics stage. Aurora's lyrics page direction started there; the visual system and playback core are independent
- [folia](https://github.com/chthollyphile/folia-major) (chthollyphile, closed source): source tabs on the search page, one card component for local and online
- [QueMusic](https://github.com/bronekox/quemusic) (GPL-3.0): separating navigation from search (search is an action, one global input)
- [Rhine Music Database](https://github.com/MikeQu223/Rhine-Music-Database) (MIT): top-level navigation by intent, with platforms and sources kept out of it
- [webwallgl](https://github.com/oneincase/webwallgl) (oneincase, MIT): the WebGL renderer for Wallpaper Engine scenes. Scene wallpapers in the dynamic background are rendered by it

The lyrics in the demo library were written for this project. They aren't lyrics from any released song.

## License

MIT, see [LICENSE](LICENSE).
