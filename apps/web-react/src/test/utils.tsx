import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { I18nProvider, type Locale } from '../i18n'
import type { AuthResponse, Card, Title } from '../lib/api'
import { AuthProvider } from '../state/auth'
import { DockProvider } from '../state/dock'
import { ToastProvider } from '../state/toast'
import { UIProvider } from '../state/ui'

export const USER_ID = '00000000-0000-4000-8000-000000000001'
export const PROFILE_ID = '00000000-0000-4000-8000-0000000000aa'

export function makeTitle(over: Partial<Title> = {}): Title {
  return {
    id: '11111111-1111-4111-8111-111111111111', name: 'Lueur Boréale', synopsis: 'Une enquête sous les aurores.', year: 2021,
    kind: 'Movie', genre: 'Thriller', durationMinutes: 108, posterUrl: null, backdropUrl: null, author: null, narrator: null,
    externalSource: 'demo', keywords: [], cast: [], director: null, rating: 7.4, maturity: '13+', addedAt: '2026-01-01T00:00:00Z',
    isPlayable: true, streamKind: 'Hls', credits: null, ...over,
  } as Title
}

export function makeCard(over: Partial<Card> = {}, title: Partial<Title> = {}): Card {
  return { title: makeTitle(title), progress: null, inWatchlist: false, myRating: 0, reason: null, match: 0, ...over } as Card
}

export function makeSession(over: Partial<AuthResponse> = {}): AuthResponse {
  return { accessToken: 'a.b.c', refreshToken: 'refresh', user: { id: USER_ID, email: 'camille@test.com', role: 'Subscriber' }, ...over } as AuthResponse
}

/** Ouvre une session de test : jetons dans le stockage et profil mémorisé, comme après une vraie connexion. */
export function signIn() {
  localStorage.setItem('divertiflix.session', JSON.stringify(makeSession()))
  localStorage.setItem(`divertiflix.profile.${USER_ID}`, PROFILE_ID)
}

type Handler = (req: { url: URL; method: string; body: unknown }) => unknown | { status: number; body?: unknown }
export type Routes = Record<string, Handler | unknown>

/**
 * Remplace fetch par un routeur de test : clé « METHODE /chemin » ou « /chemin ». Les routes inconnues renvoient 404
 * (et sont consignées) pour qu'un appel imprévu fasse échouer le test au lieu de passer inaperçu.
 */
export function mockApi(routes: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    const url = new URL(req.url)
    const text = await req.clone().text()
    const body = text ? JSON.parse(text) : undefined
    calls.push({ method: req.method, path: url.pathname, body })
    const hit = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname]
    if (hit === undefined) return new Response(JSON.stringify({ title: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/problem+json' } })
    const out = typeof hit === 'function' ? await (hit as Handler)({ url, method: req.method, body }) : hit
    const isStatus = out && typeof out === 'object' && 'status' in out && typeof (out as { status: unknown }).status === 'number'
    const status = isStatus ? (out as { status: number }).status : 200
    const payload = isStatus ? (out as { body?: unknown }).body : out
    return new Response(payload === undefined ? null : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

export function renderApp(ui: ReactElement, { route = '/', locale = 'fr' as Locale } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  return render(
    <I18nProvider initial={locale}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>
            <AuthProvider>
              <UIProvider>
                <DockProvider>{ui}</DockProvider>
              </UIProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}
