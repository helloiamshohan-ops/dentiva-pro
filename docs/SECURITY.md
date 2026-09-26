# Security

- Local authentication only. Passwords are stored with scrypt. Never plaintext.
- Application lock and inactivity timeout.
- RBAC is enforced in services. Hiding a button is not the security boundary.
- Electron: `contextIsolation`, no `nodeIntegration`, sandbox, navigation lock.
- Attachments stored under the data directory with sanitized names. Path traversal is rejected.
- Restore rejects zip-slip and checksum mismatch.
- Audit log records login, clinical, financial, staff, settings, backup and restore events. Secrets are not stored.
- No activation, serial, license server, trial lock, or machine binding.
- Patient data is not sent to third-party analytics.

## Roles

| Role | Typical access |
|---|---|
| Administrator | All |
| Dentist | Patients, clinical, prescriptions, appointments, billing read |
| Receptionist | Patients, appointments, queue, billing write (no refunds) |
| Accountant | Billing, refunds, accounting, reports |
| Inventory Staff | Stock, purchases, adjustments |
