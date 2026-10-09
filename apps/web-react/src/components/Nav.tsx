import { BookOpen, Clapperboard, Home, LifeBuoy, Languages, ListVideo, LogOut, PlusCircle, Search, Settings2, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { usePopover } from '../hooks/usePopover'
import { useAuth } from '../state/auth'
import { useUI } from '../state/ui'
import { useQuery } from '@tanstack/react-query'
import { api, call } from '../lib/api'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'
import './Shell.css'

export function Logo() {
  return <span className="logo serif" aria-label="Divertiflix">Divertiflix<i aria-hidden /></span>
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export function Nav() {
  const { t, locale, setLocale } = useI18n()
  const { user, profileId, selectProfile, logout, isStaff } = useAuth()
  const { setPaletteOpen, setAssistantOpen, assistantOpen, openRequest, openSupport } = useUI()
  const navigate = useNavigate()
  const menu = usePopover()
  const [scrolled, setScrolled] = useState(false)
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => call(api.GET('/api/profiles')), enabled: !!user })
  const profile = profiles.data?.find(p => p.id === profileId)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const links = [
    { to: '/', label: t('nav.home'), icon: Home, end: true },
    { to: '/films', label: t('nav.films'), icon: Clapperboard },
    { to: '/livres-audio', label: t('nav.audiobooks'), icon: BookOpen },
    { to: '/ma-liste', label: t('nav.myList'), icon: ListVideo },
  ]

  return (
    <>
      <header className="nav" data-scrolled={scrolled}>
        <Link to="/" className="nav-logo" aria-label={t('nav.homeAria')}><Logo /></Link>
        <nav className="nav-links" aria-label={t('nav.main')}>
          {links.map(l => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
        </nav>
        <div className="nav-spacer" />
        <button className="nav-search" onClick={() => setPaletteOpen(true)} aria-label={t('nav.search')}>
          <Search aria-hidden /><span>{t('nav.searchPlaceholder')}</span><kbd className="kbd">{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <button className="icon-btn plain nav-search-icon" onClick={() => setPaletteOpen(true)} aria-label={t('nav.search')}><Search /></button>
        <button className="btn btn-glass btn-sm nav-assistant" onClick={() => setAssistantOpen(!assistantOpen)} aria-pressed={assistantOpen} aria-label={t('nav.assistant')}>
          <Sparkles aria-hidden /><span>{t('nav.assistantShort')}</span>
        </button>
        <NotificationBell />
        <div className="popover-root" ref={menu.ref}>
          <button className="nav-avatar" data-popover-trigger aria-expanded={menu.open} aria-haspopup="menu" aria-label={t('nav.account', { name: profile?.name ?? user?.email ?? '' })} onClick={() => menu.setOpen(!menu.open)}>
            <Avatar name={profile?.name ?? user?.email ?? '?'} size={34} />
          </button>
          {menu.open && (
            <div className="popover glass-panel menu" role="menu">
              <div className="menu-head">
                <Avatar name={profile?.name ?? '?'} size={40} />
                <div><strong>{profile?.name}</strong><span>{user?.email}</span></div>
              </div>
              <button role="menuitem" onClick={() => { menu.close(); selectProfile(null); navigate('/profils') }}><UserRound aria-hidden />{t('menu.switchProfile')}</button>
              <button role="menuitem" onClick={() => { menu.close(); openRequest() }}><PlusCircle aria-hidden />{t('menu.request')}</button>
              <button role="menuitem" onClick={() => { menu.close(); openSupport() }}><LifeBuoy aria-hidden />{t('menu.help')}</button>
              <button role="menuitem" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}><Languages aria-hidden />{locale === 'fr' ? 'English' : 'Français'}</button>
              {isStaff && <a role="menuitem" href="/admin/"><Settings2 aria-hidden />{t('menu.backoffice')}</a>}
              <hr />
              <button role="menuitem" onClick={() => { menu.close(); logout(); navigate('/connexion') }}><LogOut aria-hidden />{t('menu.logout')}</button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile : barre d'onglets en bas, à portée du pouce. */}
      <nav className="tabbar" aria-label={t('nav.main')}>
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.end}><l.icon aria-hidden /><span>{l.label}</span></NavLink>
        ))}
        <button onClick={() => setAssistantOpen(!assistantOpen)} aria-pressed={assistantOpen}><Sparkles aria-hidden /><span>{t('nav.assistantShort')}</span></button>
      </nav>
    </>
  )
}
