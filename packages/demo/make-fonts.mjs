// Génère la feuille de polices du back-office de démonstration avec les fichiers intégrés en data URI (latin seulement) :
// la page hébergée n'a ainsi aucun fichier de police à charger.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const face = (family, pkg, file, weights) => {
  const b64 = readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file)).toString('base64')
  return `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weights}; font-display: swap; src: url(data:font/woff2;base64,${b64}) format('woff2-variations'); unicode-range: ${RANGE}; }\n`
}
const css = face('Sora Variable', '@fontsource-variable/sora', 'sora-latin-wght-normal.woff2', '100 800') + face('Inter Variable', '@fontsource-variable/inter', 'inter-latin-opsz-normal.woff2', '100 900')
mkdirSync(join(here, 'angular/generated'), { recursive: true })
writeFileSync(join(here, 'angular/generated/fonts.css'), css)
console.log(`fonts.css : ${(css.length / 1024).toFixed(0)} Ko`)
