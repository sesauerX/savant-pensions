// Case repository on the private Blob store.
import { randomBytes } from "node:crypto";
import { DOC_KEYS } from "./documents";
import { caseStatus } from "./milestones";
import { deletePrefix, putFile, readJson, updateJson, writeJson } from "./store";
import type { Case, CaseFile, DocKey, FileKind, IndexEntry } from "./types";

export const REF_RE = /SPG-\d{4}-\d{4}/;
export const isCaseId = (id: unknown): id is string => typeof id === "string" && /^SPG-\d{4}-\d{4}$/.test(id);

const casePath = (id: string) => `cases/${id}/case.json`;
const INDEX = "cases/index.json";

export const nowIso = () => new Date().toISOString();
export const randomId = (bytes = 6) => randomBytes(bytes).toString("hex");

/** Next sequential reference for this year, e.g. SPG-2026-0007. */
export async function allocateReference(): Promise<string> {
  const year = new Date().getUTCFullYear();
  let n = 0;
  await updateJson<{ next: number }>(
    `counters/ref-${year}.json`,
    (c) => {
      n = c.next;
      return { next: c.next + 1 };
    },
    () => ({ next: 1 }),
  );
  return `SPG-${year}-${String(n).padStart(4, "0")}`;
}

function emptyDocs() {
  return Object.fromEntries(DOC_KEYS.map((k) => [k, { history: [] }])) as unknown as Case["docs"];
}

export async function createCase(init: Pick<Case, "source"> & Partial<Case>, by: string): Promise<Case> {
  const id = await allocateReference();
  const at = nowIso();
  const c: Case = {
    id,
    createdAt: at,
    updatedAt: at,
    state: "active",
    fields: {},
    files: [],
    docs: emptyDocs(),
    milestones: {},
    shipments: [],
    emails: [],
    inbound: [],
    events: [],
    notes: "",
    ...init,
  };
  c.events = [{ at, by, text: `Case created (${init.source.type})` }, ...(init.events ?? [])];
  await writeJson(casePath(id), c, { create: true });
  await updateIndex(c);
  return c;
}

export async function getCase(id: string): Promise<Case | null> {
  if (!isCaseId(id)) return null;
  const res = await readJson<Case>(casePath(id));
  if (!res) return null;
  return normalise(res.data);
}

/** Older records may lack newer arrays. */
function normalise(c: Case): Case {
  c.inbound ??= [];
  c.emails ??= [];
  c.shipments ??= [];
  c.events ??= [];
  c.files ??= [];
  c.docs ??= emptyDocs();
  for (const k of DOC_KEYS) c.docs[k] ??= { history: [] };
  return c;
}

/**
 * ETag-guarded read/modify/write. `fn` mutates the case in place and may push events.
 * Retries on conflict (so `fn` must be safe to run more than once).
 */
export async function mutateCase(id: string, by: string, fn: (c: Case) => void | Promise<void>): Promise<Case> {
  const next = await updateJson<Case>(casePath(id), async (current) => {
    const c = normalise(structuredClone(current));
    await fn(c);
    c.updatedAt = nowIso();
    return c;
  });
  await updateIndex(next);
  return next;
}

export function addEvent(c: Case, by: string, text: string) {
  c.events.push({ at: nowIso(), by, text });
}

export function setMilestone(c: Case, key: keyof Case["milestones"], by: string, data?: Record<string, string>) {
  if (c.milestones[key]) return false;
  c.milestones[key] = { at: nowIso(), by, ...(data ? { data } : {}) };
  return true;
}

function indexEntry(c: Case): IndexEntry {
  const s = caseStatus(c);
  return {
    id: c.id,
    company: String(c.fields.company_name ?? ""),
    beneficiary: String(c.fields.beneficiary_name ?? c.fields.member_name ?? ""),
    status: s.key,
    statusLabel: s.label,
    next: s.next,
    state: c.state,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  };
}

export async function updateIndex(c: Case) {
  const entry = indexEntry(c);
  await updateJson<IndexEntry[]>(
    INDEX,
    (list) => [entry, ...list.filter((e) => e.id !== c.id)].sort((a, b) => b.id.localeCompare(a.id)),
    () => [],
  );
}

export async function listCases(): Promise<IndexEntry[]> {
  return (await readJson<IndexEntry[]>(INDEX))?.data ?? [];
}

export async function removeFromIndex(id: string) {
  await updateJson<IndexEntry[]>(INDEX, (list) => list.filter((e) => e.id !== id), () => []);
}

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "file";

/** Store bytes under the case folder; returns the file record (caller adds it to the case). */
export async function storeFile(
  caseId: string,
  opts: { bytes: Uint8Array; name: string; kind: FileKind; contentType: string; by: string; doc?: DocKey; templateVersion?: string; inboundEmailId?: string; pages?: number },
): Promise<CaseFile> {
  const id = randomId();
  const path = `cases/${caseId}/files/${id}-${slug(opts.name)}`;
  await putFile(path, opts.bytes, opts.contentType);
  return {
    id,
    path,
    name: opts.name,
    kind: opts.kind,
    size: opts.bytes.byteLength,
    contentType: opts.contentType,
    createdAt: nowIso(),
    by: opts.by,
    ...(opts.doc ? { doc: opts.doc } : {}),
    ...(opts.templateVersion ? { templateVersion: opts.templateVersion } : {}),
    ...(opts.inboundEmailId ? { inboundEmailId: opts.inboundEmailId } : {}),
    ...(opts.pages ? { pages: opts.pages } : {}),
  };
}

export const fileById = (c: Case, id?: string) => (id ? c.files.find((f) => f.id === id) : undefined);

export async function deleteCaseData(id: string) {
  const count = await deletePrefix(`cases/${id}/`);
  await removeFromIndex(id);
  return count;
}
