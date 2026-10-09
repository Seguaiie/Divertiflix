import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Info, Play, Plus, Check, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call, type Card, type S } from '../lib/api'
import { reasonText } from '../lib/reason'
import { usePlayTitle } from '../hooks/usePlay'
import { useAuth } from '../state/auth'
import { useHome, useWatchlistToggle } from '../state/queries'
import { useUI } from '../state/ui'
import { Artwork } from './Art'
import './AssistantPanel.css'

type Chat = S['ChatResponse']
interface Msg { id: number; role: 'user' | 'assistant'; text?: string; res?: Chat; error?: string }

function AssistantCard({ card }: { card: Card }) {
  const i18n = useI18n()
  const { t, genre, duration } = i18n
  const location = useLocation()
  const play = usePlayTitle()
  const toggle = useWatchlistToggle()
  const title = card.title
  const why = reasonText(card.reason, i18n)
  const book = title.kind === 'Audiobook'
  return (
    <li className="ac">
      <Link to={`/titres/${title.id}`} state={{ background: location }} className="ac-art" aria-label={t('card.details', { title: title.name })}>
        <Artwork src={title.posterUrl} seed={title.id} genre={title.genre} ratio={book ? 'square' : 'poster'} />
      </Link>
      <div className="ac-body">
        <strong className="serif">{title.name}</strong>
        <span className="ac-meta tnum">{[book ? title.author : String(title.year), genre(title.genre), duration(title.durationMinutes)].filter(Boolean).join(' · ')}</span>
        {why && <span className="ac-why">{why}</span>}
        <div className="ac-actions">
          <button className="btn btn-primary btn-sm" onClick={() => play(title)}><Play fill="currentColor" aria-hidden />{book ? t('hero.listen') : t('hero.play')}</button>
          <button className="icon-btn sm" aria-pressed={card.inWatchlist} onClick={() => toggle.mutate({ titleId: title.id, add: !card.inWatchlist })}
            aria-label={card.inWatchlist ? t('card.removeFromList', { title: title.name }) : t('card.addToList', { title: title.name })}>{card.inWatchlist ? <Check /> : <Plus />}</button>
          <Link className="icon-btn sm" to={`/titres/${title.id}`} state={{ background: location }} aria-label={t('card.details', { title: title.name })}><Info /></Link>
        </div>
      </div>
    </li>
  )
}

function chipLabel(c: S['ChipDto'], i18n: ReturnType<typeof useI18n>): string {
  const { t, genre, tag } = i18n
  switch (c.kind) {
    case 'genre': return genre(c.label)
    case 'tag': return tag(c.label)
    case 'avoid': return t('chip.avoid', { x: tag(genre(c.label)) })
    case 'maxMinutes': return t('chip.max', { n: c.label })
    case 'minMinutes': return t('chip.min', { n: c.label })
    case 'short': return t('chip.short', { n: c.label })
    case 'long': return t('chip.long', { n: c.label })
    case 'before': return t('chip.before', { n: c.label })
    case 'after': return t('chip.after', { n: c.label })
    case 'decade': return t('chip.decade', { n: c.label })
    case 'recent': return t('chip.recent')
    case 'classic': return t('chip.classic')
    case 'kind': return c.label === 'Audiobook' ? t('nav.audiobooks') : c.label === 'Series' ? t('title.kindSeries') : t('nav.films')
    case 'similar': return t('chip.similar', { x: c.label })
    default: return c.label
  }
}

function stepText(s: S['ChatStep'], i18n: ReturnType<typeof useI18n>): string {
  const { t } = i18n
  return t(`assistant.step.${s.key}` as never, { n: s.count ?? 0 })
}

function replyText(r: Chat, i18n: ReturnType<typeof useI18n>): string {
  const { t, plural } = i18n
  const base = (() => {
    switch (r.reply) {
      case 'found': return plural('assistant.found', r.cards.length)
      case 'relaxed': return plural('assistant.relaxed', r.cards.length)
      case 'similar': return plural('assistant.similar', r.cards.length, { title: r.param ?? '' })
      case 'similarUnknown': return t('assistant.similarUnknown', { title: r.param ?? '' })
      case 'surprise': return t('assistant.surprise')
      case 'nothing': return t('assistant.nothing')
      default: return t('assistant.help')
    }
  })()
  return r.unknownTitle && r.reply !== 'similarUnknown' ? `${base} ${t('assistant.unknownNote', { title: r.unknownTitle })}` : base
}

/**
 * Assistant de recommandation. Il comprend des demandes libres (genre, ambiance, durée, « sans gore », « comme X »)
 * et répond avec des titres du catalogue, chacun avec la raison réelle calculée par le moteur. Aucun modèle de langage,
 * aucune conversation conservée côté serveur.
 */
export function AssistantPanel() {
  const i18n = useI18n()
  const { t } = i18n
  const { assistantOpen, setAssistantOpen, assistantPrompt, clearAssistantPrompt } = useUI()
  const { profileId } = useAuth()
  const qc = useQueryClient()
  const home = useHome()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const seq = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const chat = useMutation({
    mutationFn: (message: string) => call(api.POST('/api/assistant/chat', { body: { profileId: profileId!, message, locale: i18n.locale } })),
    onSuccess: res => {
      setMsgs(m => [...m, { id: ++seq.current, role: 'assistant', res }])
      // L'état des cartes (liste, pouces) vient du serveur : on garde le cache de l'accueil cohérent.
      void qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: e => setMsgs(m => [...m, { id: ++seq.current, role: 'assistant', error: (e as Error).message === 'network' ? t('assistant.offline') : t('assistant.error') }]),
  })

  const ask = (message: string) => {
    const q = message.trim()
    if (!q || chat.isPending || !profileId) return
    setMsgs(m => [...m, { id: ++seq.current, role: 'user', text: q }])
    setText('')
    chat.mutate(q)
  }

  useEffect(() => { if (assistantOpen) queueMicrotask(() => input.current?.focus()) }, [assistantOpen])
  useEffect(() => { if (assistantOpen && assistantPrompt) { ask(assistantPrompt); clearAssistantPrompt() } }, [assistantOpen, assistantPrompt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [msgs.length, chat.isPending])
  useEffect(() => {
    if (!assistantOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) setAssistantOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assistantOpen, setAssistantOpen])

  if (!assistantOpen) return null

  // Suggestions : trois fixes, plus « comme X » à partir de ce que le profil a vraiment regardé.
  const last = home.data?.rows.find(r => r.type === 'because')?.seed ?? home.data?.rows.find(r => r.type === 'continue')?.items[0]?.title.name
  const chips = [t('assistant.s1'), t('assistant.s2'), t('assistant.s3'), t('assistant.s4'), ...(last ? [t('assistant.sLike', { title: last })] : [])]
  const lastAnswer = [...msgs].reverse().find(m => m.res)?.res

  const onSubmit = (e: FormEvent) => { e.preventDefault(); ask(text) }

  return (
    <aside className="assistant glass-panel" aria-label={t('assistant.title')}>
      <header className="as-head">
        <div>
          <p className="eyebrow">{t('assistant.eyebrow')}</p>
          <h2 className="serif">{t('assistant.title')}</h2>
        </div>
        {msgs.length > 0 && <button className="icon-btn plain sm" onClick={() => setMsgs([])} aria-label={t('assistant.clear')} title={t('assistant.clear')}><RotateCcw /></button>}
        <button className="icon-btn plain sm" onClick={() => setAssistantOpen(false)} aria-label={t('common.close')}><X /></button>
      </header>

      <div className="as-list" ref={list}>
        {msgs.length === 0 && (
          <div className="as-intro">
            <Sparkles aria-hidden />
            <h3 className="serif">{t('assistant.hello')}</h3>
            <p>{t('assistant.helloHelp')}</p>
          </div>
        )}
        {msgs.map(m => m.role === 'user' ? (
          <div key={m.id} className="as-msg user"><p>{m.text}</p></div>
        ) : (
          <div key={m.id} className="as-msg bot">
            {m.error ? <p className="error-text" role="alert">{m.error}</p> : m.res && (
              <>
                <p>{replyText(m.res, i18n)}</p>
                {m.res.understood.length > 0 && <ul className="as-chips" aria-label={t('assistant.understood')}>{m.res.understood.map((c, i) => <li key={i} className="tag">{chipLabel(c, i18n)}</li>)}</ul>}
                {m.res.cards.length > 0 && <ul className="as-cards">{m.res.cards.map(c => <AssistantCard key={c.title.id} card={c} />)}</ul>}
                {m.res.steps.length > 0 && <p className="as-steps">{t('assistant.consulted')} {m.res.steps.map(s => stepText(s, i18n)).join(' · ')}</p>}
              </>
            )}
          </div>
        ))}
        {chat.isPending && <div className="as-msg bot" role="status"><p className="as-typing"><span /><span /><span /><span className="visually-hidden">{t('assistant.searching')}</span></p></div>}
      </div>
      <p className="visually-hidden" aria-live="polite">{lastAnswer && !chat.isPending ? replyText(lastAnswer, i18n) : ''}</p>

      <div className="as-foot">
        {msgs.length === 0 && <ul className="as-suggest" aria-label={t('assistant.suggestions')}>{chips.map(c => <li key={c}><button className="chip" onClick={() => ask(c)}>{c}</button></li>)}</ul>}
        <form onSubmit={onSubmit} className="as-form">
          <label className="visually-hidden" htmlFor="as-input">{t('assistant.inputLabel')}</label>
          <textarea id="as-input" ref={input} className="textarea" rows={1} maxLength={500} value={text} placeholder={t('assistant.placeholder')}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) } }} />
          <button className="icon-btn accent" type="submit" disabled={!text.trim() || chat.isPending} aria-label={t('assistant.send')}><Send /></button>
        </form>
        <p className="as-note">{t('assistant.note')}</p>
      </div>
    </aside>
  )
}
