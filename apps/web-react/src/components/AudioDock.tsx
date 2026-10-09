import { Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useDock } from '../state/dock'
import { Artwork } from './Art'
import './AudioDock.css'

const RATES = [0.8, 1, 1.25, 1.5, 2]

/** Lecteur audio persistant : il reste en bas de page pendant la navigation. */
export function AudioDock() {
  const { t, clock } = useI18n()
  const d = useDock()
  if (!d.current) return null
  const pct = d.duration > 0 ? (d.position / d.duration) * 100 : 0
  const nextRate = RATES[(RATES.indexOf(d.rate) + 1) % RATES.length]!

  return (
    <section className="dock glass-panel" aria-label={t('dock.label')}>
      <div className="dock-art"><Artwork src={d.current.poster} seed={d.current.titleId} genre="Poésie" ratio="square" /></div>
      <div className="dock-info">
        <strong className="serif">{d.current.name}</strong>
        <span>{d.current.author}</span>
      </div>
      <div className="dock-controls">
        <button className="icon-btn plain" onClick={() => d.skip(-15)} aria-label={t('dock.back15')}><RotateCcw /></button>
        <button className="icon-btn dock-play" onClick={d.toggle} aria-label={d.playing ? t('player.pause') : t('player.play')}>
          {d.buffering ? <span className="spinner" /> : d.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button className="icon-btn plain" onClick={() => d.skip(15)} aria-label={t('dock.forward15')}><RotateCw /></button>
      </div>
      <div className="dock-seek">
        <span className="tnum">{clock(d.position)}</span>
        <input type="range" min={0} max={Math.max(1, Math.floor(d.duration))} step={1} value={Math.floor(d.position)} onChange={e => d.seek(Number(e.target.value))}
          aria-label={t('player.seek')} aria-valuetext={t('player.position', { a: clock(d.position), b: clock(d.duration) })} style={{ ['--p' as string]: `${pct}%` }} />
        <span className="tnum">{clock(d.duration)}</span>
      </div>
      <button className="btn btn-ghost btn-sm dock-rate tnum" onClick={() => d.setRate(nextRate)} aria-label={t('player.speed')}>{d.rate}×</button>
      <button className="icon-btn plain" onClick={d.close} aria-label={t('dock.close')}><X /></button>
    </section>
  )
}
