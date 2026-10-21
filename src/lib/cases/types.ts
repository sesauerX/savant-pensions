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
};

export type DocRecord = { current?: string; signed?: string; notarized?: string[]; history: string[] };

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
    parts: { doc: DocKey; pages: number }[];
    lastPolledAt?: string;
    signers?: { name: string; email: string; status: string; order: number }[];
    redirectedFrom?: string;
    signingDatePrinted?: string;
    history?: { documentId: string; status: string; at: string }[];
  };
  milestones: Partial<Record<MilestoneKey, { at: string; by: string; data?: Record<string, string> }>>;
  shipments: {
    id: string;
    contents: DocKey[];
    carrier: string;
    tracking: string;
    trackingUrl?: string;
    shippedAt: string;
    deliveredAt?: string;
  }[];
  emails: {
    kind: "A" | "B" | "C" | "tracking" | "other";
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
