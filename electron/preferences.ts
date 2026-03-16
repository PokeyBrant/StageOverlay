import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { UserProfile } from './types'

const defaultProfile: UserProfile = {
  preferredShooterName: '',
  preferredTheme: 'carbon',
  preferredLayout: 'horizontal',
  preferredExportFolder: ''
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
    return { ...defaultProfile, ...JSON.parse(raw) }
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
