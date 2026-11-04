/** Couleur de chaque laboratoire d'IA (lisible sur le fond sombre) ; une teinte stable dérivée du nom pour les autres. */
const ORGS: Record<string, string> = {
  'OpenAI': '#19c37d',
  'Anthropic': '#e8875f',
  'Google DeepMind': '#5b9bff',
  'Google': '#5b9bff',
  'xAI': '#d5d9e6',
  'Meta': '#3d8bff',
  'Meta AI': '#3d8bff',
  'DeepSeek': '#6e8bff',
  'Alibaba': '#ff8a2a',
  'Mistral AI': '#ff6a2b',
  'Moonshot': '#a68bff',
  'Moonshot AI': '#a68bff',
  'Z.ai (Zhipu AI)': '#4d7dff',
  'ByteDance': '#36b3ff',
  'Amazon': '#ffa31a',
  'Microsoft': '#22b5f0',
  'NVIDIA': '#82c91e',
  'MiniMax': '#ff4f8b',
}

export function orgColor(org: string) {
  if (ORGS[org]) return ORGS[org]
  let h = 0
  for (const c of org) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 70% 65%)`
}
