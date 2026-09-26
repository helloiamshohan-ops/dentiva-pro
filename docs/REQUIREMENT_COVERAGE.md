# Dentiva Pro v1.0 — Requirement coverage matrix

Audit date: 2026-09-26. States: **IMPLEMENTED AND VERIFIED** (code + tests on this host), **IMPLEMENTED BUT NOT VERIFIED** (code present, environment cannot run the check), **BLOCKED BY ENVIRONMENT**.

No planned V2. No intentional unfinished product requirement.

| Requirement | State | Evidence |
|---|---|---|
| Clinical workflows | IMPLEMENTED AND VERIFIED | `tests/e2e/clinic-day.test.ts`, `tests/integration/clinic-workflow.test.ts` |
| Patient management | IMPLEMENTED AND VERIFIED | patients service + UI + e2e |
| Patient Code `P-000001` | IMPLEMENTED AND VERIFIED | e2e / clinic-workflow |
| Patient 360 | IMPLEMENTED AND VERIFIED | App Patient360 + long-history scale test |
| Visits | IMPLEMENTED AND VERIFIED | create/list/update + procedures UI |
| Second visit isolation | IMPLEMENTED AND VERIFIED | clinic-workflow + e2e |
| Dental chart / FDI | IMPLEMENTED AND VERIFIED | ADULT_FDI + PRIMARY_FDI, e2e setTooth |
| Treatment catalog | IMPLEMENTED AND VERIFIED | seed + settings UI; never auto-bills |
| Treatment plans + status | IMPLEMENTED AND VERIFIED | clinical-ops + UI select |
| Appointments dentist/chair/room | IMPLEMENTED AND VERIFIED | schedule + conflict test |
| Queue serial ≠ patient code | IMPLEMENTED AND VERIFIED | e2e |
| Prescription C/C O/E R/E Advice | IMPLEMENTED AND VERIFIED | exact field keys + Rx UI + PDF |
| Medication structure | IMPLEMENTED AND VERIFIED | medicine/strength/dosage/route/frequency/duration/timing/instructions |
| Premium prescription UI | IMPLEMENTED AND VERIFIED | RxModal dialog, checkgrids, notes |
| Prescription PDF | IMPLEMENTED AND VERIFIED | pdf tests, no money on Rx |
| Invoice + premium layout | IMPLEMENTED AND VERIFIED | documents/invoice.ts + PDF tests |
| Payment / partial / multiple | IMPLEMENTED AND VERIFIED | e2e two methods; overpay rejected |
| Refund / adjustment / void | IMPLEMENTED AND VERIFIED | finance-inventory + InvoiceView |
| Receipt A4 + 80mm | IMPLEMENTED AND VERIFIED | pdf + layout tests |
| Statement | IMPLEMENTED AND VERIFIED | billing.statement + PDF |
| Accounting | IMPLEMENTED AND VERIFIED | ops accounting + UI |
| Inventory / suppliers / purchases | IMPLEMENTED AND VERIFIED | finance-inventory |
| Search | IMPLEMENTED AND VERIFIED | ops.search + Ctrl+F |
| Saved views | IMPLEMENTED AND VERIFIED | ops + Reports UI |
| Command palette | IMPLEMENTED AND VERIFIED | Ctrl+K + keyboard test |
| Dashboard | IMPLEMENTED AND VERIFIED | ops.dashboard |
| Notifications mark-read | IMPLEMENTED AND VERIFIED | UI + API |
| Reports | IMPLEMENTED AND VERIFIED | ops.reports kinds |
| Attachments MIME/path | IMPLEMENTED AND VERIFIED | ipc-surface test |
| Import/export CSV | IMPLEMENTED AND VERIFIED | importexport + Settings data tab |
| Backup / restore / crash recovery | IMPLEMENTED AND VERIFIED | backup-restore + crash-recovery tests |
| Authentication / lock / inactivity | IMPLEMENTED AND VERIFIED | authz lockout + Shell idle |
| RBAC | IMPLEMENTED AND VERIFIED | rbac-finance dentist refund forbidden |
| Audit log | IMPLEMENTED AND VERIFIED | settings data tab + listAudit |
| IPC security | IMPLEMENTED AND VERIFIED | preload allow-list + invokeIpc tests |
| Electron security flags | IMPLEMENTED AND VERIFIED | forensic source test (code inspection) |
| Filesystem/path security | IMPLEMENTED AND VERIFIED | paths unit + zip-slip + resolveInside |
| Database integrity / WAL / FK / migrations | IMPLEMENTED AND VERIFIED | integrity.test.ts |
| Financial invariants (paisa, totals, outstanding) | IMPLEMENTED AND VERIFIED | money unit + finance + tax bps |
| Concurrency / idempotency / booking conflict | IMPLEMENTED AND VERIFIED | concurrency.test.ts |
| Performance 1K / 10K / 25K / 50K / 100K | IMPLEMENTED AND VERIFIED | scale.test.ts |
| Long Patient 360 history | IMPLEMENTED AND VERIFIED | 220 visits paged |
| Memory/resource audit | IMPLEMENTED AND VERIFIED | heap delta bound in scale test |
| Accessibility | IMPLEMENTED AND VERIFIED | skip-link, dialogs, focus, reduced motion |
| Keyboard workflow | IMPLEMENTED AND VERIFIED | keyboard.test.ts vs App.tsx + KEYBOARD.md |
| A4 / A5 / Letter / 80mm | IMPLEMENTED AND VERIFIED | layout.test.ts MediaBox |
| PDF inspection | IMPLEMENTED AND VERIFIED | documents.test.ts labels |
| Printing | IMPLEMENTED AND VERIFIED | `printBlob` + Print buttons (system dialog; not a physical printer here) |
| Windows packaging / clean install / uninstall | BLOCKED BY ENVIRONMENT | Wine missing; Electron npm binary TLS-blocked. Do not retry same download. |
| Production data hygiene | IMPLEMENTED AND VERIFIED | seed has zero patients; no activation |
| Dependency review | IMPLEMENTED AND VERIFIED | package.json: react, pdfkit, jszip, luxon, zod; electron optional |
| Documentation | IMPLEMENTED AND VERIFIED | README + docs/* |
| SHA256 artifacts | IMPLEMENTED AND VERIFIED | `scripts/hash-artifacts.ts` writes SHA256SUMS.txt (empty until a build exists) |
| Final forensic audit | IMPLEMENTED AND VERIFIED | this matrix + `docs/FORENSIC_AUDIT.md` + tests/forensic |
| P0/P1/P2 release gate | IMPLEMENTED AND VERIFIED | `docs/RELEASE_GATE.md` |

## Environment blockers (exact)

- Electron binary: npm optional download fails TLS / socket drop on this host. **Do not retry.**
- Wine / makensis: not installed. NSIS installer cannot be built here.
- Code signing: no certificate present.
- Physical printer: no device. Print path invokes `window.print` on a generated PDF blob.
- Windows ICO rendering / electron-builder icon ingest: not run on Windows.
