#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/config/home}"
export HERMES_HOME="${HERMES_HOME:-/config/agents/hermes}"
mkdir -p "$HOME" "$HERMES_HOME"

# hermes self-install / self-repair: (re)install whenever the binary is not
# on PATH — covers failed first boots and partial installs.
if ! command -v hermes >/dev/null 2>&1; then
  echo "[entrypoint] installing hermes agent (first boot or repair, takes a few minutes)..."
  if curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash; then
    if command -v hermes >/dev/null 2>&1; then
      touch "$HERMES_HOME/.installed"
      echo "[entrypoint] hermes installed: $(command -v hermes)"
    else
      echo "[entrypoint] WARNING: hermes install script finished but binary is not on PATH"
    fi
  else
    echo "[entrypoint] WARNING: hermes install failed, continuing without it"
  fi
fi

cd /app/server
exec ./node_modules/.bin/tsx src/index.ts
