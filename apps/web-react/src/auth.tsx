import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, session, type AuthResponse } from './api'

type User = AuthResponse['user']
const PROFILE_KEY = 'divertiflix.profile'

interface AuthState {
  user: User | null
  profileId: string | null
  login(email: string, password: string): Promise<void>
  register(email: string, password: string, profileName: string): Promise<void>
  logout(): void
  selectProfile(id: string | null): void
}

const Ctx = createContext<AuthState | null>(null)

function readUser(): User | null {
  try { return JSON.parse(localStorage.getItem('divertiflix.user') ?? 'null') } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (session.get() ? readUser() : null))
  const [profileId, setProfileId] = useState<string | null>(() => localStorage.getItem(PROFILE_KEY))

  const logout = useCallback(() => {
    session.clear()
    localStorage.removeItem('divertiflix.user')
    localStorage.removeItem(PROFILE_KEY)
    setUser(null); setProfileId(null)
  }, [])

  useEffect(() => {
    window.addEventListener('divertiflix:logout', logout)
    return () => window.removeEventListener('divertiflix:logout', logout)
  }, [logout])

  const accept = (a: AuthResponse) => {
    session.set(a)
    localStorage.setItem('divertiflix.user', JSON.stringify(a.user))
    setUser(a.user)
  }

  const value = useMemo<AuthState>(() => ({
    user, profileId, logout,
    async login(email, password) {
      const { data, error } = await api.POST('/api/auth/login', { body: { email, password } })
      if (!data) throw new Error((error as { error?: string } | undefined)?.error ?? 'Connexion impossible.')
      accept(data)
    },
    async register(email, password, profileName) {
      const { data, error, response } = await api.POST('/api/auth/register', { body: { email, password, profileName } })
      if (!data) throw new Error((error as { error?: string } | undefined)?.error ?? (response.status === 400 ? 'Données invalides (mot de passe : 8 caractères min.).' : 'Inscription impossible.'))
      accept(data)
    },
    selectProfile(id) {
      if (id) localStorage.setItem(PROFILE_KEY, id); else localStorage.removeItem(PROFILE_KEY)
      setProfileId(id)
    },
  }), [user, profileId, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth hors AuthProvider')
  return c
}
