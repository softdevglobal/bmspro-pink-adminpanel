import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function normalizeDateKey(value: any): string {
  if (value == null || value === "") return "";
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
    if (/^\d{4}\/\d{2}\/\d{2}/.test(v)) return v.substring(0, 10).replace(/\//g, "-");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
      const [dd, mm, yyyy] = v.split("/");
      return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return "";
  }
  if (typeof value === "object" && "seconds" in value) {
    const d = new Date((value as { seconds: number }).seconds * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return "";
}

function toCalBooking(doc: { id: string; data: () => any }): any | null {
  const data = doc.data();
  const st = (data.status || "").toLowerCase();
  if (st === "canceled" || st === "cancelled" || st === "staffrejected") return null;
  return {
    id: doc.id,
    date: data.date || "",
    dateKey: normalizeDateKey(data.date),
    time: data.time || "09:00",
    pickupTime: data.pickupTime || "",
    duration: data.duration || 60,
    client: data.client || data.clientName || "Customer",
    clientPhone: data.clientPhone || "",
    clientEmail: data.clientEmail || "",
    vehicleNumber: data.vehicleNumber || "",
    vehicleMake: data.vehicleMake || "",
    vehicleModel: data.vehicleModel || "",
    notes: data.notes || "",
    serviceName: data.serviceName || (Array.isArray(data.services) ? data.services.map((s: any) => s?.name).join(", ") : "Service"),
    branchId: data.branchId || "",
    branchName: data.branchName || "",
    staffName: data.staffName || "",
    staffId: data.staffId || "",
    status: data.status || "Pending",
    price: data.price || 0,
    services: data.services || [],
  };
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = await adminAuth().verifyIdToken(token);
    const userDoc = await adminDb().doc(`users/${decoded.uid}`).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const role = (userData?.role || userData?.systemRole || "").toString().toLowerCase();

    let ownerUid: string;
    if (role === "salon_owner") {
      ownerUid = decoded.uid;
    } else if (userData?.ownerUid) {
      ownerUid = String(userData.ownerUid);
    } else {
      ownerUid = decoded.uid;
    }

    const db = adminDb();
    const [bookingsSnap, requestsSnap] = await Promise.all([
      db.collection("bookings").where("ownerUid", "==", ownerUid).get(),
      db.collection("bookingRequests").where("ownerUid", "==", ownerUid).get().catch(() => ({ docs: [] })),
    ]);

    const byId = new Map<string, any>();
    requestsSnap.docs.forEach((d) => {
      const bk = toCalBooking({ id: d.id, data: () => d.data() });
      if (bk) byId.set(d.id, bk);
    });
    bookingsSnap.docs.forEach((d) => {
      const bk = toCalBooking({ id: d.id, data: () => d.data() });
      if (bk) byId.set(d.id, bk);
    });

    const bookings = Array.from(byId.values());
    return NextResponse.json({ bookings });
  } catch (e) {
    console.error("Calendar bookings API:", e);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}
