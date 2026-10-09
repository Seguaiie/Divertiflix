import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBackend, installDemoFetch } from '../src/index'
import snapshot from '../data/snapshot.json'
import '../../../apps/web-react/src/styles/fonts.css'
import '../../../apps/web-react/src/styles/tokens.css'
import '../../../apps/web-react/src/styles/base.css'
import '../../../apps/web-react/src/styles/ui.css'
import './demo.css'
import { mountDemoBar } from './demo-bar'

// Le faux serveur doit être en place AVANT le premier rendu : les modules de l'application lisent la session au chargement.
installDemoFetch(createBackend(snapshot as never, { mediaBase: 'media/' }))

const { default: App } = await import('../../../apps/web-react/src/App.tsx')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

mountDemoBar({
  other: { label: 'Back-office', href: 'admin/index.html' },
  hint: "Démonstration sans serveur : tout fonctionne dans votre navigateur. Entrez n'importe quel courriel et mot de passe (root ouvre le back-office en administrateur). Ouvrez le back-office dans un autre onglet : une demande approuvée arrive ici en direct.",
})
