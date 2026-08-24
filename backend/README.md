# QSC Platform — Backend (Track B)

Backend for the **Quantum Secure Communication (QSC) Platform**: a software-only
simulation of Quantum Key Distribution (BB84), AI-driven protocol selection,
standard AES-GCM encryption, and simulated eavesdropping detection with
real-time WebSocket updates — implemented with FastAPI + SQLAlchemy 2.x per the
master phase plan (`../QSC_MASTER_DEVELOPMENT_PHASES.txt`, phases **B1–B38**).

> **Simulation honesty:** all "quantum" operations are classical Monte-Carlo
> simulations of measurement statistics. QBER and the 0.11 threshold are
> *simulation* values, never physics claims. Eve performs a *simulated*
> intercept-and-resend on an idealized channel. QKD key material is never
> returned by any REST or WS payload.

---

## Quick start

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env    # then set JWT_SECRET_KEY + generate QSC_MASTER_KEY

# schema + seeds (protocol_configs; optional admin/eve bootstrap via env flags)
.\.venv\Scripts\alembic.exe upgrade head

# run
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

- Interactive API docs: `http://localhost:8000/docs`
- Health: `GET /api/v1/health -> {status, version, db}`
- Exported contract: `docs/openapi.json` (39 paths) — source for frontend typed clients

### Generating secrets

```powershell
# JWT secret: any long random string.
# Master key (32 bytes base64):
.\.venv\Scripts\python.exe -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
```

### Bootstrap accounts (optional)

Set in `.env` before `alembic upgrade head`:
`ENABLE_ADMIN_BOOTSTRAP=true`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
Creates one ADMIN plus one ATTACKER (`eve@qsc.local`) account idempotently.

### Tests

```powershell
.\.venv\Scripts\python.exe -m pytest tests/        # 97 tests
```

---

## Architecture

```
app/
├── main.py               app factory, CORS, request-id, error envelope, security headers
├── core/                 config (pydantic-settings), security (JWT/bcrypt),
│                         exceptions (typed AppError envelope), dependencies
│                         (get_current_user, require_roles, visibility matrix),
│                         ratelimit (in-process, Redis-swappable), logging
├── db/                   Base + naming conventions; engine/session factory from DATABASE_URL
├── models/               users, messages, communication_sessions, qkd_sessions,
│                         attacks, security_reports, audit_logs
│                         + [REC] ai_recommendations, secret_keys,
│                           protocol_configs, refresh_tokens
├── schemas/              Pydantic v2 request/response models (extra=forbid on writes)
├── repositories/         ORM access isolated (users, refresh tokens)
├── services/             auth, user, admin, qsc_id, messaging (+pipeline),
│                         state_machine, ai_recommendation, qkd, qber_engine,
│                         security_engine, key_service, encryption_service,
│                         attack_simulation, delivery, reporting, audit, realtime
├── protocols/            ProtocolBase + registry; BB84 implemented;
│                         B92/E91/SIX_STATE/SARG04/DECOY_BB84 registered stubs (501)
├── simulation/           seeded RNG streams (independent per actor → deterministic reruns)
├── api/routers/          health, auth, users, messages, communications,
│                         attacks, reports, dashboard, protocols, admin
└── ws/                   connection manager + /ws/* routes (JWT handshake)
alembic/                  baseline schema + seed revisions
tests/                    unit, API, integration (97 tests)
docs/openapi.json         exported contract snapshot
```

### Core workflow (one message)

`POST /api/v1/messages` creates MESSAGE + COMMUNICATION_SESSION (`CREATED`),
then runs the backend pipeline synchronously:

```
RECEIVER_VERIFIED → AI_ANALYZING → PROTOCOL_SELECTED (recommended == executed)
→ QKD_INITIALIZING → QKD_RUNNING → KEY_SIFTING → QBER_EVALUATION
→ SECURITY_CHECK ── qber ≤ threshold → KEY_ACCEPTED → ENCRYPTING (AES-256-GCM)
                      → ENCRYPTED → DELIVERED → report(DELIVERED)
                   └─ qber >  threshold → ATTACK_DETECTED → KEY_REJECTED
                                          → BLOCKED → report(BLOCKED)
```

Attack path: while the session sits inside the window states
(`QKD_INITIALIZING..SECURITY_CHECK`), an ATTACKER can launch a simulated
INTERCEPT_AND_RESEND (`POST /communications/{id}/attacks`). The engine
deterministically **reruns** the stored seeded baseline with Eve intercepting
`round(p·n)` qubits, appends a post-attack `qkd_sessions` row
(`is_baseline=false`), so QBER genuinely changes from stored counters.
DETECTED ⇒ session → BLOCKED instantly (window closes). NOT_DETECTED ⇒ the
session resumes; re-attacks capped at `MAX_REATTACKS=3`.

### Security model highlights

- bcrypt(cost 12); JWT HS256 with rotation + reuse detection (family revocation)
- Role matrix USER/ATTACKER/ADMIN enforced server-side; ownership checks separate
- Eve surfaces are metadata-only by construction (dedicated response builders)
- Keys: HKDF-SHA256(sifted bits ‖ comm-id) → AES-GCM sealed under `QSC_MASTER_KEY`
- Plaintext exists only transiently in memory; never stored or logged
- Audit redaction policy: no tokens/hashes/keys/plaintext in `audit_logs`
- Rate limits: auth 5/min, search 10/min, attacks 3/min (env-overridable)
- Error envelope `{code,message,details}` with stable code catalog (Section 19)

---

## Phase execution log (B1–B38)

| Phase | Title | Status | Evidence |
|-------|-------|--------|----------|
| Setup | venv + dependencies | DONE | fastapi, uvicorn, sqlalchemy, alembic, pydantic-settings, PyJWT, bcrypt, cryptography, httpx, pytest |
| B1 | Backend foundation | DONE | App factory; CORS; request-id middleware; global error envelope; structured logging; `GET /api/v1/health`; lifespan hooks |
| B2 | Environment configuration | DONE | pydantic-settings; `.env.example`; prod fail-fast guards (secret/master-key/db checks) |
| B3 | Database architecture | DONE | Declarative Base + naming convention; engine/session factory; transactional `session_scope`; commit-on-business-error semantics |
| B4 | Database models | DONE | All Section 11 tables + 4 recommended; unique email/QSC-ID constraints; email lowercase normalization via model validator |
| B5 | Migrations | DONE | Alembic wired to settings+metadata; baseline `10e630a4bfa9`; seed revision `0002_seeds` (6 protocol_configs, guarded bootstrap); verified fresh upgrade chain + idempotence; `097be7581625` adds qkd `seed` column for deterministic attack reruns |
| B6 | Authentication | DONE | register/login/refresh/logout/me; refresh rotation + reuse detection; no-enumeration errors; disabled-account denial; audit rows |
| B7 | Role-based authorization | DONE | `require_roles` deps; visibility matrix; ROLE_FORBIDDEN everywhere; fail-closed; role-matrix tests |
| B8 | User management | DONE | GET/PATCH `/users/me`; admin list/search/disable; ADMIN_CANNOT_DISABLE_SELF; history preserved on disable |
| B9 | QSC ID generation | DONE | `QSC-[A-Z0-9]{10}` via `secrets`; injectable RNG; collision retry at registration |
| B10 | User search | DONE | Regex validation; public profile only; is_self flag; rate-limited |
| B11 | Messaging service | DONE | POST /messages validates receiver/self/content; transient plaintext; orchestrates full pipeline; inbox/sent/detail/report endpoints |
| B12 | Communication sessions | DONE | Session container 1:1 message; owner-scoped detail/lists; completed_at on terminal; derived statuses |
| B13 | State machine | DONE | Full Section 08 table incl. attack path + FAILED; terminal READ/BLOCKED/FAILED; derived mapping applied atomically; INVALID_STATE_TRANSITION 409 |
| B14 | BB84 engine | DONE | Seeded independent streams (alice/noise/bob/eve); noise flips; intercept-resend injection; sifting + error counting; deterministic per seed; known-answer vector test |
| B15 | QKD session management | DONE | Baseline orchestration; append-only rows; persisted per-run seed; threshold from protocol_configs; post-attack rerun support |
| B16 | QBER engine | DONE | Sole computation path; 6-dp rounding; zero-denominator guard |
| B17 | Security decision engine | DONE | ACCEPTED iff qber ≤ threshold (boundary inclusive); verdict persisted on run row; encryption gate; MAX_REATTACKS helper |
| B18 | Key management | DONE | HKDF-SHA256 derivation bound to communication id; AES-GCM-at-rest under master key; rejected path stores nothing; never serialized |
| B19 | Encryption/decryption | DONE | AES-256-GCM, random 12B nonce; refuses without acceptance; decrypt only DELIVERED/READ for owner; tamper detection |
| B20 | AI protocol recommendation | DONE | Live feature snapshot (noise/security/attack-risk/distance); weighted scoring over capability matrix; softmax-margin confidence; explanation; full audit row; enabled+supported eligibility filter; invariant recommended==executed enforced by QkdService |
| B21 | Protocol registry | DONE | ProtocolBase + registry; BB84 runnable; five registered stubs → 501; GET /protocols truth endpoint |
| B22 | Eve attacker system | DONE | Active-window target list (metadata-only); eve dashboard summary; attacker accounts created by admin; role boundaries tested |
| B23 | Intercept-and-resend | DONE | Deterministic seeded rerun with Eve; new is_baseline=false row; attack row persisted (intercepted/modified/qber before-after); strength bounds 0.1–1.0 |
| B24 | Attack detection | DONE | Same single threshold rule; DETECTED/NOT_DETECTED persisted on attack row; re-attack counter under cap |
| B25 | Message blocking | DONE | BLOCKED path end-to-end; encrypted_message stays null; no secret_keys row; inbox exclusion by query contract; sender sees flagged BLOCKED |
| B26 | Delivery/inbox | DONE | DELIVERED→READ transitions; inbox returns only DELIVERED/READ; read_at set; decryption only for receiver/sender |
| B27 | Security reports | DONE | Written on both terminal paths from stored rows; per-message + list endpoints, owner-scoped |
| B28 | Communication history | DONE | scope=mine/history lists with filters + pagination; admin platform variant |
| B29 | Eve attack history | DONE | Own-attacks-only, newest first, paginated; detail protected (owner/admin) |
| B30 | Admin services | DONE | Users mgmt; attackers CRUD (login verified); dashboard summary aggregates; platform communications; audited config update |
| B31 | Protocol analytics | DONE | Per-protocol sessions/avg-QBER/acceptance-rate/attacks/avg-confidence from live DB aggregates |
| B32 | Audit logging | DONE | AuditService used across all phases; redaction policy; filterable paginated admin endpoint; critical-path presence test |
| B33 | WebSocket events | DONE | ConnectionManager channels user/eve/admin/communications; JWT handshake (?token=) closing 4401/4403; heartbeat ping 30s; event envelope {type,communication_id,state,actor_role,payload,timestamp}; RealtimeService single sink after commit |
| B34 | Validation/error hardening | DONE | extra=forbid request models; global handlers normalize all exceptions to envelope; no stack traces leaked; OpenAPI tags/descriptions |
| B35 | Security hardening | DONE | Rate limits (auth/search/attack scopes, lazy settings resolution, 429 RATE_LIMITED); security headers middleware (nosniff/frame-deny/CSP/referrer); S19 no-key-leak grep test across endpoints |
| B36 | Backend testing | DONE | 97 tests + integration-contract suite green; state machine, BB84 vectors, QBER, crypto, AI scoring, pipeline, attacks, hardening |
| B37 | Integration testing | DONE | Scenario A (secure READ) ×3; Scenario B (DETECTED→BLOCKED, inbox absence) ×3; back-to-back A+B; Flow 3 reconnect-resync via REST timeline replay — all pass |
| B38 | Final validation | DONE | Full suite green; `docs/openapi.json` exported (39 paths incl. timeline + /security-reports alias); 4-migration chain verified fresh; WS live proof (real server + real socket + mid-run reconnect) executed |
| INT | Frontend↔Backend integration | DONE | Event-log persistence + `GET /communications/{id}/timeline` (500), `/security-reports` alias, admin summary extras (`security_outcomes/protocol_usage/recent_audit` + user-name joins), message-detail `communication_id`, QKD `sample_json` + `?include_sample`, staged `attack.progress` emissions, per-transition `communication.state_changed` broadcast; frontend `VITE_ENABLE_MOCKS=0`, `useQkdRuns` requests sample; CORS 5173; WS channels + JWT handshake verified |

**Result: 100+ tests passing (backend suite + integration contracts + E2E flows).**

### Contract endpoints (39 paths)

Auth: register/login/refresh/logout/me · Users: me(PATCH)/search · Messages: create/inbox/sent/{id}/{id}/security-report · Communications: list/{id}/{id}/recommendation/{id}/qkd/{id}/security/{id}/timeline/active · Attacks: launch/{id}/history/summary · Eve: dashboard summary · Reports: security list (+ /security-reports alias) · Dashboard: summary · Protocols: registry · Admin: users/patch, attackers CRUD, dashboard summary (+ security_outcomes/protocol_usage/recent_audit), communications, security-events, protocol-analytics, audit-logs, config.

### Known limitations / notes

- The secure pipeline executes synchronously within POST /messages (no worker
  queue in v1); WS clients still receive the emitted stage events, and REST
  remains the source of truth.
- SQLite is the dev/test default; set `DATABASE_URL` to PostgreSQL for prod
  (config fails fast in `QSC_ENV=prod` if not).
- Non-BB84 protocols are registered-but-disabled stubs returning 501, exactly
  as scoped for v1.
