import { createBackend, type DemoBackend, type DemoRequest } from './backend'
import { reset } from './state'
export { createBackend, reset }
export type { DemoBackend, DemoRequest }
export { HubConnection, HubConnectionBuilder, LogLevel } from './realtime'
export { subscribe, emit } from './state'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Remplace fetch pour tout appel à /api/* : le faux serveur répond avec un court délai réaliste. Le reste passe tel quel. */
export function installDemoFetch(backend: DemoBackend): void {
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    const url = new URL(req.url, window.location.href)
    if (!url.pathname.startsWith('/api/')) return real(input, init)
    const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text()
    const r: DemoRequest = { method: req.method, path: url.pathname, query: url.searchParams, authorization: req.headers.get('Authorization'), body: text ? JSON.parse(text) : undefined }
    await delay(25 + Math.random() * 70)
    const res = backend.handle(r)
    return new Response(res.json === null || res.status === 204 ? null : JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } })
  }
}
