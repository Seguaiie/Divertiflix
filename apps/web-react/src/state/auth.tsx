import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, call, LOGOUT_EVENT, session, type AuthResponse, type User } from '../lib/api'

const PROFILE_KEY = (userId: string) => `divertiflix.profile.${userId}`

interface AuthState {
  user: User | null
  profileId: string | null
  isStaff: boolean
  login(email: string, password: string): Promise<void>
  register(email: string, password: string, profileName: string): Promise<void>
  logout(): void
  selectProfile(id: string | null): void
}

const Ctx = createContext<AuthState | null>(null)

function readProfile(user: User | null): string | null {
  if (!user) return null
  try { return localStorage.getItem(PROFILE_KEY(user.id)) } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(() => session.get()?.user ?? null)
  const [profileId, setProfileId] = useState<string | null>(() => readProfile(session.get()?.user ?? null))

  const logout = useCallback(() => {
    const s = session.get()
    // Révocation côté serveur, sans bloquer l'interface : « se déconnecter » coupe réellement la session.
    if (s) void api.POST('/api/auth/logout', { body: { refreshToken: s.refreshToken } }).catch(() => undefined)
    session.clear()
    // Le cache contient les données du compte précédent : il ne doit jamais survivre à la déconnexion.
    qc.clear()
    setUser(null); setProfileId(null)
  }, [qc])

  useEffect(() => {
    const onLogout = () => { qc.clear(); setUser(null); setProfileId(null) }
    const onUser = (e: Event) => setUser((e as CustomEvent<User>).detail)
    window.addEventListener(LOGOUT_EVENT, onLogout)
    window.addEventListener('divertiflix:user', onUser)
    return () => { window.removeEventListener(LOGOUT_EVENT, onLogout); window.removeEventListener('divertiflix:user', onUser) }
  }, [qc])

  const accept = useCallback((a: AuthResponse) => {
    qc.clear()
    session.set(a)
    setUser(a.user)
    setProfileId(readProfile(a.user))
  }, [qc])

  const value = useMemo<AuthState>(() => ({
    user, profileId, logout,
    isStaff: user?.role === 'Admin' || user?.role === 'Support',
    async login(email, password) {
      accept(await call(api.POST('/api/auth/login', { body: { email, password } }), 'login'))
    },
    async register(email, password, profileName) {
      const a = await call(api.POST('/api/auth/register', { body: { email, password, profileName } }), 'register')
      // Le profil vient d'être nommé par la personne : on l'ouvre directement au lieu de lui redemander « Qui regarde ? ».
      session.set(a)
      try {
        const first = (await call(api.GET('/api/profiles')))[0]
        if (first) localStorage.setItem(PROFILE_KEY(a.user.id), first.id)
      } catch { /* le sélecteur de profils prend le relais */ }
      accept(a)
    },
    selectProfile(id) {
      if (!user) return
      try {
        if (id) localStorage.setItem(PROFILE_KEY(user.id), id)
        else localStorage.removeItem(PROFILE_KEY(user.id))
      } catch { /* stockage indisponible */ }
      setProfileId(id)
    },
  }), [user, profileId, logout, accept])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth hors AuthProvider')
  return c
}
