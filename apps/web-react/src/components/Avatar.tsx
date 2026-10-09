const TONES = [
  ['#3a1f9a', '#b99bff'], ['#0e4a78', '#7fdcff'], ['#7a1f63', '#ff9ad6'], ['#8a3a10', '#ffc08a'], ['#1f3a8a', '#9fb4ff'], ['#5a1f8a', '#e0a6ff'],
]

/** Avatar typographique : la tonalité dérive du prénom, donc elle est stable d'une session à l'autre. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [bg, fg] = TONES[h % TONES.length]!
  return (
    <span className="avatar display" aria-hidden style={{ width: size, height: size, fontSize: size * 0.52, background: `linear-gradient(145deg, ${fg}, ${bg})`, color: '#0b0716' }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
