import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Sparkles, Film, Search, Wand2, Share2, CalendarDays, BarChart3, Settings as SettingsIcon,
  Menu, X, RefreshCw, Activity, ChevronRight, Play,
} from 'lucide-react';
import { useApp, readActiveJob } from './lib/store';
import { Toasts, Banner, Spinner } from './ui';
import Dashboard from './pages/Dashboard';
import NewProject from './pages/NewProject';
import MyClips from './pages/MyClips';
import Campaigns from './pages/Campaigns';
import Studio from './pages/Studio';
import SocialAccounts from './pages/SocialAccounts';
import Calendar from './pages/Calendar';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, title: 'Dashboard', sub: 'Your clipping operation at a glance' },
  { id: 'new', label: 'New Project', icon: Sparkles, title: 'New Project', sub: 'Import a video and configure the AI clipping pass' },
  { id: 'clips', label: 'My Clips', icon: Film, title: 'My Clips', sub: 'Every project and every rendered clip' },
  { id: 'campaigns', label: 'Campaign Research', icon: Search, title: 'Campaign Research', sub: 'Turn a product or campaign into content angles' },
  { id: 'studio', label: 'AI Video Studio', icon: Wand2, title: 'AI Video Studio', sub: 'Fine-cut, reframe and restyle a generated clip' },
  { id: 'social', label: 'Social Accounts', icon: Share2, title: 'Social Accounts', sub: 'Connected publishing destinations' },
  { id: 'calendar', label: 'Publishing Calendar', icon: CalendarDays, title: 'Publishing Calendar', sub: 'Schedule and publish clips' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, title: 'Analytics', sub: 'Measured data only — nothing estimated' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, title: 'Settings', sub: 'Defaults, providers and the processing backend' },
];

const MOBILE_TABS = ['dashboard', 'new', 'clips', 'calendar', 'settings'];

const readHash = () => {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return SECTIONS.some((s) => s.id === raw) ? raw : 'dashboard';
};

export default function App() {
  const { loading, loadError, toasts, dismissToast, refresh, engine, backend, projects } = useApp();
  const [route, setRoute] = useState(readHash);
  const [navOpen, setNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeJob] = useState(() => readActiveJob());

  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      setNavOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((id) => {
    window.location.hash = `#/${id}`;
    setRoute(id);
    setNavOpen(false);
  }, []);

  const section = useMemo(() => SECTIONS.find((s) => s.id === route) || SECTIONS[0], [route]);
  const Page = useMemo(() => {
    const map = {
      dashboard: Dashboard, new: NewProject, clips: MyClips, campaigns: Campaigns, studio: Studio,
      social: SocialAccounts, calendar: Calendar, analytics: Analytics, settings: SettingsIcon && Settings,
    };
    return map[route] || Dashboard;
  }, [route]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const engineTone = engine.status === 'online' ? 'on' : engine.status === 'offline' ? 'off' : '';
  const engineLabel =
    engine.status === 'online' ? 'Engine online' : engine.status === 'offline' ? 'Engine offline' : 'Checking engine…';

  const clipCount = projects.reduce((n, p) => n + (Array.isArray(p.clips) ? p.clips.length : 0), 0);

  return (
    <div className="app">
      {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" /> : null}

      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            <Play size={18} fill="#fff" strokeWidth={0} />
          </div>
          <div>
            <div className="brand-name">OPEN CLIPS AI</div>
            <div className="brand-sub">Clip · Caption · Publish</div>
          </div>
          <button type="button" className="btn ghost icon" style={{ marginLeft: 'auto', display: navOpen ? 'inline-flex' : 'none' }} onClick={() => setNavOpen(false)} aria-label="Close navigation">
            <X size={17} />
          </button>
        </div>

        <nav className="nav">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.id} type="button" className={`nav-item ${route === s.id ? 'active' : ''}`} onClick={() => go(s.id)} aria-current={route === s.id ? 'page' : undefined}>
                <Icon size={17} />
                {s.label}
                {s.id === 'clips' && clipCount ? <span className="nav-badge">{clipCount}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="engine-chip" title={backend.url || 'No backend URL configured'}>
            <span className={`dot ${engineTone}`} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{engineLabel}</span>
          </div>
          {!backend.configured ? (
            <button type="button" className="btn sm block" onClick={() => go('settings')}>
              Connect backend <ChevronRight size={13} />
            </button>
          ) : null}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon" onClick={() => setNavOpen(true)} aria-label="Open navigation" style={{ display: 'inline-flex' }}>
            <Menu size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.title}</h1>
            <div className="topbar-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.sub}</div>
          </div>
          <div className="topbar-actions">
            {activeJob?.jobId ? (
              <button type="button" className="btn sm" onClick={() => go('new')} title="A clipping job is in progress">
                <Activity size={14} /> Running
              </button>
            ) : null}
            <button type="button" className="btn icon ghost" onClick={doRefresh} aria-label="Refresh data" disabled={refreshing}>
              {refreshing ? <Spinner size={15} /> : <RefreshCw size={15} />}
            </button>
          </div>
        </header>

        <main className="page">
          {loadError ? (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="err">
                Could not load application state: {loadError}{' '}
                <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={doRefresh}>
                  Retry
                </button>
              </Banner>
            </div>
          ) : null}
          {loading ? (
            <div className="card" style={{ display: 'grid', placeItems: 'center', gap: 12, padding: 48 }}>
              <Spinner size={22} />
              <div className="muted small">Loading workspace…</div>
            </div>
          ) : (
            <div className="animate-in" key={route}>
              <Page go={go} />
            </div>
          )}
        </main>
      </div>

      <nav className="mobile-bar" aria-label="Primary">
        {MOBILE_TABS.map((id) => {
          const s = SECTIONS.find((x) => x.id === id);
          const Icon = s.icon;
          return (
            <button key={id} type="button" className={route === id ? 'on' : ''} onClick={() => go(id)} aria-current={route === id ? 'page' : undefined}>
              <Icon size={19} />
              <span>{s.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
