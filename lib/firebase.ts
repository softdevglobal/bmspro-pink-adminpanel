import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration (prefer env; fallback to hard-coded dev values)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyD08qXcZjC1N_wX8EE5YGgN4sA-ZrJQICg",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "bmspro-pink.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "bmspro-pink",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "bmspro-pink.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "960634304944",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:960634304944:web:9c9cb29b14b13924b73e75",
};

// Initialize (guarded for Next.js hot reload)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Stabilize Firestore in Next.js dev (Turbopack/HMR) and varied network environments
// Use custom database ID if specified in env, otherwise use the project's custom db name
const FIRESTORE_DATABASE_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || "bmspro-pinkdb";
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
}, FIRESTORE_DATABASE_ID);

// Firebase Storage for file uploads
const storage = getStorage(app);

export { app, auth, db, storage };