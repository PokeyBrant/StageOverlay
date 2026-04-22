import fs from 'node:fs'
import path from 'node:path'

function readArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function listFiles(rootDir) {
  const files = []

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      files.push(fullPath)
    }
  }

  walk(rootDir)
  return files
}

function verifyDistElectron(distDir) {
  if (!fs.existsSync(distDir)) {
    fail(`dist-electron directory not found: ${distDir}`)
  }

  const files = fs.readdirSync(distDir).filter((entry) => fs.statSync(path.join(distDir, entry)).isFile())
  const expectedStableFiles = new Set(['main.js', 'preload.mjs'])
  const expectedChunkPrefixes = ['main-', 'matchDataProvider-', 'matchFileParser-', 'overlayRenderer-', 'parsers-']
  const allowedFiles = new Set(expectedStableFiles)

  for (const prefix of expectedChunkPrefixes) {
    const matches = files.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.js'))
    if (matches.length !== 1) {
      fail(`Expected exactly one ${prefix}* chunk in ${distDir}, found ${matches.length}: ${matches.join(', ')}`)
    }
    allowedFiles.add(matches[0])
  }

  const unexpected = files.filter((entry) => !allowedFiles.has(entry))
  if (unexpected.length > 0) {
    fail(`Unexpected build artifacts in ${distDir}: ${unexpected.join(', ')}`)
  }
}

function verifyPackagedOutput(packageDir, requireAsar) {
  if (!fs.existsSync(packageDir)) {
    fail(`Packaged output directory not found: ${packageDir}`)
  }

  const resourcesDir = path.join(packageDir, 'resources')
  if (!fs.existsSync(resourcesDir)) {
    fail(`Packaged resources directory not found: ${resourcesDir}`)
  }

  if (requireAsar) {
    const asarPath = path.join(resourcesDir, 'app.asar')
    if (!fs.existsSync(asarPath)) {
      fail(`Expected packaged asar not found: ${asarPath}`)
    }

    const unpackedAppDir = path.join(resourcesDir, 'app')
    if (fs.existsSync(unpackedAppDir)) {
      fail(`Unexpected loose app directory found alongside app.asar: ${unpackedAppDir}`)
    }
  }

  const forbiddenFileNames = new Set([
    'preferences.json',
    'cookies',
    'history',
    'login data',
    'web data'
  ])

  const forbiddenPathFragments = [
    `${path.sep}session storage${path.sep}`,
    `${path.sep}local storage${path.sep}`,
    `${path.sep}cache${path.sep}`
  ]

  const textFileExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.xml', '.yml', '.yaml'])
  const machineSpecificPatterns = [/C:\\Users\\/i, /C:\\Vibes\\/i]

  for (const filePath of listFiles(packageDir)) {
    const lowerPath = filePath.toLowerCase()
    const lowerName = path.basename(filePath).toLowerCase()

    if (forbiddenFileNames.has(lowerName)) {
      fail(`Forbidden packaged file detected: ${filePath}`)
    }

    if (forbiddenPathFragments.some((fragment) => lowerPath.includes(fragment.toLowerCase()))) {
      fail(`Forbidden packaged path detected: ${filePath}`)
    }

    if (path.extname(filePath).toLowerCase() === '.log') {
      fail(`Unexpected log file packaged: ${filePath}`)
    }

    if (lowerPath.includes(`${path.sep}node_modules${path.sep}`)) {
      continue
    }

    if (!textFileExtensions.has(path.extname(filePath).toLowerCase())) {
      continue
    }

    const content = fs.readFileSync(filePath, 'utf8')
    for (const pattern of machineSpecificPatterns) {
      if (pattern.test(content)) {
        fail(`Machine-specific path detected in packaged file: ${filePath}`)
      }
    }
  }
}

const distDir = readArg('--dist-dir')
if (!distDir) {
  fail('Missing required --dist-dir argument.')
}

verifyDistElectron(path.resolve(process.cwd(), distDir))

const packageDir = readArg('--package-dir')
if (packageDir) {
  verifyPackagedOutput(
    path.resolve(process.cwd(), packageDir),
    process.argv.includes('--require-asar')
  )
}

console.log('Release verification passed.')
