import { chat } from './assistant'
import { type DemoState, PERSONA_ID, emit, load, revision, save } from './state'
import { DAY, type J, fakeJwt, normalize, nowIso, problem, readJwt, uuid } from './util'

export interface DemoRequest { method: string; path: string; query: URLSearchParams; authorization?: string | null; body?: any }
export interface DemoResponse { status: number; json: any }
export interface DemoBackend { handle(req: DemoRequest): DemoResponse }

const ok = (json: any, status = 200): DemoResponse => ({ status, json })
const noContent = (): DemoResponse => ({ status: 204, json: null })
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const TRANSITIONS: Record<string, string[]> = { Pending: ['Approved', 'Declined'], Approved: ['Downloading', 'Available', 'Declined'], Downloading: ['Available', 'Declined'] }
const STAFF = ['Admin', 'Support']

/**
 * Faux serveur de démonstration : mêmes routes, mêmes formes de réponse et mêmes règles métier que l'API réelle
 * (transitions de demandes, rôles, garde-fous sur les comptes), sur un catalogue capturé de la vraie API.
 * L'état est conservé dans le navigateur et partagé entre le portail et le back-office.
 */
export function createBackend(snap: J, opts: { mediaBase: string }): DemoBackend {
  const base = opts.mediaBase
  let S: DemoState = load(snap)
  let rev = revision()
  const sync = () => { const r = revision(); if (r !== rev) { S = load(snap); rev = r } }
  const commit = () => { save(S); rev = revision() }

  // ------------------------------------------------------------ Titres
  const slugOf = (streamUrl: string | null) => (streamUrl?.startsWith('media:') ? streamUrl.slice(6).split('/')[0]! : null)
  const art = (u: string | null) => (u ? u.replace('/api/media/art/', `${base}art/`) : u)
  const adminDto = (t: J): J => ({ ...t, posterUrl: art(t.posterUrl), backdropUrl: art(t.backdropUrl) })
  const dto = (t: J): J => { const { streamUrl: _s, ...rest } = adminDto(t); return rest }
  const titleById = (id: string) => S.titles.find(t => t.id === id) ?? null
  const portalTitles = () => S.titles.map(dto)

  const playbackOf = (t: J) => {
    const slug = slugOf(t.streamUrl)
    if (slug && t.streamKind === 'Audio') return { kind: 'Audio', url: `${base}audio/${slug}.mp3` }
    if (slug) return { kind: 'Video', url: `${base}video/${slug}.mp4` }
    return t.streamUrl ? { kind: t.streamKind ?? 'External', url: t.streamUrl } : null
  }

  // ------------------------------------------------------------ Cartes, état du profil
  const prog = (pid: string, id: string) => S.progress[pid]?.[id]
  const progressDto = (pid: string, id: string) => {
    const p = prog(pid, id)
    return p ? { positionSeconds: p.pos, durationSeconds: p.dur, fraction: p.dur > 0 ? Math.min(1, p.pos / p.dur) : 0, updatedAt: p.at } : null
  }
  const baseCard = (id: string): J | null => snap.details[id]?.card ?? null
  function cardOf(pid: string, id: string, over: { reason?: J | null; match?: number } = {}): J {
    const t = titleById(id)!
    const rec = baseCard(id)
    return {
      title: dto(t), progress: progressDto(pid, id), inWatchlist: (S.watchlist[pid] ?? []).includes(id), myRating: S.ratings[pid]?.[id] ?? 0,
      reason: over.reason !== undefined ? over.reason : (rec?.reason ?? null), match: over.match ?? rec?.match ?? 0,
    }
  }
  const refresh = (pid: string, c: J): J | null => (titleById(c.title.id) ? cardOf(pid, c.title.id, { reason: c.reason, match: c.match }) : null)
  const refreshAll = (pid: string, cs: J[]) => cs.map(c => refresh(pid, c)).filter(Boolean) as J[]
  const ownProfile = (pid: string | null | undefined) => !!pid && S.profiles.some(p => p.id === pid)

  const requestCard = (r: J, mine: boolean): J => ({ id: r.id, name: r.name, kind: r.kind, year: r.year ?? null, status: r.status, updatedAt: r.updatedAt, mine, titleId: r.titleId ?? null })

  function home(pid: string): J {
    const h = clone(snap.home)
    const continuing = Object.entries(S.progress[pid] ?? {})
      .filter(([id, p]) => { const f = p.dur > 0 ? p.pos / p.dur : 0; return f >= 0.02 && f < 0.92 && titleById(id)?.isPlayable })
      .sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 12).map(([id]) => cardOf(pid, id, { reason: null }))
    const listed = (S.watchlist[pid] ?? []).filter(id => titleById(id)).map(id => cardOf(pid, id))
    const rows: J[] = []
    for (const r of h.rows as J[]) {
      if (r.type === 'continue') { if (continuing.length) rows.push({ ...r, items: continuing }) ; continue }
      if (r.type === 'watchlist') { if (listed.length) rows.push({ ...r, items: listed }); continue }
      if (r.type === 'requests') {
        const mine = S.requests.filter(x => x.userId === PERSONA_ID && ['Pending', 'Approved', 'Downloading'].includes(x.status)).map(x => requestCard(x, true))
        if (mine.length) rows.push({ ...r, items: [], requests: mine })
        continue
      }
      const items = refreshAll(pid, r.items)
      if (items.length) rows.push({ ...r, items })
    }
    // « Continuer » et « Ma liste » viennent en tête, comme sur le vrai accueil.
    const hero: J[] = []
    if (continuing[0]) hero.push({ card: continuing[0], mode: 'continue' })
    for (const x of h.hero as J[]) { if (x.mode !== 'continue' && !hero.some(y => y.card.title.id === x.card.title.id)) { const c = refresh(pid, x.card); if (c) hero.push({ card: c, mode: x.mode }) } }
    const cont = rows.filter(r => r.type === 'continue'), rest = rows.filter(r => r.type !== 'continue')
    return { hero: hero.slice(0, 5), rows: [...cont, ...rest], generatedAt: nowIso(), hasTaste: true }
  }

  function list(q: URLSearchParams): J {
    const page = Math.max(1, +(q.get('page') ?? 1) || 1)
    const size = Math.min(100, Math.max(1, +(q.get('pageSize') ?? 20) || 20))
    const text = q.get('q') ?? ''
    const words = normalize(text).split(' ').filter(Boolean).slice(0, 8)
    const prefix = normalize(text)
    let items = portalTitles().filter(t => {
      const hay = normalize([t.name, t.author, t.narrator, t.genre, t.director, ...(t.keywords ?? []), ...(t.cast ?? [])].filter(Boolean).join(' '))
      if (text.trim() && !words.length) return false
      if (!words.every(w => hay.includes(w))) return false
      if (q.get('genre') && t.genre !== q.get('genre')) return false
      if (q.get('kind') && t.kind !== q.get('kind')) return false
      if (q.get('available') === 'true' && !t.isPlayable) return false
      return true
    })
    const sort = q.get('sort')
    const byName = (a: J, b: J) => a.name.localeCompare(b.name, 'fr')
    if (prefix && (!sort || sort === 'name')) items.sort((a, b) => Number(normalize(b.name).startsWith(prefix)) - Number(normalize(a.name).startsWith(prefix)) || byName(a, b))
    else if (sort === 'recent') items.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byName(a, b))
    else if (sort === 'rating') items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byName(a, b))
    else if (sort === 'year') items.sort((a, b) => b.year - a.year || byName(a, b))
    else items.sort(byName)
    return { items: items.slice((page - 1) * size, page * size), total: items.length, page, pageSize: size }
  }

  function detail(pid: string, id: string): J | null {
    const rec = snap.details[id]
    const t = titleById(id)
    if (!t) return null
    const similar = rec ? refreshAll(pid, rec.similar) : []
    const req = !t.isPlayable ? S.requests.find(r => r.titleId === id || normalize(r.name) === normalize(t.name)) : null
    return { card: cardOf(pid, id), similar, request: req ? requestCard(req, req.userId === PERSONA_ID) : null }
  }

  // ------------------------------------------------------------ Notifications et évènements
  function notify(userId: string, kind: string, title: string, body: string | null, link: string | null) {
    if (userId !== PERSONA_ID) return
    const n = { id: uuid(), kind, title, body, link, createdAt: nowIso(), read: false }
    S.notifications.unshift(n)
    commit()   // l'autre onglet relit l'état : la notification doit y être avant l'évènement
    emit('notification', n)
  }

  function adminRequest(r: J): J { return { id: r.id, name: r.name, kind: r.kind, year: r.year ?? null, note: r.note ?? null, status: r.status, titleId: r.titleId ?? null, requestedBy: r.requestedBy, createdAt: r.createdAt, updatedAt: r.updatedAt } }
  const ticketSummary = (t: J) => ({ id: t.id, subject: t.subject, category: t.category, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt })
  const msgDto = (m: J) => ({ id: m.id, fromStaff: m.fromStaff, body: m.body, at: m.at })

  function stats(): J {
    const titles = S.titles
    const by = new Map<string, number>()
    for (const t of titles) if (t.genre) by.set(t.genre, (by.get(t.genre) ?? 0) + 1)
    return {
      titles: titles.length, playable: titles.filter(t => t.isPlayable).length,
      movies: titles.filter(t => t.kind === 'Movie').length, series: titles.filter(t => t.kind === 'Series').length, audiobooks: titles.filter(t => t.kind === 'Audiobook').length,
      byGenre: [...by.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre)),
      users: S.users.length, activeUsers: S.users.filter(u => u.isActive).length, staff: S.users.filter(u => u.role !== 'Subscriber').length,
      requestsPending: S.requests.filter(r => r.status === 'Pending').length, requestsInProgress: S.requests.filter(r => ['Approved', 'Downloading'].includes(r.status)).length,
      ticketsOpen: S.tickets.filter(t => t.status !== 'Resolved').length, activeProfiles7d: 14 + S.profiles.length, plays24h: 38 + S.plays,
    }
  }

  // ------------------------------------------------------------ Routage
  type Ctx = { method: string; path: string; q: URLSearchParams; body: any; user: { sub: string; email: string; role: string } | null }
  const routes: [string, RegExp, (c: Ctx, m: RegExpExecArray) => DemoResponse][] = []
  const on = (method: string, pattern: string, fn: (c: Ctx, m: RegExpExecArray) => DemoResponse) => routes.push([method, new RegExp('^' + pattern.replace(/\{id\}/g, '([^/]+)').replace(/\{titleId\}/g, '([^/]+)') + '/?$'), fn])
  const isStaff = (c: Ctx) => !!c.user && STAFF.includes(c.user.role)
  const needAdmin = (c: Ctx) => (c.user?.role === 'Admin' ? null : problem(403, "Votre rôle ne permet pas cette action."))
  const needStaff = (c: Ctx) => (isStaff(c) ? null : problem(403, "Votre rôle ne permet pas cette action."))

  // Authentification : n'importe quels identifiants fonctionnent ; l'identifiant détermine le rôle (root = Admin, support = Support).
  const session = (email: string, name?: string) => {
    const login = email.trim().toLowerCase()
    const role = /^(root|admin)/.test(login) ? 'Admin' : /^support/.test(login) ? 'Support' : 'Subscriber'
    const known = S.users.find(u => u.email === login)
    const id = role === 'Subscriber' ? PERSONA_ID : (known?.id ?? uuid())
    if (name && S.profiles[0]) S.profiles[0].name = name.trim().slice(0, 50) || S.profiles[0].name
    if (role === 'Subscriber') { S.persona.email = login.includes('@') ? login : S.persona.email; const me = S.users.find(u => u.id === PERSONA_ID); if (me) me.email = S.persona.email; S.requests.filter(r => r.userId === PERSONA_ID).forEach(r => (r.requestedBy = S.persona.email)); S.tickets.filter(t => t.userId === PERSONA_ID).forEach(t => (t.requester = S.persona.email)) }
    const user = { id, email: role === 'Subscriber' ? S.persona.email : login, role }
    commit()
    return { accessToken: fakeJwt(user), refreshToken: 'demo-refresh', user }
  }
  on('POST', '/api/auth/login', c => (c.body?.email && c.body?.password ? ok(session(String(c.body.email))) : problem(401, 'Identifiants invalides.')))
  on('POST', '/api/auth/register', c => (c.body?.email && c.body?.password ? ok(session(String(c.body.email), c.body.profileName), 201) : problem(400, 'Vérifiez les champs du formulaire.')))
  on('POST', '/api/auth/refresh', c => {
    const user = c.user ? { id: c.user.sub, email: c.user.email, role: c.user.role } : { id: PERSONA_ID, email: S.persona.email, role: 'Subscriber' }
    return ok({ accessToken: fakeJwt(user), refreshToken: 'demo-refresh', user })
  })
  on('POST', '/api/auth/logout', () => noContent())

  // Profils
  on('GET', '/api/profiles', () => ok(S.profiles))
  on('POST', '/api/profiles', c => {
    const name = String(c.body?.name ?? '').trim()
    if (!name || name.length > 50) return problem(400, 'Le nom du profil est obligatoire (50 caractères au plus).')
    if (S.profiles.length >= 5) return problem(409, 'Un compte peut avoir au plus 5 profils.')
    const p = { id: uuid(), name }; S.profiles.push(p); commit(); return ok(p, 201)
  })
  on('PUT', '/api/profiles/{id}', (c, m) => {
    const p = S.profiles.find(x => x.id === m[1]); if (!p) return problem(404, 'Profil introuvable.')
    const name = String(c.body?.name ?? '').trim(); if (!name || name.length > 50) return problem(400, 'Le nom du profil est obligatoire (50 caractères au plus).')
    p.name = name; commit(); return ok(p)
  })
  on('DELETE', '/api/profiles/{id}', (_c, m) => {
    if (S.profiles.length <= 1) return problem(409, 'Un compte doit garder au moins un profil.')
    S.profiles = S.profiles.filter(p => p.id !== m[1]); commit(); return noContent()
  })

  // Accueil, catalogue, fiches, lecture
  on('GET', '/api/home', c => (ownProfile(c.q.get('profileId')) ? ok(home(c.q.get('profileId')!)) : problem(404, 'Profil introuvable.')))
  on('GET', '/api/titles', c => ok(list(c.q)))
  on('GET', '/api/titles/genres', c => {
    const kind = c.q.get('kind'); const by = new Map<string, number>()
    for (const t of S.titles) if (t.genre && (!kind || t.kind === kind)) by.set(t.genre, (by.get(t.genre) ?? 0) + 1)
    return ok([...by.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre)))
  })
  on('GET', '/api/titles/{id}', (_c, m) => { const t = titleById(m[1]!); return t ? ok(dto(t)) : problem(404, 'Titre introuvable.') })
  on('GET', '/api/titles/{id}/detail', (c, m) => { const d = ownProfile(c.q.get('profileId')) ? detail(c.q.get('profileId')!, m[1]!) : null; return d ? ok(d) : problem(404, 'Titre introuvable.') })
  on('GET', '/api/titles/{id}/playback', (c, m) => {
    const t = titleById(m[1]!); if (!t) return problem(404, 'Titre introuvable.')
    const pb = playbackOf(t); if (!t.isPlayable || !pb) return problem(409, "Ce titre n'est pas encore disponible.")
    const pid = c.q.get('profileId'); const p = pid && ownProfile(pid) ? prog(pid, t.id) : null
    const f = p && p.dur > 0 ? p.pos / p.dur : 0
    return ok({ titleId: t.id, url: pb.url, kind: pb.kind, startSeconds: f > 0.01 && f < 0.95 ? p!.pos : 0, expiresAt: nowIso(6 * 3600_000) })
  })

  // Liste, progression, notes
  const watchlist = (pid: string) => (S.watchlist[pid] ??= [])
  on('GET', '/api/profiles/{id}/watchlist', (_c, m) => (ownProfile(m[1]) ? ok(watchlist(m[1]!).filter(id => titleById(id)).map(id => cardOf(m[1]!, id))) : problem(404, 'Profil introuvable.')))
  on('PUT', '/api/profiles/{id}/watchlist/{titleId}', (_c, m) => { if (!ownProfile(m[1]) || !titleById(m[2]!)) return problem(404, 'Introuvable.'); const w = watchlist(m[1]!); if (!w.includes(m[2]!)) w.push(m[2]!); commit(); return noContent() })
  on('DELETE', '/api/profiles/{id}/watchlist/{titleId}', (_c, m) => { if (!ownProfile(m[1])) return problem(404, 'Introuvable.'); S.watchlist[m[1]!] = watchlist(m[1]!).filter(x => x !== m[2]); commit(); return noContent() })
  on('PUT', '/api/profiles/{id}/progress/{titleId}', (c, m) => {
    if (!ownProfile(m[1]) || !titleById(m[2]!)) return problem(404, 'Introuvable.')
    const pos = Math.max(0, Math.floor(+c.body?.positionSeconds || 0)), dur = Math.max(0, Math.floor(+c.body?.durationSeconds || 0))
    const bag = (S.progress[m[1]!] ??= {})
    if (!bag[m[2]!]) S.plays += 1
    bag[m[2]!] = { pos, dur, at: nowIso() }; commit(); return noContent()
  })
  on('DELETE', '/api/profiles/{id}/progress/{titleId}', (_c, m) => { if (S.progress[m[1]!]) delete S.progress[m[1]!]![m[2]!]; commit(); return noContent() })
  on('PUT', '/api/profiles/{id}/ratings/{titleId}', (c, m) => {
    if (!ownProfile(m[1]) || !titleById(m[2]!)) return problem(404, 'Introuvable.')
    const v = Math.max(-1, Math.min(1, Math.trunc(+c.body?.value || 0))); const bag = (S.ratings[m[1]!] ??= {})
    if (v === 0) delete bag[m[2]!]; else bag[m[2]!] = v
    commit(); return noContent()
  })

  // Assistant
  on('POST', '/api/assistant/chat', c => {
    const msg = String(c.body?.message ?? '').trim(); const pid = String(c.body?.profileId ?? '')
    if (!msg || msg.length > 500) return problem(400, 'Le message doit contenir entre 1 et 500 caractères.')
    if (!ownProfile(pid)) return problem(404, 'Profil introuvable.')
    const recorded = Object.entries<J>(snap.assistant).find(([q, r]) => normalize(q) === normalize(msg) && r.reply !== 'nothing')?.[1]
    if (recorded) return ok({ ...clone(recorded), cards: refreshAll(pid, recorded.cards) })
    const finished = new Set(Object.entries(S.progress[pid] ?? {}).filter(([, p]) => p.dur > 0 && p.pos / p.dur >= 0.8).map(([id]) => id))
    return ok(chat(msg, {
      titles: portalTitles(), card: (id, reason) => cardOf(pid, id, { reason }), similar: id => detail(pid, id)?.similar ?? [], excluded: finished,
      signals: Object.keys(S.progress[pid] ?? {}).length + Object.keys(S.ratings[pid] ?? {}).length + watchlist(pid).length, seed: Math.floor(Date.now() / DAY),
    }))
  })

  // Notifications
  on('GET', '/api/notifications', () => ok({ items: S.notifications.slice(0, 30), unread: S.notifications.filter(n => !n.read).length }))
  on('POST', '/api/notifications/read', c => {
    const ids: string[] | null = c.body?.ids ?? null
    for (const n of S.notifications) if (!ids || ids.includes(n.id)) n.read = true
    commit(); return noContent()
  })

  // Demandes (abonné)
  on('GET', '/api/requests/mine', () => ok(S.requests.filter(r => r.userId === PERSONA_ID).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(r => requestCard(r, true))))
  on('POST', '/api/requests', c => {
    const name = String(c.body?.name ?? '').trim()
    if (!name || name.length > 200) return problem(400, 'Le titre est obligatoire (200 caractères au plus).')
    const key = normalize(name)
    if (S.titles.some(t => t.isPlayable && normalize(t.name) === key)) return problem(409, 'Ce titre est déjà au catalogue.')
    if (S.requests.some(r => normalize(r.name) === key && r.status !== 'Declined')) return problem(409, 'Ce titre a déjà été demandé.')
    const year = c.body?.year ? Math.trunc(+c.body.year) : null
    if (year !== null && (year < 1888 || year > 2200)) return problem(400, "L'année doit être comprise entre 1888 et 2200.")
    const t = nowIso()
    const r = { id: uuid(), name, kind: c.body?.kind ?? 'Movie', year, note: c.body?.note ? String(c.body.note).slice(0, 500) : null, status: 'Pending', titleId: c.body?.titleId ?? null, requestedBy: S.persona.email, userId: PERSONA_ID, createdAt: t, updatedAt: t }
    S.requests.unshift(r); commit(); emit('requestCreated', { id: r.id, name: r.name })
    return ok(requestCard(r, true), 201)
  })
  on('DELETE', '/api/requests/{id}', (_c, m) => {
    const r = S.requests.find(x => x.id === m[1] && x.userId === PERSONA_ID); if (!r) return problem(404, 'Demande introuvable.')
    if (r.status !== 'Pending') return problem(409, 'Seule une demande en attente peut être annulée.')
    S.requests = S.requests.filter(x => x.id !== r.id); commit(); return noContent()
  })

  // Billets d'aide (abonné et personnel)
  on('GET', '/api/support/tickets', () => ok(S.tickets.filter(t => t.userId === PERSONA_ID).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(ticketSummary)))
  on('POST', '/api/support/tickets', c => {
    const subject = String(c.body?.subject ?? '').trim(), message = String(c.body?.message ?? '').trim()
    if (!subject || subject.length > 120 || !message || message.length > 4000) return problem(400, 'Le sujet (120 caractères) et le message (4000 caractères) sont obligatoires.')
    const t = nowIso()
    const ticket = { id: uuid(), subject, category: c.body?.category ?? 'Other', status: 'Open', requester: S.persona.email, userId: PERSONA_ID, createdAt: t, updatedAt: t, messages: [{ id: uuid(), fromStaff: false, body: message, at: t }] }
    S.tickets.unshift(ticket); commit(); emit('ticketCreated', { id: ticket.id, subject })
    return ok({ ticket: ticketSummary(ticket), messages: ticket.messages.map(msgDto) }, 201)
  })
  on('GET', '/api/support/tickets/{id}', (c, m) => {
    const t = S.tickets.find(x => x.id === m[1] && (x.userId === c.user?.sub || isStaff(c) || x.userId === PERSONA_ID && c.user?.role === 'Subscriber'))
    return t ? ok({ ticket: ticketSummary(t), messages: t.messages.map(msgDto) }) : problem(404, 'Billet introuvable.')
  })
  on('POST', '/api/support/tickets/{id}/messages', (c, m) => {
    const body = String(c.body?.body ?? '').trim(); if (!body || body.length > 4000) return problem(400, 'Le message est obligatoire (4000 caractères au plus).')
    const staff = isStaff(c)
    const t = S.tickets.find(x => x.id === m[1] && (staff || x.userId === PERSONA_ID)); if (!t) return problem(404, 'Billet introuvable.')
    const fromStaff = staff && t.userId !== c.user?.sub
    const msg = { id: uuid(), fromStaff, body, at: nowIso() }
    t.messages.push(msg); t.updatedAt = msg.at
    if (fromStaff && t.status === 'Open') t.status = 'InProgress'
    if (!fromStaff && t.status === 'Resolved') t.status = 'Open'
    commit()
    if (fromStaff) notify(t.userId, 'ticket.reply', t.subject, null, `/?aide=${t.id}`)
    else emit('ticketReplied', { id: t.id, subject: t.subject })
    return ok(msgDto(msg))
  })

  // Statut des services
  on('GET', '/api/status', () => ok({ version: '1.0.0', state: 'up', services: [{ id: 'api', state: 'up', latencyMs: null }, { id: 'database', state: 'up', latencyMs: 9 }, { id: 'sensors', state: 'up', latencyMs: null }], at: nowIso() }))

  // ------------------------------------------------------------ Console d'exploitation
  on('GET', '/api/admin/stats', c => needStaff(c) ?? ok(stats()))
  on('GET', '/api/admin/titles', c => {
    const f = needStaff(c); if (f) return f
    const page = Math.max(1, +(c.q.get('page') ?? 1) || 1), size = Math.min(100, Math.max(1, +(c.q.get('pageSize') ?? 20) || 20))
    const words = normalize(c.q.get('q')).split(' ').filter(Boolean)
    const items = S.titles.filter(t => {
      const hay = normalize([t.name, t.author, t.narrator, t.genre, t.director, ...(t.keywords ?? []), ...(t.cast ?? [])].filter(Boolean).join(' '))
      return words.every(w => hay.includes(w)) && (!c.q.get('kind') || t.kind === c.q.get('kind'))
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return ok({ items: items.slice((page - 1) * size, page * size).map(adminDto), total: items.length, page, pageSize: size })
  })
  on('GET', '/api/admin/titles/{id}', (c, m) => needStaff(c) ?? (titleById(m[1]!) ? ok(adminDto(titleById(m[1]!)!)) : problem(404, 'Titre introuvable.')))
  const applyUpsert = (t: J, u: J) => {
    Object.assign(t, {
      name: String(u.name).trim(), synopsis: u.synopsis ?? '', year: u.year, kind: u.kind, genre: String(u.genre).trim(), durationMinutes: u.durationMinutes,
      posterUrl: u.posterUrl ?? null, backdropUrl: u.backdropUrl ?? null, streamUrl: u.streamUrl ?? null, author: u.author ?? null, narrator: u.narrator ?? null,
      keywords: u.keywords ?? [], cast: u.cast ?? [], director: u.director ?? null, rating: u.rating ?? null, maturity: u.maturity ?? null, credits: u.credits ?? null,
    })
    t.isPlayable = !!t.streamUrl
    t.streamKind = !t.streamUrl ? null : t.streamUrl.startsWith('media:') ? (/\.(m4a|mp3|ogg)$/.test(t.streamUrl) ? 'Audio' : 'Hls') : /\.m3u8(\?|$)/.test(t.streamUrl) ? 'Hls' : /\.(mp4|webm)(\?|$)/.test(t.streamUrl) ? 'Video' : /\.(mp3|m4a|ogg)(\?|$)/.test(t.streamUrl) ? 'Audio' : 'External'
  }
  const validUpsert = (u: J) => (!u?.name || !String(u.name).trim() ? 'Le nom est obligatoire.' : !u.genre ? 'Le genre est obligatoire.' : !(u.year >= 1888 && u.year <= 2200) ? "L'année doit être comprise entre 1888 et 2200." : null)
  on('POST', '/api/admin/titles', c => {
    const f = needAdmin(c); if (f) return f
    const bad = validUpsert(c.body); if (bad) return problem(400, bad)
    const t: J = { id: uuid(), externalSource: null, addedAt: nowIso() }; applyUpsert(t, c.body); S.titles.push(t); commit()
    if (t.isPlayable) emit('titleAdded', dto(t))
    return ok(adminDto(t), 201)
  })
  on('PUT', '/api/admin/titles/{id}', (c, m) => {
    const f = needAdmin(c); if (f) return f
    const t = titleById(m[1]!); if (!t) return problem(404, 'Titre introuvable.')
    const bad = validUpsert(c.body); if (bad) return problem(400, bad)
    const was = t.isPlayable; applyUpsert(t, c.body); commit()
    if (!was && t.isPlayable) emit('titleAdded', dto(t))
    return ok(adminDto(t))
  })
  on('DELETE', '/api/admin/titles/{id}', (c, m) => {
    const f = needAdmin(c); if (f) return f
    if (!titleById(m[1]!)) return problem(404, 'Titre introuvable.')
    S.titles = S.titles.filter(t => t.id !== m[1]); for (const k of Object.keys(S.watchlist)) S.watchlist[k] = S.watchlist[k]!.filter(x => x !== m[1])
    commit(); return noContent()
  })

  on('GET', '/api/admin/users', c => {
    const f = needStaff(c); if (f) return f
    const page = Math.max(1, +(c.q.get('page') ?? 1) || 1), size = Math.min(100, Math.max(1, +(c.q.get('pageSize') ?? 20) || 20)); const needle = (c.q.get('q') ?? '').trim().toLowerCase()
    const items = S.users.filter(u => !needle || u.email.includes(needle)).sort((a, b) => a.email.localeCompare(b.email))
    return ok({ items: items.slice((page - 1) * size, page * size), total: items.length, page, pageSize: size })
  })
  on('PUT', '/api/admin/users/{id}', (c, m) => {
    const f = needAdmin(c); if (f) return f
    const u = S.users.find(x => x.id === m[1]); if (!u) return problem(404, 'Compte introuvable.')
    const role = c.body?.role as string | undefined, active = c.body?.isActive as boolean | undefined
    if (u.id === c.user?.sub && (active === false || (role && role !== 'Admin'))) return problem(409, 'Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.')
    if (u.role === 'Admin' && (active === false || (role && role !== 'Admin')) && !S.users.some(x => x.role === 'Admin' && x.isActive && x.id !== u.id)) return problem(409, 'Il doit rester au moins un administrateur actif.')
    if (role) u.role = role
    if (active !== undefined) u.isActive = active
    commit(); return ok(u)
  })

  const order = (r: J) => (r.status === 'Pending' ? 0 : r.status === 'Available' || r.status === 'Declined' ? 2 : 1)
  on('GET', '/api/admin/requests', c => {
    const f = needStaff(c); if (f) return f
    const st = c.q.get('status')
    return ok(S.requests.filter(r => !st || r.status === st).sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt)).map(adminRequest))
  })
  on('PUT', '/api/admin/requests/{id}', (c, m) => {
    const f = needAdmin(c); if (f) return f
    const r = S.requests.find(x => x.id === m[1]); if (!r) return problem(404, 'Demande introuvable.')
    const next = c.body?.status as string
    if (!(TRANSITIONS[r.status] ?? []).includes(next)) return problem(409, `Transition impossible : ${r.status} vers ${next}.`)
    if (next === 'Available') {
      const id = c.body?.titleId ?? r.titleId; const t = id ? titleById(id) : null
      if (!t) return problem(409, 'Indiquez le titre du catalogue qui satisfait la demande.')
      if (!t.isPlayable) return problem(409, "Le titre lié n'a pas de source de lecture : ajoutez-la d'abord au catalogue.")
      r.titleId = t.id
    }
    r.status = next; r.updatedAt = nowIso()
    commit()
    notify(r.userId, `request.${next.toLowerCase()}`, r.name, next === 'Declined' ? (c.body?.reason ?? null) : null, next === 'Available' && r.titleId ? `/titres/${r.titleId}` : null)
    commit()
    return ok(adminRequest(r))
  })

  on('GET', '/api/admin/tickets', c => {
    const f = needStaff(c); if (f) return f
    const st = c.q.get('status')
    const rank = (t: J) => (t.status === 'Resolved' ? 1 : 0)
    return ok(S.tickets.filter(t => !st || t.status === st).sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt)).map(t => ({ ticket: ticketSummary(t), requester: t.requester, messages: t.messages.length })))
  })
  on('PUT', '/api/admin/tickets/{id}/status', (c, m) => {
    const f = needStaff(c); if (f) return f
    const t = S.tickets.find(x => x.id === m[1]); if (!t) return problem(404, 'Billet introuvable.')
    const was = t.status; t.status = c.body?.status ?? t.status; t.updatedAt = nowIso(); commit()
    if (t.status === 'Resolved' && was !== 'Resolved') { notify(t.userId, 'ticket.resolved', t.subject, null, `/?aide=${t.id}`); commit() }
    return ok(ticketSummary(t))
  })

  return {
    handle(req) {
      sync()
      const user = readJwt(req.authorization)
      const ctx: Ctx = { method: req.method.toUpperCase(), path: req.path, q: req.query, body: req.body, user }
      const open = ctx.path.startsWith('/api/auth/') || ctx.path === '/api/status'
      if (!user && !open) return problem(401, 'Authentification requise.')
      for (const [method, re, fn] of routes) {
        const m = re.exec(ctx.path)
        if (m && method === ctx.method) { try { return fn(ctx, m) } catch (e) { console.error('[demo]', ctx.method, ctx.path, e); return problem(500, 'Erreur inattendue dans la démonstration.') } }
      }
      return problem(404, 'Route inconnue dans la démonstration.')
    },
  }
}
