import { describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n/fr'
import { en } from '../i18n/en'
import { ApiError } from './api'
import { errorText } from './errors'
import { isWebUrl, titleLink } from './links'
import { jwtExpiry } from './jwt'
import { saveProgress } from './progress'
import { reasonText } from './reason'
import { mockApi } from '../test/utils'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('jwtExpiry', () => {
  it('lit exp, y compris en base64url', () => {
    expect(jwtExpiry(`x.${b64({ exp: 1_900_000_000, name: 'é>?' })}.y`)).toBe(1_900_000_000)
  })
  it('renvoie null pour un jeton illisible', () => {
    expect(jwtExpiry('')).toBeNull()
    expect(jwtExpiry('abc')).toBeNull()
    expect(jwtExpiry('a.@@@.c')).toBeNull()
    expect(jwtExpiry(`a.${b64({ sub: 'x' })}.c`)).toBeNull()
  })
})

describe('reasonText', () => {
  const i18n = { t: (k: string, v?: Record<string, unknown>) => `${k}:${JSON.stringify(v ?? {})}`, genre: (g: string) => `G(${g})`, tag: (x: string) => `T(${x})` }
  const r = (over: object) => ({ type: 'x', titleId: null, title: null, genre: null, tags: null, ...over }) as never

  it('met en mots la raison réelle du moteur', () => {
    expect(reasonText(r({ type: 'similarTo', title: 'Dune' }), i18n)).toBe('reason.similarTo:{"title":"Dune"}')
    expect(reasonText(r({ type: 'genreAffinity', genre: 'Drame' }), i18n)).toBe('reason.genreAffinity:{"genre":"G(Drame)"}')
    expect(reasonText(r({ type: 'trending' }), i18n)).toBe('reason.trending:{}')
    expect(reasonText(r({ type: 'matches', tags: ['court', 'sombre'] }), i18n)).toContain('reason.short')
  })
  it('n\'invente rien quand la donnée manque', () => {
    expect(reasonText(null, i18n)).toBeNull()
    expect(reasonText(r({ type: 'similarTo' }), i18n)).toBeNull()
    expect(reasonText(r({ type: 'genreAffinity' }), i18n)).toBeNull()
    expect(reasonText(r({ type: 'matches', tags: [] }), i18n)).toBeNull()
    expect(reasonText(r({ type: 'inconnu' }), i18n)).toBeNull()
  })
  it('l\'exploration a une phrase générique sans genre', () => {
    expect(reasonText(r({ type: 'explore' }), i18n)).toBe('reason.exploreGeneric:{}')
  })
})

describe('saveProgress', () => {
  it('ignore les valeurs inexploitables sans appeler le serveur', async () => {
    const { calls } = mockApi({})
    await saveProgress('p', 't', NaN, 100)
    await saveProgress('p', 't', 10, 0)
    expect(calls).toHaveLength(0)
  })
  it('envoie des entiers', async () => {
    const { calls } = mockApi({ 'PUT /api/profiles/p/progress/t': { status: 204 } })
    await saveProgress('p', 't', 12.9, 99.6)
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { positionSeconds: 12, durationSeconds: 100 } })
  })
  it('une sauvegarde manquée ne lève jamais d\'erreur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(saveProgress('p', 't', 5, 50)).resolves.toBeUndefined()
  })
})

describe('errorText', () => {
  const t = (k: string) => `[${k}]`
  const text = (status: number, overrides?: Record<number, never>) => errorText(new ApiError('Ce titre a déjà été demandé.', status), t, overrides)

  it('traduit selon le statut et ne montre jamais le texte brut du serveur', () => {
    expect(text(0)).toBe('[error.network]')
    expect(text(400)).toBe('[error.invalid]')
    expect(text(429)).toBe('[error.rateLimited]')
    expect(text(500)).toBe('[error.server]')
    expect(text(503)).toBe('[error.server]')
    expect(text(409)).toBe('[error.generic]')
    expect(text(404)).toBe('[error.generic]')
  })
  it('une phrase propre à l\'action l\'emporte sur le statut', () => {
    expect(text(409, { 409: 'request.conflict' as never })).toBe('[request.conflict]')
    expect(text(500, { 409: 'request.conflict' as never })).toBe('[error.server]')
  })
  it('une erreur inconnue donne le message générique', () => {
    expect(errorText(new Error('network'), t)).toBe('[error.generic]')
    expect(errorText(undefined, t)).toBe('[error.generic]')
  })
  it('chaque clé utilisée existe dans les deux langues, sans le mot « network »', () => {
    for (const k of ['error.network', 'error.invalid', 'error.rateLimited', 'error.server', 'error.generic', 'request.conflict', 'support.conflict', 'profiles.conflict'] as const) {
      expect(fr[k], k).toBeTruthy()
      expect(en[k], k).toBeTruthy()
      expect(fr[k]).not.toMatch(/\bnetwork\b/i)
    }
  })
})

describe('isWebUrl', () => {
  it('accepte http et https, absolus ou relatifs', () => {
    expect(isWebUrl('https://abs.exemple.test/item/1')).toBe(true)
    expect(isWebUrl('http://nas.local:13378/item/1')).toBe(true)
    expect(isWebUrl('/api/media/42')).toBe(true)
  })
  it('refuse les schémas qui exécuteraient du code ou n\'ouvrent rien, même déguisés', () => {
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'blob:https://x/1', 'file:///etc/passwd', 'media:abc'])
      expect(isWebUrl(u), u).toBe(false)
  })
})

describe('titleLink', () => {
  const at = (pathname: string, state?: unknown) => ({ pathname, search: '', hash: '', key: 'k', state }) as never
  it('depuis une page, la fiche s\'ouvre par-dessus elle et s\'empile', () => {
    const films = at('/films')
    expect(titleLink(films, 'b')).toEqual({ to: '/titres/b', replace: false, state: { background: films } })
  })
  it('depuis une fiche ouverte sur une page, la nouvelle fiche la remplace et garde la même page derrière', () => {
    const films = at('/films')
    expect(titleLink(at('/titres/a', { background: films }), 'b')).toEqual({ to: '/titres/b', replace: true, state: { background: films } })
  })
  it('depuis une fiche en lien direct, la nouvelle fiche la remplace sans page d\'origine', () => {
    expect(titleLink(at('/titres/a'), 'b')).toEqual({ to: '/titres/b', replace: true, state: undefined })
  })
})
