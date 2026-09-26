export const APP_NAME = "Dentiva Pro";
export const APP_VERSION = "1.0.0";
export const APP_ID = "com.dentivapro.app";

export const DEFAULT_CURRENCY = "BDT";
export const DEFAULT_TIMEZONE = "Asia/Dhaka";
export const DEFAULT_LOCALE = "en-GB";
export const PAISA_PER_UNIT = 100;

export const PATIENT_CODE_PREFIX = "P";
export const INVOICE_PREFIX = "INV";
export const RECEIPT_PREFIX = "RCT";
export const PURCHASE_PREFIX = "PO";

export const SCHEMA_VERSION = 2;

export const PAYMENT_METHODS = [
  "cash",
  "bank",
  "card",
  "bkash",
  "nagad",
  "rocket",
  "upay",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank",
  card: "Card",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  upay: "Upay",
};

export const ROLES = [
  "administrator",
  "dentist",
  "receptionist",
  "accountant",
  "inventory_staff",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: "Administrator",
  dentist: "Dentist",
  receptionist: "Receptionist",
  accountant: "Accountant",
  inventory_staff: "Inventory Staff",
};

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const QUEUE_STATUSES = [
  "waiting",
  "called",
  "in_treatment",
  "completed",
  "skipped",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partial",
  "paid",
  "void",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAPER_SIZES = ["A4", "A5", "Letter", "80mm"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const CC_FIELDS = [
  { key: "cc_pain_on", label: "Pain On" },
  { key: "cc_g_carries", label: "G. Carries" },
  { key: "cc_swelling", label: "Swelling" },
  { key: "cc_gum_bleeding", label: "Gum Bleeding" },
  { key: "cc_bad_breath", label: "Bad Breath" },
  { key: "cc_sensitivity", label: "Sensitivity" },
] as const;

export const OE_FIELDS = [
  { key: "oe_carries", label: "Carries" },
  { key: "oe_g_carries", label: "G Carries" },
  { key: "oe_bdr", label: "BDR" },
  { key: "oe_bdc", label: "BDC" },
  { key: "oe_gingivitis", label: "Gingivitis" },
  { key: "oe_parodental_pocket", label: "Parodental Pocket" },
  { key: "oe_periodontitis", label: "Perio Dontitis" },
  { key: "oe_impacted_teeth", label: "Impected Teeth" },
  { key: "oe_dry_socket", label: "Dry Socket" },
  { key: "oe_attrition", label: "Attrition" },
  { key: "oe_erosion", label: "Erosion" },
] as const;

export const ADULT_FDI = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
] as const;

export const PRIMARY_FDI = [
  "55", "54", "53", "52", "51",
  "61", "62", "63", "64", "65",
  "85", "84", "83", "82", "81",
  "71", "72", "73", "74", "75",
] as const;

export const TOOTH_STATES = [
  "healthy",
  "caries",
  "filled",
  "crown",
  "root_canal",
  "missing",
  "extracted",
  "implant",
  "bridge",
  "impacted",
  "fractured",
  "watch",
] as const;

export type ToothState = (typeof TOOTH_STATES)[number];

export const DEFAULT_TREATMENTS: { name: string; category: string; duration: number; pricePaisa: number }[] = [
  { name: "Consultation", category: "Exam", duration: 20, pricePaisa: 50000 },
  { name: "Dental Check-up", category: "Exam", duration: 30, pricePaisa: 80000 },
  { name: "Scaling & Polishing", category: "Hygiene", duration: 45, pricePaisa: 150000 },
  { name: "Fluoride Application", category: "Hygiene", duration: 20, pricePaisa: 60000 },
  { name: "Composite Filling (Anterior)", category: "Restorative", duration: 40, pricePaisa: 200000 },
  { name: "Composite Filling (Posterior)", category: "Restorative", duration: 45, pricePaisa: 250000 },
  { name: "GIC Filling", category: "Restorative", duration: 30, pricePaisa: 150000 },
  { name: "Root Canal Treatment (Anterior)", category: "Endodontics", duration: 60, pricePaisa: 500000 },
  { name: "Root Canal Treatment (Posterior)", category: "Endodontics", duration: 90, pricePaisa: 800000 },
  { name: "Extraction (Simple)", category: "Surgery", duration: 30, pricePaisa: 150000 },
  { name: "Extraction (Surgical)", category: "Surgery", duration: 60, pricePaisa: 400000 },
  { name: "Wisdom Tooth Extraction", category: "Surgery", duration: 75, pricePaisa: 600000 },
  { name: "Crown (PFM)", category: "Prosthodontics", duration: 60, pricePaisa: 1200000 },
  { name: "Crown (Zirconia)", category: "Prosthodontics", duration: 60, pricePaisa: 1800000 },
  { name: "Complete Denture", category: "Prosthodontics", duration: 90, pricePaisa: 2500000 },
  { name: "Partial Denture", category: "Prosthodontics", duration: 60, pricePaisa: 1500000 },
  { name: "Teeth Whitening", category: "Aesthetic", duration: 60, pricePaisa: 800000 },
  { name: "Orthodontic Consultation", category: "Orthodontics", duration: 30, pricePaisa: 100000 },
  { name: "X-Ray (Periapical)", category: "Imaging", duration: 10, pricePaisa: 40000 },
  { name: "X-Ray (OPG)", category: "Imaging", duration: 15, pricePaisa: 80000 },
  { name: "Emergency Pain Relief", category: "Emergency", duration: 20, pricePaisa: 100000 },
];

export const SHORTCUTS = [
  { keys: "Ctrl+K", action: "Command palette" },
  { keys: "Ctrl+F", action: "Global search" },
  { keys: "Ctrl+N", action: "New patient" },
  { keys: "Ctrl+Shift+V", action: "New visit" },
  { keys: "Ctrl+Shift+A", action: "New appointment" },
  { keys: "Ctrl+Shift+I", action: "New invoice" },
  { keys: "Ctrl+Shift+P", action: "Receive payment" },
  { keys: "Ctrl+S", action: "Save" },
  { keys: "Escape", action: "Close / back" },
  { keys: "Ctrl+L", action: "Lock application" },
] as const;
