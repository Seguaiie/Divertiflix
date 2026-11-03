import { useI18n } from '../i18n'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useMlbResults } from '../state/queries'
import type { MlbGame, MlbTeam } from '../lib/api'
import './DomingoPage.css'

/** Onglet « Domingo » : derniers résultats de la MLB, journée par journée (la plus récente d'abord). */
export function DomingoPage() {
  const { t, locale } = useI18n()
  const results = useMlbResults()
  useDocumentTitle(t('nav.domingo'))

  // Les dates de la MLB sont des journées (« 2026-10-28 ») : affichées telles quelles, sans décalage de fuseau.
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  const days = results.data?.days ?? []
  return (
    <div className="page domingo">
      <header className="page-head">
        <p className="eyebrow">{t('mlb.eyebrow')}</p>
        <h1 className="display">{t('nav.domingo')}</h1>
        <p>{t('mlb.lead')}</p>
      </header>

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
            <h2 id={`mlb-${day.date}`} className="mlb-day-title">{dayLabel(day.date)}</h2>
            <ul className="mlb-games">
              {day.games.map(g => <li key={g.id}><GameCard game={g} /></li>)}
            </ul>
          </section>
        ))}
      </div>

      {results.data && days.length > 0 && <p className="mlb-updated tnum">{t('mlb.updated', { time: time(results.data.updatedAt) })}</p>}
    </div>
  )
}

function GameCard({ game }: { game: MlbGame }) {
  const { t } = useI18n()
  const live = game.status === 'Live'
  const innings = game.inning ?? 9
  const status = live
    ? `${t('mlb.live')} · ${t('mlb.inning', { half: game.inningHalf === 'Bottom' ? t('mlb.bottom') : t('mlb.top'), n: innings })}`
    : innings > 9 ? t('mlb.finalExtra', { innings }) : t('mlb.final')
  const series = [game.seriesDescription, game.seriesGameNumber ? t('mlb.game', { n: game.seriesGameNumber }) : null].filter(Boolean).join(' · ')
  // Saison régulière : le libellé « Regular Season » n'apporte rien ; on ne l'affiche que pour les séries (et le camp d'entraînement).
  const showSeries = game.gameType !== 'R' && series.length > 0

  return (
    <article className={`mlb-game${live ? ' is-live' : ''}`} aria-label={t('mlb.matchup', { away: game.away.name, home: game.home.name })}>
      <header className="mlb-game-head">
        <span className={live ? 'mlb-status live' : 'mlb-status'}>{status}</span>
        {showSeries && <span className="mlb-series">{series}</span>}
      </header>
      <TeamRow team={game.away} final={!live} />
      <TeamRow team={game.home} final={!live} />
      {game.venue && <p className="mlb-venue">{game.venue}</p>}
    </article>
  )
}

function TeamRow({ team, final }: { team: MlbTeam; final: boolean }) {
  // Le gagnant ressort ; en cours de match, personne n'a encore gagné.
  const lead = final && team.isWinner
  return (
    <div className={`mlb-team${lead ? ' is-winner' : ''}${final && !team.isWinner ? ' is-loser' : ''}`}>
      <img className="mlb-logo" src={team.logoUrl} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer"
        onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
      <span className="mlb-name">
        <span className="mlb-full">{team.name}</span>
        <abbr className="mlb-abbr" title={team.name}>{team.abbreviation}</abbr>
      </span>
      {team.record && <span className="mlb-record tnum">{team.record}</span>}
      <span className="mlb-score tnum">{team.score ?? '–'}</span>
    </div>
  )
}
