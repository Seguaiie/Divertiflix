import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LifeBuoy, Plus, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { api, call, type S } from '../lib/api'
import { keys } from '../state/queries'
import { useToast } from '../state/toast'
import { useUI } from '../state/ui'
import './SupportWidget.css'

type Category = S['TicketCreate']['category']
const CATEGORIES: Category[] = ['Playback', 'Account', 'Content', 'Other']

function StatusBadge({ status }: { status: S['TicketSummaryDto']['status'] }) {
  const { t } = useI18n()
  return <span className={`badge ${status === 'Resolved' ? '' : 'accent'}`}>{t(`ticket.status.${status}` as never)}</span>
}

function Thread({ id, onBack }: { id: string; onBack(): void }) {
  const { t, ago } = useI18n()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const ticket = useQuery({ queryKey: keys.ticket(id), queryFn: () => call(api.GET('/api/support/tickets/{id}', { params: { path: { id } } })), refetchInterval: 30_000 })
  const reply = useMutation({
    mutationFn: () => call(api.POST('/api/support/tickets/{id}/messages', { params: { path: { id } }, body: { body: body.trim() } })),
    onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: keys.ticket(id) }); void qc.invalidateQueries({ queryKey: keys.tickets }) },
  })
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [ticket.data?.messages.length])
  const submit = (e: FormEvent) => { e.preventDefault(); if (body.trim()) reply.mutate() }

  return (
    <div className="sp-thread">
      <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft aria-hidden />{t('support.back')}</button>
      {ticket.data && (
        <>
          <div className="sp-ticket-head"><h3 className="serif">{ticket.data.ticket.subject}</h3><StatusBadge status={ticket.data.ticket.status} /></div>
          <ul className="sp-msgs" aria-live="polite">
            {ticket.data.messages.map(m => (
              <li key={m.id} data-staff={m.fromStaff}>
                <span className="eyebrow">{m.fromStaff ? t('support.staff') : t('support.you')} · <time className="tnum" dateTime={m.at}>{ago(m.at)}</time></span>
                <p>{m.body}</p>
              </li>
            ))}
            <div ref={end} />
          </ul>
          {ticket.data.ticket.status === 'Resolved' && <p className="hint">{t('support.resolvedHint')}</p>}
          <form onSubmit={submit} className="sp-reply">
            <label className="visually-hidden" htmlFor="sp-reply">{t('support.reply')}</label>
            <textarea id="sp-reply" className="textarea" rows={2} maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder={t('support.reply')} />
            <button className="icon-btn accent" disabled={!body.trim() || reply.isPending} aria-label={t('assistant.send')}><Send /></button>
          </form>
        </>
      )}
      {ticket.isPending && <div className="spinner" style={{ margin: '24px auto' }} />}
    </div>
  )
}

/** Aide : bouton flottant, billets d'assistance (sera relayé vers GLPI) et fil de discussion avec le support. */
export function SupportWidget() {
  const { t, ago } = useI18n()
  const { support, openSupport, closeSupport } = useUI()
  const qc = useQueryClient()
  const toast = useToast()
  const [view, setView] = useState<'list' | 'new' | string>('list')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<Category>('Playback')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  const tickets = useQuery({ queryKey: keys.tickets, queryFn: () => call(api.GET('/api/support/tickets')), enabled: support.open })
  const create = useMutation({
    mutationFn: () => call(api.POST('/api/support/tickets', { body: { subject: subject.trim(), category, message: message.trim() } })),
    onSuccess: res => {
      toast.push({ kind: 'ok', text: t('support.sent') })
      setSubject(''); setMessage(''); setError(null)
      void qc.invalidateQueries({ queryKey: keys.tickets })
      setView(res.ticket.id)
    },
    onError: e => setError((e as Error).message),
  })

  useEffect(() => { if (support.open) setView(support.ticketId ?? 'list') }, [support.open, support.ticketId])
  useEffect(() => {
    if (!support.open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) closeSupport() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [support.open, closeSupport])
  useEffect(() => { if (support.open) panel.current?.querySelector<HTMLElement>('button, input, textarea')?.focus() }, [support.open, view])

  const submit = (e: FormEvent) => { e.preventDefault(); if (subject.trim() && message.trim()) create.mutate() }

  return (
    <>
      {!support.open && (
        <button className="sp-fab" onClick={() => openSupport()} aria-label={t('support.open')}><LifeBuoy aria-hidden /><span>{t('support.fab')}</span></button>
      )}
      {support.open && (
        <aside className="sp glass-panel" ref={panel} aria-label={t('support.title')}>
          <header className="sp-head">
            <div className="grow"><p className="eyebrow">{t('support.eyebrow')}</p><h2 className="serif">{t('support.title')}</h2></div>
            <button className="icon-btn plain sm" onClick={closeSupport} aria-label={t('common.close')}><X /></button>
          </header>
          <div className="sp-body">
            {view === 'list' && (
              <>
                <p className="sp-lead">{t('support.lead')}</p>
                <button className="btn btn-accent" onClick={() => setView('new')}><Plus aria-hidden />{t('support.new')}</button>
                {tickets.data && tickets.data.length > 0 && (
                  <section aria-label={t('support.mine')}>
                    <h3 className="eyebrow">{t('support.mine')}</h3>
                    <ul className="sp-list">
                      {tickets.data.map(tk => (
                        <li key={tk.id}><button onClick={() => openSupport(tk.id)}>
                          <span className="grow"><strong>{tk.subject}</strong><span className="hint tnum">{ago(tk.updatedAt)}</span></span>
                          <StatusBadge status={tk.status} />
                        </button></li>
                      ))}
                    </ul>
                  </section>
                )}
                {tickets.data?.length === 0 && <p className="hint">{t('support.none')}</p>}
              </>
            )}
            {view === 'new' && (
              <form className="stack" onSubmit={submit}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setView('list')}><ArrowLeft aria-hidden />{t('support.back')}</button>
                <label className="field"><span>{t('support.subject')}</span><input className="input" required maxLength={120} value={subject} onChange={e => setSubject(e.target.value)} /></label>
                <label className="field"><span>{t('support.category')}</span>
                  <select className="select" value={category} onChange={e => setCategory(e.target.value as Category)}>{CATEGORIES.map(c => <option key={c} value={c}>{t(`support.cat.${c}` as never)}</option>)}</select></label>
                <label className="field"><span>{t('support.message')}</span><textarea className="textarea" required maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('support.messageHelp')} /></label>
                {error && <p className="error-text" role="alert">{error}</p>}
                <button className="btn btn-accent" disabled={!subject.trim() || !message.trim() || create.isPending}>{create.isPending && <span className="spinner" />}{t('support.submit')}</button>
              </form>
            )}
            {view !== 'list' && view !== 'new' && <Thread id={view} onBack={() => setView('list')} />}
          </div>
        </aside>
      )}
    </>
  )
}
