import { useMemo, useState, type CSSProperties } from 'react'

/** Générateur pseudo-aléatoire déterministe : le même titre a toujours le même visuel. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function rng(seed: number) {
  let a = seed
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

interface Palette { sky: [string, string]; ridges: string[]; glow: string }
const DUSK: Palette = { sky: ['#140a2e', '#c46ad8'], ridges: ['#8a4dd0', '#5f2fa8', '#3d1d78', '#221050', '#0e0724'], glow: '#ffd6f4' }
const AURORA: Palette = { sky: ['#061a2e', '#58d0e8'], ridges: ['#2f9bc4', '#1f6f9c', '#154a74', '#0b2a4a', '#050f22'], glow: '#d9fbff' }
const EMBER: Palette = { sky: ['#240a22', '#ff9a5c'], ridges: ['#d2507a', '#9a2f6a', '#64184f', '#3a0c33', '#190517'], glow: '#fff0d0' }
const ORCHID: Palette = { sky: ['#2a0d28', '#f08ad0'], ridges: ['#c0509e', '#8f3478', '#5f2058', '#391238', '#1b081c'], glow: '#ffe3f6' }
const CRIMSON: Palette = { sky: ['#1d0614', '#d0406a'], ridges: ['#a02855', '#6f1840', '#44102c', '#26081a', '#12040c'], glow: '#ffc9d8' }
const NIGHT: Palette = { sky: ['#050816', '#4a56c8'], ridges: ['#3a44a8', '#262e7a', '#161b52', '#0b0f30', '#04061a'], glow: '#dfe4ff' }

const BY_GENRE: Record<string, Palette> = {
  'Science-fiction': AURORA, Thriller: NIGHT, Gothique: NIGHT, Horreur: CRIMSON, Animation: EMBER, Fantastique: DUSK,
  Comédie: EMBER, Romance: ORCHID, Drame: DUSK, Documentaire: AURORA, Aventure: AURORA, Satire: EMBER, Poésie: NIGHT,
}

/**
 * Visuel génératif de repli : reliefs superposés dans la brume, dans la même grammaire que les médias de démonstration.
 * Affiché quand un titre n'a pas d'image (ou qu'elle ne charge pas) : le catalogue n'a jamais de trou.
 */
export function GeneratedArt({ seed, genre, ratio = 'poster' }: { seed: string; genre?: string; ratio?: 'poster' | 'square' | 'backdrop' }) {
  const [w, h] = ratio === 'backdrop' ? [1600, 900] : ratio === 'square' ? [600, 600] : [400, 600]
  const svg = useMemo(() => {
    const r = rng(hash(seed))
    const pal = (genre && BY_GENRE[genre]) || [DUSK, AURORA, EMBER, ORCHID, NIGHT][hash(seed) % 5]!
    const moon = r() > 0.45 ? { x: w * (0.2 + r() * 0.6), y: h * (0.14 + r() * 0.16), r: w * (0.03 + r() * 0.025) } : null
    const layers = pal.ridges.map((fill, k) => {
      const base = h * (0.42 + 0.1 * k), amp = h * (0.045 + 0.012 * k)
      const f1 = (1.6 + r() * 1.8) / w * 6.28, f2 = (4 + r() * 3) / w * 6.28, p1 = r() * 6.28, p2 = r() * 6.28
      const pts: string[] = []
      for (let x = 0; x <= w + 6; x += 6) pts.push(`${x},${(base - amp * (Math.sin(x * f1 + p1) + 0.5 * Math.sin(x * f2 + p2))).toFixed(1)}`)
      return { fill, d: `M0,${h} L${pts.join(' L')} L${w},${h} Z` }
    })
    return { pal, moon, layers }
  }, [seed, genre, w, h])
  const id = `ga-${hash(seed)}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className="art">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={svg.pal.sky[0]} /><stop offset="0.62" stopColor={svg.pal.sky[1]} /></linearGradient>
        <radialGradient id={`${id}-m`}><stop offset="0" stopColor={svg.pal.glow} stopOpacity="0.95" /><stop offset="1" stopColor={svg.pal.glow} stopOpacity="0" /></radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
      {svg.moon && <><circle cx={svg.moon.x} cy={svg.moon.y} r={svg.moon.r * 5} fill={`url(#${id}-m)`} /><circle cx={svg.moon.x} cy={svg.moon.y} r={svg.moon.r} fill={svg.pal.glow} /></>}
      {svg.layers.map((l, i) => <path key={i} d={l.d} fill={l.fill} />)}
    </svg>
  )
}

/** Image avec repli génératif et apparition en fondu ; les dimensions sont portées par le conteneur (pas de décalage de mise en page). */
export function Artwork({ src, seed, genre, ratio = 'poster', priority = false, alt = '' }: {
  src?: string | null; seed: string; genre?: string; ratio?: 'poster' | 'square' | 'backdrop'; priority?: boolean; alt?: string
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: loaded ? 1 : 0, transition: 'opacity 500ms var(--ease)' }
  if (!src || failed) return <GeneratedArt seed={seed} genre={genre} ratio={ratio} />
  return (
    <>
      <GeneratedArt seed={seed} genre={genre} ratio={ratio} />
      <img
        src={src} alt={alt} style={style} decoding="async"
        loading={priority ? 'eager' : 'lazy'} {...(priority ? { fetchPriority: 'high' as const } : {})}
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      />
    </>
  )
}
