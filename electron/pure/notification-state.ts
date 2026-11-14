/**
 * Reading Windows' idea of whether the screen is busy.
 *
 * `SHQueryUserNotificationState` answers with one of seven values; the ones that
 * mean "something else owns the screen" are:
 *
 *   2  QUNS_BUSY                     a full-screen app is running / presenting
 *   3  QUNS_RUNNING_D3D_FULL_SCREEN  exclusive D3D full screen
 *   4  QUNS_PRESENTATION_MODE        presentation settings are on
 *
 * Measured on this machine: a full-screen Electron window and a full-screen Edge
 * window both report 2 rather than 3 — the API only says 3 when a process holds
 * the display in exclusive mode, which modern apps generally do not.
 *
 * 5 (accepts notifications) is the normal state, so the lyric strip stays put.
 */

/** Parse one line of the watcher's stdout; anything but digits is a stray line. */
export function parseNotificationState(line: string): number | null {
  const text = line.trim()
  if (!/^\d+$/.test(text)) return null
  const state = Number.parseInt(text, 10)
  return Number.isFinite(state) ? state : null
}

/** True when another program owns the screen, so the overlay should hide. */
export function hidesOverlayForState(state: number): boolean {
  return state === 2 || state === 3 || state === 4
}
