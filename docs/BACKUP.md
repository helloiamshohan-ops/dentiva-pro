# Backup and restore

## Backup

Settings → **Backup now**, or command palette → Backup.

Each backup is a `.dvbak` zip containing:

- `manifest.json` — app version, schema version, SHA-256 of `clinic.db`
- `clinic.db` — consistent SQLite backup (WAL checkpointed copy)
- `attachments/` when present

History is paginated. Backups stay on this computer. Dentiva Pro does not upload them.

Default location: the clinic data directory `/backups`.

## Restore

1. Validate archive and reject path-traversal (zip-slip) entries
2. Validate manifest and checksum
3. Open the candidate database read-only and run integrity + schema checks
4. Copy the live database to `safety/`
5. Write `restore-in-progress.json`
6. Replace the live database
7. Verify the restored file
8. Remove the recovery marker only after success

If restore fails, the previous database is copied back. The application will not continue on a corrupt file.

Interrupted restore: on next launch, the recovery marker puts the safety copy back.
