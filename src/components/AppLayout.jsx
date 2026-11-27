import {useEffect} from 'react';
import {config} from '../workflow.js';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useLanguage } from '../i18n.jsx';

const navigation = [
  { label: 'Overview', to: '/overview', icon: 'overview' },
  { label: 'Inventory', to: '/inventory', icon: 'inventory' },
  { label: 'Analysis', to: '/analysis', icon: 'analysis' },
  { label: 'Review queue', to: '/exceptions', icon: 'exceptions' },
  { label: 'History & logs', to: '/logs', icon: 'logs' },
];

const pageNames = [
  { match: '/overview', title: 'Overview' },
  { match: '/inventory', title: 'Inventory' },
  { match: '/analysis', title: 'Analysis' },
  { match: '/exceptions', title: 'Review queue' },
  { match: '/logs', title: 'History & logs' },
];

function NavIcon({ name }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'overview') return <svg {...common}><rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/></svg>;
  if (name === 'logs') return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
  if (name === 'inventory') {
    return (
      <svg {...common}>
        <path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5z" />
        <path d="m4.5 8.8 7.5 4.3 7.5-4.3M12 13v7.5M8 6.3l8 4.6" />
      </svg>
    );
  }

  if (name === 'analysis') {
    return (
      <svg {...common}>
        <path d="M4 19.5h16" />
        <path d="M6.5 16V11m5.5 5V5m5.5 11v-7" />
        <path d="m5 8 6-4 5 4 4-3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 9v4.5m0 3.2h.01" />
    </svg>
  );
}

function getPageTitle(pathname, t) {
  return t(pageNames.find(({ match }) => pathname.startsWith(match))?.title ?? 'Workspace');
}

export default function AppLayout() {
  const { pathname, search } = useLocation();
  const serverLogs = pathname.startsWith('/logs') && new URLSearchParams(search).get('source') === 'backend';
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const { language, t, toggleLanguage } = useLanguage();
  const pageTitle = getPageTitle(pathname, t);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            F<span>.</span>
          </div>
          <div className="brand-copy">
            <strong>Project F.I.X.</strong>
            <span>{t('Inventory workspace')}</span>
          </div>
        </div>

        <div className="sidebar-section-label">{t('Workspace')}</div>
        <nav className="primary-nav" aria-label={t('Primary navigation')}>
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              key={item.to}
              to={item.to}
            >
              <NavIcon name={item.icon} />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-store"><span className="store-avatar">S</span><div><strong>{t('Store S001')}</strong><span>{t('Inventory & planning')}</span></div></div>
          <details className="connection-details"><summary>{t('Data connection')}</summary><p>{t(config.mode === 'mock' ? 'Synthetic demo data in this browser' : 'Results are loaded from the configured API.')}</p>{config.mode === 'live' && <code>{config.apiBaseUrl}</code>}<a href="#/logs?source=backend">{t('View task logs')} →</a></details>
        </div>
      </aside>

      <div className="workspace-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Project F.I.X.</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-badge">
              <span className="environment-badge__dot" />
              {t(serverLogs ? 'Backend logs' : config.mode==='mock'?'Mock demo':config.localIntegration?'Local API':'Live API')}
            </span>
            <button
              className="language-toggle"
              type="button"
              onClick={toggleLanguage}
              aria-label={t(language === 'en' ? 'Switch language to Simplified Chinese' : 'Switch language to English')}
              title={t(language === 'en' ? 'Switch language to Simplified Chinese' : 'Switch language to English')}
            >
              <GlobeIcon />
              <span>{language === 'en' ? '中文' : 'English'}</span>
            </button>
            <span className="team-avatar" aria-label="Group 5">G5</span>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
          <footer className="page-footer">
            <span>Project F.I.X. · {t('Inventory & planning')}</span>
            <span>{t(config.mode === 'mock' ? 'Synthetic demo data in this browser' : 'Inventory decisions remain human-reviewed')}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" />
    </svg>
  );
}
