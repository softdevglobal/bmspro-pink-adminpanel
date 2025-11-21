import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD08qXcZjC1N_wX8EE5YGgN4sA-ZrJQICg",
  authDomain: "bmspro-pink.firebaseapp.com",
  projectId: "bmspro-pink",
  storageBucket: "bmspro-pink.firebasestorage.app",
  messagingSenderId: "960634304944",
  appId: "1:960634304944:web:9c9cb29b14b13924b73e75",
};

// Initialize (guarded for Next.js hot reload)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
// Stabilize Firestore in Next.js dev (Turbopack/HMR) and varied network environments
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});

export { app, auth, db };