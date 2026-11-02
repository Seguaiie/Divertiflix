import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type Hls from 'hls.js'
import { api, call, type Title } from '../lib/api'
import { saveProgress } from '../lib/progress'
import { useAuth } from './auth'
import { useToast } from './toast'
import { useI18n } from '../i18n'

export interface DockItem { titleId: string; name: string; author?: string | null; poster?: string | null }
export interface Chapter { title: string; start: number; end: number }

interface DockState {
  current: DockItem | null
  playing: boolean
  position: number
  duration: number
  rate: number
  buffering: boolean
  /** Chapitres du livre en cours (vide si le livre n'en a pas). */
  chapters: Chapter[]
  /** Vrai quand la page d'écoute occupe l'écran : la barre du bas s'efface pour ne pas la doubler. */
  hidden: boolean
  setHidden(hidden: boolean): void
  /** Charge le livre et lance l'écoute ; faux si l'URL de lecture n'a pas pu être obtenue. */
  play(title: Pick<Title, 'id' | 'name' | 'author' | 'posterUrl'>): Promise<boolean>
  /** Met l'écoute en pause sans fermer le lecteur : la lecture d'un film ne doit pas se superposer à un livre audio. */
  pause(): void
  toggle(): void
  seek(seconds: number): void
  skip(delta: number): void
  setRate(r: number): void
  close(): void
}

const Ctx = createContext<DockState | null>(null)
const DOCK_HEIGHT = '84px'

/**
 * Lecteur audio persistant : un seul élément <audio> vit au-dessus du routeur, donc l'écoute continue quand on navigue.
 * La position est enregistrée comme celle d'un film (reprise sur n'importe quel appareil).
 */
export function DockProvider({ children }: { children: ReactNode }) {
  const { profileId } = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const audio = useRef<HTMLAudioElement | null>(null)
  const hls = useRef<Hls | null>(null)
  const [current, setCurrent] = useState<DockItem | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRateState] = useState(1)
  const [buffering, setBuffering] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [hidden, setHidden] = useState(false)
  const lastSaved = useRef(0)
  const startAt = useRef(0)

  const persist = useCallback((keepalive = false) => {
    const a = audio.current
    if (!a || !current || !profileId || !a.duration) return
    void saveProgress(profileId, current.titleId, a.currentTime, a.duration, { keepalive })
  }, [current, profileId])

  useEffect(() => {
    document.documentElement.style.setProperty('--dock-h', current && !hidden ? DOCK_HEIGHT : '0px')
    return () => { document.documentElement.style.setProperty('--dock-h', '0px') }
  }, [current, hidden])

  // Sauvegarde périodique et à la fermeture de l'onglet.
  useEffect(() => {
    const onHide = () => persist(true)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [persist])

  // Un changement de compte ou de profil arrête l'écoute : ce que l'on écoute appartient à un profil. Y compris d'un profil directement à un autre
  // (un autre compte ouvert dans un autre onglet), sinon la position du livre serait enregistrée dans le profil du nouveau compte.
  useEffect(() => { audio.current?.pause(); setCurrent(null) }, [profileId])

  const pause = useCallback(() => { audio.current?.pause() }, [])

  const play = useCallback(async (title: Pick<Title, 'id' | 'name' | 'author' | 'posterUrl'>) => {
    try {
      const pb = await call(api.GET('/api/titles/{id}/playback', { params: { path: { id: title.id }, query: { profileId: profileId ?? undefined } } }))
      persist()
      startAt.current = pb.startSeconds
      setChapters((pb.chapters ?? []).map(c => ({ title: c.title, start: c.startSeconds, end: c.endSeconds })))
      setCurrent({ titleId: title.id, name: title.name, author: title.author, poster: title.posterUrl })
      const a = audio.current!
      hls.current?.destroy(); hls.current = null
      // Un livre Audiobookshelf arrive en flux HLS continu (tous les chapitres) : hls.js le lit dans le même élément <audio>.
      const HlsLib = pb.kind === 'Hls' ? (await import('hls.js')).default : null   // chargé à la demande, comme dans le lecteur vidéo
      if (HlsLib?.isSupported()) {
        const h = new HlsLib({
          startPosition: pb.startSeconds > 0 ? pb.startSeconds : -1,   // la reprise se fait au chargement, pas par un second déplacement
          // Livre audio seul : après un grand saut (chapitre), le navigateur met parfois plusieurs secondes à repartir alors que les données sont là.
          // hls.js abandonne après 3 petits décalages de 0,1 s ; on lui laisse plus de marge avant de parler d'échec.
          nudgeMaxRetry: 10,
          nudgeOffset: 0.2,
        })
        startAt.current = 0
        hls.current = h
        // Erreur fatale : on tente d'abord de repartir (rechargement des segments, puis reconstruction du tampon audio) à la même position.
        // Le message n'apparaît que si ces reprises échouent plusieurs fois de suite, et une seule fois.
        let recoveries: number[] = []
        let reported = false
        h.on(HlsLib.Events.ERROR, (_e, d) => {
          if (!d.fatal || hls.current !== h) return
          console.warn('[lecteur audio]', d.type, d.details, d.error?.message ?? '')
          const now = Date.now()
          recoveries = recoveries.filter(at => now - at < 60_000)
          if (recoveries.length < 4) {
            recoveries.push(now)
            if (d.type === HlsLib.ErrorTypes.NETWORK_ERROR) h.startLoad(a.currentTime)
            else if (d.type === HlsLib.ErrorTypes.MEDIA_ERROR) { h.recoverMediaError(); void a.play().catch(() => undefined) }
            else { h.loadSource(pb.url); h.startLoad(a.currentTime) }
            return
          }
          if (!reported) { reported = true; toast.push({ kind: 'error', text: t('dock.error') }) }
        })
        h.on(HlsLib.Events.FRAG_BUFFERED, () => { reported = false })
        h.loadSource(pb.url)
        h.attachMedia(a)
      } else a.src = pb.url   // fichier audio direct, ou HLS natif (Safari)
      a.playbackRate = rate
      await a.play().catch(() => undefined)
      return true
    } catch {
      toast.push({ kind: 'error', text: t('dock.error') })
      return false
    }
  }, [profileId, persist, rate, toast, t])

  const value = useMemo<DockState>(() => ({
    current, playing, position, duration, rate, buffering, chapters, hidden, setHidden, play, pause,
    toggle: () => { const a = audio.current; if (a) void (a.paused ? a.play() : a.pause()) },
    seek: s => { if (audio.current) audio.current.currentTime = Math.max(0, Math.min(s, audio.current.duration || s)) },
    skip: d => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min(a.currentTime + d, a.duration || Infinity)) },
    setRate: r => { setRateState(r); if (audio.current) audio.current.playbackRate = r },
    close: () => { persist(); audio.current?.pause(); hls.current?.destroy(); hls.current = null; if (audio.current) audio.current.removeAttribute('src'); audio.current?.load(); setCurrent(null); setPlaying(false); setChapters([]) },
  }), [current, playing, position, duration, rate, buffering, chapters, hidden, play, pause, persist])

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio
        ref={audio}
        preload="metadata"
        onLoadedMetadata={e => {
          setDuration(e.currentTarget.duration)
          if (startAt.current > 0) { e.currentTarget.currentTime = startAt.current; startAt.current = 0 }
        }}
        onTimeUpdate={e => {
          const a = e.currentTarget
          setPosition(a.currentTime)
          if (!a.paused && a.currentTime - lastSaved.current > 15) { lastSaved.current = a.currentTime; persist() }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); persist() }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onEnded={() => { if (profileId && current && audio.current) void saveProgress(profileId, current.titleId, audio.current.duration, audio.current.duration) }}
        // Avec hls.js, les erreurs du média passent par son propre gestionnaire (avec reprise) : ne pas afficher un second message.
        onError={() => { if (current && !hls.current) toast.push({ kind: 'error', text: t('dock.error') }) }}
      />
    </Ctx.Provider>
  )
}

export function useDock() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDock hors DockProvider')
  return c
}
