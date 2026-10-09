import { Check, Info, Pause, Play, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'
import { usePlayTitle } from '../hooks/usePlay'
import { useReducedMotion } from '../hooks/useMedia'
import type { Card } from '../lib/api'
import { reasonText } from '../lib/reason'
import { useWatchlistToggle, type Home } from '../state/queries'
import { Artwork } from './Art'
import './Hero.css'

const INTERVAL = 9000

export function HeroSkeleton() {
  return <div className="hero hero-skeleton" aria-hidden><div className="skeleton" /></div>
}

/**
 * Billboard d'accueil. Contenu : la reprise de lecture s'il y en a une, sinon les meilleures recommandations.
 * Le défilement automatique s'arrête au survol, au focus, quand l'onglet est caché ou si l'utilisateur préfère moins de mouvement,
 * et peut être mis en pause (WCAG 2.2.2).
 */
export function Hero({ items }: { items: Home['hero'] }) {
  const i18n = useI18n()
  const { t, genre, duration, plural } = i18n
  const reduced = useReducedMotion()
  const location = useLocation()
  const play = usePlayTitle()
  const toggle = useWatchlistToggle()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [picked, setPicked] = useState(false)

  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const count = items.length
  const auto = count > 1 && !paused && !hover && !hidden && !reduced && !picked
  useEffect(() => {
    if (!auto) return
    const id = setTimeout(() => setIndex(i => (i + 1) % count), INTERVAL)
    return () => clearTimeout(id)
  }, [auto, index, count])

  if (count === 0) return null
  const current = index < count ? index : 0

  const { card, mode } = items[current]!
  const title = card.title
  const isBook = title.kind === 'Audiobook'
  const eyebrow = mode === 'continue' ? t('hero.continue') : mode === 'recommended' ? t('hero.forYou') : t('hero.featured')
  const why = mode === 'continue' ? null : reasonText(card.reason, i18n)
  const left = card.progress ? Math.max(1, Math.round((card.progress.durationSeconds - card.progress.positionSeconds) / 60)) : 0
  const meta = [String(title.year), genre(title.genre), duration(title.durationMinutes), title.maturity, title.rating ? `★ ${title.rating.toFixed(1)}` : null].filter(Boolean)

  return (
    <section className="hero" aria-roledescription="carousel" aria-label={t('hero.label')}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="hero-media" aria-hidden>
        {items.map((it, i) => (
          <div key={it.card.title.id} className="hero-slide" data-active={i === current}>
            <Artwork src={it.card.title.backdropUrl} seed={it.card.title.id} genre={it.card.title.genre} ratio="backdrop" priority={i === 0} />
          </div>
        ))}
      </div>
      <div className="hero-scrim" aria-hidden />

      <div className="hero-body" key={title.id}>
        <p className="eyebrow hero-eyebrow">{eyebrow}</p>
        <h1 className="display hero-title">{title.name}</h1>
        <p className="hero-meta tnum">{meta.join('  ·  ')}</p>
        <p className="hero-synopsis">{title.synopsis}</p>
        {why && <p className="hero-why"><Sparkles aria-hidden /> {why}</p>}
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => play(title)}>
            <Play fill="currentColor" aria-hidden />
            {!title.isPlayable ? t('hero.details') : mode === 'continue' ? t('hero.resume') : isBook ? t('hero.listen') : t('hero.play')}
          </button>
          <Link className="btn btn-glass btn-lg hero-info" to={`/titres/${title.id}`} state={{ background: location }} aria-label={t('hero.more')}><Info aria-hidden /><span>{t('hero.more')}</span></Link>
          <HeroListButton card={card} onToggle={add => toggle.mutate({ titleId: title.id, add })} />
        </div>
        {mode === 'continue' && card.progress && (
          <div className="hero-resume">
            <div className="hero-resume-bar" role="progressbar" aria-valuenow={Math.round(card.progress.fraction * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t('hero.progress')}><i style={{ width: `${card.progress.fraction * 100}%` }} /></div>
            <span className="tnum">{plural('hero.left', left)}</span>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="hero-dots">
          <button className="icon-btn sm plain" onClick={() => setPaused(p => !p)} aria-label={paused ? t('hero.resumeSlides') : t('hero.pauseSlides')}>
            {paused ? <Play /> : <Pause />}
          </button>
          {items.map((it, i) => (
            <button key={it.card.title.id} className="hero-dot" data-active={i === current} data-running={auto && i === current}
              onClick={() => { setPicked(true); setIndex(i) }} aria-label={t('hero.slide', { n: i + 1, title: it.card.title.name })} aria-current={i === current}>
              <i />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function HeroListButton({ card, onToggle }: { card: Card; onToggle(add: boolean): void }) {
  const { t } = useI18n()
  return (
    <button className="icon-btn hero-list" aria-pressed={card.inWatchlist} onClick={() => onToggle(!card.inWatchlist)}
      aria-label={card.inWatchlist ? t('card.removeFromList', { title: card.title.name }) : t('card.addToList', { title: card.title.name })}>
      {card.inWatchlist ? <Check /> : <Plus />}
    </button>
  )
}
