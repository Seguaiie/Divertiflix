import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowUpRight, BrainCircuit } from 'lucide-react'
import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAiBenchmarks, useAiNews } from '../state/queries'
import { AiLeaderboard } from '../components/AiLeaderboard'
import type { NewsItem } from '../lib/api'
import './NicholasPage.css'

type Lang = 'all' | 'fr' | 'en'

/** Teinte stable par source : chaque média garde sa couleur d'une visite à l'autre. */
function hue(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
const sourceVars = (source: string) => ({ '--src-h': hue(source) }) as CSSProperties
const initials = (source: string) => source.split(/[\s.-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
const isWeb = (url: string) => /^https?:\/\//i.test(url)

/** Onglet « Nicholas » : les nouvelles du jour sur l'intelligence artificielle. */
export function NicholasPage() {
  const { t, plural, locale } = useI18n()
  const news = useAiNews()
  const bench = useAiBenchmarks()
  useDocumentTitle(t('nav.nicholas'))
  const [lang, setLang] = useState<Lang>('all')
  const [source, setSource] = useState<string>('')

  const items = useMemo(() => news.data?.items ?? [], [news.data])
  const byLang = useMemo(() => items.filter(i => lang === 'all' || i.language === lang), [items, lang])
  const sources = useMemo(() => [...new Set(byLang.map(i => i.source))].sort((a, b) => a.localeCompare(b, locale)), [byLang, locale])
  const shown = useMemo(() => byLang.filter(i => !source || i.source === source), [byLang, source])
  // À la une : l'article le plus récent qui a une image, parmi les premiers (sinon le plus récent tout court).
  const top = shown.slice(0, 8).find(i => i.imageUrl) ?? shown[0]
  const rest = shown.filter(i => i !== top)
  const down = news.data?.sources.filter(s => !s.ok) ?? []
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  const chooseLang = (l: Lang) => { setLang(l); setSource('') }

  return (
    <div className="page nicholas">
      <header className="page-head ai-hero">
        <span className="ai-hero-orb" aria-hidden><BrainCircuit /></span>
        <p className="eyebrow">{t('ai.eyebrow')}</p>
        <h1 className="display">{t('nav.nicholas')}</h1>
        <p><strong>{t('ai.tagline')}</strong> {t('ai.lead', { n: news.data?.sources.length ?? 8 })}</p>
        <span className="ai-sparks" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</span>

        {/* Chiffres du jour : articles, sources, et le modèle en tête du classement. */}
        {news.data && (
          <dl className="ai-stats">
            <div><dt>{t('ai.statsArticles')}</dt><dd className="tnum">{items.length}</dd></div>
            <div><dt>{t('ai.statsSources')}</dt><dd className="tnum">{news.data.sources.filter(s => s.ok).length}</dd></div>
            {bench.data?.leaderboard[0] && <div className="is-leader"><dt>{t('ai.statsLeader')}</dt><dd>{bench.data.leaderboard[0].name}</dd></div>}
          </dl>
        )}

        {/* Bandeau défilant des derniers titres (doublé pour une boucle sans à-coup ; arrêté au survol et si les animations sont réduites). */}
        {items.length > 0 && (
          <div className="ai-ticker" aria-hidden>
            <div className="ai-ticker-track">
              {[0, 1].map(copy => (
                <span key={copy} className="ai-ticker-run">
                  {items.slice(0, 12).map(i => <span key={i.id}><b>{i.source}</b> {i.title}</span>)}
                </span>
              ))}
            </div>
          </div>
        )}
      </header>

      {news.isPending && <div className="ai-grid" aria-busy="true">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="ai-skeleton" />)}</div>}

      {news.isError && !news.data && (
        <div className="empty" role="alert">
          <h2>{t('ai.error')}</h2>
          <p>{t('ai.errorHelp')}</p>
          <button className="btn btn-primary" onClick={() => void news.refetch()}>{t('common.retry')}</button>
        </div>
      )}

      {news.data && (
        <>
          <div className="ai-toolbar">
            <div className="ai-chips" role="group" aria-label={t('ai.filterLang')}>
              {(['all', 'fr', 'en'] as const).map(l => (
                <button key={l} className={lang === l ? 'ai-chip is-on' : 'ai-chip'} aria-pressed={lang === l} onClick={() => chooseLang(l)}>
                  {t(l === 'all' ? 'ai.all' : l === 'fr' ? 'ai.fr' : 'ai.en')}
                  <span className="tnum">{l === 'all' ? items.length : items.filter(i => i.language === l).length}</span>
                </button>
              ))}
            </div>
            <label className="ai-select">
              <span className="visually-hidden">{t('ai.filterSource')}</span>
              <select value={source} onChange={e => setSource(e.target.value)}>
                <option value="">{t('ai.allSources')}</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <p className="ai-window tnum">
              {t(news.data.windowHours > 24 ? 'ai.window72' : 'ai.window24')} · {plural('ai.count', shown.length)}
            </p>
          </div>

          {shown.length === 0 && <div className="empty"><h2>{t('ai.empty')}</h2><p>{t('ai.emptyHelp')}</p></div>}

          {top && (
            <section aria-labelledby="ai-top-title">
              <h2 id="ai-top-title" className="ai-section-title">{t('ai.top')}</h2>
              <Story item={top} big now={news.data.updatedAt} />
            </section>
          )}

          <AiLeaderboard />

          {rest.length > 0 && (
            <section aria-labelledby="ai-latest-title">
              <h2 id="ai-latest-title" className="ai-section-title">{t('ai.latest')}</h2>
              <ul className="ai-grid">{rest.map(i => <li key={i.id}><Story item={i} now={news.data.updatedAt} /></li>)}</ul>
            </section>
          )}

          <footer className="ai-foot">
            <ul className="ai-sources">
              {news.data.sources.map(s => (
                <li key={s.name} className={s.ok ? undefined : 'is-down'} style={sourceVars(s.name)} title={s.ok ? undefined : t('ai.down', { source: s.name })}>
                  {s.name} <span className="tnum">{s.ok ? s.count : '!'}</span>
                </li>
              ))}
            </ul>
            {down.length > 0 && <p className="ai-down">{down.map(s => t('ai.down', { source: s.name })).join(' · ')}</p>}
            <p className="ai-updated tnum">{t('ai.updated', { time: time(news.data.updatedAt) })}</p>
          </footer>
        </>
      )}
    </div>
  )
}

/** « Nouveau » : publié moins de 2 h avant la dernière mise à jour des nouvelles (repère stable, pas l'horloge à chaque rendu). */
function Story({ item, big = false, now }: { item: NewsItem; big?: boolean; now: string }) {
  const { t, ago } = useI18n()
  const fresh = new Date(now).getTime() - new Date(item.publishedAt).getTime() < 2 * 3600_000
  const [broken, setBroken] = useState(false)
  if (!isWeb(item.url)) return null
  return (
    <article className={big ? 'ai-story is-big' : 'ai-story'} style={sourceVars(item.source)}>
      <a className="ai-story-link" href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="ai-media">
          {item.imageUrl && !broken
            ? <img src={item.imageUrl} alt="" loading={big ? 'eager' : 'lazy'} onError={() => setBroken(true)} />
            : <span className="ai-placeholder" aria-hidden><BrainCircuit /><b>{initials(item.source)}</b></span>}
        </span>
        <span className="ai-body">
          <span className="ai-meta">
            <span className="ai-source">{item.source}</span>
            <span className="ai-lang">{item.language.toUpperCase()}</span>
            {fresh && <span className="ai-new">{t('ai.new')}</span>}
            <time className="ai-time" dateTime={item.publishedAt}>{ago(item.publishedAt)}</time>
          </span>
          <span className="ai-title">{item.title}</span>
          {item.summary && <span className="ai-summary">{item.summary}</span>}
          <span className="ai-read">{t('ai.read', { source: item.source })}<ArrowUpRight aria-hidden /></span>
        </span>
      </a>
    </article>
  )
}
