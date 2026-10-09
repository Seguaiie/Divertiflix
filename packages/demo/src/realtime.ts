import { subscribe } from './state'

/**
 * Remplace @microsoft/signalr dans la démonstration : une « connexion » qui reçoit les évènements diffusés entre onglets
 * (une demande approuvée dans le back-office arrive en direct dans le portail ouvert dans un autre onglet, et inversement).
 */
type Handler = (...a: any[]) => void
export class HubConnection {
  private handlers = new Map<string, Handler[]>()
  private off: (() => void) | null = null
  on(name: string, h: Handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), h]) }
  onclose(_h: Handler) { /* jamais fermée */ }
  onreconnected(_h: Handler) { /* jamais déconnectée */ }
  onreconnecting(_h: Handler) { /* jamais déconnectée */ }
  start(): Promise<void> {
    this.off ??= subscribe(e => (this.handlers.get(e.name) ?? []).forEach(h => h(e.payload)))
    return Promise.resolve()
  }
  stop(): Promise<void> { this.off?.(); this.off = null; return Promise.resolve() }
}
export class HubConnectionBuilder {
  withUrl(_u: string, _o?: unknown) { return this }
  withAutomaticReconnect(_d?: unknown) { return this }
  configureLogging(_l?: unknown) { return this }
  build() { return new HubConnection() }
}
export const LogLevel = { None: 6, Error: 4, Warning: 3, Information: 2, Debug: 1, Trace: 0, Critical: 5 }
