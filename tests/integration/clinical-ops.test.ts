import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("clinical ops", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("records follow-ups and referrals without creating invoices", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const p = app.patients.create(actor, { fullName: "Follow Case", ignoreDuplicateWarning: true });
    const fu = app.clinical.createFollowup(actor, {
      patientId: p.id,
      dueAt: new Date("2026-06-01T09:00:00+06:00").toISOString(),
      reason: "Suture review",
    }) as { id: string; status: string };
    expect(fu.status).toBe("pending");
    app.clinical.completeFollowup(actor, fu.id);
    const listed = app.clinical.listFollowups(actor, { patientId: p.id });
    const done = (listed.items as Array<{ id: string; status: string }>).find((x) => x.id === fu.id);
    expect(done?.status).toBe("completed");
    app.clinical.createReferral(actor, {
      patientId: p.id,
      referredTo: "OMFS Dhaka",
      reason: "Impacted 38",
      referredAt: new Date().toISOString(),
    });
    expect(app.clinical.listReferrals(actor, p.id).length).toBe(1);
    expect(app.billing.listInvoices(actor, { patientId: p.id }).total).toBe(0);
  });

  it("rejects disallowed attachment types and stores allowed ones", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const p = app.patients.create(actor, { fullName: "Files", ignoreDuplicateWarning: true });
    expect(() =>
      app.attachments.add(actor, "patient", p.id, "payload.exe", Buffer.from("MZ"), "application/x-msdownload"),
    ).toThrow(/not allowed/i);
    const saved = app.attachments.add(actor, "patient", p.id, "note.txt", Buffer.from("ok"), "text/plain");
    expect(saved.filename).toBe("note.txt");
    const read = app.attachments.read(actor, saved.id);
    expect(read.data.toString("utf8")).toBe("ok");
  });

  it("pays a purchase without exceeding due and saves chairs", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const item = app.inventory.createItem(actor, { sku: "CEM-1", name: "Cement" });
    const po = app.inventory.createPurchase(actor, {
      purchasedAt: new Date("2026-04-01T09:00:00+06:00").toISOString(),
      lines: [{ itemId: item.id, quantity: 2, unitCostPaisa: 10000 }],
    }) as unknown as { id: string; total_paisa: number; paid_paisa: number; status: string };
    expect(po.total_paisa).toBe(20000);
    expect(() => app.inventory.payPurchase(actor, { id: po.id, amountPaisa: 20001 })).toThrow(/greater than the amount due/i);
    const partial = app.inventory.payPurchase(actor, { id: po.id, amountPaisa: 5000 }) as unknown as { paid_paisa: number; status: string };
    expect(partial.paid_paisa).toBe(5000);
    expect(partial.status).toBe("partial");
    const paid = app.inventory.payPurchase(actor, { id: po.id, amountPaisa: 15000 }) as unknown as { status: string; paid_paisa: number };
    expect(paid.status).toBe("paid");
    expect(paid.paid_paisa).toBe(20000);
    const chair = app.schedule.saveChair(actor, null, "Chair 3");
    expect(chair.name).toBe("Chair 3");
    expect(app.schedule.listChairs().some((c) => (c as { name: string }).name === "Chair 3")).toBe(true);
  });
});
