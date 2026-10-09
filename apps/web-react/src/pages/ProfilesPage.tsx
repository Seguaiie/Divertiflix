import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api, call } from '../lib/api'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../state/auth'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Nav'
import './ProfilesPage.css'

const MAX = 5

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
  useDocumentTitle(t('profiles.title'))

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => call(api.GET('/api/profiles')) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['profiles'] })
  const fail = (e: unknown) => setError((e as Error).message)
  const create = useMutation({ mutationFn: (n: string) => call(api.POST('/api/profiles', { body: { name: n } })), onSuccess: () => { setName(''); setAdding(false); setError(null); void refresh() }, onError: fail })
  const rename = useMutation({ mutationFn: (p: { id: string; name: string }) => call(api.PUT('/api/profiles/{id}', { params: { path: { id: p.id } }, body: { name: p.name } })), onSuccess: () => { setEditing(null); setError(null); void refresh() }, onError: fail })
  const remove = useMutation({ mutationFn: (id: string) => call(api.DELETE('/api/profiles/{id}', { params: { path: { id } } })), onSuccess: () => { setConfirm(null); setError(null); void refresh() }, onError: fail })

  const choose = (id: string) => { selectProfile(id); navigate('/', { replace: true }) }
  const submitAdd = (e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }
  const submitEdit = (e: FormEvent, id: string) => { e.preventDefault(); if (name.trim()) rename.mutate({ id, name: name.trim() }) }
  const count = profiles.data?.length ?? 0

  return (
    <main className="who">
      <Logo />
      <h1 className="serif">{managing ? t('profiles.manage') : t('profiles.title')}</h1>
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
            ) : (
              <div className="who-tile" data-managing={managing}>
                <button className="who-pick" onClick={() => (managing ? (setEditing(p.id), setName(p.name)) : choose(p.id))} aria-label={managing ? t('profiles.edit', { name: p.name }) : t('profiles.pick', { name: p.name })}>
                  <span className="who-avatar"><Avatar name={p.name} size={112} />{managing && <span className="who-overlay"><Pencil aria-hidden /></span>}</span>
                  <span className="who-name">{p.name}</span>
                </button>
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
    </main>
  )
}
