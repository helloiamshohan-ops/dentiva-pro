# Release gate — Dentiva Pro 1.0.0

## P0 — must be true to ship code

| Gate | Status |
|---|---|
| Typecheck | run in validation cycle |
| Lint | run in validation cycle |
| Unit + integration + e2e + security + pdf + scale | run in validation cycle |
| No activation/license lock | PASS |
| Money is integer paisa | PASS |
| Issued invoices immutable | PASS |
| Second visit isolation | PASS |
| Backup restore safety + crash recovery | PASS |
| RBAC enforced in services | PASS |
| IPC allow-list | PASS |

## P1 — must be true for a Windows installer

| Gate | Status |
|---|---|
| Electron binary available | BLOCKED (TLS). Do not retry the same npm fetch. |
| NSIS / portable / zip | BLOCKED (no Wine) |
| SHA256 of installer | BLOCKED until artifacts exist; script ready |
| Code signing | BLOCKED (no cert) |
| Clean install / uninstall on Windows | BLOCKED |

## P2 — polish verified in source

Keyboard, accessibility skip-link/focus/dialogs, print helper, paper sizes, saved views, command palette, diagnostics, audit log UI.

## Decision

**Code P0: GO** once the validation cycle on this host is green.  
**Installer P1: NO-GO** until a Windows/Electron build environment exists. Do not claim WINDOWS VALIDATED, SIGNED, or PRODUCTION READY for the packaged binary.
