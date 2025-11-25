import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export type BookingInput = {
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
  serviceId: string | number;
  serviceName?: string;
  staffId: string;
  staffName?: string;
  branchId: string;
  branchName?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration: number; // minutes
  status?: "Confirmed" | "Pending" | "Canceled" | "Completed";
  price: number;
};

export async function createBooking(input: BookingInput): Promise<{ id: string }> {
  const user = auth.currentUser;
  const token =
    (await user?.getIdToken().catch(() => null)) ||
    (typeof window !== "undefined" ? localStorage.getItem("idToken") : null);
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...input,
        status: input.status || "Confirmed",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(json?.error || "Failed");
    }
    // If API was a dev no-op, also persist from client
    if (json?.devNoop) {
      const payload = {
        ownerUid: user?.uid || null,
        ...input,
        status: input.status || "Confirmed",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "bookings"), payload as any);
      return { id: ref.id };
    }
    return { id: String(json?.id) };
  } catch {
    // Fallback: write from client (requires Firestore rules allow authenticated writes)
    const payload = {
      ownerUid: user?.uid || null,
      ...input,
      status: input.status || "Confirmed",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, "bookings"), payload as any);
    return { id: ref.id };
  }
}


