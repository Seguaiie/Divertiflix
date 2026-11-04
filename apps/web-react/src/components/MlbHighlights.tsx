import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { useI18n } from '../i18n'
import { useDock } from '../state/dock'
import { useMlbHighlights } from '../state/queries'
import type { MlbHighlight } from '../lib/api'
import './MlbHighlights.css'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Lecteur des derniers faits saillants de la MLB (onglet « Domingo ») : la vidéo choisie, et la liste des clips à côté.
 * Les MP4 viennent directement de la MLB (mlb-cuts-diamond.mlb.com, autorisé par la politique de sécurité du site).
 * À la fin d'un clip, le suivant démarre ; lancer une vidéo met en pause le livre audio en cours.
 */
export function MlbHighlights() {
  const { t } = useI18n()
  const clips = useMlbHighlights()
  const { pause } = useDock()
  const video = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const [autoplay, setAutoplay] = useState(false)   // pas de démarrage tout seul à l'arrivée sur la page : seulement après un clic ou à la fin d'un clip

  const list = clips.data ?? []
  const current: MlbHighlight | undefined = list[index]

  useEffect(() => {
    const v = video.current
    if (!v || !current) return
    v.load()
    if (autoplay) void v.play().catch(() => undefined)
  }, [current, autoplay])

  if (clips.isPending) return <div className="mlb-hl mlb-hl-loading" aria-busy="true" />
  if (clips.isError) return <p className="mlb-hl-note" role="status">{t('mlb.highlightsError')}</p>
  if (!current) return <p className="mlb-hl-note">{t('mlb.highlightsEmpty')}</p>

  const choose = (i: number) => { setIndex(i); setAutoplay(true) }

  return (
    <section className="mlb-hl" aria-labelledby="mlb-hl-title">
      <h2 id="mlb-hl-title" className="mlb-hl-title">{t('mlb.highlights')}</h2>
      <div className="mlb-hl-stage">
        <video
          ref={video}
          className="mlb-hl-video"
          controls
          playsInline
          preload="metadata"
          poster={current.posterUrl ?? undefined}
          onPlay={pause}
          onEnded={() => { if (index + 1 < list.length) choose(index + 1) }}
        >
          <source src={current.videoUrl} type="video/mp4" />
        </video>
        <div className="mlb-hl-info">
          <p className="mlb-hl-meta">{current.matchup}{current.durationSeconds > 0 && <> · <span className="tnum">{clock(current.durationSeconds)}</span></>}</p>
          <h3 className="mlb-hl-headline">{current.title}</h3>
          {current.description && <p className="mlb-hl-desc">{current.description}</p>}
        </div>
      </div>

      <div className="mlb-hl-list">
        <h3 className="mlb-hl-list-title">{t('mlb.highlightsList')} <span className="tnum">{list.length}</span></h3>
        <ol>
          {list.map((c, i) => (
            <li key={c.id}>
              <button className={i === index ? 'is-current' : undefined} aria-current={i === index ? 'true' : undefined} onClick={() => choose(i)}>
                <span className="mlb-hl-thumb">
                  {c.posterUrl && <img src={c.posterUrl.replace('w_1920,h_1080', 'w_320,h_180')} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  <Play aria-hidden />
                </span>
                <span className="mlb-hl-item">
                  <span className="mlb-hl-item-title">{c.title}</span>
                  <span className="mlb-hl-item-meta">
                    {i === index ? t('mlb.playing') : c.matchup}{c.durationSeconds > 0 && <> · <span className="tnum">{clock(c.durationSeconds)}</span></>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
