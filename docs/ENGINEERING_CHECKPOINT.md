# Dentiva Pro — Engineering Checkpoint

**Product:** Dentiva Pro v1.0.0  
**Platform:** Windows x64 desktop (offline-first)  
**Session branch:** `arena/01a0dbe6-dentiva-pro`  
**Updated:** 2026-09-26

## Current phase

**IMPLEMENTATION / TEST** — visit procedures UI, plan status, notification mark-read, ICO container.

## Current subphase

Typecheck, lint, and 43 vitest tests green on this Linux host. Electron binary download remains blocked (TLS). Windows NSIS packaging remains blocked (no Wine).

## Current objective

Keep tests green. Package Windows x64 only when Electron can be installed.

## Repository ground truth

- Branch: `arena/01a0dbe6-dentiva-pro`
- Last pushed before this pass: `7dde766`

## Environment

- OS: Debian GNU/Linux 12 (bookworm), x86_64
- Node: v22.22.3 (`node:sqlite` experimental)
- Wine: not present
- Electron npm binary: not installed. Do not retry the same download.
- Code signing: not present

## Completed requirements

- [x] Core domains and commercial UI workflows
- [x] Ctrl+S / Ctrl+Shift+P, invoice adjustments, audit log, clinic inactivity minutes
- [x] Visit procedures (optional; never auto-invoice), plan status select, notification mark-read
- [x] `resources/icons/icon.ico` is an ICO container wrapping a PNG (not raw PNG magic)
- [x] Tests (43 passing on this host)
- [ ] Windows package / signed installer

## Verified requirements

- `npx tsc --noEmit -p tsconfig.json` — green (Electron `src/main` + `src/preload` excluded)
- `npx eslint . --ext .ts,.tsx --max-warnings 0` — green
- `NODE_OPTIONS=--experimental-sqlite npx vitest run` — 11 files, 43 tests passed

**Not verified:** Windows install/uninstall, NSIS, code signing, Electron packaged runtime, 100K-patient scale, Windows ICO rendering / electron-builder icon ingest.

## Test results

11 files / 43 tests passed, including visit procedures without invoice and plan status change without invoice.

## Known defects

- Electron binary missing; desktop packaging cannot run here.
- Electron IPC `api:call` dispatch remains a stub; packaged app uses loopback HTTP.
- ICO is a single PNG-in-ICO wrapper; not validated on Windows.

## Blocked items

- Windows NSIS: Wine not present.
- Electron download: TLS / socket drop. Do not retry the same npm electron fetch.
- Code signing: not present.

## Exact unfinished task

IPC `api:call` full route dispatch (share HTTP handlers). Windows packaging when the environment allows.

## Exact next action

1. Keep tests/typecheck/lint green.
2. Commit and push `arena/01a0dbe6-dentiva-pro`.
3. Implement IPC dispatch using the HTTP route table (do not retry Electron download).
4. Do not claim WINDOWS VALIDATED / SIGNED / PRODUCTION READY.

## Recovery instructions

1. Read this checkpoint and inspect `git status`.
2. Do **not** restart from zero.
3. Resume at **Exact next action**.
4. Run `npm test` and `npm run typecheck` as evidence.
5. Tests require `NODE_OPTIONS=--experimental-sqlite`.
