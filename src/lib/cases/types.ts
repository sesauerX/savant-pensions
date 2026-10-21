import type { DocKey } from "./documents";
import type { MilestoneKey } from "./milestones";
import type { Fields } from "./schema";

export type { DocKey, MilestoneKey, Fields };

export type FileKind = "draft" | "signed" | "notarized" | "apostille" | "audit_trail" | "inbound" | "upload" | "proof";

export type CaseFile = {
  id: string;
  path: string;
  name: string;
  kind: FileKind;
  doc?: DocKey;
  size: number;
  contentType: string;
  createdAt: string;
  by: string;
  templateVersion?: string;
  inboundEmailId?: string;
  pages?: number;
  /** Certificate issue number (C1, C2…) for certificate files. */
  certNo?: number;
};

export type DocRecord = { current?: string; signed?: string; notarized?: string[]; history: string[] };

export type EnvelopeRef = {
  documentId: string;
  status: string;
  sentAt: string;
  completedAt?: string;
  lastPolledAt?: string;
  signers?: { name: string; email: string; status: string; order: number }[];
};

/** One issued Certificate of Pension Administration (C1 at onboarding, later payment-history issues). */
export type CertIssue = {
  no: number;
  ref: string; // "{caseRef}-C{no}"
  variant: "onboarding" | "payment_history";
  certificate_date: string;
  payments_made?: number;
  last_payment_date?: string;
  attestedBy?: { name: string; at: string; text: string };
  createdAt: string;
  by: string;
  files: { current?: string; signed?: string; notarized: string[]; history: string[]; proof: string[] };
  notary?: { meeting: string; notary: string; at: string; by: string };
  boldsign?: EnvelopeRef; // separate e-signature (issues after C1)
  signPages?: number;
  shipments: string[]; // shipment ids
  emailedAt?: string;
};

export type Case = {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: "active" | "on_hold" | "cancelled" | "closed";
  holdReason?: string;
  source: { type: "email" | "manual"; from?: string; subject?: string; receivedAt?: string; resendEmailId?: string };
  fields: Fields;
  extraction?: { model: string; at: string; notes: string; missing: string[]; uncertain: string[]; error?: string };
  files: CaseFile[];
  docs: Record<DocKey, DocRecord>;
  boldsign?: {
    documentId: string;
    status: string;
    sentAt: string;
    completedAt?: string;
    parts: { doc: DocKey; pages: number; certNo?: number }[];
    lastPolledAt?: string;
    signers?: { name: string; email: string; status: string; order: number }[];
    redirectedFrom?: string;
    signingDatePrinted?: string;
    history?: { documentId: string; status: string; at: string }[];
  };
  milestones: Partial<Record<MilestoneKey, { at: string; by: string; data?: Record<string, string> }>>;
  certificates: CertIssue[];
  shipments: {
    id: string;
    contents: DocKey[];
    certNo?: number;
    carrier: string;
    tracking: string;
    trackingUrl?: string;
    shippedAt: string;
    deliveredAt?: string;
  }[];
  emails: {
    kind: "A" | "B" | "C" | "tracking" | "details" | "other";
    certNo?: number;
    lang?: "en" | "de";
    to: string[];
    subject: string;
    sentAt: string;
    resendId?: string;
    redirectedFrom?: string[];
    attachments?: string[];
    by?: string;
  }[];
  inbound: { emailId: string; from: string; subject: string; receivedAt: string; fileIds: string[] }[];
  events: { at: string; by: string; text: string }[];
  notes: string;
};

export type IndexEntry = {
  id: string;
  company: string;
  beneficiary: string;
  status: string;
  statusLabel: string;
  next: string;
  state: Case["state"];
  updatedAt: string;
  createdAt: string;
};
