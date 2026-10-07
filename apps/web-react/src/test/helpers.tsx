import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { AuthProvider } from '../auth'

export function renderApp(ui: ReactElement, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></AuthProvider>
    </QueryClientProvider>,
  )
}

/** Remplace fetch : chaque route "METHODE /chemin" renvoie [statut, corps]. */
export function mockApi(routes: Record<string, [number, unknown]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, 'http://localhost'), init)
    const key = `${req.method} ${new URL(req.url).pathname}`
    calls.push(key)
    const hit = routes[key]
    if (!hit) return new Response('not mocked: ' + key, { status: 500 })
    return new Response(JSON.stringify(hit[1]), { status: hit[0], headers: { 'Content-Type': 'application/json' } })
  }))
  return calls
}
