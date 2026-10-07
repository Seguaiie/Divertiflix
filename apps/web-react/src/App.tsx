import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { BrowsePage } from './pages/BrowsePage'
import { LoginPage } from './pages/LoginPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { TitlePage } from './pages/TitlePage'
import { WatchlistPage } from './pages/WatchlistPage'

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })

function Shell() {
  const { user, profileId, selectProfile, logout } = useAuth()
  if (!user) return <LoginPage />
  if (!profileId) return <ProfilesPage />
  return (
    <>
      <header className="nav">
        <Link to="/" className="logo">Divertiflix</Link>
        <Link to="/watchlist">Ma liste</Link>
        <span className="spacer" />
        <button className="link" onClick={() => selectProfile(null)}>Changer de profil</button>
        <button className="link" onClick={() => { queryClient.clear(); logout() }}>Déconnexion</button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/titles/:id" element={<TitlePage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter><Shell /></BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
