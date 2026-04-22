import { BrowserWindow } from 'electron'
import type { SourceStatusEvent } from './types'

export const SOURCE_STATUS_CHANNEL = 'source.status'

let currentSourceStatus: SourceStatusEvent | null = null

export function emitSourceStatus(status: SourceStatusEvent) {
  currentSourceStatus = status

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(SOURCE_STATUS_CHANNEL, status)
    }
  }
}

export function getCurrentSourceStatus() {
  return currentSourceStatus
}
