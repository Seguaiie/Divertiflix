// Prépare la publication en artefact : page principale (fragment HTML, l'hébergeur ajoute le squelette) et liste des fichiers.
//   node packages/demo/artifact.mjs      -> dist/artifact/page.html  et  dist/artifact/files.json
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const site = join(here, 'dist/site')
const out = join(here, 'dist/artifact')
mkdirSync(out, { recursive: true })

const html = readFileSync(join(site, 'index.html'), 'utf8')
const grab = re => [...html.matchAll(re)].map(m => m[0])
const links = grab(/<link rel="(?:stylesheet|modulepreload)"[^>]*>/g)
const scripts = grab(/<script type="module"[^>]*><\/script>/g)
const page = `<title>Divertiflix</title>
<meta name="color-scheme" content="dark">
<style>:root{color-scheme:dark}html,body{background:#07060d}body{margin:0}</style>
${links.join('\n')}
<div id="root"></div>
${scripts.join('\n')}
`
writeFileSync(join(out, 'page.html'), page)

const files = []
const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(relative(site, p)) } }
walk(site)
const list = files.filter(f => f !== 'index.html').sort()
writeFileSync(join(out, 'files.json'), JSON.stringify(list.map(path => ({ path }))))
console.log(`page.html (${page.length} o), ${list.length} fichiers`)
