// Capture un instantané de la VRAIE API (portail et back-office) pour le mode démonstration.
//   API en marche sur http://localhost:5080 (compte root du développement), puis :  npm run capture -w @divertiflix/demo
// Le fichier produit (data/snapshot.json) ne contient que des données du catalogue de démonstration : aucun secret, aucun compte réel.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = process.env.API ?? 'http://localhost:5080'
const here = dirname(fileURLToPath(import.meta.url))
const call = async (path, opts = {}, token) => {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const text = await r.text()
  if (!r.ok) throw new Error(`${opts.method ?? 'GET'} ${path} -> ${r.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

// Un profil de démonstration avec un goût formé (historique, liste, pouces) : l'accueil montre alors de vraies raisons.
const stamp = Date.now()
const reg = await call('/api/auth/register', { method: 'POST', body: { email: `demo${stamp}@divertiflix.test`, password: 'Passw0rd!demo', profileName: 'Camille' } })
const tok = reg.accessToken
const profileId = (await call('/api/profiles', {}, tok))[0].id
const all = (await call('/api/titles?pageSize=100&sort=name', {}, tok)).items
const byName = n => all.find(t => t.name === n)
const progress = async (name, pos, dur) => { const t = byName(name); if (t) await call(`/api/profiles/${profileId}/progress/${t.id}`, { method: 'PUT', body: { positionSeconds: pos, durationSeconds: dur } }, tok) }
await progress('Marée basse', 118, 120)         // terminé : définit le goût (contemplatif, Drame)
await progress('Atlas de poche', 112, 120)
await progress('Jardin d\'hiver', 108, 120)
await progress('Boléro des machines', 55, 120)  // en cours : « Continuer à regarder »
await progress('Orbite silencieuse', 40, 120)
await progress('Ligne 9', 6, 120)               // abandonné : signal négatif
for (const n of ['Marée basse', 'Atlas de poche']) await call(`/api/profiles/${profileId}/ratings/${byName(n).id}`, { method: 'PUT', body: { value: 1 } }, tok)
for (const n of ['Foret-Mémoire', 'Forêt-Mémoire', 'Cartes postales de l\'apocalypse']) { const t = byName(n); if (t) await call(`/api/profiles/${profileId}/watchlist/${t.id}`, { method: 'PUT' }, tok) }

const out = { capturedAt: new Date().toISOString(), profileId, titles: all }
out.genres = { all: await call('/api/titles/genres', {}, tok), Movie: await call('/api/titles/genres?kind=Movie', {}, tok), Audiobook: await call('/api/titles/genres?kind=Audiobook', {}, tok) }
out.home = await call(`/api/home?profileId=${profileId}`, {}, tok)
out.details = {}
out.playback = {}
for (const t of all) {
  out.details[t.id] = await call(`/api/titles/${t.id}/detail?profileId=${profileId}`, {}, tok)
  if (t.isPlayable) {
    const pb = await call(`/api/titles/${t.id}/playback`, {}, tok)
    out.playback[t.id] = { kind: pb.kind, source: pb.url.replace(/^\/api\/media\/stream\/[^/]+\//, '') }   // chemin relatif au dossier de médias, sans jeton
  }
}
out.watchlist = await call(`/api/profiles/${profileId}/watchlist`, {}, tok)
out.status = await call('/api/status', {}, tok)
out.assistant = {}
for (const q of ['Quelque chose de court ce soir', 'Un film contemplatif et lumineux', 'Une comédie sans gore', 'Un thriller tendu de moins de 90 minutes', 'Un livre audio classique', 'Surprends-moi']) {
  try { out.assistant[q] = await call('/api/assistant/chat', { method: 'POST', body: { profileId, message: q, locale: 'fr' } }, tok) } catch (e) { console.warn('assistant', q, e.message) }
}

// Back-office : on prépare des demandes et des billets variés puis on photographie l'état.
const admin = await call('/api/auth/login', { method: 'POST', body: { email: 'root', password: 'boom123$' } })
const at = admin.accessToken
const mk = async (email, name) => (await call('/api/auth/register', { method: 'POST', body: { email, password: 'Passw0rd!demo', profileName: name } }))
const people = [['alice.tremblay@exemple.ca', 'Alice'], ['marc.bouchard@exemple.ca', 'Marc'], ['lea.gagnon@exemple.ca', 'Léa'], ['nadia.roy@exemple.ca', 'Nadia']]
const accounts = []
for (const [e, n] of people) { try { accounts.push(await mk(`${stamp}.${e}`, n)) } catch (e2) { console.warn('compte', e2.message) } }
const dmd = [['Nosferatu', 1922, 'Version restaurée si possible'], ['Metropolis', 1927, null], ['Le Voyage dans la Lune', 1902, 'Un classique du court métrage'], ['Solaris', 1972, null]]
const reqs = []
for (let i = 0; i < dmd.length && i < accounts.length; i++) {
  const [name, year, note] = dmd[i]
  reqs.push(await call('/api/requests', { method: 'POST', body: { name: `${name}`, kind: 'Movie', year, note } }, accounts[i].accessToken).catch(e => (console.warn('demande', name, e.message), null)))
}
const tickets = []
const tk = [
  ['Lecture saccadée sur Ligne 9', 'Playback', 'Ça saccade depuis ce matin sur mon téléviseur.', 'Merci du signalement, nous regardons.'],
  ['Je ne retrouve pas mon mot de passe', 'Account', 'Le lien de réinitialisation ne m\'arrive pas.', null],
  ['Sous-titres décalés', 'Playback', 'Les sous-titres arrivent trop tard sur Marée basse.', null],
]
for (let i = 0; i < tk.length && i < accounts.length; i++) {
  const [subject, category, message, reply] = tk[i]
  const t = await call('/api/support/tickets', { method: 'POST', body: { subject, category, message } }, accounts[i].accessToken)
  if (reply) await call(`/api/support/tickets/${t.ticket.id}/messages`, { method: 'POST', body: { body: reply } }, at)
  tickets.push(t.ticket.id)
}
out.admin = {
  stats: await call('/api/admin/stats', {}, at),
  titles: (await call('/api/admin/titles?pageSize=100', {}, at)).items,
  users: (await call('/api/admin/users?pageSize=100', {}, at)).items.filter(u => u.email === 'root' || u.email.includes('exemple.ca') || u.email.includes('divertiflix.test')).slice(0, 12),
  requests: (await call('/api/admin/requests', {}, at)).filter(r => ['Nosferatu', 'Metropolis', 'Le Voyage dans la Lune', 'Solaris'].includes(r.name)).slice(0, 6),
  tickets: [],
  ticketDetails: {},
}
const adminTickets = await call('/api/admin/tickets', {}, at)
out.admin.tickets = adminTickets.filter(t => tickets.includes(t.ticket.id))
for (const t of out.admin.tickets) out.admin.ticketDetails[t.ticket.id] = await call(`/api/support/tickets/${t.ticket.id}`, {}, at)

mkdirSync(join(here, '..', 'data'), { recursive: true })
writeFileSync(join(here, '..', 'data', 'snapshot.json'), JSON.stringify(out))
console.log(`Instantané : ${all.length} titres, ${Object.keys(out.details).length} fiches, ${out.admin.requests.length} demandes, ${out.admin.tickets.length} billets, ${Object.keys(out.assistant).length} réponses d'assistant.`)
