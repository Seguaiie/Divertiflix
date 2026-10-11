import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Fragment, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, type Location } from 'react-router-dom'
import { RealLocation } from './hooks/useRealLocation'
import { I18nProvider, useI18n } from './i18n'
import { AudioDock } from './components/AudioDock'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'
import { RequestDialog } from './components/RequestDialog'
import { SupportWidget } from './components/SupportWidget'
import { TitleModal } from './components/TitleModal'
import { BrowsePage } from './pages/BrowsePage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MyListPage } from './pages/MyListPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { AuthProvider, useAuth } from './state/auth'
import { DockProvider } from './state/dock'
import { RealtimeProvider } from './state/realtime'
import { ToastProvider } from './state/toast'
import { UIProvider, useUI } from './state/ui'

// Chargés à la demande : le lecteur (et hls.js) et l'assistant ne pèsent rien tant qu'on ne s'en sert pas.
const WatchPage = lazy(() => import('./pages/WatchPage').then(m => ({ default: m.WatchPage })))
const AssistantPanel = lazy(() => import('./components/AssistantPanel').then(m => ({ default: m.AssistantPanel })))

export const createQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
})

function Gate({ children }: { children: ReactNode }) {
  const { user, profileId } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/connexion" replace state={{ from: location }} />
  if (!profileId) return <Navigate to="/profils" replace />
  // key : un autre compte (ouvert dans un autre onglet) repart d'un écran neuf, sans la conversation de l'assistant ni le billet ouvert du précédent.
  return <Fragment key={user.id}>{children}</Fragment>
}

/** Fiche d'un titre en fenêtre par-dessus la page courante ; un lien direct ouvre la même fiche sur l'accueil. */
function TitleRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const hasBackground = !!(location.state as { background?: Location } | null)?.background
  // key : passer à un titre similaire remet la fenêtre à neuf (défilement en haut, focus sur l'action principale).
  return <TitleModal key={id} id={id} onClose={() => (hasBackground ? navigate(-1) : navigate('/', { replace: true }))} />
}

function Shell() {
  const { t } = useI18n()
  const location = useLocation()
  const main = useRef<HTMLElement>(null)
  const { support, openSupport, closeAll } = useUI()
  const { user } = useAuth()

  // Les dialogues vivent dans la coque : en la quittant (lecture, connexion, autre compte), aucun ne doit rester « ouvert » pour resurgir au retour.
  useEffect(() => closeAll, [closeAll])

  // Navigation SPA : le focus revient en haut du contenu et les lecteurs d'écran annoncent le changement de page.
  const path = (location.state as { background?: Location } | null)?.background?.pathname ?? location.pathname
  const lastPath = useRef(path) // comparer au chemin précédent (et non un drapeau « premier rendu ») reste correct quand React rejoue les effets en développement
  useEffect(() => {
    if (lastPath.current === path) return
    lastPath.current = path
    window.scrollTo({ top: 0 })
    main.current?.focus({ preventScroll: true })
  }, [path])

  // Lien profond vers un billet (?aide=<id>) depuis une notification.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('aide')
    if (id && user && !support.open) openSupport(id)
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <a className="skip-link" href="#main">{t('a11y.skip')}</a>
      <Nav />
      <main id="main" className="app-main" tabIndex={-1} ref={main}>
        <ErrorBoundary fallback={retry => <div className="page"><div className="empty"><h2>{t('home.error')}</h2><button className="btn btn-primary" onClick={retry}>{t('common.retry')}</button></div></div>}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer />
      <Suspense fallback={null}><AssistantPanel /></Suspense>
      <SupportWidget />
      <CommandPalette />
      <RequestDialog />
      <AudioDock />
    </>
  )
}

export function AppRoutes() {
  const location = useLocation()
  const { user } = useAuth()
  const background = (location.state as { background?: Location } | null)?.background
  return (
    <RealLocation.Provider value={location}>
      <Routes location={background ?? location}>
        <Route path="/connexion" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/profils" element={user ? <ProfilesPage /> : <Navigate to="/connexion" replace />} />
        <Route path="/regarder/:id" element={<Gate><Suspense fallback={<div className="player" role="status" />}><WatchPage /></Suspense></Gate>} />
        <Route element={<Gate><Shell /></Gate>}>
          <Route path="/" element={<HomePage />} />
          <Route path="/films" element={<BrowsePage kind="Movie" />} />
          <Route path="/livres-audio" element={<BrowsePage kind="Audiobook" />} />
          <Route path="/ma-liste" element={<MyListPage />} />
          <Route path="/titres/:id" element={<><HomePage /><TitleRoute /></>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      {background && (
        <Routes>
          <Route path="/titres/:id" element={<TitleRoute />} />
        </Routes>
      )}
    </RealLocation.Provider>
  )
}

export default function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <UIProvider>
                <RealtimeProvider>
                  <DockProvider>
                    <AppRoutes />
                  </DockProvider>
                </RealtimeProvider>
              </UIProvider>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  )
}
