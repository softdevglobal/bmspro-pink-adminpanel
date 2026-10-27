import { NextRequest, NextResponse } from "next/server";
import type { DocumentData, Firestore, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { resolveAgentActivityActor } from "@/lib/callCenterActorFromAuth";
import { toIso } from "@/lib/callCenterBookings";

export const runtime = "nodejs";

/** Firestore collection for call-center agent activity records (same name/shape as BMS Black). */
const COLLECTION = "agent_activities";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function serializeAgentActivity(id: string, d: DocumentData) {
  return {
    id,
    callId: String(d.callId ?? ""),
    agentName: String(d.agentName ?? ""),
    agentUserId: String(d.agentUserId ?? ""),
    agentEmail: String(d.agentEmail ?? ""),
    agentRole: String(d.agentRole ?? ""),
    recordedByKind: d.recordedByKind === "tenant_admin" ? "tenant_admin" : "agent",
    callerNumber: String(d.callerNumber ?? ""),
    callerName: String(d.callerName ?? ""),
    agentNote: String(d.agentNote ?? ""),
    didNumber: String(d.didNumber ?? ""),
    ownerId: String(d.ownerId ?? ""),
    ownerName: String(d.ownerName ?? ""),
    ownerTimezone: String(d.ownerTimezone ?? "Australia/Sydney"),
    branchId: String(d.branchId ?? ""),
    branchName: String(d.branchName ?? ""),
    queueId: String(d.queueId ?? ""),
    queueName: String(d.queueName ?? ""),
    recordingUrl: String(d.recordingUrl ?? ""),
    recordingFileName: String(d.recordingFileName ?? ""),
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

function resolveOwnerId(src: { ownerId?: unknown; ownerUid?: unknown }): string {
  const raw = src.ownerId ?? src.ownerUid;
  return typeof raw === "string" ? raw.trim() : "";
}

function isFirestoreIndexError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: number | string; message?: string; details?: string };
  const text = `${e.message || ""} ${e.details || ""}`.toLowerCase();
  return e.code === 9 || e.code === "failed-precondition" || text.includes("requires an index");
}

/** First recording reference among the accepted field spellings (URL, gs:// or storage path). */
function resolveRecording(body: Record<string, unknown>) {
  const isReference = (value: string) => {
    if (!value) return false;
    if (value.startsWith("http") || value.startsWith("gs://")) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
    return value.includes("/") || /\.[a-z0-9]{2,5}($|[?#])/i.test(value);
  };
  const fileName = str(body.recordingFileName) || str(body.recording_file_name);
  for (const key of [
    "recordingUrl",
    "recordingFileUrl",
    "recording_file_url",
    "recordingPath",
    "recording_path",
    "recordingFile",
    "recording_file",
  ]) {
    const value = str(body[key]);
    if (isReference(value)) return { recordingUrl: value, recordingFileName: fileName };
  }
  const fileOnly = str(body.recordingFile);
  return { recordingUrl: "", recordingFileName: fileName || (!isReference(fileOnly) ? fileOnly : "") };
}

async function fetchAgentActivities(
  db: Firestore,
  f: { ownerId: string; agentUserId: string; agentEmail: string; branchId: string; callId: string; limit: number }
): Promise<QueryDocumentSnapshot[]> {
  let query: Query = db.collection(COLLECTION).where("ownerId", "==", f.ownerId);
  if (f.agentUserId) query = query.where("agentUserId", "==", f.agentUserId);
  if (f.branchId) query = query.where("branchId", "==", f.branchId);
  if (f.callId) query = query.where("callId", "==", f.callId);
  const emailLower = f.agentEmail.toLowerCase();

  try {
    const snap = await query.orderBy("createdAt", "desc").limit(f.limit).get();
    return emailLower
      ? snap.docs.filter((doc) => String(doc.data().agentEmail || "").toLowerCase() === emailLower)
      : snap.docs;
  } catch (error) {
    if (!isFirestoreIndexError(error)) throw error;
    console.warn("[call-center/agent-activities GET] Composite index missing; using in-memory sort.");
    const snap = await db
      .collection(COLLECTION)
      .where("ownerId", "==", f.ownerId)
      .limit(Math.min(Math.max(f.limit * 5, 100), 500))
      .get();
    const ms = (doc: QueryDocumentSnapshot) => Date.parse(toIso(doc.data().createdAt) || "") || 0;
    return snap.docs
      .filter((doc) => {
        const d = doc.data();
        if (f.agentUserId && d.agentUserId !== f.agentUserId) return false;
        if (emailLower && String(d.agentEmail || "").toLowerCase() !== emailLower) return false;
        if (f.branchId && d.branchId !== f.branchId) return false;
        if (f.callId && d.callId !== f.callId) return false;
        return true;
      })
      .sort((a, b) => ms(b) - ms(a))
      .slice(0, f.limit);
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/agent-activities
 *
 * Records one handled call in Firestore `agent_activities`. Agent identity (`agentUserId`,
 * `agentName`, `agentEmail`, `agentRole`, `recordedByKind`) comes from the Bearer token and
 * Firestore profile — never from the body.
 *
 * Body (JSON):
 * {
 *   "ownerId": "<salon owner uid>",   // `ownerUid` accepted as alias — required
 *   "callId": "call-id",              // required
 *   "callerNumber": "+61400000000",   // required
 *   "callerName", "agentNote", "didNumber", "branchId", "branchName",
 *   "queueId", "queueName", "recordingUrl", "recordingFileName"
 * }
 */
export async function POST(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const ownerId = resolveOwnerId(body);
  if (!ownerId) {
    return NextResponse.json(
      { error: "Missing ownerId (salon owner Firebase UID)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerId)) {
    return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
  }
  const callId = str(body.callId);
  const callerNumber = str(body.callerNumber);
  if (!callId) return NextResponse.json({ error: "Missing callId" }, { status: 400, headers: CORS_HEADERS });
  if (!callerNumber) {
    return NextResponse.json({ error: "Missing callerNumber" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const db = adminDb();
    const actor = await resolveAgentActivityActor(gate.auth);

    let ownerName = "";
    let ownerTimezone = "Australia/Sydney";
    try {
      const od = (await db.doc(`users/${ownerId}`).get()).data();
      ownerName = String(od?.name || od?.displayName || "").trim();
      ownerTimezone = String(od?.timezone || "").trim() || ownerTimezone;
    } catch {
      // Owner lookup is best-effort.
    }

    const now = new Date();
    const record = {
      callId,
      agentUserId: actor.uid,
      agentName: actor.displayName,
      agentEmail: actor.email,
      agentRole: actor.role,
      recordedByKind: actor.recordedByKind,
      callerNumber,
      callerName: str(body.callerName),
      agentNote: str(body.agentNote),
      didNumber: str(body.didNumber),
      ownerId,
      ownerName,
      ownerTimezone,
      branchId: str(body.branchId),
      branchName: str(body.branchName),
      queueId: str(body.queueId),
      queueName: str(body.queueName),
      ...resolveRecording(body),
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection(COLLECTION).add(record);

    return NextResponse.json(
      { success: true, id: ref.id, activity: serializeAgentActivity(ref.id, record) },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/agent-activities POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}

/**
 * GET /api/call-center/agent-activities?ownerId=<salon owner uid>
 *
 * Optional: agentUserId, agentEmail (case-insensitive), branchId, callId, limit (default 25, max 100).
 * Newest first.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const params = req.nextUrl.searchParams;
  const ownerId = resolveOwnerId({ ownerId: params.get("ownerId"), ownerUid: params.get("ownerUid") });
  if (!ownerId) {
    return NextResponse.json({ error: "Missing ownerId query parameter" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerId)) {
    return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
  }
  const limitRaw = parseInt(params.get("limit") || "25", 10);

  try {
    const docs = await fetchAgentActivities(adminDb(), {
      ownerId,
      agentUserId: params.get("agentUserId")?.trim() || "",
      agentEmail: params.get("agentEmail")?.trim() || "",
      branchId: params.get("branchId")?.trim() || "",
      callId: params.get("callId")?.trim() || "",
      limit: Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 100),
    });
    const activities = docs.map((doc) => serializeAgentActivity(doc.id, doc.data()));
    return NextResponse.json({ success: true, activities, total: activities.length }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[call-center/agent-activities GET] Error:", error);
    if (isFirestoreIndexError(error)) {
      return NextResponse.json(
        { error: "Firestore index required for agent_activities (ownerId + createdAt). Create it from the link in the server log." },
        { status: 503, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
