import { getApps, initializeApp, cert, App, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: App | null = null;

export function getAdminApp() {
  if (adminApp) return adminApp;
  if (!getApps().length) {
    // Accept multiple ways of providing credentials:
    // 1) FIREBASE_SERVICE_ACCOUNT (JSON string)
    // 2) FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of JSON)
    // 3) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
    let serviceAccount: any = null;
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (saJson) {
      serviceAccount = JSON.parse(saJson);
    } else if (saB64) {
      const decoded = Buffer.from(saB64, "base64").toString("utf8");
      serviceAccount = JSON.parse(decoded);
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      serviceAccount = {
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      };
    } else {
      // Fallback to ADC if GOOGLE_APPLICATION_CREDENTIALS is set
      // or machine has gcloud application-default login
      adminApp = initializeApp({
        credential: applicationDefault(),
      });
      return adminApp!;
    }
    adminApp = initializeApp({ credential: cert(serviceAccount) });
  } else {
    adminApp = getApps()[0]!;
  }
  return adminApp!;
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());


