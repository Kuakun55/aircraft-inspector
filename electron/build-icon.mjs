import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

mkdirSync(join(root, 'build'), { recursive: true })

await sharp(join(root, 'public', 'icon.svg'))
  .resize(512, 512)
  .png()
  .toFile(join(root, 'build', 'icon.png'))

console.log('wrote build/icon.png')
