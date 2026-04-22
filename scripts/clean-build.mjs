import fs from 'node:fs'
import path from 'node:path'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('No cleanup targets provided.')
  process.exit(1)
}

for (const target of targets) {
  const resolved = path.resolve(process.cwd(), target)
  fs.rmSync(resolved, { recursive: true, force: true })
}

