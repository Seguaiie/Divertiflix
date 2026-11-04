import { useState, type CSSProperties } from 'react'
import { ExternalLink, Trophy } from 'lucide-react'
import { useI18n, type Key } from '../i18n'
import { useAiBenchmarks } from '../state/queries'
import { orgColor } from '../lib/aiOrgs'
import type { BenchEntry, BenchModel } from '../lib/api'
import './AiLeaderboard.css'

const orgVars = (org: string) => ({ '--org': orgColor(org) }) as CSSProperties
const MEDALS = ['🥇', '🥈', '🥉']

/**
 * Classement des modèles d'IA (onglet « Nicholas ») : podium et classement général d'après l'indice des capacités d'Epoch AI,
 * derniers modèles évalués, et les 10 meilleurs de quelques bancs d'essai. Source et licence (CC BY 4.0) toujours affichées.
 */
export function AiLeaderboard() {
  const { t, date } = useI18n()
  const bench = useAiBenchmarks()
  const [tab, setTab] = useState(0)

  if (bench.isPending) return <div className="ai-lb ai-lb-loading" aria-busy="true" />
  if (bench.isError || !bench.data) return <p className="ai-lb-note" role="status">{t('ai.benchError')}</p>

  const { leaderboard, latest, benchmarks } = bench.data
  const podium = leaderboard.slice(0, 3)
  const rest = leaderboard.slice(3)
  // Barres relatives : l'écart entre modèles de tête est petit sur l'échelle de l'indice, on part un peu sous le dernier affiché.
  const floor = Math.min(...leaderboard.map(m => m.score)) - 4
  const top = Math.max(...leaderboard.map(m => m.score))
  const width = (s: number) => `${Math.max(6, ((s - floor) / (top - floor)) * 100)}%`
  const current = benchmarks[Math.min(tab, benchmarks.length - 1)]

  return (
    <section className="ai-lb" aria-labelledby="ai-lb-title">
      <header className="ai-lb-head">
        <h2 id="ai-lb-title" className="ai-lb-title"><Trophy aria-hidden />{t('ai.benchTitle')}</h2>
        <p>{t('ai.benchLead')}</p>
      </header>

      <div className="ai-lb-grid">
        <div className="ai-lb-overall">
          <h3 className="ai-lb-sub">{t('ai.benchOverall')}</h3>
          <ol className="ai-podium">
            {podium.map((m, i) => (
              <li key={m.name} className={`ai-podium-step p${i + 1}`} style={orgVars(m.organization)}>
                <span className="ai-medal" aria-hidden>{MEDALS[i]}</span>
                <span className="ai-podium-rank">{i === 0 ? t('ai.rank1') : t('ai.rank', { n: i + 1 })}</span>
                <span className="ai-podium-name">{m.name}</span>
                <span className="ai-org"><i aria-hidden />{m.organization}</span>
                <span className="ai-podium-score tnum" title={m.low != null && m.high != null ? t('ai.benchRange', { low: m.low, high: m.high }) : undefined}>{m.score}</span>
              </li>
            ))}
          </ol>
          <ol className="ai-bars" start={4}>
            {rest.map((m, i) => <Bar key={m.name} model={m} rank={i + 4} width={width(m.score)} value={String(m.score)} />)}
          </ol>
        </div>

        <aside className="ai-lb-latest">
          <h3 className="ai-lb-sub">{t('ai.benchLatest')}</h3>
          <ul>
            {latest.map(m => (
              <li key={m.name} style={orgVars(m.organization)}>
                <span className="ai-latest-name">{m.name}</span>
                <span className="ai-org"><i aria-hidden />{m.organization}</span>
                <span className="ai-latest-meta tnum">{m.date ? date(`${m.date}T12:00:00Z`) : ''}<b>{m.score}</b></span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {current && (
        <div className="ai-lb-tests">
          <h3 className="ai-lb-sub">{t('ai.benchTests')}</h3>
          <div className="ai-tabs" role="tablist" aria-label={t('ai.benchTests')}>
            {benchmarks.map((b, i) => (
              <button key={b.id} role="tab" id={`ai-tab-${b.id}`} aria-selected={b === current} aria-controls={`ai-panel-${b.id}`}
                tabIndex={b === current ? 0 : -1} className={b === current ? 'ai-tab is-on' : 'ai-tab'} onClick={() => setTab(i)}
                onKeyDown={e => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                  const next = (i + (e.key === 'ArrowRight' ? 1 : benchmarks.length - 1)) % benchmarks.length
                  setTab(next)
                  document.getElementById(`ai-tab-${benchmarks[next]!.id}`)?.focus()
                }}>
                <b>{b.name}</b>
                <span>{t(`ai.bench.${b.id}` as Key)}</span>
              </button>
            ))}
          </div>
          <ol key={current.id} id={`ai-panel-${current.id}`} role="tabpanel" aria-labelledby={`ai-tab-${current.id}`} className="ai-bars is-pct">
            {current.top.map((m, i) => <Bar key={m.name} model={m} rank={i + 1} width={`${Math.max(4, m.score)}%`} value={`${m.score} %`} />)}
          </ol>
        </div>
      )}

      <p className="ai-lb-source">
        <a href={bench.data.sourceUrl} target="_blank" rel="noopener noreferrer">
          {t('ai.benchSource', { source: bench.data.source, license: bench.data.license })}<ExternalLink aria-hidden />
        </a>
      </p>
    </section>
  )
}

function Bar({ model, rank, width, value }: { model: BenchModel | BenchEntry; rank: number; width: string; value: string }) {
  return (
    <li className="ai-bar" style={{ ...orgVars(model.organization), '--w': width } as CSSProperties}>
      <span className="ai-bar-rank tnum">{rank}</span>
      <span className="ai-bar-label">
        <span className="ai-bar-name">{model.name}{model.effort && <em>{model.effort}</em>}</span>
        <span className="ai-org"><i aria-hidden />{model.organization}</span>
      </span>
      <span className="ai-bar-track" aria-hidden><span className="ai-bar-fill" /></span>
      <span className="ai-bar-value tnum">{value}</span>
    </li>
  )
}
