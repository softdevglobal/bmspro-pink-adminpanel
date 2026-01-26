import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration (prefer env; fallback to staging values)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDEqqcY5778KkFGeeD59DdxaVJmyWl6Kpw",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "bmspro-pink-v2-staging.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "bmspro-pink-v2-staging",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "bmspro-pink-v2-staging.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "545320934186",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:545320934186:web:ebf4aa8fb734539ec99c53",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-5TJLX869X9",
};

// Initialize (guarded for Next.js hot reload)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Stabilize Firestore in Next.js dev (Turbopack/HMR) and varied network environments
// Note: Removed experimentalAutoDetectLongPolling as it was causing connection warnings (code=unavailable)
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

// Firebase Storage for file uploads
const storage = getStorage(app);

export { app, auth, db, storage };