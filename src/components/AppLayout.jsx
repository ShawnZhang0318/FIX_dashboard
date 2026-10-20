import {useEffect} from 'react';
import {config} from '../workflow.js';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useLanguage } from '../i18n.jsx';

const navigation = [
  { label: 'Inventory', to: '/inventory', icon: 'inventory' },
  { label: 'Analysis', to: '/analysis', icon: 'analysis' },
  { label: 'Exceptions', to: '/exceptions', icon: 'exceptions' },
  { label: 'Logs', to: '/logs', icon: 'logs' },
];

const pageNames = [
  { match: '/inventory', title: 'Inventory' },
  { match: '/analysis', title: 'Analysis' },
  { match: '/exceptions', title: 'Exceptions' },
  { match: '/logs', title: 'Logs' },
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
  const serverLogs = pathname.startsWith('/logs') && new URLSearchParams(search).get('source') !== 'browser';
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
              {item.label === 'Exceptions' && <span className="nav-link-dot" aria-hidden="true" />}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-card__icon" aria-hidden="true">
              <span />
            </span>
            <div>
              <span className="connection-card__label">{t('API connection')}</span>
              <strong>{t(config.localIntegration ? 'Local model integration' : config.mode==='mock'?'Mock demo':'Live API')}</strong>
            </div>
          </div>
          <div className="sidebar-caption">{t('Forecasting & Inventory Exceptions')}</div>
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
              {t(serverLogs ? 'Backend logs' : config.localIntegration ? 'Real model · Local SQLite' : config.mode==='mock'?'Mock demo':'Live API')}
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
          {!pathname.startsWith('/logs') && <div className="workflow-message workflow-notice">{t(config.localIntegration ? 'Local integration uses the trained model and a separate SQLite database. PostgreSQL is not connected. Historical analysis uses stock at the selected cutoff.' : config.mode==='mock'?'Synthetic fixtures only. No trained model or server database. Saved in this browser.':'Live API mode. Results come from the configured backend.')}</div>}
          <Outlet />
          <footer className="page-footer">
            <span>{t('Project F.I.X. · Demo workspace')}</span>
            <span>{t('Inventory decisions remain human-reviewed')}</span>
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
