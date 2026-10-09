import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { api, call, type S } from '../lib/api'
import { useDialog } from '../hooks/useDialog'
import { keys } from '../state/queries'
import { useToast } from '../state/toast'
import { useUI } from '../state/ui'

/** Demande d'un titre absent du catalogue. Le suivi (en attente, approuvée, en préparation, disponible) se fait ici et dans la fiche. */
export function RequestDialog() {
  const { t, ago } = useI18n()
  const { request, closeRequest } = useUI()
  const qc = useQueryClient()
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'Movie' | 'Audiobook'>('Movie')
  const [year, setYear] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  useDialog(request.open, closeRequest, ref, { initialFocus: '#rq-name' })

  useEffect(() => { if (request.open) { setName(request.prefill); setError(null) } }, [request.open, request.prefill])
  const mine = useQuery({ queryKey: keys.myRequests, queryFn: () => call(api.GET('/api/requests/mine')), enabled: request.open })

  const create = useMutation({
    mutationFn: () => call(api.POST('/api/requests', { body: { name: name.trim(), kind, year: year ? Number(year) : null, note: note.trim() || null, titleId: null } })),
    onSuccess: () => {
      toast.push({ kind: 'ok', text: t('request.sent', { title: name.trim() }) })
      setName(''); setYear(''); setNote(''); setError(null)
      void qc.invalidateQueries({ queryKey: keys.myRequests })
      void qc.invalidateQueries({ queryKey: ['home'] })
    },
    onError: e => setError((e as Error).message),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => call(api.DELETE('/api/requests/{id}', { params: { path: { id } } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.myRequests }); void qc.invalidateQueries({ queryKey: ['home'] }) },
  })

  if (!request.open) return null
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate() }
  const statusLabel = (s: S['RequestCardDto']['status']) => t(`request.status.${s}` as never)

  return (
    <div className="overlay" style={{ display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' }} onMouseDown={e => { if (e.target === e.currentTarget) closeRequest() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="rq-title" ref={ref} style={{ width: 'min(560px, 100%)', padding: 'clamp(20px, 4vw, 32px)', display: 'grid', gap: 22 }}>
        <header className="row-flex">
          <div className="grow"><p className="eyebrow" style={{ color: 'var(--accent-hi)' }}>{t('request.eyebrow')}</p><h2 id="rq-title" className="display" style={{ fontSize: '2.2rem', lineHeight: 1 }}>{t('request.title')}</h2></div>
          <button className="icon-btn plain" onClick={closeRequest} aria-label={t('common.close')}><X /></button>
        </header>
        <p style={{ color: 'var(--text-2)' }}>{t('request.help')}</p>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>{t('request.name')}</span><input id="rq-name" className="input" required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field"><span>{t('request.kind')}</span>
              <select className="select" value={kind} onChange={e => setKind(e.target.value as 'Movie' | 'Audiobook')}><option value="Movie">{t('nav.films')}</option><option value="Audiobook">{t('nav.audiobooks')}</option></select></label>
            <label className="field"><span>{t('request.year')}</span><input className="input tnum" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="2024" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <label className="field"><span>{t('request.note')}</span><textarea className="textarea" style={{ minHeight: 80 }} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn-accent" disabled={!name.trim() || create.isPending}>{create.isPending && <span className="spinner" />}{t('request.submit')}</button>
        </form>
        {mine.data && mine.data.length > 0 && (
          <section aria-label={t('request.mine')}>
            <h3 className="eyebrow" style={{ marginBottom: 10 }}>{t('request.mine')}</h3>
            <ul style={{ display: 'grid', gap: 2 }}>
              {mine.data.map(r => (
                <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                  <div className="grow"><strong style={{ fontWeight: 600 }}>{r.name}</strong><div className="hint tnum">{ago(r.updatedAt)}</div></div>
                  <span className={`badge ${r.status === 'Available' ? 'accent' : ''}`}>{statusLabel(r.status)}</span>
                  {r.status === 'Pending' && <button className="btn btn-ghost btn-sm" onClick={() => cancel.mutate(r.id)}>{t('request.cancel')}</button>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
