import { type J, normalize, rng } from './util'

/**
 * Assistant de la démonstration : une version allégée de l'analyseur de requêtes de l'API (qui tourne en C# côté serveur).
 * Mêmes réponses structurées (clés de réponse, critères compris, étapes consultées, cartes avec raison), calculées ici sur le
 * catalogue de démonstration. Il comprend : genre, ambiance, durée, « sans X », « comme X », « surprends-moi ».
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

const stem = (w: string) => w.replace(/(s|x)$/, '')

export function chat(message: string, env: AssistantEnv): J {
  const text = ` ${normalize(message)} `
  const playable = env.titles.filter(t => t.isPlayable)
  const steps = (criteria: number) => [{ key: 'taste', count: env.signals }, { key: 'catalog', count: playable.length }, ...(criteria ? [{ key: 'criteria', count: criteria }] : [])]
  const reply = (r: string, cards: J[], over: J = {}) => ({ reply: r, param: null, unknownTitle: null, understood: [], steps: steps(0), cards, ...over })

  // 1. Surprends-moi : un choix varié parmi les titres jamais vus, stable sur la journée.
  if (SURPRISE.some(p => text.includes(` ${p} `))) {
    const rnd = rng(env.seed)
    const pool = playable.filter(t => !env.excluded.has(t.id)).map(t => ({ t, k: rnd() })).sort((a, b) => a.k - b.k)
    const picked: J[] = []
    const seenGenres = new Set<string>()
    for (const { t } of pool) { if (picked.length < 4 && !seenGenres.has(t.genre)) { picked.push(t); seenGenres.add(t.genre) } }
    return picked.length ? reply('surprise', picked.map(t => env.card(t.id, { type: 'surprise', titleId: null, title: null, genre: null, tags: null }))) : reply('nothing', [])
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
  const understood: J[] = []
  const genres = new Set<string>(), tags = new Set<string>(), avoidGenres = new Set<string>(), avoidTags = new Set<string>()
  let kind: string | null = null, maxMin: number | null = null, minMin: number | null = null, recent = false, classic = false, short = false, long = false

  // « sans X » / « pas de X » : on extrait avant de lire le reste, pour ne pas confondre « sans gore » avec « du gore ».
  let rest = text
  const neg = [...rest.matchAll(/ (?:sans|pas de|no|without|evite|eviter) ([a-z0-9]+)/g)]
  for (const m of neg) {
    const w = m[1]!
    const g = AVOID_GENRE[w] ?? GENRES[w]
    if (g) { avoidGenres.add(g); understood.push({ kind: 'avoid', label: w }) } else if (TAGS[w]) { avoidTags.add(TAGS[w]!); understood.push({ kind: 'avoid', label: w }) }
    rest = rest.replace(m[0], ' ')
  }

  if (/ (livre audio|livres audio|audiobook|audiolivre|ecouter|a ecouter|audio) /.test(rest)) { kind = 'Audiobook'; understood.push({ kind: 'kind', label: 'Audiobook' }) }
  else if (/ (film|films|court metrage|movie) /.test(rest)) { kind = 'Movie'; understood.push({ kind: 'kind', label: 'Movie' }) }

  const dm = /(?:moins de|max(?:imum)?|jusqu a|pas plus de|under|less than)\s+(\d+)\s*(?:min|minutes|mn)?/.exec(rest)
  if (dm) { maxMin = +dm[1]!; understood.push({ kind: 'maxMinutes', label: String(maxMin) }) }
  const dl = /(?:plus de|au moins|over|more than)\s+(\d+)\s*(?:min|minutes|mn)/.exec(rest)
  if (dl) { minMin = +dl[1]!; understood.push({ kind: 'minMinutes', label: String(minMin) }) }
  if (!dm && / (court|courte|courts|short|rapide|vite fait) /.test(rest)) { short = true; maxMin = 2; understood.push({ kind: 'short', label: '2' }) }
  if (!dl && / (long|longue|longs|epique long|long metrage) /.test(rest)) { long = true; minMin = 10; understood.push({ kind: 'long', label: '10' }) }
  if (/ (recent|recents|nouveau|nouveaute|nouveautes|new) /.test(rest)) { recent = true; understood.push({ kind: 'recent', label: '' }) }
  if (/ (classique|classiques|classic|ancien|vieux) /.test(rest)) { classic = true; understood.push({ kind: 'classic', label: '1999' }) }

  for (const [phrase, g] of Object.entries(GENRES)) if (rest.includes(` ${phrase} `) || rest.includes(` ${phrase}s `)) { genres.add(g) }
  for (const g of genres) understood.push({ kind: 'genre', label: g })
  for (const w of rest.trim().split(' ')) { const t = TAGS[w] ?? TAGS[stem(w)]; if (t && !tags.has(t) && !avoidTags.has(t)) { tags.add(t); understood.push({ kind: 'tag', label: t }) } }
  const criteria = understood.length
  if (!criteria) return reply('help', [])

  const score = (t: J, relax: boolean) => {
    if (kind && t.kind !== kind) return -1
    if (!relax) {
      if (maxMin !== null && t.durationMinutes > maxMin) return -1
      if (minMin !== null && t.durationMinutes < minMin) return -1
      if (recent && t.year < 2023) return -1
      if (classic && t.year > 1950) return -1
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
  const run = (relax: boolean) => playable.filter(t => !env.excluded.has(t.id))
    .map(t => ({ t, s: score(t, relax) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name, 'fr')).slice(0, 5)

  const withReason = (list: { t: J }[]) => list.map(({ t }) => {
    const matchedTags = [...tags].filter(g => (t.keywords as string[]).includes(g))
    const labels = [short ? 'court' : maxMin !== null ? `≤ ${maxMin} min` : '', genres.has(t.genre) ? t.genre : '', ...matchedTags].filter(Boolean)
    return env.card(t.id, labels.length ? { type: 'matches', titleId: null, title: null, genre: null, tags: labels } : { type: 'genreAffinity', titleId: null, title: null, genre: t.genre, tags: null })
  })

  let found = run(false)
  if (found.length) return reply('found', withReason(found), { understood, steps: steps(criteria) })
  if (maxMin !== null || minMin !== null || recent || classic) {
    found = run(true)
    if (found.length) return reply('relaxed', withReason(found), { understood, steps: steps(criteria) })
  }
  return reply('nothing', [], { understood, steps: steps(criteria) })
}
