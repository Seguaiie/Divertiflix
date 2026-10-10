/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom ne fait pas de mise en page : ce que la charte et l'accessibilité demandent au CSS se vérifie sur le texte des feuilles de style.
// (Vitest remplace les imports CSS par du vide : on lit les fichiers tels quels.)
const src = join(import.meta.dirname, '..')
const sheets: Record<string, string> = Object.fromEntries(
  readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.css')).map(f => [f, readFileSync(join(src, f), 'utf8')]),
)
const sheet = (name: string) => {
  const key = Object.keys(sheets).find(k => k.endsWith(name))
  if (!key) throw new Error(`feuille introuvable : ${name}`)
  return sheets[key]!
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Déclarations de toutes les règles dont le sélecteur est exactement `selector` (dans la feuille `name`). */
const declarations = (name: string, selector: string) => [...sheet(name).matchAll(new RegExp(`(?:^|[\\s}])${esc(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(' ')

/** Contenu du bloc `@media …` d'une feuille (accolades appariées). */
function media(css: string, query: string): string {
  const start = css.indexOf(`${query} {`)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return ''
}

/** Couleurs écrites en dur : rgb(r g b / a), rgb(r, g, b), #rgb, #rrggbb (y compris dans une image SVG intégrée, où # s'écrit %23). */
function literals(css: string): { text: string; rgb: [number, number, number] }[] {
  const out: { text: string; rgb: [number, number, number] }[] = []
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) out.push({ text: m[0], rgb: [Number(m[1]), Number(m[2]), Number(m[3])] })
  for (const m of css.matchAll(/(?:#|%23)([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const h = m[1]!.length === 3 ? [...m[1]!].map(c => c + c).join('') : m[1]!
    out.push({ text: m[0], rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] })
  }
  return out
}

describe('charte : couleurs', () => {
  it('aucun neutre sombre ou chaud codé en dur : tout passe par la famille encre indigo (rgb(var(--ink) / x), --text-3, etc.)', () => {
    const fautifs = Object.entries(sheets).flatMap(([file, css]) => literals(css).filter(({ rgb: [r, g, b] }) => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const noirPur = max === 0, blanc = min === 255
      const quasiNoir = !noirPur && max <= 64 // ancien « noir chaud » : devrait être --ink
      const grisChaud = max > 64 && max - min <= 40 && r > b + 8 // beige gris : devrait être --text-3
      return !noirPur && !blanc && (quasiNoir || grisChaud)
    }).map(l => `${file} : ${l.text}`))
    expect(fautifs).toEqual([])
  })
})

describe('accessibilité : feuilles de style', () => {
  it('le défilement vers le focus laisse la place au lecteur audio fixe, et à la barre d\'onglets sous 960 px', () => {
    expect(declarations('base.css', 'html')).toMatch(/scroll-padding-bottom:\s*calc\(var\(--dock-h\)\s*\+\s*\d+px\)/)
    expect(media(sheet('Shell.css'), '@media (max-width: 960px)')).toMatch(/html\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--dock-h\)\s*\+\s*64px\s*\+\s*\d+px\)/)
  })

  it('les liens et la recherche de la navigation ne passent jamais à la ligne', () => {
    expect(declarations('Shell.css', '.nav-links a')).toMatch(/white-space:\s*nowrap/)
    expect(declarations('Shell.css', '.nav-search span')).toMatch(/white-space:\s*nowrap/)
  })

  it('la barre d\'onglets est disponible dès la tablette en portrait : aucune largeur sans navigation', () => {
    const tablet = media(sheet('Shell.css'), '@media (max-width: 960px)')
    expect(tablet).toMatch(/\.nav-links[^{]*\{\s*display: none;/) // les liens quittent la barre du haut...
    expect(tablet).toMatch(/\.tabbar \{\s*display: grid/) // ...et la barre d'onglets prend le relais, sans trou entre 721 et 960 px
  })

  it('les titres d\'un état vide ont la graisse des autres titres (600), qu\'ils soient h1 ou h2', () => {
    expect(declarations('ui.css', '.empty :is(h1, h2)')).toMatch(/font-weight:\s*600/)
  })
})
