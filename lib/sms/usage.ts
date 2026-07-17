import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { parseOwnerSmsFields } from "@/lib/sms/types";

export async function tryConsumeSmsCredits(
  ownerUid: string,
  count: number,
): Promise<boolean> {
  const trimmedId = ownerUid.trim();
  if (!trimmedId || count <= 0) return false;

  const ref = adminDb().doc(`users/${trimmedId}`);

  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;

      const balance = parseOwnerSmsFields(snap.data() ?? {});
      if (balance.isUnlimited) return true;

      const remaining = balance.remaining ?? 0;
      if (remaining < count) {
        console.warn("[sms] skipped — quota exceeded.", {
          ownerUid: trimmedId,
          remaining,
          requested: count,
        });
        return false;
      }

      tx.update(ref, {
        smsMessagesUsed: balance.used + count,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch (error) {
    console.error("[sms] quota reservation failed", { ownerUid: trimmedId, error });
    return false;
  }
}

export async function releaseSmsCredits(
  ownerUid: string,
  count: number,
): Promise<void> {
  const trimmedId = ownerUid.trim();
  if (!trimmedId || count <= 0) return;

  const ref = adminDb().doc(`users/${trimmedId}`);

  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;

      const balance = parseOwnerSmsFields(snap.data() ?? {});
      if (balance.isUnlimited) return;

      tx.update(ref, {
        smsMessagesUsed: Math.max(0, balance.used - count),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    console.error("[sms] credit release failed", { ownerUid: trimmedId, error });
  }
}
