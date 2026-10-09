import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Headphones, Info, Play, Plus, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useRef } from 'react'
import { useI18n } from '../i18n'
import { api, call, type Card, type S } from '../lib/api'
import { reasonText } from '../lib/reason'
import { useDialog } from '../hooks/useDialog'
import { usePlayTitle } from '../hooks/usePlay'
import { useDetail, useRate, useWatchlistToggle, keys } from '../state/queries'
import { useAuth } from '../state/auth'
import { useToast } from '../state/toast'
import { Artwork } from './Art'
import { PosterCard } from './PosterCard'
import './TitleModal.css'

const STEPS = ['Pending', 'Approved', 'Downloading', 'Available'] as const

function RequestBlock({ title, request }: { title: S['TitleDto']; request: S['RequestCardDto'] | null | undefined }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const toast = useToast()
  const { profileId } = useAuth()
  const create = useMutation({
    mutationFn: () => call(api.POST('/api/requests', { body: { name: title.name, kind: title.kind, year: title.year, note: null, titleId: title.id } })),
    onSuccess: () => {
      toast.push({ kind: 'ok', text: t('request.sent', { title: title.name }) })
      void qc.invalidateQueries({ queryKey: keys.detail(profileId!, title.id) })
      void qc.invalidateQueries({ queryKey: keys.home(profileId!) })
      void qc.invalidateQueries({ queryKey: keys.myRequests })
    },
    onError: e => toast.push({ kind: 'error', text: (e as Error).message }),
  })

  if (!request) {
    return (
      <div className="tm-request">
        <div><strong>{t('request.notYet')}</strong><p>{t('request.notYetHelp')}</p></div>
        <button className="btn btn-accent" onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? <span className="spinner" /> : <Plus aria-hidden />}{t('request.cta')}</button>
      </div>
    )
  }
  const at = STEPS.indexOf(request.status as (typeof STEPS)[number])
  return (
    <div className="tm-request">
      <div className="grow">
        <strong>{request.mine ? t('request.yours') : t('request.someone')}</strong>
        <ol className="tm-steps" aria-label={t('request.progress')}>
          {STEPS.map((s, i) => <li key={s} data-done={i <= at} aria-current={i === at ? 'step' : undefined}><i aria-hidden /><span>{t(`request.status.${s}` as never)}</span></li>)}
        </ol>
      </div>
    </div>
  )
}

export function TitleModal({ id, onClose }: { id: string; onClose(): void }) {
  const i18n = useI18n()
  const { t, genre, tag, duration } = i18n
  const ref = useRef<HTMLDivElement>(null)
  useDialog(true, onClose, ref, { initialFocus: '[data-autofocus]' })
  const detail = useDetail(id)
  const play = usePlayTitle()
  const toggle = useWatchlistToggle()
  const rate = useRate()

  const card = detail.data?.card
  const title = card?.title
  const labelId = `tm-${id}`

  return (
    <div className="overlay tm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet tm" role="dialog" aria-modal="true" aria-labelledby={labelId} ref={ref}>
        <button className="icon-btn tm-close" onClick={onClose} aria-label={t('common.close')}><X /></button>

        {detail.isPending && <div className="tm-loading" role="status"><span className="spinner" /><span className="visually-hidden">{t('common.loading')}</span></div>}
        {detail.isError && (
          <div className="empty"><h2 id={labelId}>{t('title.notFound')}</h2><p>{t('title.notFoundHelp')}</p><button className="btn btn-glass" onClick={onClose} data-autofocus>{t('common.close')}</button></div>
        )}

        {card && title && (
          <>
            <div className="tm-hero" data-kind={title.kind === 'Audiobook' ? 'book' : 'film'}>
              <Artwork src={title.backdropUrl ?? title.posterUrl} seed={title.id} genre={title.genre} ratio="backdrop" priority />
              <div className="tm-scrim" aria-hidden />
              <div className="tm-hero-body">
                <p className="eyebrow">{title.kind === 'Audiobook' ? t('title.kindBook') : title.kind === 'Series' ? t('title.kindSeries') : t('title.kindFilm')}</p>
                <h2 id={labelId} className="display">{title.name}</h2>
                <div className="tm-actions">
                  <PrimaryAction card={card} onPlay={() => play(title)} />
                  <button className="icon-btn" aria-pressed={card.inWatchlist} onClick={() => toggle.mutate({ titleId: title.id, add: !card.inWatchlist })}
                    aria-label={card.inWatchlist ? t('card.removeFromList', { title: title.name }) : t('card.addToList', { title: title.name })} title={card.inWatchlist ? t('title.inList') : t('title.addList')}>
                    {card.inWatchlist ? <Check /> : <Plus />}
                  </button>
                  <button className="icon-btn" aria-pressed={card.myRating === 1} onClick={() => rate.mutate({ titleId: title.id, value: card.myRating === 1 ? 0 : 1 })} aria-label={t('card.like', { title: title.name })} title={t('title.like')}><ThumbsUp /></button>
                  <button className="icon-btn" aria-pressed={card.myRating === -1} onClick={() => rate.mutate({ titleId: title.id, value: card.myRating === -1 ? 0 : -1 })} aria-label={t('card.dislike', { title: title.name })} title={t('title.dislike')}><ThumbsDown /></button>
                </div>
              </div>
            </div>

            <div className="tm-body">
              <div className="tm-main">
                <p className="tm-meta tnum">
                  {card.match >= 60 && <span className="tm-match">{t('title.match', { n: card.match })}</span>}
                  <span>{title.year}</span>
                  {title.maturity && <span className="badge">{title.maturity}</span>}
                  <span>{duration(title.durationMinutes)}</span>
                  <span>{genre(title.genre)}</span>
                  {title.rating ? <span>★ {title.rating.toFixed(1)}</span> : null}
                </p>
                <p className="tm-synopsis">{title.synopsis}</p>
                {reasonText(card.reason, i18n) && <p className="tm-why"><Sparkles aria-hidden />{reasonText(card.reason, i18n)}</p>}
                {!title.isPlayable && <RequestBlock title={title} request={detail.data?.request} />}
              </div>
              <dl className="tm-facts">
                {title.director && <><dt>{t('title.director')}</dt><dd>{title.director}</dd></>}
                {title.author && <><dt>{t('title.author')}</dt><dd>{title.author}</dd></>}
                {title.narrator && <><dt>{t('title.narrator')}</dt><dd>{title.narrator}</dd></>}
                {title.cast.length > 0 && <><dt>{t('title.cast')}</dt><dd>{title.cast.join(', ')}</dd></>}
                {title.keywords.length > 0 && <><dt>{t('title.tags')}</dt><dd className="tm-tags">{title.keywords.map(k => <span key={k} className="tag">{tag(k)}</span>)}</dd></>}
              </dl>
            </div>

            {detail.data!.similar.length > 0 && (
              <section className="tm-similar" aria-label={t('title.similar')}>
                <h3 className="display">{t('title.similar')}</h3>
                <div className="tm-grid">{detail.data!.similar.map(c => <PosterCard key={c.title.id} card={c} rated={false} />)}</div>
              </section>
            )}

            {title.credits && <p className="tm-credits">{title.credits}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function PrimaryAction({ card, onPlay }: { card: Card; onPlay(): void }) {
  const { t } = useI18n()
  const title = card.title
  if (!title.isPlayable) return <button className="btn btn-glass btn-lg" data-autofocus disabled><Info aria-hidden />{t('title.unavailable')}</button>
  const resume = !!card.progress && card.progress.fraction < 0.95
  if (title.streamKind === 'External') return <button className="btn btn-primary btn-lg" onClick={onPlay} data-autofocus><ExternalLink aria-hidden />{title.externalSource === 'Audiobookshelf' ? t('title.openAbs') : t('title.openLink')}</button>
  const book = title.kind === 'Audiobook'
  return (
    <button className="btn btn-primary btn-lg" onClick={onPlay} data-autofocus>
      {book ? <Headphones aria-hidden /> : <Play fill="currentColor" aria-hidden />}
      {resume ? t('hero.resume') : book ? t('hero.listen') : t('hero.play')}
    </button>
  )
}
