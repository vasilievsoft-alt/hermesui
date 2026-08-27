# hermesui — web cockpit for CLI coding agents

Один контейнер-«toolbox» на VPS: веб-интерфейс (чат, файлы, cron, skills, MCP)
поверх четырёх CLI-агентов — **Claude Code, OpenCode, OpenClaw, Hermes**.

Транспорт чата — [ACP](https://agentclientprotocol.com) (Agent Client Protocol):
один клиент на сервере говорит со всеми агентами через нативные `acp`-режимы.

```
браузер ──► hermesui server (:3000, Node+TS: express + ws)
              ├── ACP client ──► claude / opencode / openclaw / hermes
              ├── files API (/workspace sandbox)
              ├── croner scheduler + sqlite history
              └── skills/MCP manager → конфиги каждого агента
volumes:  ./workspace → /workspace (общий), config:/config (дома агентов, ключи, сессии)
```

## Быстрый старт

```bash
git clone <repo> hermesui && cd hermesui
echo "APP_PASSWORD=<сильный пароль>" > .env
docker compose up -d --build
# http://<server-ip>:3000
```

Первый старт медленный: сборка образа + self-install hermes в volume (~несколько минут).

- `UI_PORT=8080` — сменить порт
- TLS/домен — снаружи через твой reverse-proxy (Traefik/Caddy/NPM)

## Разработка

```bash
npm run dev:server   # server на :3000 (tsx watch)
npm run dev:web      # vite на :5173, прокси /api и /ws
npm run typecheck    # оба пакета
```

## Фазы

| Фаза | Что | Статус |
|---|---|---|
| 0 | Каркас: Docker, auth, шелл UI | ✅ |
| 1 | Файловый эксплорер: превью/правка (CodeMirror, ~130 синтаксисов), upload/download, sandbox от symlink-побегов | ✅ |
| 2 | Чат по ACP со стримингом, tool-блоки, сессии в sqlite | ✅ проверено вживую с claude |
| 3 | hermes/openclaw через тот же ACP-клиент; Env/ключи агентов через UI; веб-терминал (xterm/node-pty) для OAuth-флоу | ✅ код готов; запуск opencode/openclaw/hermes — проверить на VPS |
| 4 | Cron: задачи + история запусков | по согласованию |
| 5 | Skills-менеджер + MCP-менеджер | по согласованию |
| 6 | Полировка: диффы, git, мобилка | |

Живые прогоны локально (Windows, node 24): login/auth и 401-границы, files API полный цикл + блокировка `../`-побега, чат end-to-end с Claude Code по ACP, терминал-WS, применение env к агентам. После `docker compose up --build` на VPS ожидается то же самое + недостающие CLI.

Старый менеджер инстансов hermes-webui живёт в ветке `legacy`.

## Безопасность

- Один пароль (`APP_PASSWORD`) → session cookie; без пароля контейнер не стартует.
- Это панель remote-code-execution: не выставляй порт в открытый интернет без TLS.
- Агенты выполняют код внутри контейнера — изоляция обеспечивается самим контейнером.
