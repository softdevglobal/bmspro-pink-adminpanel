import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAXkJB5pymjqwcTDc5DtH_CbDtXPIslsao",
  authDomain: "bms-pro-e3125.firebaseapp.com",
  projectId: "bms-pro-e3125",
  storageBucket: "bms-pro-e3125.firebasestorage.app",
  messagingSenderId: "95517764192",
  appId: "1:95517764192:web:a674c4c1aa55c314b23105",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };


