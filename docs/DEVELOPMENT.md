# Development

## Prerequisites

- Go 1.22+ (match `backend/go.mod`)
- Node 22.13+ and pnpm 11.22.0
- Docker + Compose
- golang-migrate, sqlc, air, golangci-lint, gofumpt — see [backend/TOOLCHAIN.md](../backend/TOOLCHAIN.md)

## First clone

```sh
cp .env.example .env
```

Set these **before** sharing a Docker host with another stack:

| Variable | Purpose |
|----------|---------|
| `NAME_PREFIX` | Container names (`${NAME_PREFIX}-postgres`, `-minio`, …) |
| `COMPOSE_PROJECT_NAME` | Compose project name |
| `LOCAL_NETWORK_NAME` | Local bridge |
| `APP_NETWORK_NAME` | Prod private bridge (default `${NAME_PREFIX}-app`) |
| `*_VOLUME_NAME` | Named volumes so MinIO/Postgres do not collide |

Never reuse the short Docker DNS names `minio` / `centrifugo` alone on a shared Dokploy overlay — they are already qualified as `*.${APP_NETWORK_NAME}` in `compose.prod.yml`.

Root `.env` is canonical. `backend/.env` is a fallback only. Do not keep a long-lived `frontend/.env.local` for API URLs; `API_URL` comes from the root env.

`API_URL` **must** include `/v1` (Go routes are `/v1/...`). Default: `http://127.0.0.1:8080/v1`.

## Local

```sh
make local-dev
make create-super-admin
```

Helpers:

| Target | What it does |
|--------|----------------|
| `make infra` / `make infra-down` | Compose infra only |
| `make backend-dev` | air on `:8080` |
| `make frontend-dev` | `pnpm dev` on `:3000` |
| `make migrate-up` | Apply SQL migrations |
| `make create-super-admin` | Upsert platform admin + `super_admin` role |
| `make search-reindex` | Rebuild Meilisearch indexes (users, roles, …) |
| `make check-i18n` | Find missing / unwired translation keys (en+tr, activity, RBAC, exports) |

### Local URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://127.0.0.1:8080 |
| Scalar docs | http://127.0.0.1:8080/docs/ |
| Health / ready | http://127.0.0.1:8080/healthz · `/readyz` |
| Adminer | http://127.0.0.1:8081 |
| MinIO console | http://127.0.0.1:9001 |
| MailHog | http://127.0.0.1:8025 |
| Meilisearch | http://127.0.0.1:7700 |
| Centrifugo WS | ws://127.0.0.1:8000/connection/websocket |

Login: http://localhost:3000/platform/login

## Branding

Swap name and colors in `frontend/src/config/brand.ts` and the CSS tokens in the frontend theme. Default product name is **App**.

## VAPID (optional Web Push)

```sh
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in `.env`. The frontend registers via `/app-push-sw.js` → BFF → `/v1/notifications/vapid-public-key` + push-subscriptions.

Closed-browser push does not work until these three are set.

Optional frontend public vars (root `.env`): `NEXT_PUBLIC_BFF_BASE_URL`, `NEXT_PUBLIC_REALTIME_ENABLED`, `NEXT_PUBLIC_CENTRIFUGO_URL`, `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_FALLBACK_LOCALE`.

## Production / Dokploy

1. Create the external network once: `docker network create dokploy-network`
2. `cp .env.example .env.server` and replace every secret (`${VAR:?…}` is required)
3. `make prod-config` then `make prod-up`
4. Seed platform admin: `make prod-create-super-admin` (uses `SA_*` from `.env.server`; backend image includes `create-super-admin`)

Dokploy-attached services: **centrifugo, backend, frontend**. Postgres, Redis, Meilisearch, and the worker stay on the private app network.

Prod has no object store container: set `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` (and optionally `S3_USE_PATH_STYLE`, `S3_PUBLIC_BASE_URL`) for an external S3-compatible bucket. Public media (logos, share links) need public read on the bucket or a CDN URL in `S3_PUBLIC_BASE_URL`. MinIO remains in `compose.local.yml` for local dev only.

`APP_ENCRYPTION_KEY` (32-byte, raw or base64) encrypts GitHub App secrets at rest. Generate: `openssl rand -base64 32`. Replace the example key in production.

## AI voice (Speaches, optional)

Push-to-talk and read-aloud use [Speaches](https://speaches.ai) (faster-whisper STT, Piper TTS). The browser only calls `/api/v1/tenant/ai/voice/*`; Go forwards to Speaches.

- **Prod:** `compose.prod.yml` runs `speaches` (`ghcr.io/speaches-ai/speaches:latest-cpu`, override with `SPEACHES_IMAGE`) on the private network. `PRELOAD_MODELS` downloads `Systran/faster-whisper-small` and `speaches-ai/piper-tr_TR-fettah-medium` into the `speaches_models` volume on first start (needs Hugging Face access; takes a few minutes, ~1 GB RAM on CPU).
- **Local:** `docker compose -f compose.local.yml --profile voice up -d speaches` (published on `SPEACHES_PORT`, default 8090).
- Other models, once, on a running server: `curl -X POST http://<speaches>:8000/v1/models/Systran/faster-whisper-medium` (list with `GET /v1/models`; Turkish Piper voices: `speaches-ai/piper-tr_TR-{fettah,dfki,fahrettin}-medium`).
- Admin → `/platform/ai` → **Ses**: URL `http://<NAME_PREFIX>-speaches:8000` (local: `http://127.0.0.1:8090`), turn on **Ses**, then **Ses sunucusunu test et** shows which models are installed. Empty model fields use the defaults above; a non-Piper TTS model is written `model:voice`.
- `SPEACHES_API_KEY` is only for an external Speaches started with `API_KEY`.

## Super admin

From the repo root (loads `.env`):

```sh
make create-super-admin
make create-super-admin SA_EMAIL=you@example.com SA_PASSWORD='Secret1' SA_NAME=Ada SA_SURNAME=Admin
```

The same target exists under `backend/` (`make -C backend create-super-admin …`).

## After a backend contract change

```sh
make -C backend sqlc
make -C backend openapi-lint
cd frontend && pnpm api:generate && pnpm typecheck
```
