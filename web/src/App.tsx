import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api } from './api';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import FilesPage from './pages/FilesPage';
import AgentsPage from './pages/AgentsPage';
import SkillsPage from './pages/SkillsPage';
import McpPage from './pages/McpPage';
import CronPage from './pages/CronPage';

const NAV = [
  { to: '/chat', label: 'Chat' },
  { to: '/files', label: 'Files' },
  { to: '/agents', label: 'Agents' },
  { to: '/skills', label: 'Skills' },
  { to: '/mcp', label: 'MCP' },
  { to: '/cron', label: 'Cron' },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ authenticated: boolean }>('/api/auth/me')
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="grid h-dvh place-items-center text-neutral-500">…</div>;
  }

  if (!authed) {
    return (
      <LoginPage
        onSuccess={() => setAuthed(true)}
      />
    );
  }

  return <Shell />;
}

function Shell() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    window.location.reload();
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* desktop sidebar */}
      <aside className="hidden w-48 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/60 md:flex">
        <div className="px-4 py-4 text-sm font-semibold tracking-wide text-neutral-100">
          hermesui
        </div>
        <NavList />
        <button
          onClick={logout}
          className="m-2 rounded-md px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300"
        >
          Log out
        </button>
      </aside>

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 max-w-[82vw] flex-col border-r border-neutral-800 bg-neutral-900 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+1rem)]">
            <div className="px-4 pb-3 text-sm font-semibold tracking-wide text-neutral-100">
              hermesui
            </div>
            <NavList />
            <button
              onClick={logout}
              className="m-2 rounded-md px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300"
            >
              Log out
            </button>
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900/60 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-2 text-neutral-300 hover:bg-neutral-800"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold tracking-wide text-neutral-100">
            hermesui
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/mcp" element={<McpPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function NavList() {
  return (
    <nav className="flex-1 space-y-0.5 overflow-auto px-2 py-2 md:py-0">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2.5 text-sm md:py-2 ${
              isActive
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
