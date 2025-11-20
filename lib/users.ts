import { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

export type AppUserRole = "super_admin" | "salon_owner" 

export async function ensureSuperAdminUser(user: User | null) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      role: "super_admin" as AppUserRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      provider: user.providerData?.[0]?.providerId || "password",
    });
  }
}


