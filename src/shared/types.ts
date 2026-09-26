import type {
  AppointmentStatus,
  InvoiceStatus,
  PaperSize,
  PaymentMethod,
  QueueStatus,
  Role,
  ToothState,
} from "./constants.ts";

export type PermissionName = string;
export type PaisaAmount = number;

export type SessionInfo = {
  sessionId: string;
  staffId: string;
  name: string;
  username: string;
  role: Role;
  permissions: PermissionName[];
  locked: boolean;
  clinicName: string;
  timezone: string;
  currency: string;
};

export type ClinicSettings = {
  clinicName: string;
  logoPath: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationInfo: string;
  dentistName: string;
  dentistQualifications: string;
  dentistRegistration: string;
  currency: string;
  timezone: string;
  invoicePrefix: string;
  receiptPrefix: string;
  patientPrefix: string;
  paperSize: PaperSize;
  invoiceFooter: string;
  receiptFooter: string;
  prescriptionFooter: string;
  taxRateBps: number;
  appointmentSlotMinutes: number;
  inactivityTimeoutMinutes: number;
  backupDir: string | null;
  printSettings: Record<string, unknown>;
  notificationSettings: Record<string, unknown>;
  securitySettings: Record<string, unknown>;
  prefs: Record<string, unknown>;
  updatedAt: string;
};

export type Staff = {
  id: string;
  name: string;
  role: Role;
  contact: string | null;
  username: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Patient = {
  id: string;
  code: string;
  title: string | null;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  age: number | null;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  occupation: string | null;
  referralSource: string | null;
  tags: string[];
  notes: string | null;
  archived: boolean;
  outstandingPaisa: number;
  allergyAlert: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PatientMedical = {
  history: string;
  allergies: string;
  allergyAlert: boolean;
  medications: string;
  chronicConditions: string;
  importantNotes: string;
};

export type PatientDental = {
  history: string;
  previousTreatment: string;
  oralHygiene: string;
  notes: string;
};

export type DuplicateCandidate = {
  id: string;
  code: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  reasons: string[];
};

export type Visit = {
  id: string;
  patientId: string;
  patientCode: string;
  dentistId: string | null;
  visitedAt: string;
  chiefComplaint: string;
  reason: string;
  symptoms: string;
  findings: string;
  diagnosis: string;
  treatmentPlanNotes: string;
  treatmentPerformed: string;
  toothNumbers: string[];
  anesthesia: string;
  medicationsNotes: string;
  notes: string;
  followUpNotes: string;
  referralNotes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ToothChartEntry = {
  toothFdi: string;
  dentition: "adult" | "primary";
  state: ToothState;
  notes: string;
};

export type PrescriptionMed = {
  id: string;
  sequence: number;
  medicine: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  timing: string;
  instructions: string;
};

export type Prescription = {
  id: string;
  patientId: string;
  visitId: string | null;
  dentistId: string | null;
  prescribedAt: string;
  cc: Record<string, boolean | string>;
  oe: Record<string, boolean | string>;
  reNotes: string;
  advice: string;
  notes: string;
  medications: PrescriptionMed[];
};

export type Appointment = {
  id: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  dentistId: string | null;
  dentistName: string | null;
  chairId: string | null;
  chairName: string | null;
  roomId: string | null;
  roomName: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  appointmentType: string | null;
  status: AppointmentStatus;
  notes: string;
};

export type QueueItem = {
  id: string;
  queueDate: string;
  serial: number;
  serialLabel: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  appointmentId: string | null;
  status: QueueStatus;
  notes: string;
};

export type InvoiceLine = {
  id: string;
  sequence: number;
  treatmentId: string | null;
  visitId: string | null;
  description: string;
  tooth: string | null;
  quantity: number;
  unitPricePaisa: PaisaAmount;
  discountPaisa: PaisaAmount;
  lineTotalPaisa: PaisaAmount;
};

export type Invoice = {
  id: string;
  number: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  visitId: string | null;
  issuedAt: string;
  subtotalPaisa: PaisaAmount;
  discountPaisa: PaisaAmount;
  taxPaisa: PaisaAmount;
  totalPaisa: PaisaAmount;
  paidPaisa: PaisaAmount;
  duePaisa: PaisaAmount;
  status: InvoiceStatus;
  notes: string;
  lines: InvoiceLine[];
};

export type Payment = {
  id: string;
  invoiceId: string;
  patientId: string;
  receiptId: string | null;
  receiptNumber: string | null;
  method: PaymentMethod;
  amountPaisa: PaisaAmount;
  paidAt: string;
  reference: string | null;
  notes: string | null;
};

export type Receipt = {
  id: string;
  number: string;
  paymentId: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  issuedAt: string;
  amountPaisa: PaisaAmount;
  method: PaymentMethod;
  invoiceNumber: string;
  remainingPaisa: PaisaAmount;
  reference: string | null;
};

export type StatementLine = {
  at: string;
  kind: "invoice" | "payment" | "refund" | "adjustment";
  description: string;
  reference: string;
  debitPaisa: PaisaAmount;
  creditPaisa: PaisaAmount;
  runningPaisa: PaisaAmount;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type SearchHit = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string;
  code?: string;
};

export type TimelineEvent = {
  id: string;
  at: string;
  kind: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
};
