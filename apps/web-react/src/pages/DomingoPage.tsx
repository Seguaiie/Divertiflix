import type { CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useMlbResults } from '../state/queries'
import { MlbHighlights } from '../components/MlbHighlights'
import { teamColor } from '../lib/mlbTeams'
import type { MlbGame, MlbTeam } from '../lib/api'
import './DomingoPage.css'

/** Couleurs des deux équipes, en variables CSS : bandeaux, lueurs et lignes gagnantes s'en servent. */
const teamVars = (g: MlbGame) => ({ '--away': teamColor(g.away.id), '--home': teamColor(g.home.id) }) as CSSProperties

/** Classe du badge de série : or pour la Série mondiale, couleurs propres aux autres tours. */
const seriesClass = (type: string) => ({ W: 'ws', L: 'lcs', D: 'ds', F: 'wc', S: 'spring' } as Record<string, string>)[type] ?? 'other'

/** Onglet « Domingo » : derniers résultats de la MLB, avec le dernier match à la une et ses manches. */
export function DomingoPage() {
  const { t, locale, plural } = useI18n()
  const results = useMlbResults()
  useDocumentTitle(t('nav.domingo'))

  // Les dates de la MLB sont des journées (« 2026-10-28 ») : affichées telles quelles, sans décalage de fuseau.
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  const days = results.data?.days ?? []
  const featured = days[0]?.games[0]

  return (
    <div className="page domingo">
      <header className="page-head mlb-hero">
        <span className="mlb-hero-ball" aria-hidden />
        <p className="eyebrow">{t('mlb.eyebrow')}</p>
        <h1 className="display">{t('nav.domingo')}</h1>
        <p><strong>{t('mlb.tagline')}</strong> {t('mlb.lead')}</p>
      </header>

      <MlbHighlights />

      {featured && <Featured game={featured} />}

      {results.isPending && <div className="mlb-days" aria-busy="true">{[0, 1].map(i => <div key={i} className="mlb-skeleton" />)}</div>}

      {results.isError && !results.data && (
        <div className="empty" role="alert">
          <h2>{t('mlb.error')}</h2>
          <p>{t('mlb.errorHelp')}</p>
          <button className="btn btn-primary" onClick={() => void results.refetch()}>{t('common.retry')}</button>
        </div>
      )}

      {results.data && days.length === 0 && <div className="empty"><h2>{t('mlb.empty')}</h2><p>{t('mlb.emptyHelp')}</p></div>}

      <div className="mlb-days">
        {days.map(day => (
          <section key={day.date} className="mlb-day" aria-labelledby={`mlb-${day.date}`}>
            <h2 id={`mlb-${day.date}`} className="mlb-day-title">
              <span>{dayLabel(day.date)}</span>
              <span className="mlb-day-count tnum">{plural('mlb.games', day.games.length)}</span>
            </h2>
            <ul className="mlb-games">
              {day.games.map(g => <li key={g.id}><GameRow game={g} /></li>)}
            </ul>
          </section>
        ))}
      </div>

      {results.data && days.length > 0 && <p className="mlb-updated tnum">{t('mlb.updated', { time: time(results.data.updatedAt) })}</p>}
    </div>
  )
}

function useStatus(game: MlbGame) {
  const { t } = useI18n()
  const live = game.status === 'Live'
  const innings = game.inning ?? 9
  const status = live
    ? `${t('mlb.live')} · ${t('mlb.inning', { half: game.inningHalf === 'Bottom' ? t('mlb.bottom') : t('mlb.top'), n: innings })}`
    : innings > 9 ? t('mlb.finalExtra', { innings }) : t('mlb.final')
  const series = [game.seriesDescription, game.seriesGameNumber ? t('mlb.game', { n: game.seriesGameNumber }) : null].filter(Boolean).join(' · ')
  // Saison régulière : le libellé « Regular Season » n'apporte rien ; on ne l'affiche que pour les séries (et le camp d'entraînement).
  return { live, status, series: game.gameType !== 'R' && series.length > 0 ? series : null }
}

function Status({ game }: { game: MlbGame }) {
  const { live, status, series } = useStatus(game)
  return (
    <>
      <span className={live ? 'mlb-status live' : 'mlb-status'}>{live && <span className="mlb-live-dot" aria-hidden />}{status}</span>
      {series && <span className={`mlb-series ${seriesClass(game.gameType)}`}>{series}</span>}
    </>
  )
}

/** Le dernier match, en grand : logos, score, et la feuille de match manche par manche avec P / CS / E. */
function Featured({ game }: { game: MlbGame }) {
  const { t } = useI18n()
  const final = game.status !== 'Live'
  const innings = game.innings ?? []
  // Au moins neuf colonnes, comme un vrai tableau d'affichage ; les manches supplémentaires s'ajoutent.
  const columns = Array.from({ length: Math.max(9, innings.length) }, (_, i) => innings[i] ?? { number: i + 1, awayRuns: null, homeRuns: null })
  const rows: [MlbTeam, 'away' | 'home'][] = [[game.away, 'away'], [game.home, 'home']]

  return (
    <section className="mlb-featured" style={teamVars(game)} aria-labelledby="mlb-featured-title">
      <header className="mlb-featured-head">
        <h2 id="mlb-featured-title" className="mlb-featured-label">{t('mlb.featured')}</h2>
        <div className="mlb-game-head"><Status game={game} /></div>
      </header>

      <div className="mlb-featured-score">
        {rows.map(([team, side], i) => (
          <div key={side} className={`mlb-featured-team ${side}${final && team.isWinner ? ' is-winner' : ''}`} style={{ '--team': `var(--${side})` } as CSSProperties}>
            <img className="mlb-featured-logo" src={team.logoUrl} alt="" width={84} height={84} onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
            <span className="mlb-featured-name">{team.name}</span>
            {team.record && <span className="mlb-record tnum">{team.record}</span>}
            <span className="mlb-featured-runs tnum">{team.score ?? '–'}</span>
            {i === 0 && <span className="mlb-featured-vs" aria-hidden>@</span>}
          </div>
        ))}
      </div>

      {innings.length > 0 && (
        <div className="mlb-linescore-wrap">
          <table className="mlb-linescore tnum">
            <caption className="visually-hidden">{t('mlb.lineScore', { away: game.away.name, home: game.home.name })}</caption>
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">{t('mlb.team')}</span></th>
                {columns.map(c => <th key={c.number} scope="col">{c.number}</th>)}
                <th scope="col" className="tot"><abbr title={t('mlb.colRunsLong')}>{t('mlb.colRuns')}</abbr></th>
                <th scope="col" className="tot"><abbr title={t('mlb.colHitsLong')}>{t('mlb.colHits')}</abbr></th>
                <th scope="col" className="tot"><abbr title={t('mlb.colErrorsLong')}>{t('mlb.colErrors')}</abbr></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([team, side]) => (
                <tr key={side} style={{ '--team': `var(--${side})` } as CSSProperties} className={final && team.isWinner ? 'is-winner' : undefined}>
                  <th scope="row">{team.abbreviation}</th>
                  {columns.map(c => {
                    const runs = side === 'away' ? c.awayRuns : c.homeRuns
                    return <td key={c.number} className={runs ? 'scored' : undefined}>{runs ?? (c.number <= innings.length ? 'X' : '')}</td>
                  })}
                  <td className="tot runs">{team.score ?? '–'}</td>
                  <td className="tot">{team.hits ?? '–'}</td>
                  <td className="tot">{team.errors ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {game.venue && <p className="mlb-venue">{game.venue}</p>}
    </section>
  )
}

function GameRow({ game }: { game: MlbGame }) {
  const { t } = useI18n()
  const live = game.status === 'Live'
  return (
    <article className={`mlb-game${live ? ' is-live' : ''}`} style={teamVars(game)} aria-label={t('mlb.matchup', { away: game.away.name, home: game.home.name })}>
      <header className="mlb-game-head"><Status game={game} /></header>
      {/* Une ligne par match : visiteurs à gauche, locaux à droite, les deux scores face à face au centre. */}
      <TeamRow team={game.away} side="away" final={!live} />
      <span className="mlb-vs" aria-hidden>–</span>
      <TeamRow team={game.home} side="home" final={!live} />
      {game.venue && <p className="mlb-venue">{game.venue}</p>}
    </article>
  )
}

function TeamRow({ team, side, final }: { team: MlbTeam; side: 'away' | 'home'; final: boolean }) {
  const { t } = useI18n()
  // Le gagnant ressort ; en cours de match, personne n'a encore gagné.
  const lead = final && team.isWinner
  return (
    <div className={`mlb-team side-${side}${lead ? ' is-winner' : ''}${final && !team.isWinner ? ' is-loser' : ''}`} style={{ '--team': `var(--${side})` } as CSSProperties}>
      <img className="mlb-logo" src={team.logoUrl} alt="" width={30} height={30} loading="lazy"
        onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
      <span className="mlb-name">
        <span className="mlb-full">{team.name}</span>
        <abbr className="mlb-abbr" title={team.name}>{team.abbreviation}</abbr>
        {lead && <abbr className="mlb-win" title={t('mlb.winLong')}>{t('mlb.win')}</abbr>}
      </span>
      <span className="mlb-rhe tnum" aria-label={`${t('mlb.colHitsLong')} ${team.hits ?? '–'}, ${t('mlb.colErrorsLong')} ${team.errors ?? '–'}`}>
        {team.hits ?? '–'}<span aria-hidden>·</span>{team.errors ?? '–'}
      </span>
      <span className="mlb-score tnum">{team.score ?? '–'}</span>
    </div>
  )
}
