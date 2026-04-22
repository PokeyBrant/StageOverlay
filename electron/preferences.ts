import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { detectCanvasPreset, resolveCanvasDimensions } from './renderSizing'
import type { UserProfile } from './types'

const defaultProfile: UserProfile = {
  preferredShooterName: '',
  preferredTheme: 'carbon',
  preferredLayout: 'horizontal',
  preferredExportFolder: '',
  backgroundSeed: 'stageoverlay-default',
  savedBackgroundSeed: null,
  backgroundImagePath: null,
  preferredCanvasPreset: '1080p',
  preferredCanvasWidth: 1080,
  preferredCanvasHeight: 324,
  preferredAspectLock: true
}

function getPreferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

export async function getUserProfile(): Promise<UserProfile> {
  const filePath = getPreferencesPath()
  if (!fs.existsSync(filePath)) {
    return defaultProfile
  }

  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserProfile> & {
      preferredOutputPreset?: UserProfile['preferredCanvasPreset']
      preferredLongestSide?: number
    }
    const preferredLayout = parsed.preferredLayout === 'vertical' ? 'vertical' : defaultProfile.preferredLayout
    const migratedCanvas = typeof parsed.preferredCanvasWidth === 'number' && typeof parsed.preferredCanvasHeight === 'number'
      ? {
          width: Math.round(parsed.preferredCanvasWidth),
          height: Math.round(parsed.preferredCanvasHeight)
        }
      : resolveCanvasDimensions(preferredLayout, parsed.preferredLongestSide ?? 1080)
    const preferredCanvasPreset = parsed.preferredCanvasPreset
      ?? parsed.preferredOutputPreset
      ?? detectCanvasPreset(preferredLayout, migratedCanvas.width, migratedCanvas.height)

    return {
      ...defaultProfile,
      preferredShooterName: parsed.preferredShooterName ?? defaultProfile.preferredShooterName,
      preferredTheme: parsed.preferredTheme ?? defaultProfile.preferredTheme,
      preferredLayout,
      preferredExportFolder: parsed.preferredExportFolder ?? defaultProfile.preferredExportFolder,
      backgroundSeed: parsed.backgroundSeed ?? defaultProfile.backgroundSeed,
      savedBackgroundSeed: typeof parsed.savedBackgroundSeed === 'string' ? parsed.savedBackgroundSeed : null,
      backgroundImagePath: parsed.backgroundImagePath ?? defaultProfile.backgroundImagePath,
      preferredCanvasPreset,
      preferredCanvasWidth: migratedCanvas.width,
      preferredCanvasHeight: migratedCanvas.height,
      preferredAspectLock: typeof parsed.preferredAspectLock === 'boolean'
        ? parsed.preferredAspectLock
        : defaultProfile.preferredAspectLock
    }
  } catch {
    return defaultProfile
  }
}

export async function saveUserProfile(profile: Partial<UserProfile>) {
  const nextProfile = { ...(await getUserProfile()), ...profile }
  const filePath = getPreferencesPath()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, JSON.stringify(nextProfile, null, 2), 'utf8')
  return nextProfile
}
