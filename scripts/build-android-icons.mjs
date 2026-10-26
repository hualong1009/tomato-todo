/**
 * 从 build/icon.png 生成安卓启动图标与启动图（写进 android/app/src/main/res）。
 *
 * 用法：node scripts/build-android-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const res = join(root, 'android', 'app', 'src', 'main', 'res')
const source = join(root, 'build', 'icon.png')

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }
const SPLASH = {
  'drawable': { w: 480, h: 800 },
  'drawable-land-mdpi': { w: 480, h: 320 },
  'drawable-land-hdpi': { w: 800, h: 480 },
  'drawable-land-xhdpi': { w: 1280, h: 720 },
  'drawable-land-xxhdpi': { w: 1600, h: 960 },
  'drawable-land-xxxhdpi': { w: 1920, h: 1280 },
  'drawable-port-mdpi': { w: 320, h: 480 },
  'drawable-port-hdpi': { w: 480, h: 800 },
  'drawable-port-xhdpi': { w: 720, h: 1280 },
  'drawable-port-xxhdpi': { w: 960, h: 1600 },
  'drawable-port-xxxhdpi': { w: 1280, h: 1920 }
}

const BACKGROUND = '#0e1120'
const iconBuffer = readFileSync(source)

async function writeRoundedSquare(target, size) {
  // 启动器图标：深色圆角底 + 居中番茄
  const inner = Math.round(size * 0.68)
  const radius = Math.round(size * 0.22)
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  )
  const innerIcon = await sharp(iconBuffer).resize(inner, inner, { fit: 'contain' }).png().toBuffer()
  const base = await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND }
  })
    .composite([
      { input: innerIcon, gravity: 'center' },
      { input: mask, blend: 'dest-in' }
    ])
    .png()
    .toBuffer()
  await sharp(base).toFile(target)
}

async function writeRound(target, size) {
  const inner = Math.round(size * 0.68)
  const radius = size / 2
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/></svg>`
  )
  const innerIcon = await sharp(iconBuffer).resize(inner, inner, { fit: 'contain' }).png().toBuffer()
  const base = await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND }
  })
    .composite([
      { input: innerIcon, gravity: 'center' },
      { input: mask, blend: 'dest-in' }
    ])
    .png()
    .toBuffer()
  await sharp(base).toFile(target)
}

async function writeForeground(target, size) {
  // 自适应图标前景：内容需落在中心 72/108 的安全区内
  const inner = Math.round((size * 72) / 108 * 0.78)
  const icon = await sharp(iconBuffer).resize(inner, inner, { fit: 'contain' }).png().toBuffer()
  const canvas = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toBuffer()
  await sharp(canvas).toFile(target)
}

async function writeSplash(target, width, height) {
  const size = Math.round(Math.min(width, height) * 0.32)
  const icon = await sharp(iconBuffer)
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer()
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: BACKGROUND
    }
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(target)
}

for (const [density, size] of Object.entries(LAUNCHER)) {
  const dir = join(res, `mipmap-${density}`)
  await writeRoundedSquare(join(dir, 'ic_launcher.png'), size)
  await writeRound(join(dir, 'ic_launcher_round.png'), size)
  await writeForeground(join(dir, 'ic_launcher_foreground.png'), FOREGROUND[density])
}

for (const [folder, { w, h }] of Object.entries(SPLASH)) {
  await writeSplash(join(res, folder, 'splash.png'), w, h)
}

const backgroundXml = join(res, 'values', 'ic_launcher_background.xml')
writeFileSync(
  backgroundXml,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`,
  'utf8'
)

console.log('安卓图标与启动图已生成')
