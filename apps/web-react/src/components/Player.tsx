import Hls from 'hls.js'
import { useEffect, useRef } from 'react'

/** Lecteur HLS : hls.js sauf Safari qui lit le .m3u8 nativement. */
export function Player({ src, poster }: { src: string; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = src; return }
    if (!Hls.isSupported()) return
    const hls = new Hls()
    hls.loadSource(src)
    hls.attachMedia(video)
    return () => hls.destroy()
  }, [src])

  return <video ref={ref} controls poster={poster ?? undefined} className="player" />
}
