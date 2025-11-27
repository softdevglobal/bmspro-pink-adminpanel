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
      (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID) &&
      (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL) &&
      (process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)
    ) {
      serviceAccount = {
        project_id: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL,
        private_key: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      };
    }

    if (serviceAccount) {
      adminApp = initializeApp({ credential: cert(serviceAccount) });
    } else {
      // If no explicit credentials, we might be in a GCP environment (Cloud Run/Functions)
      // where Application Default Credentials (ADC) work automatically.
      // However, locally this causes a hang/error trying to reach the metadata server.
      
      // Check if we are likely in development/local
      const isLocal = process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
      
      if (isLocal) {
        console.error("Firebase Admin: Missing credentials. Please set FIREBASE_SERVICE_ACCOUNT, FIREBASE_ADMIN_*, or FIREBASE_* credentials in your .env file.");
        // We proceed to let it fail with the native error, or we could throw here.
        // Throwing here ensures the API route catches a meaningful message.
        throw new Error("Missing Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT or individual keys).");
      }
      
      adminApp = initializeApp({ credential: applicationDefault() });
    }
  } else {
    adminApp = getApps()[0]!;
  }
  return adminApp!;
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());


