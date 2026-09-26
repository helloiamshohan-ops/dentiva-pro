# IPC forensic inventory

Renderer never receives Node.js, filesystem, or SQL access. Privileged work is performed in the main/core process after session, role, permission, and input validation.

| Channel | Purpose | Auth | Permission | Filesystem | Sensitivity |
|---|---|---|---|---|---|
| meta:setup | First-run detection | no | — | no | low |
| auth:bootstrap | Create first administrator | no | — | no | high |
| auth:login | Local sign-in | no | — | no | high |
| auth:logout | Destroy session | yes | — | no | medium |
| auth:lock / unlock | App lock | yes | — | no | high |
| auth:session | Session read | yes | — | no | medium |
| api:call | Domain operations (`METHOD /api/...` or named `clinic.get` / `dashboard` / `search`) using the same handlers as HTTP | yes (except `/api/auth/*` and `/api/meta/setup`) | per-route | no | high |
| documents PDF HTTP | Generate PDF | yes | clinical/billing.read | yes (temp) | high |
| backup:create | Backup archive | yes | backup.create | yes | high |
| backup:restore | Restore archive | yes | backup.restore | yes | high |
| dialog:openBackup | Native file picker | yes | backup.restore | yes | high |
| dialog:savePdf | Native save dialog | yes | — | yes | medium |

There is no generic eval/exec IPC channel.

HTTP preview API uses the same services and the same permission checks.
