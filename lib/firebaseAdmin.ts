import { getApps, initializeApp, cert, App, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: App | null = null;

export function getAdminApp() {
  if (adminApp) return adminApp;
  if (!getApps().length) {
    // Accept multiple ways of providing credentials (in order of preference)
    // 1) FIREBASE_SERVICE_ACCOUNT (JSON string)
    // 2) FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 JSON)
    // 3) FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
    // 4) Application Default Credentials
    let serviceAccount: any | null = null;

    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

    if (saJson) {
      serviceAccount = JSON.parse(saJson);
    } else if (saB64) {
      const decoded = Buffer.from(saB64, "base64").toString("utf8");
      serviceAccount = JSON.parse(decoded);
    } else if (
      process.env.FIREBASE_ADMIN_PROJECT_ID &&
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      process.env.FIREBASE_ADMIN_PRIVATE_KEY
    ) {
      serviceAccount = {
        project_id: process.env.FIREBASE_ADMIN_PROJECT_ID,
        client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        private_key: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      };
    }

    if (serviceAccount) {
      adminApp = initializeApp({ credential: cert(serviceAccount) });
    } else {
      adminApp = initializeApp({ credential: applicationDefault() });
    }
  } else {
    adminApp = getApps()[0]!;
  }
  return adminApp!;
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());


