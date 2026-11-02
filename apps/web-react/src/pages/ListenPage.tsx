import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Artwork } from '../components/Art'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useI18n } from '../i18n'
import { useDock } from '../state/dock'
import { useDetail } from '../state/queries'
import './ListenPage.css'

const RATES = [0.8, 1, 1.25, 1.5, 2]

/**
 * Page d'écoute d'un livre audio : le lecteur est dans le site (couverture, chapitres, vitesse), comme une page vidéo.
 * L'élément audio reste celui du DockProvider : l'écoute continue quand on quitte la page (la barre du bas reprend alors),
 * et la position est enregistrée par profil comme pour un film.
 */
export function ListenPage() {
  const { id = '' } = useParams()
  const { t, clock } = useI18n()
  const navigate = useNavigate()
  const d = useDock()
  const { play, setHidden } = d
  const detail = useDetail(id)
  const title = detail.data?.card.title
  useDocumentTitle(title?.name)
  const [failed, setFailed] = useState(false)
  const started = useRef<string | null>(null)
  const activeChapter = useRef<HTMLButtonElement>(null)

  // La barre du bas s'efface tant que cette page est à l'écran.
  useEffect(() => { setHidden(true); return () => setHidden(false) }, [setHidden])

  // Arrivée (clic, lien direct ou rechargement) : le livre se charge dans le lecteur, sauf s'il y est déjà.
  const loaded = d.current?.titleId === id
  useEffect(() => {
    if (!title || title.streamKind !== 'Audio' || loaded || started.current === title.id) return
    started.current = title.id
    setFailed(false)
    void play(title).then(ok => setFailed(!ok))
  }, [title, loaded, play])

  const chapters = loaded ? d.chapters : []
  let current = -1
  chapters.forEach((c, i) => { if (c.start <= d.position + 0.25) current = i })

  useEffect(() => { activeChapter.current?.scrollIntoView({ block: 'nearest' }) }, [current])

  if (detail.isError && !detail.data) return <ErrorBox title={t('player.errorTitle')} help={t('listen.error')} onBack={() => navigate('/livres-audio')} back={t('player.back')} />
  if (!title) return <div className="page" role="status"><span className="spinner" style={{ width: 36, height: 36 }} /><span className="visually-hidden">{t('common.loading')}</span></div>
  if (!title.isPlayable || title.streamKind !== 'Audio') return <ErrorBox title={t('player.unavailable')} help={t('player.unavailableHelp')} onBack={() => navigate('/livres-audio')} back={t('player.back')} />

  const pct = loaded && d.duration > 0 ? (d.position / d.duration) * 100 : 0
  const nextRate = RATES[(RATES.indexOf(d.rate) + 1) % RATES.length]!
  const goPrev = () => {
    if (current < 0) return d.seek(0)
    // Comme un lecteur de musique : après quelques secondes, « précédent » revient d'abord au début du chapitre.
    d.seek(d.position - chapters[current]!.start > 3 || current === 0 ? chapters[current]!.start : chapters[current - 1]!.start)
  }

  return (
    <div className="page listen">
      <section className="listen-main">
        <div className="listen-cover"><Artwork src={title.posterUrl} seed={title.id} genre={title.genre} ratio="square" priority /></div>
        <div className="listen-info">
          <h1 className="display">{title.name}</h1>
          <p className="listen-meta">{[title.author, title.narrator ? t('listen.narratedBy', { name: title.narrator }) : null].filter(Boolean).join(' · ')}</p>
          {current >= 0 && <p className="listen-chapter" aria-live="polite">{t('listen.chapter', { n: current + 1, total: chapters.length })} · {chapters[current]!.title}</p>}

          <div className="listen-seek">
            <span className="tnum">{clock(loaded ? d.position : 0)}</span>
            <input type="range" min={0} max={Math.max(1, Math.floor(d.duration))} step={1} value={loaded ? Math.floor(d.position) : 0} disabled={!loaded}
              onChange={e => d.seek(Number(e.target.value))} aria-label={t('player.seek')}
              aria-valuetext={t('player.position', { a: clock(d.position), b: clock(d.duration) })} style={{ ['--p' as string]: `${pct}%` }} />
            <span className="tnum" title={loaded ? t('listen.remaining', { time: clock(Math.max(0, d.duration - d.position)) }) : undefined}>{clock(loaded ? d.duration : title.durationMinutes * 60)}</span>
          </div>

          <div className="listen-controls">
            <button className="icon-btn plain" onClick={goPrev} disabled={!loaded || chapters.length === 0} aria-label={t('listen.prevChapter')}><SkipBack /></button>
            <button className="icon-btn plain" onClick={() => d.skip(-15)} disabled={!loaded} aria-label={t('dock.back15')}><RotateCcw /></button>
            <button className="icon-btn dock-play listen-play" onClick={loaded ? d.toggle : () => { started.current = null; setFailed(false); void play(title).then(ok => setFailed(!ok)) }}
              aria-label={d.playing && loaded ? t('player.pause') : t('player.play')}>
              {loaded && d.buffering ? <span className="spinner" /> : loaded && d.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            <button className="icon-btn plain" onClick={() => d.skip(15)} disabled={!loaded} aria-label={t('dock.forward15')}><RotateCw /></button>
            <button className="icon-btn plain" onClick={() => d.seek(chapters[current + 1]!.start)} disabled={!loaded || current < 0 || current + 1 >= chapters.length} aria-label={t('listen.nextChapter')}><SkipForward /></button>
            <button className="btn btn-ghost btn-sm tnum" onClick={() => d.setRate(nextRate)} disabled={!loaded} aria-label={t('player.speed')}>{d.rate}×</button>
          </div>
          {failed && <p className="listen-error" role="alert">{t('listen.error')}</p>}

          {title.synopsis && <p className="listen-synopsis">{title.synopsis}</p>}
          <Link className="listen-back" to={`/titres/${title.id}`}>{title.name}</Link>
        </div>
      </section>

      {chapters.length > 0 && (
        <aside className="listen-chapters" aria-label={t('listen.chapters')}>
          <h2>{t('listen.chapters')} <span className="tnum">{chapters.length}</span></h2>
          <ol>
            {chapters.map((c, i) => (
              <li key={i}>
                <button ref={i === current ? activeChapter : undefined} className={i === current ? 'is-current' : undefined} aria-current={i === current ? 'true' : undefined} onClick={() => d.seek(c.start)}>
                  <span className="tnum">{i + 1}</span><span className="listen-chapter-title">{c.title}</span><span className="tnum">{clock(c.start)}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  )
}

function ErrorBox({ title, help, back, onBack }: { title: string; help: string; back: string; onBack(): void }) {
  return (
    <div className="page"><div className="empty"><h2>{title}</h2><p>{help}</p><div className="row-flex"><button className="btn btn-primary" onClick={onBack}>{back}</button></div></div></div>
  )
}
