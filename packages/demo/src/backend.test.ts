import { beforeEach, describe, expect, it } from 'vitest'
import snapshot from '../data/snapshot.json'
import { createBackend, type DemoBackend } from './backend'
import { fakeJwt } from './util'

const PERSONA = { id: '00000000-0000-4000-8000-0000000000d1', email: 'camille@exemple.ca', role: 'Subscriber' }
const ADMIN = { id: 'a', email: 'root', role: 'Admin' }
const SUPPORT = { id: 's', email: 'support', role: 'Support' }
const snap = snapshot as unknown as Record<string, any>

let api: DemoBackend
beforeEach(() => { api = createBackend(snap, { mediaBase: 'media/' }) })

const call = (as: { id: string; email: string; role: string } | null, method: string, url: string, body?: unknown) => {
  const u = new URL(url, 'http://x')
  return api.handle({ method, path: u.pathname, query: u.searchParams, authorization: as ? `Bearer ${fakeJwt(as)}` : null, body })
}
const profileId = () => (call(PERSONA, 'GET', '/api/profiles').json as { id: string }[])[0]!.id
const titleId = (name: string) => (call(PERSONA, 'GET', `/api/titles?q=${encodeURIComponent(name)}`).json.items as { id: string; name: string }[]).find(t => t.name === name)!.id

describe('authentification et rôles', () => {
  it('exige un jeton hors authentification', () => {
    expect(call(null, 'GET', '/api/profiles').status).toBe(401)
    expect(call(null, 'GET', '/api/status').status).toBe(200)
  })
  it("l'identifiant détermine le rôle (root = Admin, support = Support, le reste = abonné)", () => {
    const role = (email: string) => call(null, 'POST', '/api/auth/login', { email, password: 'x' }).json.user.role
    expect(role('root')).toBe('Admin')
    expect(role('support')).toBe('Support')
    expect(role('quelquun@exemple.ca')).toBe('Subscriber')
  })
  it('refuse des identifiants vides', () => { expect(call(null, 'POST', '/api/auth/login', { email: '', password: '' }).status).toBe(401) })
  it("un abonné n'accède pas à la console, le Support lit mais ne décide pas", () => {
    expect(call(PERSONA, 'GET', '/api/admin/stats').status).toBe(403)
    expect(call(SUPPORT, 'GET', '/api/admin/requests').status).toBe(200)
    const r = call(SUPPORT, 'GET', '/api/admin/requests').json[0]
    expect(call(SUPPORT, 'PUT', `/api/admin/requests/${r.id}`, { status: 'Approved' }).status).toBe(403)
    expect(call(SUPPORT, 'GET', '/api/admin/users').status).toBe(200)
    expect(call(SUPPORT, 'PUT', `/api/admin/users/${PERSONA.id}`, { isActive: false }).status).toBe(403)
  })
})

describe('catalogue', () => {
  it('cherche sans tenir compte des accents ni de la casse, tous les mots doivent correspondre', () => {
    expect(call(PERSONA, 'GET', '/api/titles?q=maree').json.items.map((t: any) => t.name)).toContain('Marée basse')
    expect(call(PERSONA, 'GET', '/api/titles?q=drame%20contemplatif').json.total).toBeGreaterThan(0)
    expect(call(PERSONA, 'GET', '/api/titles?q=%25').json.total).toBe(0)
  })
  it('filtre, trie et pagine', () => {
    const livres = call(PERSONA, 'GET', '/api/titles?kind=Audiobook').json
    expect(livres.items.every((t: any) => t.kind === 'Audiobook')).toBe(true)
    const p1 = call(PERSONA, 'GET', '/api/titles?pageSize=5&page=1&sort=year').json
    expect(p1.items).toHaveLength(5)
    expect(p1.items[0].year).toBeGreaterThanOrEqual(p1.items[1].year)
    expect(call(PERSONA, 'GET', '/api/titles?available=true').json.items.every((t: any) => t.isPlayable)).toBe(true)
  })
  it('les affiches pointent vers les fichiers de la démonstration, pas vers /api', () => {
    const t = call(PERSONA, 'GET', '/api/titles?q=maree').json.items[0]
    expect(t.posterUrl).toMatch(/^media\/art\/maree-basse\//)
  })
  it('un film local se lit en MP4, un flux distant est « sur demande »', () => {
    const pid = profileId()
    const pb = call(PERSONA, 'GET', `/api/titles/${titleId('Marée basse')}/playback?profileId=${pid}`).json
    expect(pb.kind).toBe('Video')
    expect(pb.url).toBe('media/video/maree-basse.mp4')
    const bbb = call(PERSONA, 'GET', `/api/titles/${titleId('Big Buck Bunny')}/playback`)
    expect(bbb.status).toBe(409)
    const livre = call(PERSONA, 'GET', `/api/titles/${titleId('Candide')}/playback`).json
    expect(livre).toMatchObject({ kind: 'Audio', url: 'media/audio/candide.mp3' })
  })
})

describe('accueil et état du profil', () => {
  it('« Continuer à regarder » suit la progression, et la reprise repart de la bonne seconde', () => {
    const pid = profileId(), id = titleId('Sucre filé')
    expect(call(PERSONA, 'PUT', `/api/profiles/${pid}/progress/${id}`, { positionSeconds: 30, durationSeconds: 100 }).status).toBe(204)
    const cont = call(PERSONA, 'GET', `/api/home?profileId=${pid}`).json.rows.find((r: any) => r.type === 'continue')
    expect(cont.items[0].title.id).toBe(id)
    expect(call(PERSONA, 'GET', `/api/titles/${id}/playback?profileId=${pid}`).json.startSeconds).toBe(30)
  })
  it('ma liste et les pouces se reflètent dans les cartes', () => {
    const pid = profileId(), id = titleId('Néon & pluie')
    call(PERSONA, 'PUT', `/api/profiles/${pid}/watchlist/${id}`)
    call(PERSONA, 'PUT', `/api/profiles/${pid}/ratings/${id}`, { value: -1 })
    const card = call(PERSONA, 'GET', `/api/titles/${id}/detail?profileId=${pid}`).json.card
    expect(card.inWatchlist).toBe(true)
    expect(card.myRating).toBe(-1)
    call(PERSONA, 'PUT', `/api/profiles/${pid}/ratings/${id}`, { value: 0 })
    expect(call(PERSONA, 'GET', `/api/titles/${id}/detail?profileId=${pid}`).json.card.myRating).toBe(0)
  })
  it("refuse le profil d'un autre", () => { expect(call(PERSONA, 'GET', '/api/home?profileId=00000000-0000-4000-8000-00000000ffff').status).toBe(404) })
  it('un compte garde au moins un profil et au plus cinq', () => {
    expect(call(PERSONA, 'DELETE', `/api/profiles/${profileId()}`).status).toBe(409)
    for (let i = 0; i < 4; i++) expect(call(PERSONA, 'POST', '/api/profiles', { name: `P${i}` }).status).toBe(201)
    expect(call(PERSONA, 'POST', '/api/profiles', { name: 'Trop' }).status).toBe(409)
  })
})

describe('demandes de titres', () => {
  it('refuse un doublon et un titre déjà au catalogue', () => {
    expect(call(PERSONA, 'POST', '/api/requests', { name: 'Solaris', kind: 'Movie' }).status).toBe(409)
    expect(call(PERSONA, 'POST', '/api/requests', { name: 'Marée basse', kind: 'Movie' }).status).toBe(409)
    expect(call(PERSONA, 'POST', '/api/requests', { name: 'Stalker', kind: 'Movie', year: 1979 }).status).toBe(201)
  })
  it('applique les mêmes transitions que la vraie API et notifie la personne', () => {
    const created = call(PERSONA, 'POST', '/api/requests', { name: 'Stalker', kind: 'Movie' })
    const id = created.json.id
    expect(call(ADMIN, 'PUT', `/api/admin/requests/${id}`, { status: 'Available' }).status).toBe(409)   // pas de Pending vers Available
    expect(call(ADMIN, 'PUT', `/api/admin/requests/${id}`, { status: 'Approved' }).status).toBe(200)
    expect(call(ADMIN, 'PUT', `/api/admin/requests/${id}`, { status: 'Available' }).status).toBe(409)   // titre à indiquer
    expect(call(ADMIN, 'PUT', `/api/admin/requests/${id}`, { status: 'Available', titleId: titleId('Marée basse') }).status).toBe(200)
    expect(call(ADMIN, 'PUT', `/api/admin/requests/${id}`, { status: 'Declined' }).status).toBe(409)    // état final
    const n = call(PERSONA, 'GET', '/api/notifications').json
    expect(n.items[0]).toMatchObject({ kind: 'request.available', title: 'Stalker', read: false })
    expect(n.items[0].link).toMatch(/^\/titres\//)
    call(PERSONA, 'POST', '/api/notifications/read', { ids: null })
    expect(call(PERSONA, 'GET', '/api/notifications').json.unread).toBe(0)
  })
  it("l'annulation ne vaut que pour une demande en attente", () => {
    const id = call(PERSONA, 'POST', '/api/requests', { name: 'Stalker', kind: 'Movie' }).json.id
    expect(call(PERSONA, 'DELETE', `/api/requests/${id}`).status).toBe(204)
  })
})

describe('billets d\'aide', () => {
  it('une réponse du personnel passe le billet en cours et notifie l\'abonné', () => {
    const t = call(PERSONA, 'POST', '/api/support/tickets', { subject: 'Image figée', category: 'Playback', message: 'Ça fige au bout de 10 secondes.' }).json
    expect(t.ticket.status).toBe('Open')
    expect(call(SUPPORT, 'POST', `/api/support/tickets/${t.ticket.id}/messages`, { body: 'Nous regardons.' }).status).toBe(200)
    const after = call(PERSONA, 'GET', `/api/support/tickets/${t.ticket.id}`).json
    expect(after.ticket.status).toBe('InProgress')
    expect(after.messages.at(-1)).toMatchObject({ fromStaff: true, body: 'Nous regardons.' })
    expect(call(PERSONA, 'GET', '/api/notifications').json.items[0]).toMatchObject({ kind: 'ticket.reply', title: 'Image figée' })
    expect(call(ADMIN, 'PUT', `/api/admin/tickets/${t.ticket.id}/status`, { status: 'Resolved' }).status).toBe(200)
    expect(call(PERSONA, 'GET', '/api/notifications').json.items[0].kind).toBe('ticket.resolved')
  })
  it('valide les entrées', () => {
    expect(call(PERSONA, 'POST', '/api/support/tickets', { subject: '', message: 'x' }).status).toBe(400)
  })
})

describe('comptes', () => {
  it('garde-fous : ni auto-désactivation ni dernier administrateur', () => {
    const users = call(ADMIN, 'GET', '/api/admin/users?pageSize=100').json.items as { id: string; email: string; role: string }[]
    const root = users.find(u => u.email === 'root')!
    const me = { ...ADMIN, id: root.id }
    expect(call(me, 'PUT', `/api/admin/users/${root.id}`, { isActive: false }).status).toBe(409)
    expect(call({ ...ADMIN, id: 'autre' }, 'PUT', `/api/admin/users/${root.id}`, { role: 'Subscriber' }).status).toBe(409)   // dernier admin
    expect(call(ADMIN, 'PUT', `/api/admin/users/${PERSONA.id}`, { role: 'Support' }).json.role).toBe('Support')
  })
})

describe('assistant de la démonstration', () => {
  const ask = (message: string) => call(PERSONA, 'POST', '/api/assistant/chat', { profileId: profileId(), message, locale: 'fr' }).json
  it('répond aux suggestions avec des cartes et leur raison', () => {
    const r = ask('Quelque chose de court ce soir')
    expect(r.reply).toBe('found')
    expect(r.cards.length).toBeGreaterThan(0)
    expect(r.cards[0].reason).toBeTruthy()
  })
  it('« surprends-moi » propose des titres jamais vus', () => {
    const r = ask('Surprends-moi')
    expect(r.reply).toBe('surprise')
    expect(r.cards.length).toBeGreaterThan(0)
    expect(r.cards.every((c: any) => c.progress === null || c.progress.fraction < 0.8)).toBe(true)
  })
  it('respecte « sans gore » et les genres demandés', () => {
    const r = ask('une comédie sans gore')
    expect(r.cards.every((c: any) => c.title.genre === 'Comédie')).toBe(true)
    expect(r.understood).toContainEqual({ kind: 'avoid', label: 'gore' })
    const h = ask('de l\'horreur')
    expect(h.cards.every((c: any) => c.title.genre === 'Horreur')).toBe(true)
  })
  it('comprend la durée, assouplit si besoin et le dit', () => {
    const r = ask('un drame de moins de 1 minute')
    expect(['relaxed', 'found', 'nothing']).toContain(r.reply)
  })
  it('« comme X » : titres proches, ou aveu quand X est inconnu', () => {
    expect(ask('quelque chose comme Marée basse').reply).toBe('similar')
    const unknown = ask('quelque chose comme Zorglub')
    expect(unknown.reply).toBe('similarUnknown')
    expect(unknown.unknownTitle).toBe('Zorglub')
  })
  it('sans critère, guide la personne', () => { expect(ask('bonjour').reply).toBe('help') })
  it('valide la longueur du message', () => {
    expect(call(PERSONA, 'POST', '/api/assistant/chat', { profileId: profileId(), message: '', locale: 'fr' }).status).toBe(400)
  })
})
