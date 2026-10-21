// Retention. Cases are never deleted automatically. The one exception: attachments an admin
// tagged as identity documents are deleted 90 days after the case's details were confirmed.
import { addEvent, getCase, mutateCase, nowIso } from "./cases";
import { deleteFile } from "./store";

export const IDENTITY_RETENTION_DAYS = 90;
export const RETENTION_POLICY = "Retain until 7 years after the final pension payment";

/** Delete due identity documents of one case. Returns how many were deleted. */
export async function purgeIdentityDocuments(id: string, now = Date.now()) {
  const c = await getCase(id);
  const confirmedAt = c?.milestones.details_confirmed?.at;
  if (!c || !confirmedAt) return 0;
  if (now - Date.parse(confirmedAt) < IDENTITY_RETENTION_DAYS * 86_400_000) return 0;
  const due = c.files.filter((f) => f.identity && !f.deleted);
  if (!due.length) return 0;
  const deleted: string[] = [];
  for (const f of due) {
    try {
      await deleteFile(f.path);
      deleted.push(f.id);
    } catch (err) {
      console.error("[cases] identity document delete failed", id, (err as Error).name);
    }
  }
  if (!deleted.length) return 0;
  await mutateCase(id, "retention (daily check)", (cc) => {
    for (const f of cc.files) {
      if (!deleted.includes(f.id) || f.deleted) continue;
      f.deleted = { at: nowIso(), reason: `identity document, ${IDENTITY_RETENTION_DAYS} days after details were confirmed` };
      addEvent(cc, "retention (daily check)", `Deleted identity document "${f.name}" (${IDENTITY_RETENTION_DAYS} days after details were confirmed)`);
    }
  });
  return deleted.length;
}
