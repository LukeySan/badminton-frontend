# Badminton Rally Analyzer — frontend

Web app for the Badminton Rally Analyzer: upload a match video, mark the court, wait
for processing, then watch it with every rally shown as a chapter on the scrubber.

React 19 + TypeScript + Vite, TanStack Router/Query, Tailwind CSS + shadcn/ui. The API
client in `src/client/` is generated from the backend's OpenAPI spec. Later this app is
wrapped with Capacitor for iOS/Android.

Backend: [`../badminton-backend`](../badminton-backend) (FastAPI). Started from the
`frontend/` folder of
[full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)
(license in `TEMPLATE_LICENSE`).

## Setup

Requires [Bun](https://bun.sh/) (`brew install oven-sh/bun/bun`).

```bash
cp .env.example .env     # then set FIRST_SUPERUSER_PASSWORD to the backend's
bun install
```

## Run

Start the backend first (in `../badminton-backend`): `docker compose up -d`, then
`uv run fastapi dev` in `backend/` (API on http://localhost:8000) and
`uv run python worker/run_worker.py` for video processing. Then:

```bash
bun run dev              # http://localhost:5173 — log in with the backend's account
```

## Regenerate the API client

Every time the backend's API changes (backend must be running):

```bash
curl http://localhost:8000/api/v1/openapi.json -o openapi.json
bun run generate-client  # writes src/client/ — never edit it by hand
```

Commit `openapi.json` and `src/client/` together.

## Commands

| Command           | What it does                                               |
| ----------------- | ---------------------------------------------------------- |
| `bun run dev`     | dev server with hot reload                                 |
| `bun run build`   | type-check + production build into `dist/`                 |
| `bun run lint`    | Biome lint + format (fixes files in place)                 |
| `bun run test`    | Playwright end-to-end tests (starts the dev server itself) |
| `bun run test:ui` | the same in Playwright's UI mode                           |

The tests run against the real backend, so it must be running with Mailpit
(`docker compose up -d`) and the backend in its local environment (the tests create
users through its dev-only `/private/users/` endpoint). They read `.env`:
`VITE_API_URL`, `MAILPIT_HOST`, `FIRST_SUPERUSER`, `FIRST_SUPERUSER_PASSWORD`.
First run only: `bunx playwright install chromium`.
