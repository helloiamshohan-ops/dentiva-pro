# Dentiva Pro

Premium dental clinic / dental practice management software for Windows x64.

Version **1.0.0**. Offline-first. English UI. Default currency **BDT**. Default timezone **Asia/Dhaka**.

Dentiva Pro is a clinical documentation and practice-management system. It does not diagnose, recommend treatment, or suggest prescriptions.

There is **no** activation, serial number, license key, trial lock, or machine binding. After installation the application launches normally.

## What it covers

Clinic setup, staff, local sign-in and app lock, patients and Patient 360, visits, FDI dental chart, prescriptions (C/C, O/E, R/E, Advice), treatment catalog and plans, appointments, daily queue, billing in integer paisa, payments (Cash, Bank, Card, bKash, Nagad, Rocket, Upay), receipts (A4 and 80mm), statements, accounting, inventory, search, command palette, reports, notifications, attachments, CSV import/export, backup and restore, diagnostics.

## Run from source

Requires Node.js 22+.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

`npm run dev` starts the API on port 4780 and the UI on port 5173 (all interfaces). Data is stored in `./data` during development.

```bash
npm run build
npm run dist:dir
```

Windows NSIS installer: `npm run dist:win` (requires a Windows environment or Wine). Portable/zip targets are also configured.

## Data location (installed)

- Windows: `%APPDATA%\DentivaPro`
- Database: `clinic.db`
- Backups: `backups\`
- Attachments: `attachments\`

## Documents

- [Architecture](docs/ARCHITECTURE.md)
- [Backup & restore](docs/BACKUP.md)
- [Security](docs/SECURITY.md)
- [Keyboard shortcuts](docs/KEYBOARD.md)
- [IPC inventory](docs/IPC_INVENTORY.md)
- [Requirement coverage](docs/REQUIREMENT_COVERAGE.md)
- [Forensic audit](docs/FORENSIC_AUDIT.md)
- [Release gate](docs/RELEASE_GATE.md)

## Tests

```bash
npm test
```

Unit, integration, security, PDF and scale tests run against a real SQLite database. Nothing is claimed tested unless the suite actually ran.
