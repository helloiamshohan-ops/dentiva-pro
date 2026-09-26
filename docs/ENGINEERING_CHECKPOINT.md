# Dentiva Pro — Engineering Checkpoint

**Product:** Dentiva Pro v1.0.0  
**Platform:** Windows x64 desktop (offline-first)  
**Session branch:** `arena/01a0dbe6-dentiva-pro`  
**Base commit:** `b47c342` (fresh repository — README stub only)  
**Updated:** 2026-09-26

## Current phase

**IMPLEMENTATION / TEST** — architecture, database, domain, services, UI, documents, tests, preview API.

## Current subphase

Typecheck, lint, unit/integration/PDF tests, and `scripts/dev.mjs` smoke completed on this Linux host. Electron binary download remains blocked (TLS). Windows NSIS packaging remains blocked (no Wine).

## Current objective

Finish remaining commercial UI/workflow polish, keep tests green, document honest blockers, then package when the environment allows.

## Repository ground truth

- Branch: `arena/01a0dbe6-dentiva-pro` from `main` at `b47c342`
- History: implementation uncommitted on top of the initial README stub
- Confirmed **genuinely fresh** at session start. No previous Dentiva product code.

## Environment

- OS: Debian GNU/Linux 12 (bookworm), x86_64
- Node: v22.22.3 (experimental `node:sqlite`)
- npm: 10.9.8
- Wine: not present
- Code signing: not available — will not claim signed
- Electron npm binary: not installed (TLS / socket drop). Do not retry the same download.

## Architecture state

Offline-first Electron + React + SQLite desktop application.

- **Core:** TypeScript domain/services, integer-paisa money, transactional SQLite via `node:sqlite`
- **Main:** Electron main process, IPC allow-list, starts loopback HTTP API (`127.0.0.1:4780`) for the packaged renderer
- **Preload:** contextIsolation bridge only
- **Renderer:** React SPA, design tokens, no Node integration; `fetch('/api')` (Vite proxy) or `http://127.0.0.1:4780` on `file:`
- **Preview/dev:** `scripts/dev.mjs` — API `0.0.0.0:4780`, UI `0.0.0.0:5173`, `NODE_OPTIONS=--experimental-sqlite`
- **Documents:** PDFKit engines for prescription, invoice, receipt (A4/80mm), statement
- **No** activation, serial, license, trial, or machine binding

## Database state

Migrations `001_initial.sql` and `002_search_fts.sql` applied on first launch / tests. Seed catalog + clinic settings only. No demo patients.

## Migration state

Ordered SQL migrations, version-tracked. Bundled copies must live at `dist/main/migrations` for packaged main.

## Completed requirements

- [x] Fresh repository inspection
- [x] Git state / branch / history inspection
- [x] Architecture document
- [x] Design system
- [x] Database + migrations
- [x] Authentication / app lock / RBAC
- [x] Clinic setup, staff, patients, Patient 360
- [x] Visits, dental chart, prescriptions
- [x] Appointments, queue
- [x] Billing, payments, receipts, statements, accounting
- [x] Inventory, suppliers, purchases (services; UI covers items + adjust)
- [x] Search, command palette, dashboard, reports, notifications
- [x] Backup / restore
- [x] PDF / print engines
- [x] Tests (31 passing on this host)
- [ ] Windows package / signed installer

## Verified requirements

Executed on this host (2026-09-26):

- `NODE_OPTIONS=--experimental-sqlite npx vitest run` — 9 files, 31 tests passed
- `npx tsc --noEmit -p tsconfig.json` — green (Electron `src/main` + `src/preload` excluded while electron types are absent)
- `npx eslint . --ext .ts,.tsx --max-warnings 0` — green
- `node scripts/dev.mjs` — API health `{"ok":true,"name":"Dentiva Pro","version":"1.0.0"}`, UI HTTP 200 on :5173, `/api/meta/setup` `needsSetup: true` on a fresh `./data` dir

**Not verified:** Windows clean install/uninstall, NSIS installer, code signing, Electron packaged runtime (binary missing), 100K-patient scale (current scale test uses 1,000 patients).

## Files / modules changed this session

Core, renderer, server, tests, docs, scripts, package.json, tsconfig. See git status.

## Tests executed

`npm test` equivalent: `NODE_OPTIONS=--experimental-sqlite npx vitest run`

## Test results

9 files / 31 tests passed in ~5.2s.

## Audit results

`npm run lint` 0 errors. Source-audit script exists; not used as a release gate.

## Performance results

Scale test: 1,000 patients insert + search < 500 ms + dashboard < 1 s on this 2 CPU / 3.8 GiB host. 100K not run.

## Known defects

- Electron binary not present in `node_modules/electron`; desktop packaging cannot run here.
- `icon.ico` is PNG bytes (electron-builder NSIS may reject a true ICO requirement on Windows).
- Electron IPC `api:call` dispatch is a stub; packaged app relies on loopback HTTP API instead.

## Blocked items

- Windows NSIS installer: Wine not present.
- Electron download: TLS certificate / socket drop. Do not retry the same npm electron fetch.
- Code signing infrastructure: not present. Will not fake signing.

## Environment limitations

- Linux sandbox, not a Windows machine. Windows validation cannot be honestly marked verified.
- 2 CPU / 3.8 GiB RAM — large scale tests must be measured honestly.

## Exact unfinished task

Package Windows x64 artifacts when Electron can be installed; keep filling remaining UI depth (purchase orders, treatment catalog editor, attachment download) without regressing tests.

## Exact next action

1. Keep tests/typecheck/lint green after UI changes.
2. Commit implementation on `arena/01a0dbe6-dentiva-pro`.
3. Do not claim WINDOWS VALIDATED / SIGNED / PRODUCTION READY.

## Recovery instructions

1. Read this checkpoint and inspect `git status` / actual files.
2. Do **not** restart from zero.
3. Resume at **Exact next action**.
4. Run `npm test` and `npm run typecheck` as evidence; never trust prior claims.
5. Continue IMPLEMENT → TEST → AUDIT → FIX until the final release gate.
6. Tests require `NODE_OPTIONS=--experimental-sqlite` (also set in the npm `test` script and `scripts/dev.mjs`).
