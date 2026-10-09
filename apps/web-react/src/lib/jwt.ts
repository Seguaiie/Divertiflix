/** Date d'expiration (secondes epoch) d'un JWT, ou null s'il est illisible. Aucune vérification : le serveur fait foi. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof json.exp === 'number' ? json.exp : null
  } catch { return null }
}
