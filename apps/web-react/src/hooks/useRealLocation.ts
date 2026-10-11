import { createContext, useContext } from 'react'
import { useLocation, type Location } from 'react-router-dom'

/**
 * Vraie adresse du routeur, posée par AppRoutes. Dans la coque, rendue par `<Routes location={background}>`, useLocation() renvoie la page
 * d'arrière-plan et jamais la fiche ouverte par-dessus : or titleLink doit savoir si une fiche est déjà ouverte pour la remplacer au lieu de l'empiler.
 */
export const RealLocation = createContext<Location | null>(null)

/** La vraie adresse, y compris sous la coque ; hors AppRoutes (composant isolé), celle du routeur le plus proche. */
export function useRealLocation(): Location {
  const real = useContext(RealLocation)
  const here = useLocation()
  return real ?? here
}
