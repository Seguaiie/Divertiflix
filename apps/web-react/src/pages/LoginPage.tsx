import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { ApiError } from '../lib/api'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../state/auth'
import { GeneratedArt } from '../components/Art'
import { Logo } from '../components/Nav'
import './LoginPage.css'

export function LoginPage() {
  const { t, locale, setLocale } = useI18n()
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profileName, setProfileName] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useDocumentTitle(mode === 'login' ? t('auth.login') : t('auth.register'))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await register(email.trim(), password, profileName.trim())
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      setError(
        status === 0 ? t('auth.offline')
        : status === 401 ? t('auth.invalid')
        : status === 429 ? t('auth.tooMany')
        : status === 409 ? t('auth.emailTaken')
        : status === 400 ? t('auth.checkFields')
        : t('auth.generic'),
      )
    } finally { setBusy(false) }
  }

  return (
    <main className="login">
      <div className="login-art" aria-hidden>
        <GeneratedArt seed="divertiflix-login" genre="Drame" ratio="backdrop" />
        <div className="login-art-scrim" />
        <div className="login-art-copy">
          <p className="eyebrow">{t('auth.eyebrow')}</p>
          <h2 className="serif">{t('auth.headline')}</h2>
          <p>{t('auth.sub')}</p>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <Logo />
          <div className="login-tabs" role="tablist" aria-label={t('auth.mode')}>
            <button role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(null) }}>{t('auth.login')}</button>
            <button role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(null) }}>{t('auth.register')}</button>
          </div>
          <form onSubmit={submit} className="stack" noValidate={false}>
            <label className="field"><span>{mode === 'register' ? t('auth.email') : t('auth.identifier')}</span>
              <input className="input" required value={email} onChange={e => setEmail(e.target.value)} type={mode === 'register' ? 'email' : 'text'} autoComplete={mode === 'register' ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} maxLength={256} /></label>
            {/* Le bouton « afficher » reste hors du <label> : sinon son texte s'ajoute au nom accessible du champ. */}
            <div className="field"><label htmlFor="login-password">{t('auth.password')}</label>
              <span className="input-wrap">
                <input id="login-password" className="input" required value={password} onChange={e => setPassword(e.target.value)} type={show ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} maxLength={128} aria-describedby={mode === 'register' ? 'pw-hint' : undefined} />
                <button type="button" className="icon-btn plain sm" onClick={() => setShow(s => !s)} aria-label={show ? t('auth.hide') : t('auth.show')} aria-pressed={show}>{show ? <EyeOff /> : <Eye />}</button>
              </span>
              {mode === 'register' && <span id="pw-hint" className="hint">{t('auth.passwordHint')}</span>}
            </div>
            {mode === 'register' && <label className="field"><span>{t('auth.profileName')}</span><input className="input" required maxLength={50} value={profileName} onChange={e => setProfileName(e.target.value)} autoComplete="given-name" /></label>}
            {error && <p role="alert" className="error-text">{error}</p>}
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy && <span className="spinner" />}{mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}</button>
          </form>
          <button className="link login-lang" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}>{locale === 'fr' ? 'English' : 'Français'}</button>
        </div>
      </div>
    </main>
  )
}
