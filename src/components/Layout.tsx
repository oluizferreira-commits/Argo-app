import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { MODULES } from '../app/modules'
import { TABS } from '../app/navigation'
import { useOnline } from '../hooks/useOnline'
import { Icon } from './Icon'
import { UpdatePrompt } from './UpdatePrompt'

const EXTRA_TITLES: Record<string, string> = { '/financeiro': 'Financeiro', '/mais': 'Módulos' }

export function Layout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const isHome = pathname === '/'
  const isTab = TABS.some((t) => t.path === pathname)
  const title = EXTRA_TITLES[pathname] ?? MODULES.find((m) => m.path === pathname)?.title ?? 'ARGO'

  return (
    <div className="app">
      <header className="header">
        {isHome ? (
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
            <div style={{ minWidth: 0 }}>
              <div className="brand-name">ARGO</div>
              <div className="brand-sub">Gestão Pecuária</div>
            </div>
          </div>
        ) : (
          <>
            {!isTab && (
              <button className="header-back" onClick={() => navigate(-1)} aria-label="Voltar">
                <Icon name="chevronLeft" size={26} />
              </button>
            )}
            <h1 className="header-title">{title}</h1>
          </>
        )}
        <span className={`net-pill${online ? '' : ' offline'}`} aria-live="polite">
          <Icon name={online ? 'cloud' : 'cloudOff'} size={16} />
          {online ? 'Online' : 'Offline'}
        </span>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navegação principal">
        {TABS.map((t) => (
          <NavLink key={t.path} to={t.path} end={t.path === '/'} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon name={t.icon} size={24} />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <UpdatePrompt />
    </div>
  )
}
