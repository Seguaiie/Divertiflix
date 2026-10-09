import { describe, expect, it, vi } from 'vitest'
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
