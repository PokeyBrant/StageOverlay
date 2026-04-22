const path = require('node:path')
const { pathToFileURL } = require('node:url')

process.env.APP_ROOT = path.join(__dirname, '..')

async function bootstrap() {
  const mainEntry = path.join(process.env.APP_ROOT, 'dist-electron', 'main.js')
  await import(pathToFileURL(mainEntry).href)
}

bootstrap().catch((error) => {
  console.error('Stage Overlay bootstrap failed.')
  console.error(error)
  process.exit(1)
})
