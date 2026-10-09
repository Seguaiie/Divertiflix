const TONES = [
  ['#7a4a1d', '#e3b36e'], ['#1f4a58', '#9ccfd0'], ['#4c2a38', '#e4aeb0'], ['#2f4a35', '#b9cf9a'], ['#3a3350', '#bfb6e3'], ['#58321a', '#f0c58f'],
]

/** Avatar typographique : la tonalité dérive du prénom, donc elle est stable d'une session à l'autre. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [bg, fg] = TONES[h % TONES.length]!
  return (
    <span className="avatar serif" aria-hidden style={{ width: size, height: size, fontSize: size * 0.52, background: `linear-gradient(145deg, ${fg}, ${bg})`, color: '#140d05' }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
