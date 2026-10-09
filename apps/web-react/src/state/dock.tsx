import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, call, type Title } from '../lib/api'
import { saveProgress } from '../lib/progress'
import { useAuth } from './auth'
import { useToast } from './toast'
import { useI18n } from '../i18n'

export interface DockItem { titleId: string; name: string; author?: string | null; poster?: string | null }

interface DockState {
  current: DockItem | null
  playing: boolean
  position: number
  duration: number
  rate: number
  buffering: boolean
  play(title: Pick<Title, 'id' | 'name' | 'author' | 'posterUrl'>): Promise<void>
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
  const [current, setCurrent] = useState<DockItem | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRateState] = useState(1)
  const [buffering, setBuffering] = useState(false)
  const lastSaved = useRef(0)
  const startAt = useRef(0)

  const persist = useCallback((keepalive = false) => {
    const a = audio.current
    if (!a || !current || !profileId || !a.duration) return
    void saveProgress(profileId, current.titleId, a.currentTime, a.duration, { keepalive })
  }, [current, profileId])

  useEffect(() => {
    document.documentElement.style.setProperty('--dock-h', current ? DOCK_HEIGHT : '0px')
    return () => { document.documentElement.style.setProperty('--dock-h', '0px') }
  }, [current])

  // Sauvegarde périodique et à la fermeture de l'onglet.
  useEffect(() => {
    const onHide = () => persist(true)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [persist])

  // Un changement de compte ou de profil arrête l'écoute : ce que l'on écoute appartient à un profil.
  useEffect(() => { if (!profileId) { audio.current?.pause(); setCurrent(null) } }, [profileId])

  const play = useCallback(async (title: Pick<Title, 'id' | 'name' | 'author' | 'posterUrl'>) => {
    try {
      const pb = await call(api.GET('/api/titles/{id}/playback', { params: { path: { id: title.id }, query: { profileId: profileId ?? undefined } } }))
      persist()
      startAt.current = pb.startSeconds
      setCurrent({ titleId: title.id, name: title.name, author: title.author, poster: title.posterUrl })
      const a = audio.current!
      a.src = pb.url
      a.playbackRate = rate
      await a.play().catch(() => undefined)
    } catch {
      toast.push({ kind: 'error', text: t('dock.error') })
    }
  }, [profileId, persist, rate, toast, t])

  const value = useMemo<DockState>(() => ({
    current, playing, position, duration, rate, buffering, play,
    toggle: () => { const a = audio.current; if (a) void (a.paused ? a.play() : a.pause()) },
    seek: s => { if (audio.current) audio.current.currentTime = Math.max(0, Math.min(s, audio.current.duration || s)) },
    skip: d => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min(a.currentTime + d, a.duration || Infinity)) },
    setRate: r => { setRateState(r); if (audio.current) audio.current.playbackRate = r },
    close: () => { persist(); audio.current?.pause(); if (audio.current) audio.current.removeAttribute('src'); audio.current?.load(); setCurrent(null); setPlaying(false) },
  }), [current, playing, position, duration, rate, buffering, play, persist])

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
        onError={() => { if (current) toast.push({ kind: 'error', text: t('dock.error') }) }}
      />
    </Ctx.Provider>
  )
}

export function useDock() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDock hors DockProvider')
  return c
}
