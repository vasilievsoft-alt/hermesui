# hermesui — Hermes instances manager

Минималистичный менеджер изолированных инстансов [Hermes Agent WebUI](https://github.com/nesquena/hermes-webui).

Кнопка **+ Create instance** → создаётся отдельный Docker-контейнер `ghcr.io/nesquena/hermes-webui` со своими named volumes (конфиг, память и сессии агента изолированы) → инстанс открывается по своей ссылке. **Delete** → контейнер и его данные удаляются полностью.

```
браузер ──► менеджер (:3000, сам в Docker, docker.sock)
              │  UI + REST /api/instances
              │  reverse-proxy по Host-заголовку
              ├──► hermes-work-xxxxxx:8787   (volume: hermes-data-xxxxxx)
              └──► hermes-test-yyyyyy:8787   (volume: hermes-data-yyyyyy)
```

Менеджер создаёт sibling-контейнеры через смонтированный `/var/run/docker.sock` и подключает их в сеть `hermes-net`. Никакие порты инстансов наружу не публикуются — трафик идёт через прокси менеджера.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `BASE_DOMAIN` | — | Домен менеджера, напр. `hermes.example.com`. Инстанс `hermes-work-abc123` станет доступен по `https://hermes-work-abc123.hermes.example.com` |
| `ACCESS_MODE` | `subdomain` | `subdomain` — прокси по поддомену (нужен wildcard-домен); `ports` — каждый инстанс получает порт из диапазона 8800+ напрямую |
| `PORT_RANGE_START/END` | `8800`/`8899` | Диапазон портов для режима `ports` |
| `PUBLIC_HOST` | авто | Хост в ссылках на инстансы в режиме `ports` (напр. IP сервера) |
| `MANAGER_PASSWORD` | — | Basic-auth (`admin`) на UI и API менеджера. Настоятельно рекомендуется: менеджер управляет Docker |
| `HERMES_IMAGE` | `ghcr.io/nesquena/hermes-webui:latest` | Образ инстансов |

## Локальный запуск

```bash
docker compose up -d --build
# открыть http://localhost:3000
```

Первый инстанс тянет образ hermes-webui (~2 GB) — создание займёт несколько минут, дальше быстро.

## Деплой в Dokploy

Compose уже содержит Traefik-роутер с `HostRegexp` для поддоменов инстансов — wildcard-домен в UI Dokploy добавлять не нужно.

1. Запушь этот репозиторий в git.
2. В Dokploy: **Projects → New → Docker Compose**, выбери репозиторий (или вставь содержимое `docker-compose.yml`).
3. Добавь домен менеджера через вкладку **Domains** (порт `3000`) — обычный точный домен, например сгенерированный `*.traefik.me` preview-домен Dokploy.
4. В Environment пропиши:
   ```
   BASE_DOMAIN=<тот же домен менеджера>
   MANAGER_PASSWORD=сильный-пароль
   ```
5. Deploy. Инстансы будут доступны по `http://<имя-инстанса>.<BASE_DOMAIN>`.

### Быстрый вариант: preview-домен traefik.me

Если в качестве домена менеджера используешь сгенерированный Dokploy домен вида `hermesui-main-xxxx-173-212-211-71.traefik.me`:

- поддомены инстансов резолвятся автоматически (wildcard DNS traefik.me)
- роутер уже настроен лейблами в compose
- схема URL инстансов автоматически станет `http` (у traefik.me нет wildcard-сертификата на вложенные поддомены) — просто открывай инстансы по http, менеджер может быть по https
- DNS-записи создавать не нужно

### Правильный вариант: свой домен + HTTPS на инстансах

1. DNS: `A` запись `hermes.example.com` → IP сервера и `A` запись `*.hermes.example.com` → IP сервера.
2. В **Settings → Certificates** Dokploy настрой DNS-провайдера (Cloudflare и т.п.) и выпусти wildcard-сертификат `*.hermes.example.com` (DNS-challenge).
3. Домен менеджера `hermes.example.com` — как обычно через UI (порт 3000, HTTPS).
4. env:
   ```
   BASE_DOMAIN=hermes.example.com
   TRAEFIK_ENTRYPOINTS=web,websecure
   ```
5. Подключи wildcard-сертификат к роутеру `hermes-instances` (лейблы в compose при необходимости дополни `traefik.http.routers.hermes-instances.tls=true` и `...tls.domains[0].main=*.hermes.example.com`).

### Если wildcard-домен не вариант

Переключись на режим портов — инстансы будут доступны напрямую по `http://IP-СЕРВЕРА:8800+`:

```
ACCESS_MODE=ports
PUBLIC_HOST=123.45.67.89
```

Открой в фаерволе порты `8800-8899` (только нужные, лучше ограничить по IP).

## Безопасность

- Инстанс без пароля = любой, кто знает ссылку, управляет агентом. Всегда задавай **Instance password** при создании (это `HERMES_WEBUI_PASSWORD`, нативный login hermes-webui).
- `MANAGER_PASSWORD` защищает только UI/API менеджера, не инстансы.

## MVP-границы

- Нет restart/stop инстансов (только create/delete) — контейнеры и так `restart: unless-stopped`
- Нет логов/статистики инстансов в UI менеджера
- Состояние менеджера stateless: список инстансов читается по docker-лейблам, менеджер можно пересоздавать
