import { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

export type AppUserRole = "super_admin" | "salon_owner" | "salon_staff" | "pending";

/**
 * Ensure a Firestore user doc exists for the logged-in user.
 * - If an invitation exists for the same email, link the uid to that invite and mirror it to users/{uid}.
 * - Otherwise, create a new "pending" user document.
 */
export async function ensureUserDocument(user: User | null) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) return;

  // Try to link with an existing invite (matched by email)
  if (user.email) {
    const q = query(collection(db, "users"), where("email", "==", user.email));
    const qs = await getDocs(q);
    if (!qs.empty) {
      const invited = qs.docs[0];
      await updateDoc(invited.ref, {
        uid: user.uid,
        displayName: user.displayName || "",
        updatedAt: serverTimestamp(),
      });
      await setDoc(
        userRef,
        {
          ...invited.data(),
          uid: user.uid,
          displayName: user.displayName || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }
  }

  // Create a new pending user
  await setDoc(userRef, {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role: "pending" as AppUserRole,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    provider: user.providerData?.[0]?.providerId || "password",
  });
}

/**
 * Create or promote a user record by email to a specific role.
 * Used by super_admin to invite salon owners or promote roles.
 * (Auth account will be linked on first login via ensureUserDocument.)
 */
export async function upsertUserByEmail(email: string, role: Exclude<AppUserRole, "super_admin">, displayName?: string) {
  const q = query(collection(db, "users"), where("email", "==", email));
  const qs = await getDocs(q);
  if (!qs.empty) {
    await updateDoc(qs.docs[0].ref, {
      role,
      displayName: displayName || qs.docs[0].data().displayName || "",
      invitedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  await addDoc(collection(db, "users"), {
    email,
    displayName: displayName || "",
    role,
    invitedAt: serverTimestamp(),
    status: "invited",
  });
}
