import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { SMS_LOGS_COLLECTION, type AppendSmsLogInput } from "@/lib/sms/types";

async function resolveSenderName(
  ownerUid: string | null,
  override: string | null | undefined,
): Promise<string> {
  if (override?.trim()) return override.trim();
  if (!ownerUid) return "Salon";
  try {
    const snap = await adminDb().doc(`users/${ownerUid}`).get();
    const data = snap.data() ?? {};
    const name =
      (typeof data.salonName === "string" && data.salonName.trim()) ||
      (typeof data.businessName === "string" && data.businessName.trim()) ||
      (typeof data.name === "string" && data.name.trim()) ||
      "";
    return name || ownerUid;
  } catch {
    return ownerUid;
  }
}

export async function appendSmsLog(input: AppendSmsLogInput): Promise<void> {
  try {
    const ownerUid = input.ownerUid?.trim() || null;
    const senderName = await resolveSenderName(ownerUid, input.senderName);

    await adminDb().collection(SMS_LOGS_COLLECTION).add({
      ownerUid,
      businessId: ownerUid,
      senderName,
      receiverPhone: input.receiverPhone?.trim() || "—",
      receiverName: input.receiverName?.trim() || null,
      message: input.message?.trim() || "",
      status: input.status,
      statusDetail: input.statusDetail?.trim() || null,
      source: input.source?.trim() || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[sms-log] could not persist entry:", error);
  }
}
