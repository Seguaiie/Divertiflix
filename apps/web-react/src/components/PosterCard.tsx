import { Check, Headphones, Info, Play, Plus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { Card } from '../lib/api'
import { reasonText } from '../lib/reason'
import { usePlayTitle } from '../hooks/usePlay'
import { useRate, useWatchlistToggle } from '../state/queries'
import { Artwork } from './Art'
import './PosterCard.css'

/**
 * Carte d'un titre. Le lien principal ouvre la fiche ; les actions rapides (lecture, liste, pouces) apparaissent
 * au survol et au focus clavier. L'explication de la recommandation reste visible sous l'affiche quand la rangée la demande.
 */
export function PosterCard({ card, showReason = false, rated = true }: { card: Card; showReason?: boolean; rated?: boolean }) {
  const i18n = useI18n()
  const { t, genre, duration } = i18n
  const location = useLocation()
  const play = usePlayTitle()
  const toggle = useWatchlistToggle()
  const rate = useRate()
  const title = card.title
  const isBook = title.kind === 'Audiobook'
  const reason = showReason ? reasonText(card.reason, i18n) : null
  const meta = isBook ? [title.author, duration(title.durationMinutes)] : [String(title.year), genre(title.genre), duration(title.durationMinutes)]
  const pct = card.progress ? Math.round(card.progress.fraction * 100) : 0

  return (
    <article className="card" data-kind={isBook ? 'book' : 'film'} data-available={title.isPlayable}>
      <div className="card-frame">
        <Link to={`/titres/${title.id}`} state={{ background: location }} className="card-link" aria-label={`${title.name}. ${meta.filter(Boolean).join(', ')}`}>
          <div className="card-art">
            <Artwork src={title.posterUrl} seed={title.id} genre={title.genre} ratio={isBook ? 'square' : 'poster'} />
            <div className="card-shade" aria-hidden />
            {card.match >= 60 && <span className="card-match tnum" title={t('card.matchHint')}>{card.match} %</span>}
            {!title.isPlayable && <span className="card-flag">{t('card.onRequest')}</span>}
            {isBook && title.isPlayable && <Headphones className="card-kind" aria-hidden />}
            {pct > 0 && <div className="card-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('card.progress', { n: pct })}><i style={{ width: `${pct}%` }} /></div>}
          </div>
        </Link>

        {/* Légende et actions partagent le même flux : au survol, les boutons poussent le titre vers le haut au lieu de le recouvrir. */}
        <div className="card-overlay">
          <div className="card-caption" aria-hidden>
            <strong className="serif">{title.name}</strong>
            <span>{meta.filter(Boolean).join(' · ')}</span>
          </div>
          <div className="card-actions">
            <div>
              <button className="icon-btn sm accent" onClick={() => play(title)} aria-label={title.isPlayable ? t(isBook ? 'card.listen' : 'card.play', { title: title.name }) : t('card.details', { title: title.name })}>
                {title.isPlayable ? <Play fill="currentColor" /> : <Info />}
              </button>
              <button className="icon-btn sm" aria-pressed={card.inWatchlist} onClick={() => toggle.mutate({ titleId: title.id, add: !card.inWatchlist })}
                aria-label={card.inWatchlist ? t('card.removeFromList', { title: title.name }) : t('card.addToList', { title: title.name })}>
                {card.inWatchlist ? <Check /> : <Plus />}
              </button>
              {rated && <>
                <button className="icon-btn sm" aria-pressed={card.myRating === 1} onClick={() => rate.mutate({ titleId: title.id, value: card.myRating === 1 ? 0 : 1 })} aria-label={t('card.like', { title: title.name })}><ThumbsUp /></button>
                <button className="icon-btn sm" aria-pressed={card.myRating === -1} onClick={() => rate.mutate({ titleId: title.id, value: card.myRating === -1 ? 0 : -1 })} aria-label={t('card.dislike', { title: title.name })}><ThumbsDown /></button>
              </>}
            </div>
          </div>
        </div>
      </div>
      {reason && <p className="card-reason">{reason}</p>}
    </article>
  )
}
