/**
 * Couleurs des 30 équipes de la MLB (identifiants de statsapi.mlb.com), choisies pour rester lisibles sur le fond sombre du portail :
 * la couleur officielle quand elle est assez claire, sinon la couleur secondaire de l'équipe (ex. l'or des Brewers, l'orange des Tigers).
 */
const COLORS: Record<number, string> = {
  108: '#e0233e', // Angels
  109: '#e3254b', // Diamondbacks
  110: '#ff6a1a', // Orioles
  111: '#e0353f', // Red Sox
  112: '#3d74e0', // Cubs
  113: '#e8102e', // Reds
  114: '#f0384e', // Guardians
  115: '#8f5fd6', // Rockies
  116: '#fa4616', // Tigers
  117: '#f57c2b', // Astros
  118: '#3b8ae6', // Royals
  119: '#2f8fe0', // Dodgers
  120: '#e0262e', // Nationals
  121: '#ff6b1f', // Mets
  133: '#efb21e', // Athletics
  134: '#fdb827', // Pirates
  135: '#ffc425', // Padres
  136: '#18b3b3', // Mariners
  137: '#fd5a1e', // Giants
  138: '#e22a4d', // Cardinals
  139: '#8fbce6', // Rays
  140: '#e8293a', // Rangers
  141: '#3b7fe0', // Blue Jays
  142: '#e2244f', // Twins
  143: '#f02d33', // Phillies
  144: '#e8264f', // Braves
  145: '#c4ced4', // White Sox
  146: '#00a3e0', // Marlins
  147: '#5b8de0', // Yankees
  158: '#ffc52f', // Brewers
}

/** Couleur d'accent de l'équipe ; l'accent du portail pour une équipe inconnue (match des étoiles, équipe d'exhibition…). */
export const teamColor = (id: number) => COLORS[id] ?? 'var(--accent-hi)'
