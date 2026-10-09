import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { session, refreshSession, route, match, api, navigate } from './lib.js';
import { Icon, Avatar, Loading, Toasts, Dialog } from './ui.jsx';
import { Login, Forgot, SetPassword, Intake } from './pages/auth.jsx';
import { Dashboard } from './pages/dashboard.jsx';
import { ClientsList, NewClient, ClientRecord } from './pages/clients.jsx';
import { Pipeline, Tasks } from './pages/pipeline.jsx';
import { DiscoveryRunner } from './pages/discovery.jsx';
import { Team, Settings, Commissions } from './pages/admin.jsx';
import { Account } from './pages/account.jsx';
import { ContractPage } from './pages/contracts.jsx';
import { InvoicesPage, InvoicePage } from './pages/billing.jsx';
import { FilesPage } from './pages/files.jsx';
import { AuditPage, ReportPage } from './pages/audits.jsx';
import { GoatPage, GoatRequestPage } from './pages/goat.jsx';
import { MeetingPage } from './pages/meetings.jsx';
import { SocialPage, SocialPostPage } from './pages/social.jsx';
import { ReportsPage, MonthlyReportPage } from './pages/reports.jsx';
import { BusinessPage } from './pages/business.jsx';
import { ProposalPage } from './pages/proposals.jsx';

const PUBLIC = [
  ['/login', Login],
  ['/forgot', Forgot],
  ['/activate', () => <SetPassword kind="invite" />],
  ['/reset', () => <SetPassword kind="reset" />],
  ['/intake', Intake],
];

const PRIVATE = [
  ['/', Dashboard, ['admin', 'rep', 'client']],
  ['/clients', ClientsList, ['admin', 'rep']],
  ['/clients/new', NewClient, ['admin', 'rep']],
  ['/clients/:id', ClientRecord, ['admin', 'rep', 'client']],
  ['/business', BusinessPage, ['client']],
  ['/business/:id', ClientRecord, ['client']],
  ['/pipeline', Pipeline, ['admin', 'rep']],
  ['/tasks', Tasks, ['admin', 'rep']],
  ['/discovery/:id', DiscoveryRunner, ['admin', 'rep']],
  ['/team', Team, ['admin']],
  ['/settings', Settings, ['admin']],
  ['/commissions', Commissions, ['admin', 'rep']],
  ['/account', Account, ['admin', 'rep', 'client']],
  ['/contracts/:id', ContractPage, ['admin', 'rep', 'client']],
  ['/invoices', InvoicesPage, ['admin', 'rep', 'client']],
  ['/invoices/:id', InvoicePage, ['admin', 'rep', 'client']],
  ['/files', FilesPage, ['client']],
  ['/audits/:id', AuditPage, ['admin', 'rep']],
  ['/reports', ReportsPage, ['admin', 'rep', 'client']],
  ['/reports/monthly/:id', MonthlyReportPage, ['admin', 'rep', 'client']],
  ['/reports/:id', ReportPage, ['admin', 'rep', 'client']],
  ['/goat', GoatPage, ['admin', 'rep', 'client']],
  ['/goat/:id', GoatRequestPage, ['admin', 'rep', 'client']],
  ['/meetings/:id', MeetingPage, ['admin', 'rep']],
  ['/social', SocialPage, ['client']],
  ['/social/:id', SocialPostPage, ['admin', 'rep', 'client']],
  ['/proposals/:id', ProposalPage, ['admin', 'rep', 'client']],
];

const NAV = {
  admin: [['/', 'home', 'Detcord Today'], ['/clients', 'clients', 'Clients'], ['/goat', 'bolt', 'Requests'], ['/pipeline', 'pipeline', 'Pipeline'], ['/tasks', 'tasks', 'Tasks'], ['/invoices', 'card', 'Invoices'], '|Agency', ['/team', 'team', 'Team'], ['/commissions', 'money', 'Commissions'], ['/settings', 'settings', 'Settings']],
  rep: [['/', 'home', 'My Day'], ['/clients', 'clients', 'My clients'], ['/goat', 'bolt', 'Requests'], ['/pipeline', 'pipeline', 'Pipeline'], ['/tasks', 'tasks', 'Tasks'], ['/invoices', 'card', 'Invoices'], ['/commissions', 'money', 'Commissions']],
  client: [['/', 'home', 'Home'], ['/business', 'clients', 'Business'], ['/goat', 'bolt', 'Ask the GOAT'], ['/social', 'globe', 'Social'], ['/reports', 'doc', 'Reports'], ['/invoices', 'card', 'Invoices'], ['/files', 'folder', 'Files']],
};

function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const flip = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dp-theme', t); } catch {}
    setTheme(t);
  };
  return <button class="icon-btn" onClick={flip} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>;
}

async function logout() {
  await api('POST', '/auth/logout', {}).catch(() => {});
  session.value = { user: null, clients: [] };
  navigate('/login');
}

const shortLabel = (l) => l.replace('Detcord ', '').replace('My clients', 'Clients').replace('Ask the GOAT', 'GOAT');

// Phones: up to six links fit. With more, the first five plus a More button that opens the rest in a sheet.
function BottomNav({ links, current }) {
  const [more, setMore] = useState(false);
  const overflow = links.length > 6;
  const shown = overflow ? links.slice(0, 5) : links;
  const rest = overflow ? links.slice(5) : [];
  const restActive = rest.some((i) => current(i[0]));
  return (
    <>
      <nav class="bottom-nav" style={`grid-template-columns:repeat(${shown.length + (overflow ? 1 : 0)},1fr)`}>
        {shown.map((i) => <a href={i[0]} aria-current={current(i[0])}><Icon name={i[1]} size={20} />{shortLabel(i[2])}</a>)}
        {overflow && <button type="button" aria-current={restActive ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}><Icon name="menu" size={20} />More</button>}
      </nav>
      {more && (
        <Dialog title="More" onClose={() => setMore(false)}>
          <nav class="more-nav" onClick={(e) => e.target.closest('a') && setMore(false)}>
            {rest.map((i) => <a href={i[0]} aria-current={current(i[0])}><Icon name={i[1]} />{i[2]}</a>)}
          </nav>
        </Dialog>
      )}
    </>
  );
}

function Shell({ user, children, path }) {
  const items = NAV[user.role];
  const current = (href) => (href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined;
  const links = items.filter((i) => typeof i !== 'string');
  return (
    <div class="shell">
      <aside class="sidebar">
        <a class="logo" href="/" aria-label="Detcord Digital home"><img src="/detcord-logo-transparent.webp" alt="Detcord Digital" /></a>
        <nav class="nav">
          {items.map((i) => typeof i === 'string'
            ? <div class="section">{i.slice(1)}</div>
            : <a href={i[0]} aria-current={current(i[0])}><Icon name={i[1]} />{i[2]}</a>)}
        </nav>
        <div class="me">
          <Avatar name={user.name} />
          <a href="/account" style="text-decoration:none;min-width:0;flex:1">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{user.name}</div>
            <div class="faint small">{{ admin: 'Admin', rep: 'Sales', client: 'Client' }[user.role]}</div>
          </a>
          <ThemeToggle />
          <button class="icon-btn" onClick={logout} aria-label="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <a href="/"><img src="/detcord-logo-transparent.webp" alt="Detcord Digital" /></a>
          <div class="row"><ThemeToggle /><a class="icon-btn" href="/account" aria-label="Account"><Avatar name={user.name} /></a></div>
        </div>
        {children}
        {links.length > 1 && <BottomNav links={links} current={current} />}
      </div>
    </div>
  );
}

function App() {
  useEffect(() => { refreshSession(); }, []);
  const path = route.value.split(/[?#]/)[0].replace(/\/$/, '') || '/';

  for (const [pattern, Page] of PUBLIC) {
    const params = match(pattern, path);
    if (params) return <><Page {...params} /><Toasts /></>;
  }
  const s = session.value;
  if (s === undefined) return <Loading />;
  if (!s.user) {
    const next = path !== '/' ? `?next=${encodeURIComponent(route.value)}` : '';
    setTimeout(() => navigate(`/login${next}`, { replace: true }));
    return <Loading />;
  }
  for (const [pattern, Page, roles] of PRIVATE) {
    const params = match(pattern, path);
    if (params && roles.includes(s.user.role)) {
      return <><Shell user={s.user} path={path}><Page {...params} user={s.user} key={path} /></Shell><Toasts /></>;
    }
  }
  return (
    <><Shell user={s.user} path={path}>
      <div class="page"><div class="empty"><strong>Page not found</strong><a class="btn secondary mt" href="/">Go home</a></div></div>
    </Shell><Toasts /></>
  );
}

render(<App />, document.getElementById('app'));
