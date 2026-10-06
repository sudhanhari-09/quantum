# QuantumSecure — Frontend (Track A)

React 19 + TypeScript + Vite SPA for the **Quantum Secure Communication (QSC) Platform**. It talks to the FastAPI backend (Track B) over REST (`/api/v1/*`) and WebSockets (`/ws/*`), renders live QKD/pipeline timelines, security reports, an Eve attacker dashboard, and an admin panel. `msw` can optionally mock the entire backend for offline demo/testing.

## Quick start

```powershell
cd frontend
npm ci
copy .env.example .env.development   # defaults already point at http://localhost:8000
npm run dev                          # -> http://localhost:5173
```

> The backend must be running (see `../backend/README.md`) unless you enable mocks.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR on port 5173 |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serve the production build locally (port 4173) |
| `npm run lint` | Oxlint |
| `npm test` | Vitest, run-once (CI mode) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest + v8 coverage report |

## Environment (`frontend/.env.development`, copied from `.env.example`)

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | REST base — inlined at build time |
| `VITE_WS_BASE_URL` | `ws://localhost:8000/ws` | WebSocket base (JWT passed as `?token=`) |
| `VITE_ENABLE_MOCKS` | `0` | `1` = boot against the in-memory MSW mock API (dev/demo only, never against a real deployment) |

`VITE_`-prefixed values are inlined at build time and cannot be read at runtime; changes require a dev-server restart.

## Tests

Vitest + jsdom + Testing Library; 40 tests across `src/tests/`: `auth.test.tsx`, `eve.test.ts`, `pages.test.tsx`, `session.test.ts`, `timeline.test.ts`, `ui.test.tsx`, `vocab.test.ts`, with the BB84 fixture in `bb84Fixture.ts` and shared setup in `setup.ts`. `session.test.ts` covers single-flight refresh, rotation/terminal states, and per-tab session isolation; `eve.test.ts` asserts that the live Active Communications query key is invalidated by the window-open WS event. Coverage thresholds are configured in `vite.config.ts`.

```powershell
npm test
```

## Notes

- The WebSocket client attaches the access token via `?token=`; the backend closes with `4401` (bad/expired token), `4403` (role denied) or `4404` (unknown communication). The client refreshes once on `4401`, stops on `4403`/`4404`, and otherwise reconnects with jittered exponential backoff (1 s -> 30 s) plus a frame watchdog.
- Token lifecycle is centralised in `core/session.ts` (single-flight refresh shared by boot + REST + WebSocket, rotation-safe pair replacement, terminal 401/403 handling) with `core/tokenUtils.ts` pre-checking JWT expiry before WS handshakes; `SessionBootstrap` hydrates the user via `/auth/me` on boot and never logs the user out on transient network failures. Tokens live in `sessionStorage` (per-tab sessions); refresh is serialized across tabs via `navigator.locks`.
- `VITE_ENABLE_MOCKS` must stay `0` in any environment talking to the real backend.
- EVE's Active Communications list (`useActiveSessions`, key `["communications","active"]` shared via `queries/keys.ts`) is invalidated by `communication.state_changed` (plus `communication.created` / `attack.started`) in `queries/live.ts`, so a live USER→USER session appears without a manual reload. The backend must run with `PROCESS_ASYNC=true` (the `.env.example` default) for the window to be observable.

## Original template docs

This project started from the React + TypeScript + Vite template; original template notes (Oxlint config, React Compiler) remain available in the [Vite template repository](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md).

