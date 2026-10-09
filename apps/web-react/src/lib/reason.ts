import type { I18n } from '../i18n'
import type { Reason } from './api'

/**
 * Phrase d'explication d'une recommandation. Elle décrit la raison RÉELLE calculée par le moteur
 * (titre proche, genre apprécié, tendance...) : le client ne fait que la mettre en mots, jamais l'inventer.
 */
export function reasonText(r: Reason | null | undefined, i18n: Pick<I18n, 't' | 'genre' | 'tag'>): string | null {
  if (!r) return null
  const { t, genre, tag } = i18n
  switch (r.type) {
    case 'similarTo': return r.title ? t('reason.similarTo', { title: r.title }) : null
    case 'genreAffinity': return r.genre ? t('reason.genreAffinity', { genre: genre(r.genre) }) : null
    case 'trending': return t('reason.trending')
    case 'fresh': return t('reason.fresh')
    case 'popular': return t('reason.popular')
    case 'community': return t('reason.community')
    case 'explore': return r.genre ? t('reason.explore', { genre: genre(r.genre) }) : t('reason.exploreGeneric')
    case 'matches': return r.tags?.length ? t('reason.matches', { tags: r.tags.map(x => (x === 'court' ? t('reason.short') : tag(x))).join(' · ') }) : null
    case 'surprise': return t('reason.surprise')
    default: return null
  }
}
