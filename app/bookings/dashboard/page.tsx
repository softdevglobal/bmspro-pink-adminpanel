"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";

type Booking = {
  id: string;
  client: string;
  serviceId?: string | number;
  serviceName?: string;
  staffId?: string;
  staffName?: string;
  date: string;
  time: string;
  status: string;
  price?: number;
};

export default function BookingsDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [todayRows, setTodayRows] = useState<Booking[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setOwnerUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!ownerUid) return;
    const today = new Date().toISOString().slice(0, 10);
    const q = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid), where("date", "==", today));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Booking[] = [];
        snap.forEach((d) => {
          const b = d.data() as any;
          list.push({
            id: d.id,
            client: String(b.client || ""),
            serviceId: b.serviceId,
            serviceName: b.serviceName,
            staffId: b.staffId,
            staffName: b.staffName,
            date: String(b.date || today),
            time: String(b.time || ""),
            status: String(b.status || ""),
            price: typeof b.price === "number" ? b.price : undefined,
          });
        });
        list.sort((a, b) => (a.time > b.time ? 1 : -1));
        setTodayRows(list);
      },
      () => setTodayRows([])
    );
    return () => unsub();
  }, [ownerUid]);

  const confirmedValue = useMemo(
    () => todayRows.filter((r) => r.status === "Confirmed").reduce((s, r) => s + (r.price || 0), 0),
    [todayRows]
  );
  const confirmedCount = useMemo(() => todayRows.filter((r) => r.status === "Confirmed").length, [todayRows]);
  const avgDuration = useMemo(() => 0, []); // Not tracked in schema yet

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
          <div className="md:hidden mb-4">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => setMobileOpen(true)}
            >
              <i className="fas fa-bars" />
              Menu
            </button>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fas fa-calendar-check" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">Booking Summary</h1>
                      <p className="text-sm text-white/80 mt-1">Summary of today’s bookings.</p>
                    </div>
                  </div>
                  <div />
                </div>
              </div>
            </div>

            {/* Subpage Tabs removed as requested */}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-800">Today&apos;s Bookings</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-100">
                      <tr>
                        <th className="p-4">Time</th>
                        <th className="p-4">Customer</th>
                        <th className="p-4">Service</th>
                        <th className="p-4">Staff</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {todayRows.length === 0 && (
                        <tr>
                          <td className="p-4 text-slate-400" colSpan={6}>
                            No bookings scheduled for today.
                          </td>
                        </tr>
                      )}
                      {todayRows.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-50">
                          <td className="p-4">{b.time || "-"}</td>
                          <td className="p-4">{b.client || "-"}</td>
                          <td className="p-4">{b.serviceName || String(b.serviceId || "")}</td>
                          <td className="p-4">{b.staffName || b.staffId || "-"}</td>
                          <td className="p-4">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                b.status === "Confirmed"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : b.status === "Pending"
                                  ? "bg-amber-100 text-amber-700"
                                  : b.status === "Completed"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {b.status || "-"}
                            </span>
                          </td>
                          <td className="p-4 text-right font-semibold text-slate-800">${Number(b.price || 0).toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-6">
                  <h3 className="font-bold mb-4 flex justify-between items-center">
                    Today&apos;s Summary
                    <i className="fas fa-chart-line text-pink-500" />
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Confirmed Value</span>
                      <span className="font-bold text-green-400">${confirmedValue.toLocaleString()}</span>
                    </div>
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Confirmed Bookings</span>
                      <span className="font-bold">{confirmedCount}</span>
                    </div>
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Avg Service Duration</span>
                      <span className="font-bold">{avgDuration} mins</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}


