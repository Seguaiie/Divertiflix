import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'

export function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profileName, setProfileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, profileName)
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <main className="auth">
      <h1 className="logo">Divertiflix</h1>
      <form onSubmit={submit}>
        <h2>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
        <label>{mode === 'register' ? 'Courriel' : 'Courriel ou identifiant'}<input type={mode === 'register' ? 'email' : 'text'} required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Mot de passe<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {mode === 'register' && (
          <label>Nom du premier profil<input required maxLength={50} value={profileName} onChange={e => setProfileName(e.target.value)} /></label>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        <button disabled={busy}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Pas de compte ? Inscription' : 'Déjà inscrit ? Connexion'}
        </button>
      </form>
    </main>
  )
}
