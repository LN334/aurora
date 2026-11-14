import { spawn, type ChildProcess } from 'node:child_process'

import { hidesOverlayForState, parseNotificationState } from './pure/notification-state.ts'

/**
 * Watches Windows' own "is something full-screen right now" signal.
 *
 * Electron has no binding for `SHQueryUserNotificationState`, and a native
 * addon would mean shipping a prebuilt binary for every architecture. One
 * PowerShell process that reports the state twice a second costs far less than
 * that and needs no build step — it starts when the lyric strip opens and exits
 * with it.
 *
 * Failure is silent by design: without the watcher the strip simply stops
 * dodging other apps' full-screen windows, which is the behaviour before this
 * existed.
 */

const POLL_MS = 1500

const SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AuroraQuns {
  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int state);
}
"@
while ($true) {
  $state = 0
  [void][AuroraQuns]::SHQueryUserNotificationState([ref]$state)
  [Console]::WriteLine($state)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${POLL_MS}
}
`

let child: ChildProcess | null = null
let lastHidden = false

function stop(): void {
  if (!child) return
  const dying = child
  child = null
  if (dying.exitCode === null) dying.kill()
}

/** Start polling; calling it again restarts with the new callback. */
export function startFullscreenWatch(onChange: (hidden: boolean) => void): void {
  stop()
  lastHidden = false

  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  const spawned = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  child = spawned

  spawned.on('error', () => {
    /* PowerShell is missing or refused to start; keep the strip as it was. */
    if (child === spawned) child = null
  })

  spawned.on('exit', () => {
    if (child === spawned) child = null
  })

  let buffer = ''
  spawned.stdout?.setEncoding('utf8')
  spawned.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const state = parseNotificationState(line)
      if (state === null) continue
      const hidden = hidesOverlayForState(state)
      if (hidden === lastHidden) continue
      lastHidden = hidden
      onChange(hidden)
    }
  })
}

export function stopFullscreenWatch(): void {
  stop()
  lastHidden = false
}
