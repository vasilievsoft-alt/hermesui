import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
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
    return <div className="h-screen grid place-items-center text-neutral-500">…</div>;
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
  const navigate = useNavigate();

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    window.location.reload();
  }

  return (
    <div className="flex h-screen">
      <aside className="w-48 shrink-0 flex flex-col border-r border-neutral-800 bg-neutral-900/60">
        <div className="px-4 py-4 text-sm font-semibold tracking-wide text-neutral-100">
          hermesui
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
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
        <button
          onClick={logout}
          className="m-2 rounded-md px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-300"
        >
          Log out
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
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
  );
}
