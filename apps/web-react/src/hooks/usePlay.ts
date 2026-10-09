import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, call, type Title } from '../lib/api'
import { useI18n } from '../i18n'
import { useDock } from '../state/dock'
import { useToast } from '../state/toast'
import { useAuth } from '../state/auth'

/**
 * Lance un titre selon la nature de sa source : film ou vidéo (page de lecture), livre audio (lecteur persistant),
 * lien externe (nouvel onglet), ou fiche si le titre n'est pas encore disponible.
 */
export function usePlayTitle() {
  const navigate = useNavigate()
  const location = useLocation()
  const dock = useDock()
  const toast = useToast()
  const { t } = useI18n()
  const { profileId } = useAuth()

  return useCallback((title: Title) => {
    if (!title.isPlayable) { navigate(`/titres/${title.id}`, { state: { background: location } }); return }
    if (title.streamKind === 'Audio') { void dock.play(title); return }
    if (title.streamKind === 'External') {
      // La fenêtre s'ouvre tout de suite (geste de l'utilisateur) puis reçoit l'adresse : sinon le navigateur bloque la fenêtre.
      const win = window.open('', '_blank')
      call(api.GET('/api/titles/{id}/playback', { params: { path: { id: title.id }, query: { profileId: profileId ?? undefined } } }))
        .then(pb => { if (win) { win.opener = null; win.location.href = pb.url } })
        .catch(() => { win?.close(); toast.push({ kind: 'error', text: t('play.error') }) })
      return
    }
    navigate(`/regarder/${title.id}`)
  }, [navigate, location, dock, toast, t, profileId])
}
