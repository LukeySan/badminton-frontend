# Badminton Rally Analyzer — frontend

Web app for the Badminton Rally Analyzer: upload a match video, mark the court, wait
for processing, then watch it with every rally shown as a chapter on the scrubber.

React 19 + TypeScript + Vite, TanStack Router/Query, Tailwind CSS + shadcn/ui. The API
client in `src/client/` is generated from the backend's OpenAPI spec. Later this app is
wrapped with Capacitor for iOS/Android.

Backend: [`../badminton-backend`](../badminton-backend) (FastAPI). Started from the
`frontend/` folder of
[full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)
(MIT; its copyright notice is kept in `LICENSE`).

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

| Command               | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `bun run dev`         | dev server with hot reload                                             |
| `bun run build`       | type-check + production build into `dist/`                             |
| `bun run lint`        | Biome lint + format (fixes files in place)                             |
| `bun run test`        | Playwright end-to-end tests in Chromium (starts the dev server itself) |
| `bun run test:ui`     | the same in Playwright's UI mode                                       |
| `bun run test:webkit` | the tests in WebKit (Safari's engine), in Docker: see below            |

The tests run against the real backend, so it must be running with Mailpit
(`docker compose up -d`) and the backend in its local environment (the tests create
users through its dev-only `/private/users/` endpoint). They read `.env`:
`VITE_API_URL`, `MAILPIT_HOST`, `FIRST_SUPERUSER`, `FIRST_SUPERUSER_PASSWORD`.
First run only: `bunx playwright install chromium`.

**WebKit.** iPhones (and the iOS app) run WebKit, so CI tests it too. Playwright's
own WebKit hangs opening pages on macOS 26.0 (Nov 2026), so on a Mac
`bun run test:webkit` runs Linux WebKit in Playwright's Docker image instead, against
the production build (`scripts/test-webkit-docker.sh`; needs Docker and the backend
running). Elsewhere: `PW_WEBKIT=1 bun run test`.

**CI** (`.github/workflows/test-frontend.yml`, on every PR and push to main): Biome,
build, then the end-to-end tests in Chromium and WebKit against the backend's `main`
branch (API + Postgres + Mailpit started in the job) and the production build. A
failed run keeps the Playwright HTML report as an artifact. A frontend PR that needs a
backend change fails until that change is on the backend's `main`.

**Feedback link.** `VITE_FEEDBACK_EMAIL` in `.env` is where Profile → "Send feedback"
mails to (hidden when empty). Set it to the beta's inbox before deploying.
