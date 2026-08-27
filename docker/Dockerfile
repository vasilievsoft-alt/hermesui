# ---------- web build ----------
FROM node:24-bookworm-slim AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---------- toolbox runtime ----------
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git bash ripgrep python3 python3-venv procps tini \
 && rm -rf /var/lib/apt/lists/*

# Node CLIs: claude code, opencode, openclaw
RUN npm install -g @anthropic-ai/claude-code opencode-ai openclaw

# All agent homes live under /config (persisted volume): claude -> ~/.claude,
# openclaw -> ~/.openclaw, opencode -> ~/.local/share/opencode etc.
ENV HOME=/config/home
ENV HERMES_HOME=/config/agents/hermes
ENV PATH="/config/home/.local/bin:${PATH}"
ENV WEB_DIST=/app/web/dist
ENV WORKSPACE_DIR=/workspace
ENV CONFIG_DIR=/config

# hermes is NOT baked into the image: its state and venv share one directory,
# so it self-installs into the persistent volume on first boot (entrypoint).
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server/src ./src
COPY shared ../shared

COPY --from=web-build /build/dist ../web/dist

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
