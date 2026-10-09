import { ArrowLeft, Captions, Gauge, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings2, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type Hls from 'hls.js'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { Card, S } from '../lib/api'
import { saveProgress } from '../lib/progress'
import { Artwork } from './Art'
import './Player.css'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const VOLUME_KEY = 'divertiflix.volume'
type Menu = null | 'speed' | 'quality' | 'subs' | 'audio'
interface Level { index: number; height: number; bitrate: number }
interface Track { index: number; label: string }

function readVolume(): { volume: number; muted: boolean } {
  try { const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null') as { volume: number; muted: boolean } | null; if (v) return v } catch { /* défaut */ }
  return { volume: 0.8, muted: false }
}

interface Props {
  profileId: string
  title: S['TitleDto']
  playback: S['PlaybackDto']
  similar: Card[]
  onBack(): void
  onRetry(): void
}

/**
 * Lecteur plein écran : HLS (hls.js chargé à la demande, ou natif sous Safari), MP4 direct, reprise à la seconde près,
 * raccourcis clavier, qualité / vitesse / sous-titres / pistes audio quand le flux en propose, picture-in-picture,
 * et enregistrement de la progression (toutes les 10 s, à la pause, et même à la fermeture de l'onglet).
 */
export function Player({ profileId, title, playback, similar, onBack, onRetry }: Props) {
  const { t, clock } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  const hls = useRef<Hls | null>(null)
  const last = useRef({ pos: 0, dur: title.durationMinutes * 60 })
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const resumed = useRef(false)
  const started = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(title.durationMinutes * 60)
  const [buffered, setBuffered] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState(false)
  const [visible, setVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [rate, setRate] = useState(1)
  const [{ volume, muted }, setVol] = useState(readVolume)
  const [levels, setLevels] = useState<Level[]>([])
  const [level, setLevel] = useState(-1)
  const [subs, setSubs] = useState<Track[]>([])
  const [sub, setSub] = useState(-1)
  const [audios, setAudios] = useState<Track[]>([])
  const [audioTrack, setAudioTrack] = useState(0)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)

  // ------------------------------------------------------------------ Source
  useEffect(() => {
    const v = video.current!
    let cancelled = false
    let netRetries = 0, mediaRetries = 0
    resumed.current = false
    started.current = false
    setError(false); setBuffering(true); setEnded(false)

    async function init() {
      if (playback.kind === 'Hls') {
        const { default: HlsLib } = await import('hls.js') // ~500 Ko : chargé seulement à l'ouverture d'un film
        if (cancelled) return
        if (HlsLib.isSupported()) {
          const h = new HlsLib({ capLevelToPlayerSize: true, maxBufferLength: 40, startPosition: playback.startSeconds > 0 ? playback.startSeconds : -1 })
          hls.current = h
          h.on(HlsLib.Events.MANIFEST_PARSED, (_e, d) => {
            const ls = d.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })).filter(l => l.height > 0)
            setLevels(ls.length > 1 ? ls.sort((a, b) => b.height - a.height) : [])
          })
          h.on(HlsLib.Events.SUBTITLE_TRACKS_UPDATED, (_e, d) => setSubs(d.subtitleTracks.map((s, index) => ({ index, label: s.name || s.lang || `#${index + 1}` }))))
          h.on(HlsLib.Events.AUDIO_TRACKS_UPDATED, (_e, d) => setAudios(d.audioTracks.length > 1 ? d.audioTracks.map((a, index) => ({ index, label: a.name || a.lang || `#${index + 1}` })) : []))
          h.on(HlsLib.Events.ERROR, (_e, d) => {
            if (!d.fatal) return
            if (d.type === HlsLib.ErrorTypes.NETWORK_ERROR && netRetries++ < 2) h.startLoad()
            else if (d.type === HlsLib.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) h.recoverMediaError()
            else setError(true)
          })
          h.loadSource(playback.url)
          h.attachMedia(v)
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = playback.url   // Safari : HLS natif
        else setError(true)
      } else v.src = playback.url
    }
    void init()
    return () => { cancelled = true; hls.current?.destroy(); hls.current = null; v.removeAttribute('src'); v.load() }
  }, [playback.url, playback.kind, playback.startSeconds])

  // ------------------------------------------------------------------ Progression
  const flush = useCallback((keepalive = false, atEnd = false) => {
    const { pos, dur } = last.current
    if (dur > 0 && (pos > 2 || atEnd)) void saveProgress(profileId, title.id, atEnd ? dur : pos, dur, { keepalive })
  }, [profileId, title.id])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => flush(), 10_000)
    return () => clearInterval(id)
  }, [playing, flush])

  useEffect(() => {
    const onHide = () => flush(true)
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); flush(true) } // aussi en quittant la page de lecture
  }, [flush])

  // ------------------------------------------------------------------ Actions
  const toggle = useCallback(() => { const v = video.current; if (v) void (v.paused ? v.play().catch(() => undefined) : v.pause()) }, [])
  const seekTo = useCallback((s: number) => { const v = video.current; if (v) { v.currentTime = Math.max(0, Math.min(s, v.duration || s)); setEnded(false) } }, [])
  const skip = useCallback((d: number) => { const v = video.current; if (v) seekTo(v.currentTime + d) }, [seekTo])
  const setVolume = useCallback((vol: number, m = false) => {
    const v = video.current
    const clamped = Math.max(0, Math.min(1, vol))
    if (v) { v.volume = clamped; v.muted = m || clamped === 0 }
    setVol({ volume: clamped, muted: m || clamped === 0 })
    try { localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: clamped, muted: m || clamped === 0 })) } catch { /* défaut */ }
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void shell.current?.requestFullscreen?.().catch(() => undefined)
  }, [])
  const wake = useCallback(() => {
    setVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!video.current?.paused) setVisible(false) }, 3200)
  }, [])

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  useEffect(() => { const v = video.current; if (v) { v.volume = volume; v.muted = muted } }, [volume, muted])
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(clickTimer.current) }, [])

  // Contrôles système (clavier multimédia, écran de verrouillage).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: title.name, artist: 'Divertiflix', artwork: title.posterUrl ? [{ src: title.posterUrl, sizes: '480x720', type: 'image/webp' }] : [] })
    navigator.mediaSession.setActionHandler('play', toggle)
    navigator.mediaSession.setActionHandler('pause', toggle)
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10))
    navigator.mediaSession.setActionHandler('seekforward', () => skip(10))
    return () => { for (const a of ['play', 'pause', 'seekbackward', 'seekforward'] as const) navigator.mediaSession.setActionHandler(a, null) }
  }, [title.name, title.posterUrl, toggle, skip])

  // ------------------------------------------------------------------ Clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range')) return
      const k = e.key.toLowerCase()
      const handled = (fn: () => void) => { e.preventDefault(); wake(); fn() }
      if (k === ' ' || k === 'k') { if (el.tagName === 'BUTTON' && k === ' ') return; handled(toggle) }
      else if (k === 'j') handled(() => skip(-10))
      else if (k === 'l') handled(() => skip(10))
      else if (k === 'arrowleft' && el.tagName !== 'INPUT') handled(() => skip(-5))
      else if (k === 'arrowright' && el.tagName !== 'INPUT') handled(() => skip(5))
      else if (k === 'arrowup' && el.tagName !== 'INPUT') handled(() => setVolume(volume + 0.05))
      else if (k === 'arrowdown' && el.tagName !== 'INPUT') handled(() => setVolume(volume - 0.05))
      else if (k === 'm') handled(() => setVolume(volume || 0.8, !muted))
      else if (k === 'f') handled(toggleFullscreen)
      else if (k === 'c' && subs.length > 0) handled(() => setMenu(m => (m === 'subs' ? null : 'subs')))
      else if (k === '<' || k === ',') handled(() => changeRate(-1))
      else if (k === '>' || k === '.') handled(() => changeRate(1))
      else if (/^[0-9]$/.test(k) && el.tagName !== 'INPUT') handled(() => seekTo((duration * Number(k)) / 10))
      else if (k === 'escape' && !document.fullscreenElement) { if (menu) setMenu(null); else onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle, skip, wake, setVolume, volume, muted, toggleFullscreen, seekTo, duration, subs.length, menu, onBack, rate])

  const changeRate = (dir: 1 | -1) => {
    const i = SPEEDS.indexOf(rate)
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]!
    applyRate(next)
  }
  const applyRate = (r: number) => { setRate(r); if (video.current) video.current.playbackRate = r; setMenu(null) }

  const onBarHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHover({ x: ratio * 100, t: ratio * duration })
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) }
  }

  const volIcon = muted || volume === 0 ? <VolumeX /> : volume < 0.5 ? <Volume1 /> : <Volume2 />
  const pct = duration > 0 ? (time / duration) * 100 : 0

  return (
    <div className="player" ref={shell} data-visible={visible || !playing || !!menu} data-playing={playing} onMouseMove={wake} onTouchStart={wake} onFocus={wake}>
      <video
        ref={video} playsInline preload="auto" aria-label={title.name}
        onClick={() => { clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => { setMenu(null); toggle() }, 220) }}
        onDoubleClick={() => { clearTimeout(clickTimer.current); toggleFullscreen() }}
        onLoadedMetadata={e => {
          const v = e.currentTarget
          setDuration(v.duration)
          last.current.dur = v.duration
          if (!resumed.current) {
            resumed.current = true
            if (playback.startSeconds > 0 && v.duration > playback.startSeconds + 5) v.currentTime = playback.startSeconds
          }
        }}
        onCanPlay={() => { setBuffering(false); if (!started.current) { started.current = true; void video.current?.play().catch(() => undefined) } }}
        onPlay={() => { setPlaying(true); setEnded(false); wake() }}
        onPause={() => { setPlaying(false); setVisible(true); flush() }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onSeeked={() => setBuffering(false)}
        onTimeUpdate={e => {
          const v = e.currentTarget
          setTime(v.currentTime)
          last.current.pos = v.currentTime
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
        }}
        onEnded={() => { setEnded(true); setPlaying(false); flush(true, true) }}
        onError={() => { if (playback.kind !== 'Hls') setError(true) }}
      />

      <div className="pl-top">
        <button className="icon-btn" onClick={onBack} aria-label={t('player.back')}><ArrowLeft /></button>
        <h1 className="serif">{title.name}</h1>
      </div>

      {buffering && !error && !ended && <div className="pl-center" role="status"><span className="spinner" /><span className="visually-hidden">{t('common.loading')}</span></div>}
      {!playing && !buffering && !ended && !error && <button className="pl-bigplay" onClick={toggle} aria-label={t('player.play')}><Play fill="currentColor" /></button>}

      <div className="pl-bottom">
        <div className="pl-seek" onPointerMove={onBarHover} onPointerLeave={() => setHover(null)}>
          <div className="pl-track" aria-hidden>
            <i className="buf" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <i className="played" style={{ width: `${pct}%` }} />
          </div>
          {hover && <span className="pl-tip tnum" style={{ left: `${hover.x}%` }}>{clock(hover.t)}</span>}
          <input
            type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.floor(time)}
            onChange={e => seekTo(Number(e.target.value))}
            aria-label={t('player.seek')} aria-valuetext={t('player.position', { a: clock(time), b: clock(duration) })}
            style={{ ['--p' as string]: `${pct}%` }}
          />
        </div>

        <div className="pl-bar">
          <button className="icon-btn plain" onClick={toggle} aria-label={playing ? t('player.pause') : t('player.play')}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
          <button className="icon-btn plain" onClick={() => skip(-10)} aria-label={t('player.back10')}><RotateCcw /></button>
          <button className="icon-btn plain" onClick={() => skip(10)} aria-label={t('player.forward10')}><RotateCw /></button>
          <div className="pl-volume">
            <button className="icon-btn plain" onClick={() => setVolume(volume || 0.8, !muted)} aria-label={muted ? t('player.unmute') : t('player.mute')}>{volIcon}</button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => setVolume(Number(e.target.value))} aria-label={t('player.volume')} style={{ ['--p' as string]: `${(muted ? 0 : volume) * 100}%` }} />
          </div>
          <span className="pl-time tnum">{clock(time)} <em>/ {clock(duration)}</em></span>
          <span className="grow" />

          <div className="pl-menu-wrap" onKeyDown={onMenuKey}>
            <button className="icon-btn plain" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} aria-expanded={menu === 'speed'} aria-label={t('player.speed')} title={t('player.speed')}><Gauge /></button>
            {menu === 'speed' && <ul className="pl-menu glass-panel" role="menu">{SPEEDS.map(s => <li key={s}><button role="menuitemradio" aria-checked={rate === s} onClick={() => applyRate(s)}>{s === 1 ? t('player.normal') : `${s}×`}</button></li>)}</ul>}
          </div>
          {levels.length > 0 && (
            <div className="pl-menu-wrap" onKeyDown={onMenuKey}>
              <button className="icon-btn plain" onClick={() => setMenu(menu === 'quality' ? null : 'quality')} aria-expanded={menu === 'quality'} aria-label={t('player.quality')} title={t('player.quality')}><Settings2 /></button>
              {menu === 'quality' && (
                <ul className="pl-menu glass-panel" role="menu">
                  <li><button role="menuitemradio" aria-checked={level === -1} onClick={() => { if (hls.current) hls.current.currentLevel = -1; setLevel(-1); setMenu(null) }}>{t('player.auto')}</button></li>
                  {levels.map(l => <li key={l.index}><button role="menuitemradio" aria-checked={level === l.index} onClick={() => { if (hls.current) hls.current.currentLevel = l.index; setLevel(l.index); setMenu(null) }}>{l.height}p</button></li>)}
                </ul>
              )}
            </div>
          )}
          {subs.length > 0 && (
            <div className="pl-menu-wrap" onKeyDown={onMenuKey}>
              <button className="icon-btn plain" onClick={() => setMenu(menu === 'subs' ? null : 'subs')} aria-expanded={menu === 'subs'} aria-label={t('player.subtitles')} title={`${t('player.subtitles')} (C)`}><Captions /></button>
              {menu === 'subs' && (
                <ul className="pl-menu glass-panel" role="menu">
                  <li><button role="menuitemradio" aria-checked={sub === -1} onClick={() => { if (hls.current) hls.current.subtitleTrack = -1; setSub(-1); setMenu(null) }}>{t('player.off')}</button></li>
                  {subs.map(s => <li key={s.index}><button role="menuitemradio" aria-checked={sub === s.index} onClick={() => { if (hls.current) hls.current.subtitleTrack = s.index; setSub(s.index); setMenu(null) }}>{s.label}</button></li>)}
                </ul>
              )}
            </div>
          )}
          {audios.length > 0 && (
            <div className="pl-menu-wrap" onKeyDown={onMenuKey}>
              <button className="icon-btn plain" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} aria-expanded={menu === 'audio'} aria-label={t('player.audio')} title={t('player.audio')}><Volume2 /></button>
              {menu === 'audio' && <ul className="pl-menu glass-panel" role="menu">{audios.map(a => <li key={a.index}><button role="menuitemradio" aria-checked={audioTrack === a.index} onClick={() => { if (hls.current) hls.current.audioTrack = a.index; setAudioTrack(a.index); setMenu(null) }}>{a.label}</button></li>)}</ul>}
            </div>
          )}
          {document.pictureInPictureEnabled && <button className="icon-btn plain pl-pip" onClick={() => { if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void video.current?.requestPictureInPicture().catch(() => undefined) }} aria-label={t('player.pip')} title={t('player.pip')}><PictureInPicture2 /></button>}
          <button className="icon-btn plain" onClick={toggleFullscreen} aria-label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')} title={`${fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')} (F)`}>{fullscreen ? <Minimize /> : <Maximize />}</button>
        </div>
      </div>

      {ended && (
        <div className="pl-end" role="dialog" aria-label={t('player.endTitle')}>
          <p className="eyebrow">{t('player.endEyebrow')}</p>
          <h2 className="serif">{title.name}</h2>
          <div className="pl-end-actions">
            <button className="btn btn-primary" onClick={() => { seekTo(0); void video.current?.play() }} data-autofocus><RotateCcw aria-hidden />{t('player.replay')}</button>
            <button className="btn btn-glass" onClick={onBack}>{t('player.backToCatalog')}</button>
          </div>
          {similar.length > 0 && (
            <>
              <p className="eyebrow pl-end-next">{t('player.next')}</p>
              <ul className="pl-end-list">
                {similar.slice(0, 4).map(c => (
                  <li key={c.title.id}>
                    <Link to={`/titres/${c.title.id}`} replace>
                      <span className="pl-end-art"><Artwork src={c.title.posterUrl} seed={c.title.id} genre={c.title.genre} ratio={c.title.kind === 'Audiobook' ? 'square' : 'poster'} /></span>
                      <span className="serif">{c.title.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="pl-end" role="alert">
          <h2 className="serif">{t('player.errorTitle')}</h2>
          <p>{t('player.errorHelp')}</p>
          <div className="pl-end-actions">
            <button className="btn btn-primary" onClick={onRetry} data-autofocus><RotateCcw aria-hidden />{t('common.retry')}</button>
            <button className="btn btn-glass" onClick={onBack}>{t('player.back')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
