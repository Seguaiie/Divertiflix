import { DAY, HOUR, MIN, type J, nowIso, uuid } from './util'

/** État du faux serveur : tout ce que le visiteur peut modifier. Partagé entre le portail et le back-office via localStorage. */
export interface DemoState {
  v: number
  persona: { id: string; email: string; role: string }
  profiles: { id: string; name: string }[]
  watchlist: Record<string, string[]>
  progress: Record<string, Record<string, { pos: number; dur: number; at: string }>>
  ratings: Record<string, Record<string, number>>
  notifications: J[]
  requests: J[]
  tickets: J[]
  users: J[]
  titles: J[]
  plays: number
}

export const STATE_VERSION = 3
const KEY = 'divertiflix.demo.state'
const REV = 'divertiflix.demo.rev'
const CHANNEL = 'divertiflix-demo'

export const PERSONA_ID = '00000000-0000-4000-8000-0000000000d1'

/** Un flux HLS distant (démonstration Blender) n'est pas joignable depuis la page hébergée : le titre apparaît « sur demande ». */
function normalizeTitle(t: J): J {
  const remote = typeof t.streamUrl === 'string' && /^https?:/.test(t.streamUrl)
  return remote ? { ...t, streamUrl: null, isPlayable: false, streamKind: null } : { ...t }
}

/** Construit l'état initial depuis l'instantané de la vraie API. Les comptes, demandes et billets sont fictifs et cohérents. */
export function seed(snap: J): DemoState {
  const profileId: string = snap.profileId
  const progress: DemoState['progress'][string] = {}
  const ratings: DemoState['ratings'][string] = {}
  for (const [id, d] of Object.entries<J>(snap.details)) {
    const c = d.card
    if (c.progress) progress[id] = { pos: c.progress.positionSeconds, dur: c.progress.durationSeconds, at: c.progress.updatedAt }
    if (c.myRating) ratings[id] = c.myRating
  }
  const t0 = Date.now()
  const iso = (ms: number) => new Date(t0 - ms).toISOString()

  const camille = { id: PERSONA_ID, email: 'camille@exemple.ca' }
  const ticketA = uuid()
  const users: J[] = [
    { id: uuid(), email: 'root', role: 'Admin', source: 'Local', isActive: true, createdAt: iso(120 * DAY), profiles: 1 },
    { id: uuid(), email: 'support', role: 'Support', source: 'Local', isActive: true, createdAt: iso(110 * DAY), profiles: 1 },
    { id: uuid(), email: 'j.leblanc@divertiflix.local', role: 'Support', source: 'ActiveDirectory', isActive: true, createdAt: iso(60 * DAY), profiles: 1 },
    { id: PERSONA_ID, email: camille.email, role: 'Subscriber', source: 'Local', isActive: true, createdAt: iso(34 * DAY), profiles: 1 },
    { id: uuid(), email: 'alice.tremblay@exemple.ca', role: 'Subscriber', source: 'Local', isActive: true, createdAt: iso(41 * DAY), profiles: 2 },
    { id: uuid(), email: 'marc.bouchard@exemple.ca', role: 'Subscriber', source: 'Local', isActive: true, createdAt: iso(27 * DAY), profiles: 3 },
    { id: uuid(), email: 'lea.gagnon@exemple.ca', role: 'Subscriber', source: 'Local', isActive: true, createdAt: iso(19 * DAY), profiles: 1 },
    { id: uuid(), email: 'nadia.roy@exemple.ca', role: 'Subscriber', source: 'Local', isActive: true, createdAt: iso(9 * DAY), profiles: 2 },
    { id: uuid(), email: 'm.cote@divertiflix.local', role: 'Subscriber', source: 'ActiveDirectory', isActive: true, createdAt: iso(52 * DAY), profiles: 1 },
    { id: uuid(), email: 'ancien.compte@exemple.ca', role: 'Subscriber', source: 'Local', isActive: false, createdAt: iso(200 * DAY), profiles: 1 },
  ]
  const uid = (email: string) => users.find(u => u.email === email)!.id

  const requests: J[] = [
    { id: uuid(), name: 'Nosferatu', kind: 'Movie', year: 1922, note: 'Version restaurée si possible', status: 'Pending', titleId: null, requestedBy: 'alice.tremblay@exemple.ca', userId: uid('alice.tremblay@exemple.ca'), createdAt: iso(38 * MIN), updatedAt: iso(38 * MIN) },
    { id: uuid(), name: 'Solaris', kind: 'Movie', year: 1972, note: null, status: 'Pending', titleId: null, requestedBy: 'nadia.roy@exemple.ca', userId: uid('nadia.roy@exemple.ca'), createdAt: iso(3 * HOUR), updatedAt: iso(3 * HOUR) },
    { id: uuid(), name: 'Le Voyage dans la Lune', kind: 'Movie', year: 1902, note: 'Un classique du court métrage', status: 'Pending', titleId: null, requestedBy: camille.email, userId: PERSONA_ID, createdAt: iso(5 * HOUR), updatedAt: iso(5 * HOUR) },
    { id: uuid(), name: 'Metropolis', kind: 'Movie', year: 1927, note: null, status: 'Approved', titleId: null, requestedBy: camille.email, userId: PERSONA_ID, createdAt: iso(2 * DAY), updatedAt: iso(3 * HOUR) },
    { id: uuid(), name: 'Akira', kind: 'Movie', year: 1988, note: null, status: 'Downloading', titleId: null, requestedBy: 'marc.bouchard@exemple.ca', userId: uid('marc.bouchard@exemple.ca'), createdAt: iso(3 * DAY), updatedAt: iso(1 * DAY) },
    { id: uuid(), name: 'Titanic', kind: 'Movie', year: 1997, note: null, status: 'Declined', titleId: null, requestedBy: 'lea.gagnon@exemple.ca', userId: uid('lea.gagnon@exemple.ca'), createdAt: iso(6 * DAY), updatedAt: iso(5 * DAY) },
  ]

  const msg = (fromStaff: boolean, body: string, ago: number) => ({ id: uuid(), fromStaff, body, at: iso(ago) })
  const tickets: J[] = [
    { id: ticketA, subject: 'Lecture saccadée sur Ligne 9', category: 'Playback', status: 'InProgress', requester: camille.email, userId: PERSONA_ID, createdAt: iso(26 * HOUR), updatedAt: iso(20 * MIN),
      messages: [msg(false, 'Ça saccade depuis ce matin sur mon téléviseur, surtout au début du film.', 26 * HOUR), msg(true, 'Merci du signalement, nous regardons du côté du serveur de médias.', 25 * HOUR), msg(false, 'Toujours le cas ce soir.', 20 * MIN)] },
    { id: uuid(), subject: 'Je ne retrouve pas mon mot de passe', category: 'Account', status: 'Open', requester: 'marc.bouchard@exemple.ca', userId: uid('marc.bouchard@exemple.ca'), createdAt: iso(2 * HOUR), updatedAt: iso(2 * HOUR),
      messages: [msg(false, "Le lien de réinitialisation ne m'arrive pas, j'ai vérifié mes courriels indésirables.", 2 * HOUR)] },
    { id: uuid(), subject: 'Sous-titres décalés', category: 'Playback', status: 'Open', requester: 'lea.gagnon@exemple.ca', userId: uid('lea.gagnon@exemple.ca'), createdAt: iso(50 * MIN), updatedAt: iso(50 * MIN),
      messages: [msg(false, 'Les sous-titres arrivent environ deux secondes trop tard sur Marée basse.', 50 * MIN)] },
    { id: uuid(), subject: 'Question sur ma facture de septembre', category: 'Account', status: 'Resolved', requester: 'nadia.roy@exemple.ca', userId: uid('nadia.roy@exemple.ca'), createdAt: iso(8 * DAY), updatedAt: iso(7 * DAY),
      messages: [msg(false, "Je ne comprends pas le montant de ma facture de septembre.", 8 * DAY), msg(true, 'Le prorata du changement de forfait explique la différence : détail envoyé par courriel.', 7.5 * DAY), msg(false, 'Parfait, merci !', 7 * DAY)] },
  ]

  const notifications: J[] = [
    { id: uuid(), kind: 'request.approved', title: 'Metropolis', body: null, link: null, createdAt: iso(3 * HOUR), read: false },
    { id: uuid(), kind: 'ticket.reply', title: 'Lecture saccadée sur Ligne 9', body: null, link: `/?aide=${ticketA}`, createdAt: iso(25 * HOUR), read: true },
  ]

  return {
    v: STATE_VERSION,
    persona: { ...camille, role: 'Subscriber' },
    profiles: [{ id: profileId, name: 'Camille' }],
    watchlist: { [profileId]: (snap.watchlist as J[]).map(c => c.title.id) },
    progress: { [profileId]: progress },
    ratings: { [profileId]: ratings },
    notifications,
    requests,
    tickets,
    users,
    titles: snap.admin.titles.map(normalizeTitle),
    plays: 0,
  }
}

// ---------------------------------------------------------------- Persistance et diffusion entre onglets

export function load(snap: J): DemoState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) { const s = JSON.parse(raw) as DemoState; if (s.v === STATE_VERSION) return s }
  } catch { /* stockage indisponible ou corrompu : on repart de l'état initial */ }
  const s = seed(snap)
  save(s)
  return s
}

export function save(s: DemoState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem(REV, String(Date.now())) } catch { /* stockage indisponible : l'état reste en mémoire */ }
}

export const revision = (): string => { try { return localStorage.getItem(REV) ?? '' } catch { return '' } }
export function reset(): void { try { localStorage.removeItem(KEY); localStorage.removeItem(REV) } catch { /* rien */ } }

export interface DemoEvent { name: string; payload: J }
type Listener = (e: DemoEvent) => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null
function ch(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL)
  ;(channel as unknown as { unref?: () => void }).unref?.()   // Node (tests) : ne retient pas le processus
  channel.onmessage = ev => listeners.forEach(l => l(ev.data as DemoEvent))
  return channel
}
/** Évènement « temps réel » : reçu par les autres onglets (et par celui-ci, comme le ferait SignalR). */
export function emit(name: string, payload: J): void {
  const e: DemoEvent = { name, payload }
  try { ch()?.postMessage(e) } catch { /* diffusion indisponible */ }
  setTimeout(() => listeners.forEach(l => l(e)), 0)
}
export function subscribe(l: Listener): () => void { ch(); listeners.add(l); return () => { listeners.delete(l) } }
export { nowIso }
