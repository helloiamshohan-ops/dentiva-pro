CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE clinic_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  clinic_name TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  registration_info TEXT NOT NULL DEFAULT '',
  dentist_name TEXT NOT NULL DEFAULT '',
  dentist_qualifications TEXT NOT NULL DEFAULT '',
  dentist_registration TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'BDT',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  receipt_prefix TEXT NOT NULL DEFAULT 'RCT',
  patient_prefix TEXT NOT NULL DEFAULT 'P',
  paper_size TEXT NOT NULL DEFAULT 'A4',
  invoice_footer TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT '',
  prescription_footer TEXT NOT NULL DEFAULT '',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 100000),
  appointment_slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (appointment_slot_minutes > 0),
  inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 15 CHECK (inactivity_timeout_minutes >= 0),
  backup_dir TEXT,
  print_settings_json TEXT NOT NULL DEFAULT '{}',
  notification_settings_json TEXT NOT NULL DEFAULT '{}',
  security_settings_json TEXT NOT NULL DEFAULT '{}',
  prefs_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator','dentist','receptionist','accountant','inventory_staff')),
  contact TEXT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  permissions_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  failed_unlocks INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  at TEXT NOT NULL,
  ip_note TEXT
);

CREATE INDEX idx_login_attempts_user_at ON login_attempts(username, at);

CREATE TABLE patients (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT,
  full_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth TEXT,
  phone TEXT,
  phone_normalized TEXT,
  alternate_phone TEXT,
  email TEXT,
  address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  occupation TEXT,
  referral_source TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_patients_phone ON patients(phone_normalized);
CREATE INDEX idx_patients_name ON patients(full_name COLLATE NOCASE);
CREATE INDEX idx_patients_email ON patients(email COLLATE NOCASE);
CREATE INDEX idx_patients_created ON patients(created_at);
CREATE INDEX idx_patients_archived ON patients(archived, full_name COLLATE NOCASE);

CREATE TABLE patient_medical (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id),
  history TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  allergy_alert INTEGER NOT NULL DEFAULT 0 CHECK (allergy_alert IN (0,1)),
  medications TEXT NOT NULL DEFAULT '',
  chronic_conditions TEXT NOT NULL DEFAULT '',
  important_notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE patient_dental (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id),
  history TEXT NOT NULL DEFAULT '',
  previous_treatment TEXT NOT NULL DEFAULT '',
  oral_hygiene TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE custom_field_defs (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  name TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  options_json TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(entity, field_key)
);

CREATE TABLE custom_field_values (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES custom_field_defs(id),
  entity_id TEXT NOT NULL,
  value TEXT,
  UNIQUE(field_id, entity_id)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_att_entity ON attachments(entity_type, entity_id);

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  dentist_id TEXT REFERENCES staff(id),
  visited_at TEXT NOT NULL,
  chief_complaint TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  symptoms TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  treatment_plan_notes TEXT NOT NULL DEFAULT '',
  treatment_performed TEXT NOT NULL DEFAULT '',
  tooth_numbers_json TEXT NOT NULL DEFAULT '[]',
  anesthesia TEXT NOT NULL DEFAULT '',
  medications_notes TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  follow_up_notes TEXT NOT NULL DEFAULT '',
  referral_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_visits_patient ON visits(patient_id, visited_at);
CREATE INDEX idx_visits_date ON visits(visited_at);
CREATE INDEX idx_visits_dentist ON visits(dentist_id, visited_at);

CREATE TABLE visit_procedures (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id),
  treatment_id TEXT,
  tooth TEXT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_visit_proc ON visit_procedures(visit_id);

CREATE TABLE dental_chart (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  tooth_fdi TEXT NOT NULL,
  dentition TEXT NOT NULL CHECK (dentition IN ('adult','primary')),
  state TEXT NOT NULL DEFAULT 'healthy',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(patient_id, tooth_fdi)
);

CREATE INDEX idx_chart_patient ON dental_chart(patient_id);

CREATE TABLE dental_chart_history (
  id TEXT PRIMARY KEY,
  chart_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  tooth_fdi TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  visit_id TEXT,
  at TEXT NOT NULL,
  by_staff TEXT
);

CREATE INDEX idx_chart_hist ON dental_chart_history(patient_id, at);

CREATE TABLE treatments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  default_duration_minutes INTEGER,
  default_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (default_price_paisa >= 0),
  clinical_notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_treatments_name ON treatments(name COLLATE NOCASE);
CREATE INDEX idx_treatments_active ON treatments(active, category, name);

CREATE TABLE treatment_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','presented','accepted','rejected','converted','cancelled')),
  estimated_total_paisa INTEGER NOT NULL DEFAULT 0 CHECK (estimated_total_paisa >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_plans_patient ON treatment_plans(patient_id, created_at);

CREATE TABLE treatment_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES treatment_plans(id),
  treatment_id TEXT,
  tooth TEXT,
  sequence INTEGER NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  estimated_paisa INTEGER NOT NULL DEFAULT 0 CHECK (estimated_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'planned'
);

CREATE TABLE prescriptions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_id TEXT REFERENCES visits(id),
  dentist_id TEXT REFERENCES staff(id),
  prescribed_at TEXT NOT NULL,
  cc_pain_on INTEGER NOT NULL DEFAULT 0 CHECK (cc_pain_on IN (0,1)),
  cc_g_carries INTEGER NOT NULL DEFAULT 0 CHECK (cc_g_carries IN (0,1)),
  cc_swelling INTEGER NOT NULL DEFAULT 0 CHECK (cc_swelling IN (0,1)),
  cc_gum_bleeding INTEGER NOT NULL DEFAULT 0 CHECK (cc_gum_bleeding IN (0,1)),
  cc_bad_breath INTEGER NOT NULL DEFAULT 0 CHECK (cc_bad_breath IN (0,1)),
  cc_sensitivity INTEGER NOT NULL DEFAULT 0 CHECK (cc_sensitivity IN (0,1)),
  cc_notes TEXT NOT NULL DEFAULT '',
  oe_carries INTEGER NOT NULL DEFAULT 0 CHECK (oe_carries IN (0,1)),
  oe_g_carries INTEGER NOT NULL DEFAULT 0 CHECK (oe_g_carries IN (0,1)),
  oe_bdr INTEGER NOT NULL DEFAULT 0 CHECK (oe_bdr IN (0,1)),
  oe_bdc INTEGER NOT NULL DEFAULT 0 CHECK (oe_bdc IN (0,1)),
  oe_gingivitis INTEGER NOT NULL DEFAULT 0 CHECK (oe_gingivitis IN (0,1)),
  oe_parodental_pocket INTEGER NOT NULL DEFAULT 0 CHECK (oe_parodental_pocket IN (0,1)),
  oe_periodontitis INTEGER NOT NULL DEFAULT 0 CHECK (oe_periodontitis IN (0,1)),
  oe_impacted_teeth INTEGER NOT NULL DEFAULT 0 CHECK (oe_impacted_teeth IN (0,1)),
  oe_dry_socket INTEGER NOT NULL DEFAULT 0 CHECK (oe_dry_socket IN (0,1)),
  oe_attrition INTEGER NOT NULL DEFAULT 0 CHECK (oe_attrition IN (0,1)),
  oe_erosion INTEGER NOT NULL DEFAULT 0 CHECK (oe_erosion IN (0,1)),
  oe_notes TEXT NOT NULL DEFAULT '',
  re_notes TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_rx_patient ON prescriptions(patient_id, prescribed_at);
CREATE INDEX idx_rx_visit ON prescriptions(visit_id);

CREATE TABLE prescription_medications (
  id TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  medicine TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  timing TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_rx_meds ON prescription_medications(prescription_id, sequence);

CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_id TEXT,
  source TEXT NOT NULL DEFAULT '',
  referred_to TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  referred_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ref_patient ON referrals(patient_id, referred_at);

CREATE TABLE followups (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_id TEXT,
  due_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_followups_due ON followups(status, due_at);
CREATE INDEX idx_followups_patient ON followups(patient_id, due_at);

CREATE TABLE chairs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  dentist_id TEXT REFERENCES staff(id),
  chair_id TEXT REFERENCES chairs(id),
  room_id TEXT REFERENCES rooms(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  appointment_type TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show','rescheduled'
  )),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_appt_start ON appointments(starts_at);
CREATE INDEX idx_appt_dentist ON appointments(dentist_id, starts_at, ends_at);
CREATE INDEX idx_appt_chair ON appointments(chair_id, starts_at, ends_at);
CREATE INDEX idx_appt_room ON appointments(room_id, starts_at, ends_at);
CREATE INDEX idx_appt_patient ON appointments(patient_id, starts_at);
CREATE INDEX idx_appt_status ON appointments(status, starts_at);

CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  queue_date TEXT NOT NULL,
  serial INTEGER NOT NULL CHECK (serial > 0),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  appointment_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','in_treatment','completed','skipped')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(queue_date, serial)
);

CREATE INDEX idx_queue_date ON queue(queue_date, serial);
CREATE INDEX idx_queue_patient ON queue(patient_id, queue_date);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_id TEXT REFERENCES visits(id),
  issued_at TEXT NOT NULL,
  subtotal_paisa INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  tax_paisa INTEGER NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
  total_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),
  paid_paisa INTEGER NOT NULL DEFAULT 0 CHECK (paid_paisa >= 0),
  due_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partial','paid','void')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  CHECK (total_paisa = subtotal_paisa - discount_paisa + tax_paisa)
);

CREATE INDEX idx_inv_patient ON invoices(patient_id, issued_at);
CREATE INDEX idx_inv_status ON invoices(status);
CREATE INDEX idx_inv_issued ON invoices(issued_at);
CREATE INDEX idx_inv_due ON invoices(due_paisa, status);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  sequence INTEGER NOT NULL,
  treatment_id TEXT,
  visit_id TEXT,
  description TEXT NOT NULL,
  tooth TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  line_total_paisa INTEGER NOT NULL CHECK (line_total_paisa >= 0)
);

CREATE INDEX idx_inv_lines ON invoice_lines(invoice_id, sequence);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay')),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  paid_at TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX idx_pay_invoice ON payments(invoice_id);
CREATE INDEX idx_pay_patient ON payments(patient_id, paid_at);
CREATE INDEX idx_pay_paid_at ON payments(paid_at);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT REFERENCES payments(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  refunded_at TEXT NOT NULL,
  method TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_refunds_invoice ON refunds(invoice_id);
CREATE INDEX idx_refunds_patient ON refunds(patient_id, refunded_at);

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  amount_paisa INTEGER NOT NULL,
  reason TEXT NOT NULL,
  adjusted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_adj_patient ON adjustments(patient_id, adjusted_at);
CREATE INDEX idx_adj_invoice ON adjustments(invoice_id);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  issued_at TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_receipts_patient ON receipts(patient_id, issued_at);

CREATE TABLE accounting_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE accounting_transactions (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES accounting_categories(id),
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_acct_at ON accounting_transactions(occurred_at);
CREATE INDEX idx_acct_type ON accounting_transactions(type, occurred_at);
CREATE INDEX idx_acct_ref ON accounting_transactions(reference_type, reference_id);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_suppliers_name ON suppliers(name COLLATE NOCASE);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id),
  purchase_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_paisa >= 0),
  sale_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_paisa >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_invitem_name ON inventory_items(name COLLATE NOCASE);
CREATE INDEX idx_invitem_qty ON inventory_items(quantity, reorder_level);

CREATE TABLE inventory_batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  batch_code TEXT NOT NULL,
  expiry_date TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(item_id, batch_code)
);

CREATE INDEX idx_batch_expiry ON inventory_batches(expiry_date);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  type TEXT NOT NULL CHECK (type IN ('purchase','use','adjustment','wastage','sale')),
  quantity_delta INTEGER NOT NULL,
  unit_cost_paisa INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_inv_mov_item ON inventory_movements(item_id, occurred_at);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  number TEXT NOT NULL UNIQUE,
  purchased_at TEXT NOT NULL,
  total_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),
  paid_paisa INTEGER NOT NULL DEFAULT 0 CHECK (paid_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX idx_purchases_at ON purchases(purchased_at);

CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  batch_code TEXT,
  expiry_date TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paisa INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  line_total_paisa INTEGER NOT NULL CHECK (line_total_paisa >= 0)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notif_created ON notifications(created_at DESC);
CREATE INDEX idx_notif_unread ON notifications(read_at, created_at);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  staff_id TEXT REFERENCES staff(id),
  name TEXT NOT NULL,
  entity TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_audit_at ON audit_log(at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, at);

CREATE TABLE backup_history (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  size_bytes INTEGER,
  checksum TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_backup_created ON backup_history(created_at DESC);

CREATE TABLE id_sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE search_index (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  code TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_search_type ON search_index(entity_type, entity_id);
CREATE INDEX idx_search_code ON search_index(code);
CREATE INDEX idx_search_title ON search_index(title COLLATE NOCASE);

CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  title,
  body,
  code,
  content='search_index',
  content_rowid='rowid',
  tokenize='unicode61'
);
