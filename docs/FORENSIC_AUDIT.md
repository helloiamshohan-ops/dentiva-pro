# Final forensic audit — Dentiva Pro 1.0.0

Performed 2026-09-26 on Debian GNU/Linux 12, Node v22, branch `arena/01a0dbe6-dentiva-pro`.

## Product identity

Offline-first Windows x64 dental practice management. English UI. BDT / paisa integers. Asia/Dhaka. No diagnosis/treatment/prescription AI. No activation, serial, license, trial, or machine binding.

## Architecture boundary

Renderer has no Node, filesystem, or SQL. Privileged work is in core services after session + RBAC + Zod validation. Preload exposeInMainWorld allow-lists 10 channels. `api:call` shares HTTP handlers (`invokeIpc`).

## Security findings

| Check | Result |
|---|---|
| contextIsolation / no nodeIntegration / sandbox | present in `src/main/index.ts` |
| Navigation lock + external openExternal | present |
| scrypt password hashes | verified |
| Lockout after failed logins | verified |
| Zip-slip / path traversal | rejected |
| Attachment MIME allow-list | JPEG/PNG/WebP/GIF/PDF/TXT/DOCX |
| Secrets in audit log | metadata only; password hashes not logged |
| eval / new Function in src | none |
| Activation / license | none |

## Data integrity

WAL, foreign_keys ON, busy_timeout, transactional migrations, invoice CHECK `total = subtotal - discount + tax`. Crash marker `unclean-shutdown.json` written on boot, removed on clean close. Restore-in-progress marker restores the safety copy and is deleted after recovery.

## Financial integrity

Authoritative amounts are integer paisa. Issued invoices are not rewritten. Corrections: refund, adjustment, void. Overpay rejected. Payment idempotency keys. Outstanding = total − payments + refunds + adjustments.

## Clinical integrity

Visit 2 does not mutate visit 1. Chart uses FDI adult + primary. Procedures and treatment catalog never create invoices. Prescription stationery fields match C/C, O/E, R/E, Advice. Prescription PDF contains no money.

## Documents

Dedicated PDF engine (pdfkit), not screenshots. Papers: A4, A5, Letter, 80mm. Print via `printBlob`.

## What this host could not execute

Windows NSIS/portable/zip packaging, authenticode signing, Electron packaged runtime, physical print, 100K-patient wall-clock on Windows hardware. Those remain **BLOCKED BY ENVIRONMENT**, not unverified product omissions.

## Release recommendation

Ship the application code and tests as v1.0.0 **source-complete**. Produce the Windows installer only when Electron + Wine/NSIS (or a Windows builder) are available, then hash artifacts with `npx tsx scripts/hash-artifacts.ts`.
