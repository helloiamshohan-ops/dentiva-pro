# Operational guide

## First launch

1. Install and open Dentiva Pro.
2. Enter clinic name, administrator name, username and password.
3. Sign in.
4. Complete Settings (address, dentist, paper size, tax if any, backup folder).

## Daily clinic

1. Confirm today’s appointments.
2. Add arrivals to the queue (serials are independent of patient codes).
3. Open Patient 360 from search or the patient list.
4. Record the visit. Use the dental chart (FDI). Write the prescription (C/C, O/E, R/E, Advice). Treatment catalog items never create invoices by themselves.
5. Issue an invoice only when charging. Record payments (partial and multiple allowed). Print or save the receipt. 80mm layout is available for thermal printers.
6. Follow-ups and referrals stay on the patient record.

## Money

Amounts are stored as integer paisa. `subtotal − discount + tax = total`. Outstanding is `total − payments + refunds + adjustments`. Issued invoices are not silently rewritten; use refund or adjustment.

## Second visit

A later visit is a new record. Visit 1 findings and treatment remain unchanged.

## Import

CSV import previews, maps columns, reports row errors, and rolls back on catastrophic failure. Duplicates are warned, never merged automatically.
