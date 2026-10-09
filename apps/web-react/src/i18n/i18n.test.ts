import { describe, expect, it } from 'vitest'
import { interpolate } from '.'
import { en } from './en'
import { fr } from './fr'

// Tout le code de l'application, lu comme du texte (Vite), hors dictionnaires et tests.
const code = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.*', '!../test/**', '!../i18n/**'], { query: '?raw', import: 'default', eager: true })

describe('dictionnaires', () => {
  const frKeys = Object.keys(fr).sort()
  const enKeys = Object.keys(en).filter(k => !/^(genre|tag)\./.test(k)).sort()

  it('anglais et français ont exactement les mêmes clés', () => {
    expect(enKeys.filter(k => !(k in fr))).toEqual([])
    expect(frKeys.filter(k => !(k in en))).toEqual([])
  })

  it('aucune valeur vide, aucun tiret cadratin', () => {
    for (const [k, v] of [...Object.entries(fr), ...Object.entries(en)]) {
      expect(v.trim(), k).not.toBe('')
      expect(v, k).not.toContain('\u2014')
    }
  })

  it('les variables {x} sont identiques dans les deux langues', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const k of frKeys) expect(vars(en[k as keyof typeof en]), k).toEqual(vars(fr[k as keyof typeof fr]))
  })

  it('chaque pluriel a ses formes one et other dans les deux langues', () => {
    const bases = new Set(Object.keys(fr).filter(k => /\.(one|other)$/.test(k)).map(k => k.replace(/\.(one|other)$/, '')))
    expect(bases.size).toBeGreaterThan(0)
    for (const b of bases) for (const dict of [fr, en] as Record<string, string>[]) {
      expect(dict[`${b}.one`], b).toBeTruthy()
      expect(dict[`${b}.other`], b).toBeTruthy()
    }
  })

  it('toutes les clés utilisées dans le code existent', () => {
    const files = Object.entries(code)
    expect(files.length).toBeGreaterThan(30) // garde-fou : le balayage doit vraiment lire le code
    const missing: string[] = []
    for (const [file, text] of files) {
      for (const m of text.matchAll(/\bt\(\s*'([a-z0-9]+(?:\.[A-Za-z0-9]+)+)'/g)) if (!(m[1]! in fr)) missing.push(`${file}: ${m[1]}`)
      for (const m of text.matchAll(/\bplural\(\s*'([a-z0-9.]+)'/g)) if (!((`${m[1]}.other`) in fr)) missing.push(`${file}: ${m[1]} (pluriel)`)
    }
    expect(missing).toEqual([])
  })
})

describe('interpolate', () => {
  it('remplace les variables et laisse visible celle qui manque', () => {
    expect(interpolate('Bonjour {name}', { name: 'Camille' })).toBe('Bonjour Camille')
    expect(interpolate('{n} titres, {x}', { n: 3 })).toBe('3 titres, {x}')
    expect(interpolate('Sans variable')).toBe('Sans variable')
  })
})
