import React, { useCallback, useEffect, useRef, useState } from "react";
import { CC_FIELDS, OE_FIELDS, PAYMENT_METHOD_LABELS, ROLE_LABELS, ROLES, SHORTCUTS, ADULT_FDI, PRIMARY_FDI, TOOTH_STATES } from "../shared/constants.ts";
import type { SessionInfo } from "../shared/types.ts";
import { api, ApiError, AuthApi, downloadBlob, formatMoney, getToken, setToken, todayIsoDate, nowIso } from "./api.ts";

type Route = { name: string; id?: string; tab?: string };

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [name, id, tab] = raw.split("/");
  return { name: name || "dashboard", id, tab };
}

function go(path: string) {
  location.hash = `#/${path.replace(/^\//, "")}`;
}

function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

type Toast = { id: number; text: string };
const ToastCtx = React.createContext<(t: string) => void>(() => undefined);

export function App() {
  const [boot, setBoot] = useState<"load" | "setup" | "login" | "app">("load");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await AuthApi.setup();
        if (s.needsSetup) {
          setBoot("setup");
          return;
        }
        if (getToken()) {
          try {
            const sess = await AuthApi.session();
            setSession(sess);
            setBoot(sess.locked ? "login" : "app");
            return;
          } catch {
            setToken(null);
          }
        }
        setBoot("login");
      } catch {
        setBoot("login");
      }
    })();
  }, []);

  if (boot === "load") {
    return (
      <div className="login">
        <div className="card login-card">
          <div className="skel" style={{ width: 180, height: 22 }} />
          <div className="skel" style={{ width: "100%", height: 12, marginTop: 16 }} />
        </div>
      </div>
    );
  }
  if (boot === "setup") return <Setup onDone={() => setBoot("login")} toast={toast} />;
  if (boot !== "app" || !session || session.locked) {
    return (
      <>
        <Login
          locked={Boolean(session?.locked)}
          onSession={(s, token) => {
            setToken(token);
            setSession(s);
            if (!s.locked) setBoot("app");
          }}
          toast={toast}
        />
        <Toasts items={toasts} />
      </>
    );
  }
  return (
    <ToastCtx.Provider value={toast}>
      <Shell session={session} setSession={setSession} />
      <Toasts items={toasts} />
    </ToastCtx.Provider>
  );
}

function Toasts({ items }: { items: Toast[] }) {
  if (!items.length) return null;
  return (
    <div className="toast-wrap">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Setup({ onDone, toast }: { onDone: () => void; toast: (s: string) => void }) {
  const [form, setForm] = useState({ clinicName: "", adminName: "", username: "admin", password: "" });
  const [err, setErr] = useState("");
  return (
    <div className="login">
      <form
        className="card login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            await AuthApi.bootstrap(form);
            toast("Clinic created. Sign in to continue.");
            onDone();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to complete setup.");
          }
        }}
      >
        <div className="brand" style={{ padding: 0, border: 0, marginBottom: 12 }}>
          <div className="brand-mark">D</div>
          <div>
            <h1>Dentiva Pro</h1>
            <small>Clinic setup</small>
          </div>
        </div>
        <p style={{ color: "var(--color-muted)", marginBottom: 18 }}>Create the clinic record and the first administrator. No internet is required.</p>
        {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="grid" style={{ gap: 12 }}>
          <Field label="Clinic name" value={form.clinicName} onChange={(v) => setForm({ ...form, clinicName: v })} />
          <Field label="Administrator name" value={form.adminName} onChange={(v) => setForm({ ...form, adminName: v })} />
          <Field label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
          <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 18, width: "100%" }} type="submit">
          Create clinic
        </button>
      </form>
    </div>
  );
}

function Login({
  locked,
  onSession,
  toast,
}: {
  locked: boolean;
  onSession: (s: SessionInfo, token: string) => void;
  toast: (s: string) => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="login">
      <form
        className="card login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            if (locked) {
              const s = await AuthApi.unlock(password);
              onSession(s, getToken() || "");
              toast("Unlocked.");
            } else {
              const r = await AuthApi.login(username, password);
              onSession(r.session, r.token);
            }
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to sign in.");
          }
        }}
      >
        <div className="brand" style={{ padding: 0, border: 0, marginBottom: 12 }}>
          <div className="brand-mark">D</div>
          <div>
            <h1>Dentiva Pro</h1>
            <small>{locked ? "Application locked" : "Sign in"}</small>
          </div>
        </div>
        {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}
        {!locked && <Field label="Username" value={username} onChange={setUsername} />}
        <div style={{ height: 12 }} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        <button className="btn btn-primary" style={{ marginTop: 18, width: "100%" }} type="submit">
          {locked ? "Unlock" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Shell({ session, setSession }: { session: SessionInfo; setSession: (s: SessionInfo) => void }) {
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let idle = 0;
    const timeoutMs = 15 * 60 * 1000;
    const bump = () => {
      idle = Date.now();
    };
    bump();
    const timer = window.setInterval(() => {
      if (Date.now() - idle >= timeoutMs) {
        void AuthApi.lock().then(setSession);
      }
    }, 30000);
    window.addEventListener("keydown", bump);
    window.addEventListener("pointerdown", bump);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("pointerdown", bump);
    };
  }, [setSession]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        go("patients/new");
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        go("visits/new");
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        go("appointments/new");
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        go("billing/new");
      }
      if (meta && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void AuthApi.lock().then(setSession);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSession]);

  const nav = [
    ["dashboard", "Dashboard"],
    ["queue", "Queue"],
    ["patients", "Patients"],
    ["appointments", "Appointments"],
    ["billing", "Billing"],
    ["inventory", "Inventory"],
    ["accounting", "Accounting"],
    ["reports", "Reports"],
    ["notifications", "Notifications"],
    ["settings", "Settings"],
  ] as const;

  return (
    <div className="app-shell">
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        Skip to content
      </button>
      <aside className="sidebar" aria-label="Clinic navigation">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <h1>Dentiva Pro</h1>
            <small>{session.clinicName || "Practice"}</small>
          </div>
        </div>
        <nav className="nav">
          {nav.map(([id, label]) => (
            <button key={id} className={route.name === id ? "active" : ""} aria-current={route.name === id ? "page" : undefined} onClick={() => go(id)}>
              <span className="label">{label}</span>
            </button>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: 16, color: "var(--color-sidebar-muted)", fontSize: 12 }}>
          {session.name}
          <div>{session.role.replace("_", " ")}</div>
        </div>
      </aside>
      <div className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <button className="search-chip" onClick={() => setSearchOpen(true)}>
            Search patients, invoices, visits — Ctrl+F
          </button>
          <button className="btn btn-secondary" onClick={() => setPalette(true)}>
            Ctrl+K
          </button>
          <button className="btn btn-secondary" onClick={() => void AuthApi.lock().then(setSession)}>
            Lock
          </button>
          <button
            className="btn btn-tertiary"
            onClick={async () => {
              await AuthApi.logout();
              setToken(null);
              location.reload();
            }}
          >
            Sign out
          </button>
        </header>
        <div className="page">
          {route.name === "dashboard" && <Dashboard />}
          {route.name === "patients" && !route.id && <Patients />}
          {route.name === "patients" && route.id === "new" && <PatientForm onSaved={(id) => go(`patients/${id}`)} />}
          {route.name === "patients" && route.id && route.id !== "new" && <Patient360 id={route.id} tab={route.tab} />}
          {route.name === "queue" && <Queue />}
          {route.name === "appointments" && <Appointments />}
          {route.name === "billing" && !route.id && <Billing />}
          {route.name === "billing" && route.id === "new" && <InvoiceForm />}
          {route.name === "billing" && route.id && route.id !== "new" && <InvoiceView id={route.id} />}
          {route.name === "inventory" && <Inventory />}
          {route.name === "accounting" && <Accounting />}
          {route.name === "reports" && <Reports />}
          {route.name === "notifications" && <Notifications />}
          {route.name === "settings" && <Settings session={session} />}
          {route.name === "visits" && route.id === "new" && <VisitForm />}
        </div>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<Record<string, unknown>>("/api/dashboard")
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="alert error">{err}</div>;
  if (!data) return <div className="skel" style={{ height: 80 }} />;
  const today = data.today as Record<string, number>;
  return (
    <>
      <PageHead title="Today" sub="Live clinic operations — real figures only." actions={<button className="btn btn-primary" onClick={() => go("patients/new")}>New patient</button>} />
      <div className="grid grid-4">
        <Kpi label="Appointments" value={String(today.appointments)} />
        <Kpi label="Waiting" value={String(today.queueWaiting)} />
        <Kpi label="Collected" value={formatMoney(Number(today.collected || 0))} />
        <Kpi label="Outstanding" value={formatMoney(Number(today.outstanding || 0))} />
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 className="section">Upcoming</h3>
          <SimpleList
            rows={((data.upcoming as Array<{ id: string; starts_at: string; full_name: string; code: string }>) || []).map((r) => ({ ...r, id: String(r.id) }))}
            empty="No upcoming appointments."
            render={(r) => (
              <div>
                <strong>{String(r.full_name)}</strong> <span className="badge">{String(r.code)}</span>
                <div style={{ color: "var(--color-muted)", fontSize: 12 }}>{String(r.starts_at)}</div>
              </div>
            )}
          />
        </div>
        <div className="card">
          <h3>Waiting</h3>
          <SimpleList
            rows={((data.waiting as Array<{ id: string; serial: number; full_name: string; code: string }>) || []).map((r) => ({ ...r, id: String(r.id) }))}
            empty="Queue is clear."
            render={(r) => (
              <div>
                <strong>#{String(r.serial).padStart(3, "0")}</strong> {String(r.full_name)} <span className="badge">{String(r.code)}</span>
              </div>
            )}
          />
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value tabular">{value}</div>
    </div>
  );
}

type ListRow = { id: string } & Record<string, unknown>;

function SimpleList({ rows, empty, render }: { rows: ListRow[]; empty: string; render: (r: ListRow) => React.ReactNode }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-line)" }}>
          {render(r)}
        </div>
      ))}
    </div>
  );
}

function Patients() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ items: Array<Record<string, unknown>>; total: number; page: number } | null>(null);
  const load = useCallback(async (page = 1) => {
    const r = await api<{ items: Array<Record<string, unknown>>; total: number; page: number }>("/api/patients/list", {
      method: "POST",
      json: { search: q, page, pageSize: 50 },
    });
    setData(r);
  }, [q]);
  useEffect(() => {
    void load(1);
  }, [load]);
  return (
    <>
      <PageHead
        title="Patients"
        sub={data ? `${data.total} records` : "Loading"}
        actions={
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code, phone" />
            <button className="btn btn-primary" onClick={() => go("patients/new")}>
              New patient
            </button>
          </>
        }
      />
      {!data ? (
        <div className="skel" style={{ height: 200 }} />
      ) : !data.items.length ? (
        <div className="card empty">
          <h3>No patients yet</h3>
          <p>Create the first patient to begin clinical work.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Age</th>
                <th className="num">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={String(p.id)} onClick={() => go(`patients/${p.id}`)} style={{ cursor: "pointer" }}>
                  <td>{String(p.code)}</td>
                  <td>
                    {String(p.fullName)} {p.allergyAlert ? <span className="badge badge-danger">Allergy</span> : null}
                  </td>
                  <td>{String(p.phone || "—")}</td>
                  <td>{p.age != null ? `${p.age}y` : "—"}</td>
                  <td className="num">{formatMoney(Number(p.outstandingPaisa || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PatientForm({ onSaved, existing }: { onSaved: (id: string) => void; existing?: Record<string, unknown> }) {
  const toast = React.useContext(ToastCtx);
  const [form, setForm] = useState({
    fullName: String(existing?.fullName || ""),
    phone: String(existing?.phone || ""),
    email: String(existing?.email || ""),
    dateOfBirth: String(existing?.dateOfBirth || ""),
    gender: String(existing?.gender || ""),
    address: String(existing?.address || ""),
    allergies: "",
    allergyAlert: false,
    medications: "",
    chronicConditions: "",
    history: "",
    dentalHistory: "",
    ignoreDuplicateWarning: false,
  });
  const [dupes, setDupes] = useState<Array<{ code: string; fullName: string; reasons: string[] }>>([]);
  const [err, setErr] = useState("");
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <>
      <PageHead title={existing ? "Edit patient" : "New patient"} />
      {err && <div className="alert error">{err}</div>}
      {dupes.length > 0 && (
        <div className="alert" style={{ marginBottom: 12 }}>
          Possible duplicates: {dupes.map((d) => `${d.code} ${d.fullName} (${d.reasons.join(", ")})`).join(" · ")}
        </div>
      )}
      <form
        className="card grid grid-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            const body = {
              fullName: form.fullName,
              phone: form.phone,
              email: form.email,
              dateOfBirth: form.dateOfBirth,
              gender: form.gender,
              address: form.address,
              ignoreDuplicateWarning: form.ignoreDuplicateWarning,
              medical: {
                allergies: form.allergies,
                allergyAlert: form.allergyAlert,
                medications: form.medications,
                chronicConditions: form.chronicConditions,
                history: form.history,
              },
              dental: { history: form.dentalHistory },
            };
            const saved = existing
              ? await api<{ id: string }>("/api/patients", { method: "PUT", json: { id: existing.id, ...body } })
              : await api<{ id: string }>("/api/patients", { method: "POST", json: body });
            toast("Patient saved.");
            onSaved(saved.id);
          } catch (ex) {
            if (ex instanceof ApiError && ex.code === "CONFLICT") {
              const d = (ex.details as { duplicates?: typeof dupes })?.duplicates || [];
              setDupes(d);
              setErr(ex.message);
              return;
            }
            setErr(ex instanceof Error ? ex.message : "Unable to save the patient.");
          }
        }}
      >
        <Field label="Full name" value={form.fullName} onChange={(v) => set("fullName", v)} />
        <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
        <Field label="Email" value={form.email} onChange={(v) => set("email", v)} />
        <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} />
        <Field label="Gender" value={form.gender} onChange={(v) => set("gender", v)} />
        <Field label="Address" value={form.address} onChange={(v) => set("address", v)} />
        <Field label="Allergies" value={form.allergies} onChange={(v) => set("allergies", v)} />
        <label className="field">
          <span>Allergy alert</span>
          <input type="checkbox" checked={form.allergyAlert} onChange={(e) => set("allergyAlert", e.target.checked)} />
        </label>
        <Field label="Medications" value={form.medications} onChange={(v) => set("medications", v)} />
        <Field label="Chronic conditions" value={form.chronicConditions} onChange={(v) => set("chronicConditions", v)} />
        <Field label="Medical history" value={form.history} onChange={(v) => set("history", v)} />
        <Field label="Dental history" value={form.dentalHistory} onChange={(v) => set("dentalHistory", v)} />
        {dupes.length > 0 && (
          <label className="field">
            <span>Create anyway</span>
            <input type="checkbox" checked={form.ignoreDuplicateWarning} onChange={(e) => set("ignoreDuplicateWarning", e.target.checked)} />
          </label>
        )}
        <div className="row" style={{ gridColumn: "1 / -1" }}>
          <button className="btn btn-primary" type="submit">
            Save
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => history.back()}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

function Patient360({ id, tab }: { id: string; tab?: string }) {
  const [p, setP] = useState<Record<string, unknown> | null>(null);
  const [medical, setMedical] = useState<Record<string, unknown> | null>(null);
  const [active, setActive] = useState(tab || "overview");
  useEffect(() => {
    void api<Record<string, unknown>>(`/api/patients/get?id=${id}`).then(setP);
    void api<Record<string, unknown>>(`/api/patients/medical?id=${id}`).then(setMedical);
  }, [id]);
  if (!p) return <div className="skel" style={{ height: 120 }} />;
  const tabs = ["overview", "timeline", "visits", "chart", "prescriptions", "plans", "appointments", "billing", "attachments", "notes"];
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)" }}>{String(p.code)}</div>
            <h2>{String(p.fullName)}</h2>
            <p>
              {[p.age != null ? `${p.age}y` : null, p.gender, p.phone].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="row">
            {p.allergyAlert ? <span className="badge badge-danger">Allergy alert</span> : null}
            <span className="badge">{formatMoney(Number(p.outstandingPaisa || 0))} due</span>
            <button className="btn btn-secondary" onClick={() => go(`visits/new?patient=${id}`)}>
              New visit
            </button>
            <button className="btn btn-primary" onClick={() => go(`billing/new?patient=${id}`)}>
              Invoice
            </button>
          </div>
        </div>
        {medical && String(medical.allergies || "") ? <div className="alert" style={{ marginTop: 12 }}>{String(medical.allergies)}</div> : null}
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={active === t ? "active" : ""} onClick={() => setActive(t)}>
            {t}
          </button>
        ))}
      </div>
      {active === "overview" && <Overview patientId={id} patient={p} medical={medical} />}
      {active === "timeline" && <Timeline patientId={id} />}
      {active === "visits" && <VisitList patientId={id} />}
      {active === "chart" && <Chart patientId={id} />}
      {active === "prescriptions" && <RxList patientId={id} />}
      {active === "plans" && <Plans patientId={id} />}
      {active === "appointments" && <ApptList patientId={id} />}
      {active === "billing" && <PatientBilling patientId={id} />}
      {active === "attachments" && <AttachList patientId={id} />}
      {active === "notes" && <div className="card">{String(p.notes || "No notes.")}</div>}
      {/* Patient 360 workspace */}
    </>
  );
}

function Overview({ patientId, patient, medical }: { patientId: string; patient: Record<string, unknown>; medical: Record<string, unknown> | null }) {
  const [tl, setTl] = useState<{ items: Array<Record<string, string>>; total: number } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, string>>; total: number }>(`/api/timeline?patientId=${patientId}&page=1&pageSize=8`).then(setTl);
  }, [patientId]);
  return (
    <div className="grid grid-2">
      <div className="card">
        <h3>Clinical summary</h3>
        <p style={{ marginTop: 8 }}>Medications: {String(medical?.medications || "—")}</p>
        <p>Chronic: {String(medical?.chronicConditions || "—")}</p>
        <p>Outstanding: {formatMoney(Number(patient.outstandingPaisa || 0))}</p>
      </div>
      <div className="card">
        <h3>Recent activity ({tl?.total ?? 0})</h3>
        <SimpleList rows={(tl?.items || []).map((i) => ({ ...i, id: String(i.id) }))} empty="No history yet." render={(r) => <div><strong>{String(r.title)}</strong> · {String(r.at)}</div>} />
      </div>
    </div>
  );
}

function Timeline({ patientId }: { patientId: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Array<Record<string, string>>; total: number; page: number } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, string>>; total: number; page: number }>(`/api/timeline?patientId=${patientId}&page=${page}&pageSize=50`).then(setData);
  }, [patientId, page]);
  if (!data) return <div className="skel" style={{ height: 120 }} />;
  return (
    <div className="card">
      <p style={{ marginBottom: 8 }}>{data.total} events — complete history, paginated.</p>
      <SimpleList
        rows={data.items.map((i) => ({ ...i, id: String(i.id) }))}
        empty="No timeline events."
        render={(r) => (
          <div>
            <strong>{String(r.title)}</strong>
            <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{String(r.at)} · {String(r.kind)}</div>
            <div>{String(r.body)}</div>
          </div>
        )}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button className="btn btn-secondary" disabled={page * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function VisitList({ patientId }: { patientId: string }) {
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>("/api/visits/list", { method: "POST", json: { patientId, page: 1, pageSize: 50 } }).then(setData);
  }, [patientId]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3>Visits</h3>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          New visit
        </button>
      </div>
      <SimpleList
        rows={(data?.items || []).map((v) => ({ ...v, id: String(v.id) }))}
        empty="No visits yet."
        render={(v) => (
          <div>
            <strong>{String(v.visitedAt)}</strong> — {String(v.chiefComplaint || "Visit")}
          </div>
        )}
      />
      {open && <VisitModal patientId={patientId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void api<{ items: Array<Record<string, unknown>> }>("/api/visits/list", { method: "POST", json: { patientId } }).then(setData); }} />}
    </div>
  );
}

function VisitModal({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ visitedAt: nowIso(), chiefComplaint: "", findings: "", diagnosis: "", treatmentPerformed: "", notes: "" });
  const [err, setErr] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/visits", { method: "POST", json: { patientId, ...form } });
            onSaved();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to save the visit.");
          }
        }}
      >
        <h2>New visit</h2>
        {err && <div className="alert error">{err}</div>}
        <div className="grid" style={{ gap: 10, marginTop: 12 }}>
          <Field label="Chief complaint" value={form.chiefComplaint} onChange={(v) => setForm({ ...form, chiefComplaint: v })} />
          <Field label="Findings" value={form.findings} onChange={(v) => setForm({ ...form, findings: v })} />
          <Field label="Diagnosis / documentation" value={form.diagnosis} onChange={(v) => setForm({ ...form, diagnosis: v })} />
          <Field label="Treatment performed" value={form.treatmentPerformed} onChange={(v) => setForm({ ...form, treatmentPerformed: v })} />
          <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary">Save visit</button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Chart({ patientId }: { patientId: string }) {
  const toast = React.useContext(ToastCtx);
  const [teeth, setTeeth] = useState<Array<{ toothFdi: string; dentition: string; state: string }>>([]);
  const [sel, setSel] = useState<string | null>(null);
  const load = () => void api<typeof teeth>(`/api/chart?patientId=${patientId}`).then(setTeeth);
  useEffect(() => {
    load();
  }, [patientId]);
  const adult = teeth.filter((t) => t.dentition === "adult");
  const primary = teeth.filter((t) => t.dentition === "primary");
  async function setState(state: string) {
    if (!sel) return;
    await api("/api/chart", { method: "POST", json: { patientId, toothFdi: sel, state } });
    toast(`Tooth ${sel} updated.`);
    load();
  }
  return (
    <div className="card">
      <h3>Adult dentition (FDI)</h3>
      <div className="tooth-grid" style={{ margin: "12px 0 20px" }}>
        {(adult.length ? adult : ADULT_FDI.map((t) => ({ toothFdi: t, dentition: "adult", state: "healthy" }))).map((t) => (
          <button key={t.toothFdi} className={`tooth ${sel === t.toothFdi ? "selected" : ""}`} data-state={t.state} onClick={() => setSel(t.toothFdi)}>
            {t.toothFdi}
          </button>
        ))}
      </div>
      <h3>Primary dentition</h3>
      <div className="tooth-grid" style={{ gridTemplateColumns: "repeat(10, 1fr)", marginTop: 12 }}>
        {(primary.length ? primary : PRIMARY_FDI.map((t) => ({ toothFdi: t, dentition: "primary", state: "healthy" }))).map((t) => (
          <button key={t.toothFdi} className={`tooth ${sel === t.toothFdi ? "selected" : ""}`} data-state={t.state} onClick={() => setSel(t.toothFdi)}>
            {t.toothFdi}
          </button>
        ))}
      </div>
      {sel && (
        <div className="row wrap" style={{ marginTop: 16 }}>
          {TOOTH_STATES.map((s) => (
            <button key={s} className="btn btn-secondary" onClick={() => void setState(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RxList({ patientId }: { patientId: string }) {
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  const [open, setOpen] = useState(false);
  const load = () => void api<{ items: Array<Record<string, unknown>> }>("/api/prescriptions/list", { method: "POST", json: { patientId } }).then(setData);
  useEffect(() => {
    load();
  }, [patientId]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Prescriptions</h3>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          New prescription
        </button>
      </div>
      <SimpleList
        rows={(data?.items || []).map((r) => ({ ...r, id: String(r.id) }))}
        empty="No prescriptions."
        render={(r) => (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>{String(r.prescribedAt)}</span>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const blob = await api<Blob>("/api/pdf/prescription", { method: "POST", json: { id: r.id } });
                downloadBlob(blob, "prescription.pdf");
              }}
            >
              PDF
            </button>
          </div>
        )}
      />
      {open && <RxModal patientId={patientId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
    </div>
  );
}

function RxModal({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [cc, setCc] = useState<Record<string, boolean>>({});
  const [oe, setOe] = useState<Record<string, boolean>>({});
  const [re, setRe] = useState("");
  const [advice, setAdvice] = useState("");
  const [meds, setMeds] = useState<Array<{ medicine: string; strength: string; dosage: string; frequency: string; duration: string; route: string; instructions: string }>>([
    { medicine: "", strength: "", dosage: "", frequency: "", duration: "", route: "", instructions: "" },
  ]);
  const [err, setErr] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        style={{ width: 860 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/prescriptions", {
              method: "POST",
              json: {
                patientId,
                prescribedAt: nowIso(),
                ...Object.fromEntries(Object.entries(cc).map(([k, v]) => [k, v])),
                ...Object.fromEntries(Object.entries(oe).map(([k, v]) => [k, v])),
                re_notes: re,
                advice,
                medications: meds.filter((m) => m.medicine.trim()),
              },
            });
            onSaved();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to save the prescription.");
          }
        }}
      >
        <h2>Prescription</h2>
        {err && <div className="alert error">{err}</div>}
        <h3 style={{ margin: "16px 0 8px" }}>C/C</h3>
        <div className="checkgrid">
          {CC_FIELDS.map((f) => (
            <label key={f.key}>
              <input type="checkbox" checked={Boolean(cc[f.key])} onChange={(e) => setCc({ ...cc, [f.key]: e.target.checked })} /> {f.label}
            </label>
          ))}
        </div>
        <h3 style={{ margin: "16px 0 8px" }}>O/E</h3>
        <div className="checkgrid">
          {OE_FIELDS.map((f) => (
            <label key={f.key}>
              <input type="checkbox" checked={Boolean(oe[f.key])} onChange={(e) => setOe({ ...oe, [f.key]: e.target.checked })} /> {f.label}
            </label>
          ))}
        </div>
        <Field label="R/E" value={re} onChange={setRe} />
        <Field label="Advice" value={advice} onChange={setAdvice} />
        <h3 style={{ margin: "16px 0 8px" }}>Medication</h3>
        {meds.map((m, i) => (
          <div className="grid grid-2" key={i} style={{ marginBottom: 8 }}>
            <Field label="Medicine" value={m.medicine} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, medicine: v } : x)))} />
            <Field label="Strength" value={m.strength} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, strength: v } : x)))} />
            <Field label="Dosage" value={m.dosage} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, dosage: v } : x)))} />
            <Field label="Frequency" value={m.frequency} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, frequency: v } : x)))} />
            <Field label="Duration" value={m.duration} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, duration: v } : x)))} />
            <Field label="Instructions" value={m.instructions} onChange={(v) => setMeds(meds.map((x, j) => (j === i ? { ...x, instructions: v } : x)))} />
          </div>
        ))}
        <button className="btn btn-tertiary" type="button" onClick={() => setMeds([...meds, { medicine: "", strength: "", dosage: "", frequency: "", duration: "", route: "", instructions: "" }])}>
          Add medicine
        </button>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary">Save prescription</button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Plans({ patientId }: { patientId: string }) {
  const toast = React.useContext(ToastCtx);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("Treatment plan");
  const [itemName, setItemName] = useState("");
  const [est, setEst] = useState("0");
  const load = () => void api<Array<Record<string, unknown>>>(`/api/plans/list?patientId=${patientId}`).then(setItems);
  useEffect(() => {
    load();
  }, [patientId]);
  return (
    <div className="card">
      <h3>Treatment plans</h3>
      <p style={{ color: "var(--color-muted)", margin: "8px 0 12px" }}>Plans never create invoices automatically.</p>
      <div className="grid grid-2">
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Item" value={itemName} onChange={setItemName} />
        <Field label="Estimated (BDT)" value={est} onChange={setEst} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api("/api/plans", {
                method: "POST",
                json: {
                  patientId,
                  title,
                  items: [{ name: itemName || title, estimatedPaisa: Math.round(Number(est) * 100) }],
                },
              });
              toast("Plan saved. No invoice was created.");
              setItemName("");
              load();
            }}
          >
            Save plan
          </button>
        </div>
      </div>
      <SimpleList
        rows={items.map((p) => ({ ...p, id: String(p.id) }))}
        empty="No plans."
        render={(p) => (
          <div>
            <strong>{String(p.title || "Plan")}</strong> · {String(p.status)} · {formatMoney(Number(p.estimated_total_paisa || p.estimatedTotalPaisa || 0))}
          </div>
        )}
      />
    </div>
  );
}

function ApptList({ patientId }: { patientId: string }) {
  const from = new Date(Date.now() - 86400000 * 30).toISOString();
  const to = new Date(Date.now() + 86400000 * 60).toISOString();
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>("/api/appointments/list", { method: "POST", json: { from, to, patientId } }).then(setData);
  }, [patientId]);
  return (
    <div className="card">
      <SimpleList rows={(data?.items || []).map((a) => ({ ...a, id: String(a.id) }))} empty="No appointments." render={(a) => <div>{String(a.startsAt)} · {String(a.status)}</div>} />
    </div>
  );
}

function PatientBilling({ patientId }: { patientId: string }) {
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>("/api/invoices/list", { method: "POST", json: { patientId } }).then(setData);
  }, [patientId]);
  return (
    <div className="card">
      <button className="btn btn-primary" onClick={() => go(`billing/new?patient=${patientId}`)}>
        New invoice
      </button>
      <table className="data" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Number</th>
            <th>Status</th>
            <th className="num">Total</th>
            <th className="num">Due</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items || []).map((i) => (
            <tr key={String(i.id)} onClick={() => go(`billing/${i.id}`)} style={{ cursor: "pointer" }}>
              <td>{String(i.number)}</td>
              <td>{String(i.status)}</td>
              <td className="num">{formatMoney(Number(i.totalPaisa))}</td>
              <td className="num">{formatMoney(Number(i.duePaisa))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttachList({ patientId }: { patientId: string }) {
  const toast = React.useContext(ToastCtx);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const load = () => void api<Array<Record<string, unknown>>>(`/api/attachments?entityType=patient&entityId=${patientId}`).then(setItems);
  useEffect(() => {
    load();
  }, [patientId]);
  return (
    <div className="card">
      <h3>Attachments</h3>
      <input
        type="file"
        aria-label="Add attachment"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          bytes.forEach((b) => {
            bin += String.fromCharCode(b);
          });
          await api("/api/attachments", {
            method: "POST",
            json: { entityType: "patient", entityId: patientId, filename: file.name, mime: file.type, dataBase64: btoa(bin) },
          });
          toast("Attachment stored.");
          e.target.value = "";
          load();
        }}
      />
      {!items.length ? <div className="empty">No attachments.</div> : items.map((a) => <div key={String(a.id)}>{String(a.filename)} · {String(a.mime || "")}</div>)}
    </div>
  );
}

function Queue() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [code, setCode] = useState("");
  const load = () => void api<Array<Record<string, unknown>>>("/api/queue").then(setItems);
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <PageHead title="Today’s queue" sub="Serials are independent of patient codes and invoices." />
      <div className="card row" style={{ marginBottom: 12 }}>
        <Field label="Patient id" value={code} onChange={setCode} placeholder="Patient UUID" />
        <button
          className="btn btn-primary"
          onClick={async () => {
            await api("/api/queue", { method: "POST", json: { patientId: code } });
            setCode("");
            load();
          }}
        >
          Add to queue
        </button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Serial</th>
              <th>Patient</th>
              <th>Code</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={String(q.id)}>
                <td>{String(q.serialLabel)}</td>
                <td>{String(q.patientName)}</td>
                <td>{String(q.patientCode)}</td>
                <td>
                  <span className="badge">{String(q.status)}</span>
                </td>
                <td>
                  {["waiting", "called", "in_treatment", "completed", "skipped"].map((s) => (
                    <button
                      key={s}
                      className="btn btn-tertiary"
                      onClick={async () => {
                        await api("/api/queue/status", { method: "POST", json: { id: q.id, status: s } });
                        load();
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="empty">No one is waiting.</div>}
      </div>
    </>
  );
}

function Appointments() {
  const [view, setView] = useState<"day" | "week" | "month" | "agenda">("agenda");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + (view === "day" ? 1 : view === "week" ? 7 : 31));
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>> }>("/api/appointments/list", {
      method: "POST",
      json: { from: from.toISOString(), to: to.toISOString() },
    }).then((r) => setItems(r.items));
  }, [view]);
  return (
    <>
      <PageHead
        title="Appointments"
        actions={
          <>
            {(["day", "week", "month", "agenda"] as const).map((v) => (
              <button key={v} className={`btn ${view === v ? "btn-primary" : "btn-secondary"}`} onClick={() => setView(v)}>
                {v}
              </button>
            ))}
            <button className="btn btn-gold" onClick={() => go("appointments/new")}>
              New
            </button>
          </>
        }
      />
      <div className="card">
        <SimpleList rows={items.map((a) => ({ ...a, id: String(a.id) }))} empty="No appointments in this range." render={(a) => (
          <div>
            <strong>{String(a.patientName)}</strong> <span className="badge">{String(a.patientCode)}</span> · {String(a.startsAt)} · {String(a.status)}
          </div>
        )} />
      </div>
      {location.hash.includes("new") || view ? <NewAppointment onSaved={() => location.reload()} /> : null}
    </>
  );
}

function NewAppointment({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(location.hash.includes("appointments/new"));
  const [patientId, setPatientId] = useState("");
  const [starts, setStarts] = useState(todayIsoDate() + "T10:00");
  const [duration, setDuration] = useState("30");
  const [err, setErr] = useState("");
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => { setOpen(false); go("appointments"); }}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/appointments", {
              method: "POST",
              json: { patientId, startsAt: new Date(starts).toISOString(), durationMinutes: Number(duration) },
            });
            onSaved();
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to book.");
          }
        }}
      >
        <h2>New appointment</h2>
        {err && <div className="alert error">{err}</div>}
        <Field label="Patient id" value={patientId} onChange={setPatientId} />
        <Field label="Start" type="datetime-local" value={starts} onChange={setStarts} />
        <Field label="Duration (minutes)" value={duration} onChange={setDuration} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function Billing() {
  const [data, setData] = useState<{ items: Array<Record<string, unknown>>; total: number } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>>; total: number }>("/api/invoices/list", { method: "POST", json: { page: 1 } }).then(setData);
  }, []);
  return (
    <>
      <PageHead title="Billing" sub={data ? `${data.total} invoices` : ""} actions={<button className="btn btn-primary" onClick={() => go("billing/new")}>New invoice</button>} />
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Number</th>
              <th>Patient</th>
              <th>Status</th>
              <th className="num">Total</th>
              <th className="num">Due</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((i) => (
              <tr key={String(i.id)} onClick={() => go(`billing/${i.id}`)} style={{ cursor: "pointer" }}>
                <td>{String(i.number)}</td>
                <td>
                  {String(i.patientName)} <span className="badge">{String(i.patientCode)}</span>
                </td>
                <td>{String(i.status)}</td>
                <td className="num">{formatMoney(Number(i.totalPaisa))}</td>
                <td className="num">{formatMoney(Number(i.duePaisa))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.items.length && <div className="empty">No invoices.</div>}
      </div>
    </>
  );
}

function InvoiceForm() {
  const toast = React.useContext(ToastCtx);
  const params = new URLSearchParams(location.hash.split("?")[1] || location.search);
  const [patientId, setPatientId] = useState(params.get("patient") || "");
  const [desc, setDesc] = useState("Consultation");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("500.00");
  const [err, setErr] = useState("");
  return (
    <>
      <PageHead title="New invoice" />
      {err && <div className="alert error">{err}</div>}
      <form
        className="card grid"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const unit = Math.round(Number(price) * 100);
            const inv = await api<{ id: string }>("/api/invoices", {
              method: "POST",
              json: {
                patientId,
                issuedAt: nowIso(),
                issue: true,
                lines: [{ description: desc, quantity: Number(qty), unitPricePaisa: unit, discountPaisa: 0 }],
              },
            });
            toast("Invoice issued. Treatment selection never bills automatically.");
            go(`billing/${inv.id}`);
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : "Unable to save the invoice.");
          }
        }}
      >
        <Field label="Patient id" value={patientId} onChange={setPatientId} placeholder="Open from Patient 360 to prefill" />
        <Field label="Description" value={desc} onChange={setDesc} />
        <Field label="Quantity" value={qty} onChange={setQty} />
        <Field label="Unit price (BDT)" value={price} onChange={setPrice} />
        <button className="btn btn-primary">Issue invoice</button>
      </form>
    </>
  );
}

function InvoiceView({ id }: { id: string }) {
  const toast = React.useContext(ToastCtx);
  const [inv, setInv] = useState<Record<string, unknown> | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paper, setPaper] = useState("A4");
  const load = () => void api<Record<string, unknown>>(`/api/invoices/get?id=${id}`).then(setInv);
  useEffect(() => {
    load();
  }, [id]);
  if (!inv) return <div className="skel" style={{ height: 160 }} />;
  return (
    <>
      <PageHead
        title={String(inv.number)}
        sub={`${inv.patientName} · ${inv.patientCode}`}
        actions={
          <>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const blob = await api<Blob>("/api/pdf/invoice", { method: "POST", json: { id } });
                downloadBlob(blob, `${inv.number}.pdf`);
              }}
            >
              Invoice PDF
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const blob = await api<Blob>("/api/pdf/statement", { method: "POST", json: { patientId: inv.patientId } });
                downloadBlob(blob, `statement-${inv.patientCode}.pdf`);
              }}
            >
              Statement PDF
            </button>
          </>
        }
      />
      <div className="grid grid-2">
        <div className="card">
          <div className="kpi">
            <div className="label">Total</div>
            <div className="value">{formatMoney(Number(inv.totalPaisa))}</div>
            <div className="hint">Due {formatMoney(Number(inv.duePaisa))} · {String(inv.status)}</div>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {((inv.lines as Array<Record<string, unknown>>) || []).map((l) => (
                <tr key={String(l.id)}>
                  <td>{String(l.description)}</td>
                  <td className="num">{formatMoney(Number(l.lineTotalPaisa))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Receive payment</h3>
          <Field label="Amount (BDT)" value={amount} onChange={setAmount} />
          <label className="field">
            <span>Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              const paisa = Math.round(Number(amount) * 100);
              const r = await api<{ receipt: { id: string; number: string } }>("/api/payments", {
                method: "POST",
                json: { invoiceId: id, method, amountPaisa: paisa, paidAt: nowIso(), idempotencyKey: `${id}-${paisa}-${Date.now()}` },
              });
              toast(`Payment received. Receipt ${r.receipt.number}.`);
              const blob = await api<Blob>("/api/pdf/receipt", { method: "POST", json: { id: r.receipt.id, paper } });
              downloadBlob(blob, `${r.receipt.number}.pdf`);
              load();
            }}
          >
            Record payment
          </button>
          <label className="field" style={{ marginTop: 8 }}>
            <span>Receipt paper</span>
            <select value={paper} onChange={(e) => setPaper(e.target.value)}>
              <option value="A4">A4</option>
              <option value="80mm">80 mm</option>
            </select>
          </label>
        </div>
      </div>
    </>
  );
}

function Inventory() {
  const toast = React.useContext(ToastCtx);
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [reorder, setReorder] = useState("0");
  const load = () => void api<{ items: Array<Record<string, unknown>> }>("/api/inventory/list", { method: "POST", json: {} }).then(setData);
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <PageHead title="Inventory" sub="Stock cannot go negative." />
      <div className="card grid grid-2" style={{ marginBottom: 16 }}>
        <Field label="SKU" value={sku} onChange={setSku} />
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Reorder level" value={reorder} onChange={setReorder} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api("/api/inventory", { method: "POST", json: { sku, name, reorderLevel: Number(reorder) || 0 } });
              toast("Item created at quantity 0. Receive stock with an adjustment.");
              setSku("");
              setName("");
              load();
            }}
          >
            Add item
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th className="num">Qty</th>
              <th className="num">Reorder</th>
              <th>Adjust</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.sku)}</td>
                <td>{String(i.name)}</td>
                <td className="num">{String(i.quantity)}</td>
                <td className="num">{String(i.reorderLevel)}</td>
                <td>
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      const raw = window.prompt("Quantity change (negative issues stock)", "1");
                      if (!raw) return;
                      await api("/api/inventory/adjust", {
                        method: "POST",
                        json: { itemId: i.id, delta: Number(raw), reason: "manual adjustment" },
                      });
                      toast("Stock updated.");
                      load();
                    }}
                  >
                    ±
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.items.length && <div className="empty">No stock items.</div>}
      </div>
    </>
  );
}

function Accounting() {
  const toast = React.useContext(ToastCtx);
  const [data, setData] = useState<{ items: Array<Record<string, unknown>> } | null>(null);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const load = () => void api<{ items: Array<Record<string, unknown>> }>("/api/accounting?from=1970-01-01&to=2999-01-01").then(setData);
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <PageHead title="Accounting" sub="Income and expenses. Not a double-entry ledger." />
      <div className="card grid grid-2" style={{ marginBottom: 16 }}>
        <Field label="Expense description" value={desc} onChange={setDesc} />
        <Field label="Amount (BDT)" value={amount} onChange={setAmount} />
        <button
          className="btn btn-primary"
          onClick={async () => {
            await api("/api/accounting/expense", {
              method: "POST",
              json: { description: desc, amountPaisa: Math.round(Number(amount) * 100), occurredAt: nowIso() },
            });
            toast("Expense recorded.");
            setDesc("");
            setAmount("");
            load();
          }}
        >
          Add expense
        </button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Description</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((t) => (
              <tr key={String(t.id)}>
                <td>{String(t.occurred_at)}</td>
                <td>{String(t.type)}</td>
                <td>{String(t.description)}</td>
                <td className="num">{formatMoney(Number(t.amount_paisa))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Reports() {
  const [kind, setKind] = useState("revenue");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState("Reports");
  const from = new Date(); from.setDate(1);
  const run = async () => {
    const r = await api<{ title: string; rows: Array<Record<string, unknown>> }>("/api/reports", {
      method: "POST",
      json: { kind, from: from.toISOString(), to: new Date().toISOString() },
    });
    setRows(r.rows);
    setTitle(r.title || "Reports");
  };
  useEffect(() => {
    void run();
  }, [kind]);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <>
      <PageHead
        title={title}
        sub="Current month"
        actions={
          <select aria-label="Report type" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["revenue", "collections", "outstanding", "visits", "treatments", "appointments", "inventory", "patients", "expenses"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        }
      />
      <div className="card" style={{ padding: 0 }}>
        {!rows.length ? (
          <div className="empty">No rows for this period.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>{String(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Notifications() {
  const [data, setData] = useState<{ items: Array<Record<string, unknown>>; total: number } | null>(null);
  useEffect(() => {
    void api<{ items: Array<Record<string, unknown>>; total: number }>("/api/notifications?page=1").then(setData);
  }, []);
  return (
    <>
      <PageHead title="Notifications" sub={data ? `${data.total} total` : ""} />
      <div className="card">
        <SimpleList rows={(data?.items || []).map((n) => ({ ...n, id: String(n.id) }))} empty="No notifications." render={(n) => (
          <div>
            <strong>{String(n.title)}</strong>
            <div style={{ color: "var(--color-muted)" }}>{String(n.body)}</div>
          </div>
        )} />
      </div>
    </>
  );
}

function Settings({ session }: { session: SessionInfo }) {
  const toast = React.useContext(ToastCtx);
  const [tab, setTab] = useState<"clinic" | "staff" | "data" | "security">("clinic");
  const [clinic, setClinic] = useState<Record<string, string> | null>(null);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [staff, setStaff] = useState<Array<Record<string, unknown>>>([]);
  const [newStaff, setNewStaff] = useState({ name: "", username: "", password: "", role: "dentist" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][]; mapping: Record<string, string>; issues: string[] } | null>(null);
  const [restorePath, setRestorePath] = useState("");
  useEffect(() => {
    void api<Record<string, string>>("/api/clinic").then(setClinic);
    void api<Array<Record<string, unknown>>>("/api/staff").then(setStaff).catch(() => setStaff([]));
  }, []);
  if (!clinic) return <div className="skel" style={{ height: 120 }} />;
  return (
    <>
      <PageHead title="Settings" sub={`Signed in as ${session.name}`} />
      <div className="tabs" role="tablist">
        {(["clinic", "staff", "data", "security"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "clinic" && (
        <div className="card grid grid-2">
          {["clinicName", "address", "phone", "email", "dentistName", "dentistQualifications", "dentistRegistration"].map((k) => (
            <Field key={k} label={k} value={String(clinic[k] || "")} onChange={(v) => setClinic({ ...clinic, [k]: v })} />
          ))}
          <div className="row" style={{ gridColumn: "1 / -1" }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await api("/api/clinic", { method: "PUT", json: clinic });
                toast("Settings saved.");
              }}
            >
              Save settings
            </button>
            <button className="btn btn-secondary" onClick={async () => setDiag(await api("/api/diagnostics"))}>
              Diagnostics
            </button>
          </div>
          {diag && <pre style={{ gridColumn: "1 / -1", fontSize: 12 }}>{JSON.stringify(diag, null, 2)}</pre>}
          <div style={{ gridColumn: "1 / -1" }}>
            <h3>Keyboard</h3>
            <ul>
              {SHORTCUTS.map((s) => (
                <li key={s.keys}>
                  <strong>{s.keys}</strong> — {s.action}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {tab === "staff" && (
        <div className="card">
          <h3>Staff</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={String(s.id)}>
                  <td>{String(s.name)}</td>
                  <td>{String(s.username)}</td>
                  <td>{ROLE_LABELS[s.role as keyof typeof ROLE_LABELS] || String(s.role)}</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        await api("/api/staff", { method: "PATCH", json: { id: s.id, active: !s.active } });
                        setStaff(await api("/api/staff"));
                      }}
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Field label="Name" value={newStaff.name} onChange={(v) => setNewStaff({ ...newStaff, name: v })} />
            <Field label="Username" value={newStaff.username} onChange={(v) => setNewStaff({ ...newStaff, username: v })} />
            <Field label="Password" type="password" value={newStaff.password} onChange={(v) => setNewStaff({ ...newStaff, password: v })} />
            <label className="field">
              <span>Role</span>
              <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await api("/api/staff", { method: "POST", json: newStaff });
                toast("Staff member created.");
                setNewStaff({ name: "", username: "", password: "", role: "dentist" });
                setStaff(await api("/api/staff"));
              }}
            >
              Add staff
            </button>
          </div>
        </div>
      )}
      {tab === "data" && (
        <div className="card grid">
          <div className="row">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await api<{ path: string }>("/api/backup", { method: "POST", json: {} });
                toast(`Backup created at ${r.path}`);
              }}
            >
              Backup now
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const r = await api<{ csv: string }>("/api/export/patients");
                const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
                downloadBlob(blob, "patients.csv");
              }}
            >
              Export patients CSV
            </button>
          </div>
          <Field label="Restore from .dvbak path" value={restorePath} onChange={setRestorePath} placeholder="Absolute path on this computer" />
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm("Restore replaces the live database after a safety copy. Continue?")) return;
              await api("/api/restore", { method: "POST", json: { path: restorePath } });
              toast("Restore completed. Sign in again if asked.");
            }}
          >
            Restore backup
          </button>
          <h3>Import patients</h3>
          <label className="field">
            <span>CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                setCsv(text);
                setPreview(await api("/api/import/preview", { method: "POST", json: { csv: text } }));
              }}
            />
          </label>
          {preview && (
            <div>
              {preview.issues.map((i) => (
                <div key={i} className="alert error">{i}</div>
              ))}
              <p style={{ margin: "8px 0" }}>First {preview.rows.length} rows. Columns: {preview.headers.join(", ")}</p>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const r = await api<{ created: number; skipped: number }>("/api/import/patients", {
                    method: "POST",
                    json: { csv, mapping: preview.mapping, ignoreDuplicates: true },
                  });
                  toast(`Imported ${r.created}, skipped ${r.skipped}.`);
                }}
              >
                Import mapped rows
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "security" && (
        <div className="card grid" style={{ maxWidth: 420 }}>
          <h3>Change password</h3>
          <Field label="Current password" type="password" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} />
          <Field label="New password" type="password" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} />
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api("/api/auth/password", { method: "POST", json: pw });
              toast("Password changed.");
              setPw({ current: "", next: "" });
            }}
          >
            Update password
          </button>
        </div>
      )}
    </>
  );
}

function VisitForm() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const patientId = params.get("patient") || "";
  return <VisitModal patientId={patientId} onClose={() => history.back()} onSaved={() => go(`patients/${patientId}`)} />;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const cmds = [
    { label: "New Patient", run: () => go("patients/new") },
    { label: "Search Patient", run: () => go("patients") },
    { label: "New Visit", run: () => go("visits/new") },
    { label: "New Appointment", run: () => go("appointments/new") },
    { label: "New Invoice", run: () => go("billing/new") },
    { label: "Receive Payment", run: () => go("billing") },
    { label: "Open Dashboard", run: () => go("dashboard") },
    { label: "Open Reports", run: () => go("reports") },
    { label: "Open Settings", run: () => go("settings") },
    { label: "Open Queue", run: () => go("queue") },
    { label: "Backup", run: () => go("settings") },
  ].filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const [i, setI] = useState(0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="Type a command…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setI((x) => Math.min(x + 1, cmds.length - 1));
            if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0));
            if (e.key === "Enter") {
              cmds[i]?.run();
              onClose();
            }
          }}
        />
        <ul>
          {cmds.map((c, idx) => (
            <li key={c.label}>
              <button className={idx === i ? "active" : ""} onClick={() => { c.run(); onClose(); }}>
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ entityType: string; entityId: string; title: string; subtitle: string; code?: string }>>([]);
  const t = useRef<number | null>(null);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="Search patients, invoices, prescriptions…"
          onChange={(e) => {
            setQ(e.target.value);
            if (t.current) window.clearTimeout(t.current);
            t.current = window.setTimeout(() => {
              void api<typeof hits>(`/api/search?q=${encodeURIComponent(e.target.value)}`).then(setHits);
            }, 120);
          }}
        />
        <ul>
          {hits.map((h) => (
            <li key={`${h.entityType}-${h.entityId}`}>
              <button
                onClick={() => {
                  if (h.entityType === "patient") go(`patients/${h.entityId}`);
                  else if (h.entityType === "invoice") go(`billing/${h.entityId}`);
                  else go("patients");
                  onClose();
                }}
              >
                <strong>{h.title}</strong> <span className="badge">{h.code}</span>
                <div style={{ color: "var(--color-muted)", fontSize: 12 }}>{h.entityType} · {h.subtitle}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


