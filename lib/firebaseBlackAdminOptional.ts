import type { App } from "firebase-admin/app";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getAuth } from "firebase-admin/auth";

const BLACK_APP_NAME = "pink-secondary-bms-black";

/**
 * Optional BMS Black Admin SDK — set `FIREBASE_BLACK_SERVICE_ACCOUNT` (JSON string) so agent
 * registration can create Firebase Auth users in Black (required for Command Center Black id tokens).
 */
export function getOptionalBlackAdminAuth(): Auth | null {
  const raw = process.env.FIREBASE_BLACK_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Parameters<typeof cert>[0];
    const existing = getApps().find((a) => a.name === BLACK_APP_NAME);
    const app: App = existing ?? initializeApp({ credential: cert(sa) }, BLACK_APP_NAME);
    return getAuth(app);
  } catch {
    return null;
  }
}
