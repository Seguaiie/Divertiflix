import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call, type S } from '../lib/api'
import { errorText } from '../lib/errors'
import { useDialog } from '../hooks/useDialog'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../state/auth'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'
import './ProfilesPage.css'

const MAX = 5
const MATURITIES = ['TP', '8+', '13+', '16+', '18+']

export function ProfilesPage() {
  const { t } = useI18n()
  const { selectProfile, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [locking, setLocking] = useState<string | null>(null)
  const [lockPin, setLockPin] = useState('')
  const [lockMaturity, setLockMaturity] = useState('')
  const [unlocking, setUnlocking] = useState<S['ProfileDto'] | null>(null)
  useDocumentTitle(t('profiles.title'))

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => call(api.GET('/api/profiles')) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['profiles'] })
  const fail = (e: unknown) => setError(errorText(e, t, { 409: 'profiles.conflict' }))
  const create = useMutation({ mutationFn: (n: string) => call(api.POST('/api/profiles', { body: { name: n } })), onSuccess: () => { setName(''); setAdding(false); setError(null); void refresh() }, onError: fail })
  const rename = useMutation({ mutationFn: (p: { id: string; name: string }) => call(api.PUT('/api/profiles/{id}', { params: { path: { id: p.id } }, body: { name: p.name } })), onSuccess: () => { setEditing(null); setError(null); void refresh() }, onError: fail })
  const remove = useMutation({ mutationFn: (id: string) => call(api.DELETE('/api/profiles/{id}', { params: { path: { id } } })), onSuccess: () => { setConfirm(null); setError(null); void refresh() }, onError: fail })
  const setLock = useMutation({
    mutationFn: (p: { id: string; pin: string | null; maturityLimit: string | null }) =>
      call(api.PUT('/api/profiles/{id}/lock', { params: { path: { id: p.id } }, body: { pin: p.pin, maturityLimit: p.maturityLimit } })),
    onSuccess: () => { setLocking(null); setError(null); void refresh() },
    onError: fail,
  })

  const choose = (p: S['ProfileDto']) => (p.hasPin ? setUnlocking(p) : (selectProfile(p.id), navigate('/', { replace: true })))
  const submitAdd = (e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }
  const submitEdit = (e: FormEvent, id: string) => { e.preventDefault(); if (name.trim()) rename.mutate({ id, name: name.trim() }) }
  const submitLock = (e: FormEvent, id: string) => { e.preventDefault(); setLock.mutate({ id, pin: lockPin.trim() || null, maturityLimit: lockMaturity || null }) }
  const count = profiles.data?.length ?? 0

  return (
    <main className="who">
      <Logo />
      <h1 className="display">{managing ? t('profiles.manage') : t('profiles.title')}</h1>
      <ul className="who-grid">
        {profiles.isPending && Array.from({ length: 2 }, (_, i) => <li key={i} className="skeleton" style={{ width: 128, height: 168, borderRadius: 12 }} />)}
        {profiles.data?.map(p => (
          <li key={p.id} className="who-item">
            {editing === p.id ? (
              <form onSubmit={e => submitEdit(e, p.id)} className="who-edit">
                <Avatar name={name || p.name} size={112} />
                <label className="visually-hidden" htmlFor={`pn-${p.id}`}>{t('profiles.name')}</label>
                <input id={`pn-${p.id}`} className="input" autoFocus maxLength={50} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }} />
                <div className="row-flex"><button className="btn btn-primary btn-sm" disabled={!name.trim()}>{t('common.save')}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>{t('common.cancel')}</button></div>
              </form>
            ) : locking === p.id ? (
              <form onSubmit={e => submitLock(e, p.id)} className="who-edit who-lock">
                <Avatar name={p.name} size={112} />
                <label className="field"><span>{t('profiles.pin')}</span>
                  <input className="input" type="password" inputMode="numeric" autoFocus maxLength={20} value={lockPin} placeholder={p.hasPin ? t('profiles.pinKeepHint') : t('profiles.pinNoneHint')} onChange={e => setLockPin(e.target.value)} />
                </label>
                <label className="field"><span>{t('profiles.maturity')}</span>
                  <select className="select" value={lockMaturity} onChange={e => setLockMaturity(e.target.value)}>
                    <option value="">{t('profiles.maturityNone')}</option>
                    {MATURITIES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <p className="hint">{t('profiles.pinHint')}</p>
                {setLock.isError && <p className="error-text" role="alert">{errorText(setLock.error, t)}</p>}
                <div className="row-flex"><button className="btn btn-primary btn-sm" disabled={setLock.isPending}>{t('common.save')}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLocking(null)}>{t('common.cancel')}</button></div>
              </form>
            ) : (
              <div className="who-tile" data-managing={managing}>
                <button className="who-pick" onClick={() => (managing ? (setEditing(p.id), setName(p.name)) : choose(p))} aria-label={managing ? t('profiles.edit', { name: p.name }) : t('profiles.pick', { name: p.name })}>
                  <span className="who-avatar"><Avatar name={p.name} size={112} />{managing && <span className="who-overlay"><Pencil aria-hidden /></span>}{p.hasPin && <span className="who-lock-badge" title={t('profiles.locked')}><Lock aria-hidden /></span>}</span>
                  <span className="who-name">{p.name}</span>
                </button>
                {managing && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setLocking(p.id); setLockPin(''); setLockMaturity(p.maturityLimit ?? '') }} aria-label={t('profiles.lockSettings', { name: p.name })}>
                    <Lock aria-hidden />{t('profiles.lockBtn')}
                  </button>
                )}
                {managing && count > 1 && (confirm === p.id
                  ? <div className="who-confirm"><span>{t('profiles.confirm')}</span><button className="btn btn-danger btn-sm" onClick={() => remove.mutate(p.id)}>{t('common.delete')}</button><button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>{t('common.cancel')}</button></div>
                  : <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(p.id)} aria-label={t('profiles.delete', { name: p.name })}><Trash2 aria-hidden />{t('common.delete')}</button>)}
              </div>
            )}
          </li>
        ))}
        {profiles.data && count < MAX && (
          <li className="who-item">
            {adding ? (
              <form onSubmit={submitAdd} className="who-edit">
                <span className="who-add-icon"><Plus aria-hidden /></span>
                <label className="visually-hidden" htmlFor="pn-new">{t('profiles.name')}</label>
                <input id="pn-new" className="input" autoFocus maxLength={50} value={name} placeholder={t('profiles.name')} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setAdding(false) }} />
                <div className="row-flex"><button className="btn btn-primary btn-sm" disabled={!name.trim() || create.isPending}>{t('profiles.add')}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t('common.cancel')}</button></div>
              </form>
            ) : (
              <button className="who-pick" onClick={() => { setAdding(true); setName('') }}>
                <span className="who-add-icon"><Plus aria-hidden /></span><span className="who-name">{t('profiles.add')}</span>
              </button>
            )}
          </li>
        )}
      </ul>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row-flex">
        <button className="btn btn-glass" onClick={() => { setManaging(m => !m); setEditing(null); setConfirm(null) }}>{managing ? <><X aria-hidden />{t('profiles.done')}</> : <><Pencil aria-hidden />{t('profiles.manageBtn')}</>}</button>
        <button className="btn btn-ghost" onClick={() => { logout(); navigate('/connexion') }}>{t('menu.logout')}</button>
      </div>
      <UnlockDialog profile={unlocking} onClose={() => setUnlocking(null)}
        onUnlocked={id => { setUnlocking(null); selectProfile(id); navigate('/', { replace: true }) }} />
    </main>
  )
}

/** Code à saisir avant d'ouvrir un profil verrouillé. */
function UnlockDialog({ profile, onClose, onUnlocked }: { profile: S['ProfileDto'] | null; onClose(): void; onUnlocked(id: string): void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  useDialog(!!profile, onClose, ref, { initialFocus: '#unlock-pin' })
  useEffect(() => { setPin(''); setError(null) }, [profile?.id])

  const unlock = useMutation({
    mutationFn: () => call(api.POST('/api/profiles/{id}/unlock', { params: { path: { id: profile!.id } }, body: { pin } })),
    onSuccess: () => onUnlocked(profile!.id),
    onError: e => setError(errorText(e, t, { 403: 'profiles.pinWrong' })),
  })

  if (!profile) return null
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); if (pin.trim()) unlock.mutate() }

  return createPortal(
    <div className="overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="unlock-title" ref={ref} style={{ width: 'min(360px, 100%)', padding: 'clamp(20px, 4vw, 32px)', display: 'grid', gap: 16, textAlign: 'center' }}>
        <div style={{ justifySelf: 'center' }}><Avatar name={profile.name} size={72} /></div>
        <h2 id="unlock-title" className="display" style={{ fontSize: '1.4rem' }}>{t('profiles.pinPrompt', { name: profile.name })}</h2>
        <form className="stack" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="unlock-pin">{t('profiles.pin')}</label>
          <input id="unlock-pin" className="input" type="password" inputMode="numeric" maxLength={20} value={pin} onChange={e => setPin(e.target.value)} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row-flex" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" disabled={!pin.trim() || unlock.isPending}>{unlock.isPending && <span className="spinner" />}{t('profiles.pinSubmit')}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
