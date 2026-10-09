// Assemble le site de démonstration : portail (racine) + back-office (admin/) + médias légers (MP4 et M4A).
//   node packages/demo/assemble.mjs        (après les builds : vite build -c packages/demo/react/vite.config.ts, puis le build Angular de démo)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const media = join(root, 'apps/api/src/Divertiflix.Api/media')
const dist = join(here, 'dist')
const site = join(dist, 'site')
const snap = JSON.parse(readFileSync(join(here, 'data/snapshot.json'), 'utf8'))

rmSync(site, { recursive: true, force: true })
mkdirSync(site, { recursive: true })
cpSync(join(dist, 'portal'), site, { recursive: true })
if (existsSync(join(dist, 'admin-ng/browser'))) cpSync(join(dist, 'admin-ng/browser'), join(site, 'admin'), { recursive: true })
// Le lecteur HLS (hls.js) ne sert à rien ici : la démonstration lit des MP4. On ne le publie pas.
for (const f of readdirSync(join(site, 'assets'))) if (/^hls-/.test(f)) rmSync(join(site, 'assets', f))

const out = join(site, 'media')
const slugs = new Set()
for (const pb of Object.values(snap.playback)) {
  if (/^https?:/.test(pb.source)) continue
  const slug = pb.source.split('/')[0]
  slugs.add(slug)
  if (pb.kind === 'Audio') {
    mkdirSync(join(out, 'audio'), { recursive: true })
    // L'hébergeur de la démo ne sert pas le .m4a : MP3 (lisible partout), mono 64 kb/s suffit pour des extraits de voix.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(media, 'stream', pb.source), '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', join(out, 'audio', `${slug}.mp3`)])
  } else {
    mkdirSync(join(out, 'video'), { recursive: true })
    // Remux sans réencodage (-c copy) : mêmes images, un seul fichier lisible partout, démarrage rapide (faststart).
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(media, 'stream', pb.source), '-c', 'copy', '-movflags', '+faststart', join(out, 'video', `${slug}.mp4`)])
  }
}
// Affiches et fonds de tous les titres (même ceux qui ne sont pas lisibles).
for (const t of snap.titles) for (const u of [t.posterUrl, t.backdropUrl]) {
  const m = u && /^\/api\/media\/art\/([^/]+)\/([^/]+)$/.exec(u)
  if (!m) continue
  const src = join(media, 'art', m[1], m[2])
  if (!existsSync(src)) continue
  mkdirSync(join(out, 'art', m[1]), { recursive: true })
  cpSync(src, join(out, 'art', m[1], m[2]))
}

const size = d => { let n = 0; for (const f of readdirSync(d, { withFileTypes: true })) n += f.isDirectory() ? size(join(d, f.name)) : statSync(join(d, f.name)).size; return n }
console.log(`Site assemblé : ${(size(site) / 1048576).toFixed(1)} Mo, ${slugs.size} médias`)
