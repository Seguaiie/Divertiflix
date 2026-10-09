import { api } from './api'

/** Enregistre la position de lecture. keepalive permet l'envoi même pendant la fermeture de l'onglet. */
export function saveProgress(profileId: string, titleId: string, positionSeconds: number, durationSeconds: number, opts: { keepalive?: boolean } = {}) {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return Promise.resolve()
  return api.PUT('/api/profiles/{id}/progress/{titleId}', {
    params: { path: { id: profileId, titleId } },
    body: { positionSeconds: Math.floor(positionSeconds), durationSeconds: Math.round(durationSeconds) },
    keepalive: opts.keepalive,
  }).then(() => undefined, () => undefined) // une sauvegarde manquée ne doit jamais interrompre la lecture
}
