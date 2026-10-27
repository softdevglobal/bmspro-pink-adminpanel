import type { DocumentData, Firestore } from "firebase-admin/firestore";

export type CallCenterStaffSummary = {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
};

/** Resolve `users/{uid}` rows for the given ids (Firestore `in` limit: 30 per query). */
export async function loadStaffSummaries(
  db: Firestore,
  ids: string[]
): Promise<Record<string, CallCenterStaffSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Record<string, CallCenterStaffSummary> = {};
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await db.collection("users").where("__name__", "in", unique.slice(i, i + 30)).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      out[doc.id] = {
        id: doc.id,
        name: d.displayName || d.name || "",
        role: d.role || "",
        branchId: d.branchId || null,
      };
    }
  }
  return out;
}

export function serviceStaffIds(d: DocumentData): string[] {
  return Array.isArray(d.staffIds) ? (d.staffIds as unknown[]).map(String) : [];
}

/** Pink services carry a single price/duration (no vehicle-type tiers). */
export function serializeCallCenterServiceBase(id: string, d: DocumentData) {
  return {
    id,
    name: d.name || "",
    description: d.description || "",
    price: Number(d.price ?? 0) || 0,
    duration: Number(d.duration ?? 0) || 0,
    icon: d.icon || "",
    imageUrl: d.imageUrl || "",
  };
}
