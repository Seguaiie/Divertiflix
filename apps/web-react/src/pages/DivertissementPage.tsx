import { PartyPopper } from 'lucide-react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useHobbyNews, type Teammate } from '../state/queries'
import { Story } from './NicolasPage'
import './NicolasPage.css'
import './DivertissementPage.css'

const PEOPLE: { slug: string; api: Teammate; name: string }[] = [
  { slug: 'emilien', api: 'Emilien', name: 'Émilien' },
  { slug: 'alexi', api: 'Alexi', name: 'Alexi' },
  { slug: 'abdoullah', api: 'Abdoullah', name: 'Abdoullah' },
  { slug: 'maxence', api: 'Maxence', name: 'Maxence' },
]

/** Onglet « Divertissement » : les centres d'intérêt propres à chaque membre de l'équipe, un sous-onglet chacun. */
export function DivertissementPage() {
  const { t } = useI18n()
  const { person: slug } = useParams()
  const person = PEOPLE.find(p => p.slug === slug)
  useDocumentTitle(t('nav.divertissement'))
  if (!person) return <Navigate to={`/divertissement/${PEOPLE[0]!.slug}`} replace />

  return (
    <div className="page divertissement">
      <header className="page-head hobby-hero">
        <span className="hobby-hero-orb" aria-hidden><PartyPopper /></span>
        <p className="eyebrow">{t('hobby.eyebrow')}</p>
        <h1 className="display">{t('nav.divertissement')}</h1>
        <p>{t('hobby.lead')}</p>
      </header>

      <nav className="ai-chips hobby-switch" aria-label={t('hobby.switch')}>
        {PEOPLE.map(p => (
          <NavLink key={p.slug} to={`/divertissement/${p.slug}`} className={({ isActive }) => isActive ? 'ai-chip is-on' : 'ai-chip'}>
            {p.name}
          </NavLink>
        ))}
      </nav>

      <PersonSections key={person.api} person={person.api} />
    </div>
  )
}

function PersonSections({ person }: { person: Teammate }) {
  const { t } = useI18n()
  const hobby = useHobbyNews(person)

  if (hobby.isPending) return <div className="ai-grid" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="ai-skeleton" />)}</div>

  if (hobby.isError && !hobby.data) {
    return (
      <div className="empty" role="alert">
        <h2>{t('hobby.error')}</h2>
        <p>{t('hobby.errorHelp')}</p>
        <button className="btn btn-primary" onClick={() => void hobby.refetch()}>{t('common.retry')}</button>
      </div>
    )
  }
  if (!hobby.data) return null
  const updatedAt = hobby.data.updatedAt

  return (
    <>
      {hobby.data.sections.map(s => (
        <section key={s.key} aria-labelledby={`hobby-${s.key}`}>
          <h2 id={`hobby-${s.key}`} className="ai-section-title">{t(`hobby.${s.key}` as never)}</h2>
          {s.items.length === 0
            ? <p className="hint">{t('hobby.sectionEmpty')}</p>
            : <ul className="ai-grid is-feed">{s.items.map(i => <li key={i.id}><Story item={i} now={updatedAt} /></li>)}</ul>}
        </section>
      ))}
    </>
  )
}
