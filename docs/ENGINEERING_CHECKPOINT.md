# Dentiva Pro — Engineering Checkpoint

**Product:** Dentiva Pro v1.0.0  
**Platform:** Windows x64 desktop (offline-first)  
**Session branch:** `arena/01a0dbe6-dentiva-pro`  
**Updated:** 2026-09-26

## Current phase

**IMPLEMENTATION / TEST** — remaining commercial UI/ops: purchases pay, chairs/rooms, follow-ups, referrals, attachment MIME.

## Current subphase

Typecheck, lint, and 40 vitest tests green on this Linux host. Electron binary download remains blocked (TLS). Windows NSIS packaging remains blocked (no Wine).

## Current objective

Keep tests green. Package Windows x64 only when Electron can be installed.

## Repository ground truth

- Branch: `arena/01a0dbe6-dentiva-pro`
- Last pushed: `76d961d` plus this continue pass

## Environment

- OS: Debian GNU/Linux 12 (bookworm), x86_64
- Node: v22.22.3 (`node:sqlite` experimental)
- Wine: not present
- Electron npm binary: not installed. Do not retry the same download.
- Code signing: not present

## Completed requirements

- [x] Core domains, Patient 360, billing, inventory purchases + pay, catalog
- [x] Follow-ups, referrals, chairs/rooms editor, attachment MIME allow-list
- [x] Tests (40 passing on this host)
- [ ] Windows package / signed installer

## Verified requirements

- `npx tsc --noEmit -p tsconfig.json` — green (Electron `src/main` + `src/preload` excluded)
- `npx eslint . --ext .ts,.tsx --max-warnings 0` — green
- `NODE_OPTIONS=--experimental-sqlite npx vitest run` — 11 files, 40 tests passed

**Not verified:** Windows install/uninstall, NSIS, code signing, Electron packaged runtime, 100K-patient scale.

## Test results

11 files / 40 tests passed, including clinical-ops (follow-up/referral, MIME reject, purchase pay, chairs).

## Known defects

- Electron binary missing; desktop packaging cannot run here.
- `icon.ico` is PNG bytes.
- Electron IPC `api:call` dispatch remains a stub; packaged app uses loopback HTTP.

## Blocked items

- Windows NSIS: Wine not present.
- Electron download: TLS / socket drop. Do not retry the same npm electron fetch.
- Code signing: not present.

## Exact unfinished task

Windows packaging when the environment allows; optional remaining polish (appointment dentist/chair picker, purchase supplier link on receive form).

## Exact next action

1. Keep tests/typecheck/lint green.
2. Commit and push `arena/01a0dbe6-dentiva-pro`.
3. Do not claim WINDOWS VALIDATED / SIGNED / PRODUCTION READY.

## Recovery instructions

1. Read this checkpoint and inspect `git status`.
2. Do **not** restart from zero.
3. Resume at **Exact next action**.
4. Run `npm test` and `npm run typecheck` as evidence.
5. Tests require `NODE_OPTIONS=--experimental-sqlite`.
