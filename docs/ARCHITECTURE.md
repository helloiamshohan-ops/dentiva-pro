# Dentiva Pro Architecture

**Version:** 1.0.0  
**Product:** Premium Dental Clinic / Practice Management (Windows x64 desktop)  
**Principle:** Offline-first, transactional, secure, clinically coherent, financially correct.

## 1. System shape

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React)  — no Node, no filesystem, no SQL       │
│  Premium UI, keyboard workflows, design tokens           │
└──────────────────────────┬───────────────────────────────┘
                           │ contextBridge (Electron)
                           │ or sessioned HTTP (dev preview)
┌──────────────────────────▼───────────────────────────────┐
│ Preload / API boundary                                   │
│  Explicit channels only, Zod-validated payloads          │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────┐
│ Main / Core process                                      │
│  Session + RBAC → Domain services → Repositories         │
│  SQLite (WAL, FK, transactions)                          │
│  PDF engine, backup/restore, attachments, audit          │
└──────────────────────────────────────────────────────────┘
```

Renderer never receives unrestricted Node.js access. Privileged work happens only in core services after session, role, permission, and input validation.

## 2. Processes

| Process | Responsibility |
|---|---|
| Electron main | Window lifecycle, IPC, dialogs, paths, crash markers |
| Core services | All business rules, SQL, money, documents, backup |
| Preload | `contextIsolation` bridge exposing `window.dentiva` |
| Renderer | UI only |
| Dev HTTP API | Same services as IPC, for browser preview and tests |

## 3. Data

- Engine: SQLite via Node.js `node:sqlite` (`DatabaseSync`, WAL)
- Journal: WAL
- Foreign keys: ON
- Money: integer **paisa** (1 BDT = 100 paisa). No float as source of truth.
- Time: stored UTC ISO-8601; displayed in clinic timezone (default `Asia/Dhaka`)
- IDs: UUID primary keys + human-readable stable codes
- Migrations: ordered, version-tracked, transactional

## 4. Identity numbers (never mixed)

| Kind | Pattern | Unique |
|---|---|---|
| Patient Code | `P-000001` | stable, never changes with name |
| Invoice | `INV-2026-000001` | per year sequence |
| Receipt | `RCT-2026-000001` | per year sequence |
| Queue serial | daily integer | unique per clinic day |
| Appointment | UUID | not shown as patient code |

## 5. Financial model

```
line_total  = quantity * unit_price - line_discount
subtotal    = Σ line_total
total       = subtotal - invoice_discount + tax
outstanding = total - payments + refunds + adjustments
```

All terms integer paisa. Completed financial records are not silently rewritten; corrections use refund / adjustment / void with audit.

Payment methods: Cash, Bank, Card, bKash, Nagad, Rocket, Upay.

## 6. Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Navigation locked; external URLs via allow-listed `shell.openExternal`
- Passwords: Node `scrypt` (no plaintext)
- Sessions, lock, inactivity timeout, failed-attempt backoff
- RBAC enforced in services, not by hiding buttons
- Path normalization; zip-slip rejection on restore
- Attachments stored under data dir with sanitized names
- No activation, serial, license, trial, or machine binding

## 7. Documents

Separate engines and numbering:

- **Prescription** — clinical stationery; no money
- **Invoice** — charge document
- **Receipt** — payment acknowledgement (A4 and 80mm)
- **Statement** — running balance history

PDF is generated from a dedicated layout engine, not by screenshotting the UI.

## 8. Backup / restore

Backup = consistent SQLite backup + manifest (app version, schema version, checksum) + attachments, packed as `.dvbak` (zip).

Restore:

1. Validate archive and reject zip-slip
2. Validate manifest + checksum + schema compatibility
3. Safety-copy live database
4. Write crash/recovery marker
5. Replace only after integrity check
6. Verify opened database
7. Clear marker only on success

Failure leaves the original database recoverable.

## 9. Module map

```
src/shared     constants, DTO types
src/core       domain, db, services, documents, backup
src/main       Electron main, IPC inventory
src/preload    contextBridge
src/renderer   design system + screens
src/server     preview/test HTTP API
tests          unit, integration, e2e, security, pdf, performance
```

## 10. Test strategy

- Unit: money, IDs, validation, RBAC, financial math, path security
- Integration: migrations, services, transactions, backup/restore
- E2E: full clinic workflow including second visit
- Security: IPC surface, authz bypass, zip-slip, path traversal
- PDF: generated files parsed for required labels and totals
- Performance: search, dashboard, Patient 360, scale seeds

## 11. Release

Windows x64 NSIS + portable + zip via electron-builder. Signing only if infrastructure exists. Artifacts hashed with SHA-256.
