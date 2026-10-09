import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fr, type Key } from './fr'
import { en } from './en'

export type Locale = 'fr' | 'en'
export type { Key }
type Vars = Record<string, string | number>

const DICTS: Record<Locale, Record<Key, string>> = { fr, en }
const STORAGE = 'divertiflix.locale'

function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE)
    if (v === 'fr' || v === 'en') return v
  } catch { /* stockage indisponible */ }
  return 'fr' // le français est la langue par défaut du portail
}

/** Remplace {nom} par sa valeur. Une variable manquante reste visible : mieux vaut un défaut visible qu'un texte faux. */
export function interpolate(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

export interface I18n {
  locale: Locale
  setLocale(l: Locale): void
  t(key: Key, vars?: Vars): string
  /** Pluriel : utilise `${key}.one` ou `${key}.other` selon les règles de la langue. */
  plural(key: string, n: number, vars?: Vars): string
  genre(g: string): string
  tag(k: string): string
  duration(minutes: number): string
  clock(seconds: number): string
  ago(date: string | Date): string
  date(date: string | Date): string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? initialLocale())

  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try { localStorage.setItem(STORAGE, l) } catch { /* stockage indisponible */ }
  }, [])

  const value = useMemo<I18n>(() => {
    const dict = DICTS[locale]
    const rules = new Intl.PluralRules(locale)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const lookup = (key: string) => (dict as Record<string, string>)[key]
    const t = (key: Key, vars?: Vars) => interpolate(dict[key] ?? fr[key] ?? key, vars)
    return {
      locale, setLocale, t,
      plural: (key, n, vars) => interpolate(lookup(`${key}.${rules.select(n)}`) ?? lookup(`${key}.other`) ?? key, { n, ...vars }),
      genre: g => lookup(`genre.${g}`) ?? g,
      tag: k => lookup(`tag.${k}`) ?? k,
      duration: minutes => {
        if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
        const h = Math.floor(minutes / 60), m = Math.round(minutes % 60)
        return locale === 'fr' ? (m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`) : (m ? `${h}h ${m}m` : `${h}h`)
      },
      clock: s => {
        s = Math.max(0, Math.floor(s))
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
      },
      ago: date => {
        const diff = (new Date(date).getTime() - Date.now()) / 1000
        const abs = Math.abs(diff)
        if (abs < 60) return rtf.format(0, 'second')
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
        if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
        return new Date(date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
      },
      date: date => new Date(date).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    }
  }, [locale, setLocale])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const c = useContext(Ctx)
  if (!c) throw new Error('useI18n hors I18nProvider')
  return c
}
