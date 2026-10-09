// Rend les icônes raster (PNG, ICO) à partir de favicon.svg avec Chrome, puis les copie dans les deux applications.
// Usage : node tools/brand/render.mjs        (utilise E2E_CHROME ou /opt/google/chrome/chrome, sinon le Chromium de Playwright)
import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const assets = join(root, 'packages', 'brand', 'assets')
const png = join(assets, 'png')
mkdirSync(png, { recursive: true })
const svg = 'data:image/svg+xml;base64,' + readFileSync(join(assets, 'favicon.svg')).toString('base64')

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME || (await import('node:fs')).existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined, args: ['--no-sandbox'] })
async function render(file, size, { background = 'transparent', pad = 0, radius = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${background};border-radius:${radius}px"><img src="${svg}" style="width:${size - pad * 2}px;height:${size - pad * 2}px"></div></body>`)
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(png, file), omitBackground: true })
  await page.close()
}
await render('favicon-16.png', 16)
await render('favicon-32.png', 32)
await render('favicon-48.png', 48)
await render('icon-192.png', 192, { background: '#0d0b16', pad: 30, radius: 40 })
await render('icon-512.png', 512, { background: '#0d0b16', pad: 80, radius: 110 })
await render('apple-touch-icon.png', 180, { background: '#0d0b16', pad: 28 })
await browser.close()

// favicon.ico (16, 32, 48) pour le back-office et les navigateurs qui ignorent le SVG
const { execFileSync } = await import('node:child_process')
execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(r'${join(png, 'favicon-48.png')}').convert('RGBA')
im.save(r'${join(assets, 'favicon.ico')}', sizes=[(16,16),(32,32),(48,48)])
`])

for (const app of ['apps/web-react/public', 'apps/admin-angular/public']) {
  const dest = join(root, app)
  copyFileSync(join(assets, 'favicon.svg'), join(dest, 'favicon.svg'))
  copyFileSync(join(assets, 'favicon.ico'), join(dest, 'favicon.ico'))
  copyFileSync(join(png, 'apple-touch-icon.png'), join(dest, 'apple-touch-icon.png'))
  copyFileSync(join(png, 'icon-192.png'), join(dest, 'icon-192.png'))
  copyFileSync(join(png, 'icon-512.png'), join(dest, 'icon-512.png'))
}
// Angular ne sert que des fichiers situés dans son espace de travail : les logos y sont copiés (React les importe depuis le paquet).
const brand = join(root, 'apps/admin-angular/public/brand')
mkdirSync(brand, { recursive: true })
for (const f of ['logo.svg', 'lockup.svg', 'mark.svg']) copyFileSync(join(assets, f), join(brand, f))
console.log('icônes rendues et copiées')
