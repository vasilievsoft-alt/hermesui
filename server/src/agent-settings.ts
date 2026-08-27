import { Router } from 'express';
import { getEnvOverrides, setEnvOverrides } from './settings.js';
import { AGENT_SPECS, killConnection } from './acp.js';

export const agentSettingsRouter = Router();

// Per-agent env var suggestions shown in the UI.
const KEY_HINTS: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_MODEL'],
  opencode: ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'],
  openclaw: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
  hermes: [
    'OPENROUTER_API_KEY',
    'NOUS_API_KEY',
    'ANTHROPIC_API_KEY',
    'HERMES_INFERENCE_MODEL',
  ],
};

agentSettingsRouter.get('/', (_req, res) => {
  res.json(
    AGENT_SPECS.map((a) => ({
      id: a.id,
      label: a.label,
      suggestedEnv: KEY_HINTS[a.id] ?? [],
    }))
  );
});

agentSettingsRouter.get('/:id/env', (req, res) => {
  res.json({ env: getEnvOverrides(req.params.id) });
});

agentSettingsRouter.put('/:id/env', (req, res) => {
  const { env } = req.body as { env?: Record<string, unknown> };
  if (!env || typeof env !== 'object') {
    res.status(400).json({ error: 'env object required' });
    return;
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue; // refuse odd names
    clean[k] = String(v);
  }
  setEnvOverrides(req.params.id, clean);
  // Drop any live connection so the next chat spawns with fresh env.
  killConnection(req.params.id);
  res.json({ ok: true });
});
