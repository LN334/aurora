import type { BrowserWindow } from 'electron'
import type { MediaCommand } from '../tray'

/**
 * What the IPC modules need from main.ts's lifecycle, injected rather than
 * imported.
 *
 * The window, the running scan and the mirrored playback state are single-owner
 * facts of the main process: they change while the app runs, so a handler has to
 * read them at call time, not at registration time. main.ts builds one object
 * that answers these questions from its own `let`s and hands it over; the IPC
 * modules never keep a second copy of the state.
 */

/** The player window, or null before it exists / after it has closed. */
export interface WindowSource {
  window(): BrowserWindow | null
}

/** Abort flag for the one library scan that may be running. */
export interface ScanControl {
  cancelled: boolean
}

/** Where that scan lives: main.ts owns the variable, handlers swap it. */
export interface ScanSlot {
  scan(): ScanControl | null
  setScan(scan: ScanControl | null): void
}

/** Playback state mirrored from the renderer, plus the way back to it. */
export interface PlaybackBridge extends WindowSource {
  playing(): boolean
  setPlaying(playing: boolean): void
  sendCommand(command: MediaCommand): void
}

/** Everything main.ts owns, as the IPC modules see it. */
export interface IpcHost extends WindowSource, ScanSlot, PlaybackBridge {}
