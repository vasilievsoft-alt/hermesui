import { useState, type FormEvent } from 'react';
import { api } from '../api';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-dvh place-items-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xs space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6"
      >
        <div className="text-center text-lg font-semibold">hermesui</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-md bg-neutral-200 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          {busy ? '…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
