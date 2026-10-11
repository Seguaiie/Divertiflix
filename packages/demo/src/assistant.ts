import { type J, normalize, rng } from './util'

/**
 * Assistant de la démonstration : une version allégée de l'analyseur de requêtes de l'API (qui tourne en C# côté serveur).
 * Mêmes réponses structurées (clés de réponse, critères compris, étapes consultées, cartes avec raison), calculées ici sur le
 * catalogue de démonstration. Il comprend : genre, ambiance, type, durée, époque, négations (« sans gore », « pas trop long »,
 * « pas de série »), « comme X » et « surprends-moi ».
 */

const GENRES: Record<string, string> = {
  comedie: 'Comédie', drole: 'Comédie', humour: 'Comédie', rire: 'Comédie',
  drame: 'Drame', dramatique: 'Drame',
  thriller: 'Thriller', suspense: 'Thriller', polar: 'Thriller',
  horreur: 'Horreur', effrayant: 'Horreur', epouvante: 'Horreur', 'film d horreur': 'Horreur',
  'science fiction': 'Science-fiction', 'science-fiction': 'Science-fiction', sf: 'Science-fiction', scifi: 'Science-fiction', 'sci fi': 'Science-fiction',
  animation: 'Animation', 'dessin anime': 'Animation', anime: 'Animation',
  fantastique: 'Fantastique', fantasy: 'Fantastique',
  gothique: 'Gothique', aventure: 'Aventure', documentaire: 'Documentaire', poesie: 'Poésie', satire: 'Satire',
}
/** Mot de la demande vers mot-clé du catalogue (formes proches). */
const TAGS: Record<string, string> = {
  sombre: 'sombre', noir: 'sombre', glauque: 'sombre', tendu: 'tension', tension: 'tension', angoissant: 'tension',
  contemplatif: 'contemplatif', calme: 'contemplatif', apaisant: 'contemplatif', lent: 'contemplatif', zen: 'contemplatif',
  lumineux: 'lumière', lumiere: 'lumière', solaire: 'lumière', doux: 'tendresse', tendre: 'tendresse', reconfortant: 'réconfortant', rassurant: 'réconfortant',
  nostalgique: 'nostalgique', nostalgie: 'nostalgique', onirique: 'onirique', reve: 'rêve', etrange: 'mystère', mysterieux: 'mystère', mystere: 'mystère', enquete: 'enquête',
  rythme: 'rythmé', rythmé: 'rythmé', dynamique: 'rythmé', epique: 'épique', musique: 'musique', musical: 'musique', danse: 'danse',
  robot: 'robot', robots: 'robot', espace: 'espace', futur: 'futur', foret: 'forêt', mer: 'mer', ocean: 'mer', ville: 'ville', pluie: 'pluie', nuit: 'nuit', voyage: 'voyage',
  famille: 'famille', enfance: 'enfance', amitie: 'amitié', magie: 'magie', fantome: 'fantôme', fantomes: 'fantôme', creature: 'créature', guerre: 'guerre', desert: 'désert', montagne: 'montagne', solitude: 'solitude', nature: 'nature',
  absurde: 'absurde', vengeance: 'vengeance', evasion: 'évasion', apocalypse: 'apocalypse', gore: 'gore', silence: 'silence', memoire: 'mémoire',
}
const AVOID_GENRE: Record<string, string> = { gore: 'Horreur', sanglant: 'Horreur', sang: 'Horreur', violent: 'Horreur', violence: 'Horreur', horreur: 'Horreur', peur: 'Horreur', triste: 'Drame' }
const SURPRISE = ['surprends moi', 'surprend moi', 'surprise moi', 'surprenez moi', 'surprise me', 'au hasard', 'random', 'n importe quoi', 'peu importe', 'choisis pour moi', 'pick for me', 'choose for me', 'etonne moi']

export interface AssistantEnv {
  titles: J[]                                   // catalogue courant (TitleDto)
  card: (id: string, reason?: J | null) => J    // carte avec l'état du profil
  similar: (id: string) => J[]                  // titres proches (cartes)
  excluded: Set<string>                         // déjà vus
  signals: number                               // nombre de signaux du profil
  seed: number
}

// Seuils du catalogue de démonstration (l'API les calcule en centiles des durées jouables) et année de référence.
const SHORT_MAX = 2, LONG_MIN = 10, RECENT_FROM = 2023
const W_SHORT = 'court|courts|courte|short|rapide|quick|bref|brief|vite fait'
const W_LONG = 'long|longue|longs|longues|lengthy'
const W_RECENT = 'recent|recents|recente|recentes|nouveau|nouveaute|nouveautes|new|latest'
const W_CLASSIC = 'classique|classiques|classic|ancien|anciens|vieux|retro|old'
/** « tv show » désigne une série, « show » seul non ; les verbes (« écouter ») désignent un livre audio mais ne se nient pas. */
const KIND_WORDS: { words: string; kind: string; verbs?: string }[] = [
  { words: 'livre audio|livres audio|audiobook|audiobooks|audiolivre|livre|livres|roman|romans', kind: 'Audiobook', verbs: 'ecouter|a ecouter|listen|audio' },
  { words: 'serie|series|tv show|tv shows|episode|episodes|shows?(?! (?:me|us|them|him|her|you|something|anything|some|any|a|an|the|more|all) )', kind: 'Series' },
  { words: 'court metrage|court metrages|short film|short films', kind: 'Movie' },
  { words: 'film|films|movie|movies|cinema', kind: 'Movie' },
]
const ALL_KINDS = ['Movie', 'Series', 'Audiobook']

// Une négation (marqueur, puis mots de liaison) suivie d'une contrainte : « pas trop long », « no movies ». Lue avant les contraintes elles-mêmes.
const NEG_MARKERS = 'pas|sans|aucun|aucune|no|not|without|ni|evite|eviter|avoid|non|jamais'
const NEG_SKIP = 'trop|de|d|du|des|too|any|very|tres|beaucoup|un|une|le|la|les|of|a|an|the|peu'
const negTerm = (words: string, after = '') => new RegExp(` (?:${NEG_MARKERS}) (?:(?:${NEG_SKIP}) )*(?:${words})(?= )${after}`)
const NEG_LONG = negTerm(W_LONG), NEG_RECENT = negTerm(W_RECENT), NEG_CLASSIC = negTerm(W_CLASSIC)
const NEG_SHORT = negTerm(W_SHORT)   // « pas de court métrage » : pas de très court, donc un plancher de durée (le type film reste permis)
// « pas de série » nie le type seulement s'il termine la proposition : « pas de film d'horreur » nie un genre, pas le type.
const NEG_KINDS = KIND_WORDS.map(k => ({ kind: k.kind, rx: negTerm(k.words, '(?= (?:$|(?:et|ou|mais|ni|and|or|but|plutot|rather|instead|sinon|otherwise|un(?! peu)|une|an|s|svp|stp|please|plait|merci|thanks|ce|tonight|today) ))') }))

const stem = (w: string) => w.replace(/(s|x)$/, '')
const toMinutes = (n: string, unit?: string, extra?: string) => (unit && /^(h|heure|heures|hour|hours|hr|hrs)$/.test(unit) ? +n * 60 + (extra ? +extra : 0) : +n)

/** Lit les critères d'une demande : genres, ambiances, type, durée, époque, exclusions, et la fonction de score qui en découle. */
function readSpec(src: string) {
  const understood: J[] = []
  const genres = new Set<string>(), tags = new Set<string>(), avoidGenres = new Set<string>(), avoidTags = new Set<string>()
  let kinds = new Set<string>()
  let maxMin: number | null = null, minMin: number | null = null, yearFrom: number | null = null, yearTo: number | null = null
  let recent = false, classic = false, short = false, long = false
  // Les bornes se combinent : la plus stricte l'emporte, au lieu de s'écraser selon l'ordre de lecture.
  const atMost = (v: number) => { maxMin = maxMin === null ? v : Math.min(maxMin, v) }
  const atLeast = (v: number) => { minMin = minMin === null ? v : Math.max(minMin, v) }
  const from = (v: number) => { yearFrom = yearFrom === null ? v : Math.max(yearFrom, v) }
  const to = (v: number) => { yearTo = yearTo === null ? v : Math.min(yearTo, v) }
  let rest = src
  const consume = (rx: RegExp) => { if (!rx.test(rest)) return false; rest = rest.replace(rx, ''); return true }

  // Négations de type, de durée et d'époque, avant les lectures positives (sinon « pas trop long » serait lu comme « long »).
  // Durée et époque d'abord : « pas de court métrage » est un plancher de durée, il ne doit pas nier le type film.
  if (consume(NEG_SHORT)) { atLeast(SHORT_MAX + 1); understood.push({ kind: 'minMinutes', label: String(SHORT_MAX + 1) }) }
  if (consume(NEG_LONG)) { atMost(LONG_MIN - 1); understood.push({ kind: 'maxMinutes', label: String(LONG_MIN - 1) }) }
  if (consume(NEG_RECENT)) { to(RECENT_FROM - 1); understood.push({ kind: 'before', label: String(RECENT_FROM) }) }
  if (consume(NEG_CLASSIC)) { from(2000); understood.push({ kind: 'after', label: '1999' }) }
  const negKinds = new Set<string>()
  for (const { kind, rx } of NEG_KINDS) if (consume(rx)) negKinds.add(kind)

  // « sans X » / « pas de X » : on extrait avant de lire le reste, pour ne pas confondre « sans gore » avec « du gore ».
  for (const m of [...rest.matchAll(/ (?:sans|pas de|no|without|evite|eviter) ([a-z0-9]+)/g)]) {
    const w = m[1]!
    const g = AVOID_GENRE[w] ?? GENRES[w]
    if (g) { avoidGenres.add(g); understood.push({ kind: 'avoid', label: w }) } else if (TAGS[w]) { avoidTags.add(TAGS[w]!); understood.push({ kind: 'avoid', label: w }) }
    rest = rest.replace(m[0], ' ')
  }

  // Type de contenu, avant « court » : « court métrage » est un type, pas une durée.
  for (const k of KIND_WORDS) {
    const rx = new RegExp(` (?:${k.words}${k.verbs ? `|${k.verbs}` : ''}) `)
    if (rx.test(rest)) { kinds.add(k.kind); if (!understood.some(u => u.kind === 'kind' && u.label === k.kind)) understood.push({ kind: 'kind', label: k.kind }); rest = rest.replace(new RegExp(rx.source, 'g'), ' ') }
  }
  if (negKinds.size) {
    // Un type nié écarte ce type ; sans type demandé, tous les autres restent permis et les critères les annoncent.
    const wanted = kinds.size > 0
    kinds = new Set((wanted ? [...kinds] : ALL_KINDS).filter(k => !negKinds.has(k)))
    for (let i = understood.length - 1; i >= 0; i--) if (understood[i]!.kind === 'kind' && negKinds.has(understood[i]!.label)) understood.splice(i, 1)
    if (!wanted) for (const k of kinds) understood.push({ kind: 'kind', label: k })
  }

  // Durée : « moins de 90 min », « max 1h30 », « 1h30 max », « 2 heures maximum », « plus de 2 h ».
  const U = '(h|heures?|hours?|hrs?|min|mins|minutes?|mn)'
  const dm = new RegExp(`(?:moins de|max(?:imum)?|jusqu a|pas plus de|under|less than|at most)\\s+(\\d{1,3})\\s*${U}?(?: ?(\\d{1,2}))?(?= |$)`).exec(rest)
  const dmx = new RegExp(` (\\d{1,3}) ?${U}(?: ?(\\d{1,2}))? (?:max|maximum) `).exec(rest)
  const dl = new RegExp(`(?:plus de|au moins|over|more than|at least)\\s+(\\d{1,3})\\s*${U}(?: ?(\\d{1,2}))?`).exec(rest)
  const hit = dm ?? dmx
  if (hit) { const v = toMinutes(hit[1]!, hit[2], hit[3]); atMost(v); understood.push({ kind: 'maxMinutes', label: String(v) }); rest = rest.replace(hit[0], ' ') }
  if (dl) { const v = toMinutes(dl[1]!, dl[2], dl[3]); atLeast(v); understood.push({ kind: 'minMinutes', label: String(v) }); rest = rest.replace(dl[0], ' ') }
  if (!hit && new RegExp(` (?:${W_SHORT}) `).test(rest)) { short = true; atMost(SHORT_MAX); understood.push({ kind: 'short', label: String(SHORT_MAX) }) }
  if (!dl && new RegExp(` (?:${W_LONG}|epique long|long metrage) `).test(rest)) { long = true; atLeast(LONG_MIN); understood.push({ kind: 'long', label: String(LONG_MIN) }) }
  if (new RegExp(` (?:${W_RECENT}) `).test(rest)) { recent = true; from(RECENT_FROM); understood.push({ kind: 'recent', label: '' }) }
  if (new RegExp(` (?:${W_CLASSIC}) `).test(rest)) { classic = true; to(1999); understood.push({ kind: 'classic', label: '1999' }) }

  for (const [phrase, g] of Object.entries(GENRES)) if (rest.includes(` ${phrase} `) || rest.includes(` ${phrase}s `)) genres.add(g)
  for (const g of genres) understood.push({ kind: 'genre', label: g })
  for (const w of rest.trim().split(' ')) { const t = TAGS[w] ?? TAGS[stem(w)]; if (t && !tags.has(t) && !avoidTags.has(t)) { tags.add(t); understood.push({ kind: 'tag', label: t }) } }

  const score = (t: J, relax: boolean) => {
    if (kinds.size && !kinds.has(t.kind)) return -1
    if (!relax) {
      if (maxMin !== null && t.durationMinutes > maxMin) return -1
      if (minMin !== null && t.durationMinutes < minMin) return -1
      if (yearFrom !== null && t.year < yearFrom) return -1
      if (yearTo !== null && t.year > yearTo) return -1
    }
    if (avoidGenres.has(t.genre)) return -1
    const kws = new Set<string>((t.keywords as string[]).map(k => k.normalize('NFC')))
    if ([...avoidTags].some(a => kws.has(a))) return -1
    const gHit = genres.size ? (genres.has(t.genre) ? 1 : 0) : 0
    if (genres.size && !gHit) return -1
    const matched = [...tags].filter(g => kws.has(g)).length
    if (tags.size && !matched && !genres.size && !short && !long && !classic && !recent) return -1
    return 0.35 * gHit + 0.3 * (tags.size ? matched / tags.size : 0) + 0.04 * ((t.rating ?? 6) / 10) + 0.03 * Math.min(1, Math.max(0, (t.year - 2000) / 25))
  }
  const relaxable = maxMin !== null || minMin !== null || yearFrom !== null || yearTo !== null
  return { understood, genres, tags, short, maxMin, score, relaxable }
}

export function chat(message: string, env: AssistantEnv): J {
  const text = ` ${normalize(message)} `
  const playable = env.titles.filter(t => t.isPlayable)
  const steps = (criteria: number) => [{ key: 'taste', count: env.signals }, { key: 'catalog', count: playable.length }, ...(criteria ? [{ key: 'criteria', count: criteria }] : [])]
  const reply = (r: string, cards: J[], over: J = {}) => ({ reply: r, param: null, unknownTitle: null, understood: [], steps: steps(0), cards, ...over })

  // 1. Surprends-moi : un choix varié parmi les titres jamais vus, stable sur la journée. Les critères ajoutés (genre, « sans gore ») le cadrent.
  const surprise = SURPRISE.find(p => text.includes(` ${p} `))
  if (surprise) {
    const spec = readSpec(text.replace(` ${surprise} `, ' '))
    const rnd = rng(env.seed)
    const pool = playable.filter(t => !env.excluded.has(t.id) && spec.score(t, false) >= 0).map(t => ({ t, k: rnd() })).sort((a, b) => a.k - b.k)
    const picked: J[] = []
    const seenGenres = new Set<string>()
    for (const { t } of pool) { if (picked.length < 4 && !seenGenres.has(t.genre)) { picked.push(t); seenGenres.add(t.genre) } }
    const cards = picked.map(t => env.card(t.id, { type: 'surprise', titleId: null, title: null, genre: null, tags: null }))
    return picked.length ? reply('surprise', cards, { understood: spec.understood, steps: steps(spec.understood.length) }) : reply('nothing', [], { understood: spec.understood, steps: steps(spec.understood.length) })
  }

  // 2. Comme X : titres proches d'un titre du catalogue.
  const like = /\b(?:comme|similaire a|ressemble a|dans le genre de|like)\s+(.+?)\s*$/.exec(normalize(message))
  if (like) {
    const wanted = like[1]!.replace(/^(le|la|les|l|un|une)\s+/, '')
    const hit = env.titles.find(t => normalize(t.name) === normalize(like[1]) || normalize(t.name).includes(wanted) || (wanted.length > 3 && wanted.includes(normalize(t.name))))
    if (!hit) {
      // On rend le titre tel que l'a écrit la personne (casse et accents), pas sa forme normalisée.
      const shown = /(?:comme|similaire (?:à|a)|ressemble (?:à|a)|dans le genre de|like)\s+(.+?)\s*[.?!]*$/i.exec(message)?.[1]?.trim() ?? like[1]!
      const fallback = playable.filter(t => !env.excluded.has(t.id)).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 3)
      return reply('similarUnknown', fallback.map(t => env.card(t.id, { type: 'popular', titleId: null, title: null, genre: t.genre, tags: null })), { unknownTitle: shown, param: shown })
    }
    const cards = env.similar(hit.id).filter(c => c.title.isPlayable).slice(0, 5)
    return cards.length ? reply('similar', cards, { param: hit.name, understood: [{ kind: 'similar', label: hit.name }], steps: steps(1) }) : reply('nothing', [])
  }

  // 3. Critères : genre, ambiance, type, durée, époque, exclusions.
  const spec = readSpec(text)
  const { understood, tags, genres } = spec
  const criteria = understood.length
  if (!criteria) return reply('help', [])

  const run = (relax: boolean) => playable.filter(t => !env.excluded.has(t.id))
    .map(t => ({ t, s: spec.score(t, relax) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name, 'fr')).slice(0, 5)

  // En mode assoupli, la durée et l'époque sont levées : elles ne figurent plus dans les raisons affichées.
  const withReason = (list: { t: J }[], relaxed: boolean) => list.map(({ t }) => {
    const matchedTags = [...tags].filter(g => (t.keywords as string[]).includes(g))
    const labels = [!relaxed && spec.short ? 'court' : !relaxed && spec.maxMin !== null ? `≤ ${spec.maxMin} min` : '', genres.has(t.genre) ? t.genre : '', ...matchedTags].filter(Boolean)
    return env.card(t.id, labels.length ? { type: 'matches', titleId: null, title: null, genre: null, tags: labels } : { type: 'genreAffinity', titleId: null, title: null, genre: t.genre, tags: null })
  })

  let found = run(false)
  if (found.length) return reply('found', withReason(found, false), { understood, steps: steps(criteria) })
  if (spec.relaxable) {
    found = run(true)
    if (found.length) return reply('relaxed', withReason(found, true), { understood, steps: steps(criteria) })
  }
  return reply('nothing', [], { understood, steps: steps(criteria) })
}
