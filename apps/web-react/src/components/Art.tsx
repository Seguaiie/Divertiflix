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
const WARM: Palette = { sky: ['#3a2a18', '#d8b57a'], ridges: ['#b8935a', '#8c6b3a', '#5f4726', '#38280f', '#1b1208'], glow: '#fff1cf' }
const COOL: Palette = { sky: ['#0e2230', '#9fc3c7'], ridges: ['#6b98a1', '#3f6f7c', '#254b58', '#122c38', '#08161d'], glow: '#e8f6f3' }
const MOSS: Palette = { sky: ['#13281d', '#b9c98f'], ridges: ['#7e9a68', '#55774c', '#33553a', '#1b3524', '#0a1a10'], glow: '#f1f7d8' }
const ROSE: Palette = { sky: ['#2c1319', '#e4b09c'], ridges: ['#b8737e', '#8a4658', '#5f2b3d', '#391624', '#1a0a12'], glow: '#ffe6d9' }
const BLOOD: Palette = { sky: ['#1e0709', '#b9695a'], ridges: ['#8a3a38', '#5f2124', '#3d1216', '#240a0d', '#120507'], glow: '#ffd9c9' }
const NIGHT: Palette = { sky: ['#070a18', '#4a5c8a'], ridges: ['#3a4a73', '#26335a', '#161f3e', '#0b1126', '#04060f'], glow: '#dbe4ff' }

const BY_GENRE: Record<string, Palette> = {
  'Science-fiction': COOL, Thriller: NIGHT, Gothique: NIGHT, Horreur: BLOOD, Animation: MOSS, Fantastique: MOSS,
  Comédie: ROSE, Romance: ROSE, Drame: WARM, Documentaire: WARM, Aventure: COOL, Satire: WARM, Poésie: NIGHT,
}

/**
 * Visuel génératif de repli : reliefs superposés dans la brume, dans la même grammaire que les médias de démonstration.
 * Affiché quand un titre n'a pas d'image (ou qu'elle ne charge pas) : le catalogue n'a jamais de trou.
 */
export function GeneratedArt({ seed, genre, ratio = 'poster' }: { seed: string; genre?: string; ratio?: 'poster' | 'square' | 'backdrop' }) {
  const [w, h] = ratio === 'backdrop' ? [1600, 900] : ratio === 'square' ? [600, 600] : [400, 600]
  const svg = useMemo(() => {
    const r = rng(hash(seed))
    const pal = (genre && BY_GENRE[genre]) || [WARM, COOL, MOSS, ROSE, NIGHT][hash(seed) % 5]!
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
