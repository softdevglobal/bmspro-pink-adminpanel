"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

type BookingRow = {
  id: string;
  client: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  serviceId: string | number;
  serviceName?: string | null;
  staffId: string;
  staffName?: string | null;
  branchId: string;
  branchName?: string | null;
  date: string;
  time: string;
  duration: number;
  status: string;
  price: number;
  createdAt?: any;
};

export default function AllBookingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [selected, setSelected] = useState<BookingRow | null>(null);

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
    setLoading(true);
    // Avoid composite index requirement by sorting on client
    const q = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: BookingRow[] = [];
        snap.forEach((d) => {
          const b = d.data() as any;
          list.push({
            id: d.id,
            client: String(b.client || ""),
            clientEmail: b.clientEmail || null,
            clientPhone: b.clientPhone || null,
            serviceId: b.serviceId,
            serviceName: b.serviceName || null,
            staffId: String(b.staffId || ""),
            staffName: b.staffName || null,
            branchId: String(b.branchId || ""),
            branchName: b.branchName || null,
            date: String(b.date || ""),
            time: String(b.time || ""),
            duration: Number(b.duration || 0),
            status: String(b.status || ""),
            price: Number(b.price || 0),
            createdAt: b.createdAt,
          });
        });
        // Sort by createdAt desc on client
        list.sort((a, b) => {
          const ams = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const bms = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return bms - ams;
        });
        setRows(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [ownerUid]);

  const totalValue = useMemo(
    () => rows.reduce((sum, r) => sum + (isFinite(r.price) ? r.price : 0), 0),
    [rows]
  );

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

          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <i className="fas fa-clipboard-list" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">All Bookings</h1>
                  <p className="text-sm text-white/80 mt-1">Full list of bookings across branches</p>
                </div>
              </div>
            </div>
          </div>

          {/* Subpage Tabs removed as requested */}

          <div className="max-w-7xl mx-auto grid grid-cols-1 gap-6">
            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 flex justify-between items-center">
                <div className="text-sm text-slate-600">
                  {loading ? "Loading…" : `${rows.length} bookings`}
                </div>
                <div className="text-sm font-semibold">
                  Total Value: <span className="text-pink-600">${totalValue.toLocaleString()}</span>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-slate-800 font-semibold border-y border-slate-100">
                    <tr>
                      <th className="p-3 pl-6">Client</th>
                      <th className="p-3">Service</th>
                      <th className="p-3">Staff</th>
                      <th className="p-3">Branch</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Time</th>
                      <th className="p-3 text-center">Status</th>
                      <th className="p-3 pr-6 text-right">Value</th>
                      <th className="p-3 pr-6 text-right">Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const isSel = selected?.id === r.id;
                      return (
                        <tr
                          key={r.id}
                          className={`transition ${isSel ? "bg-pink-50" : "hover:bg-slate-50"}`}
                        >
                          <td className="p-3 pl-6">
                            <div className="font-semibold text-slate-800">{r.client}</div>
                            {(r.clientEmail || r.clientPhone) && (
                              <div className="text-xs text-slate-500">
                                {r.clientEmail || r.clientPhone}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="text-slate-800">{r.serviceName || r.serviceId}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-800">{r.staffName || r.staffId}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-800">{r.branchName || r.branchId}</div>
                          </td>
                          <td className="p-3">{r.date}</td>
                          <td className="p-3">{r.time}</td>
                          <td className="p-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.status === "Confirmed"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : r.status === "Pending"
                                  ? "bg-amber-100 text-amber-700"
                                  : r.status === "Completed"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="p-3 pr-6 text-right font-bold text-slate-800">
                            ${isFinite(r.price) ? r.price : 0}
                          </td>
                          <td className="p-3 pr-6 text-right">
                            <button
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs"
                              onClick={() => setSelected(r)}
                            >
                              <i className="fas fa-eye" />
                              Preview
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && rows.length === 0 && (
                      <tr>
                        <td className="p-6 text-center text-slate-400" colSpan={9}>
                          No bookings found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {/* Slide-over Drawer Preview (all breakpoints) */}
          {selected && (
            <div className="fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
              <div className="absolute right-0 top-0 bottom-0 w-[92vw] sm:w-full sm:max-w-lg bg-white shadow-2xl overflow-y-auto rounded-l-2xl">
                {/* Header */}
                <div className="relative bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shadow">
                        <i className="fas fa-calendar-check" />
                      </div>
                      <div>
                        <div className="text-xs opacity-90">Booking Preview</div>
                        <div className="text-xl font-extrabold tracking-tight">{selected.client}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                          <span className="px-2 py-0.5 rounded-full bg-white/15">{selected.serviceName || String(selected.serviceId)}</span>
                          <span className={`px-2 py-0.5 rounded-full ${selected.status === "Confirmed" ? "bg-emerald-300/20 text-emerald-100" : selected.status === "Pending" ? "bg-amber-300/20 text-amber-100" : "bg-slate-300/20 text-white/90"}`}>
                            {selected.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    aria-label="Close"
                    className="absolute right-4 top-4 text-white/80 hover:text-white"
                    onClick={() => setSelected(null)}
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
                <div className="p-5 space-y-5">
                  {/* Quick info row */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Mini calendar card */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 flex items-center gap-2">
                        <i className="fas fa-calendar-day text-pink-500" /> Appointment
                      </div>
                      <div className="p-4 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-pink-50 to-white border border-pink-100 flex flex-col items-center justify-center text-pink-600 shadow-sm">
                          <div className="text-[10px] uppercase font-bold leading-none">{new Date(selected.date).toLocaleString(undefined, { month: "short" })}</div>
                          <div className="text-xl font-extrabold leading-none">{new Date(selected.date).getDate()}</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{selected.date}</div>
                          <div className="text-xs text-slate-600">at <span className="font-semibold">{selected.time}</span></div>
                        </div>
                      </div>
                    </div>
                    {/* Quick contact */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 flex items-center gap-2">
                        <i className="fas fa-user text-pink-500" /> Contact
                      </div>
                      <div className="p-4 space-y-2 text-sm">
                        <div className="font-semibold text-slate-900">{selected.client}</div>
                        <div className="flex gap-2">
                          {selected.clientEmail && (
                            <a href={`mailto:${selected.clientEmail}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white text-xs hover:bg-slate-800">
                              <i className="fas fa-envelope" /> Email
                            </a>
                          )}
                          {selected.clientPhone && (
                            <a href={`tel:${selected.clientPhone}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 text-slate-700 text-xs hover:bg-slate-50">
                              <i className="fas fa-phone" /> Call
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Summary */}
                  <div className="rounded-xl border border-slate-200">
                    <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center gap-2">
                      <i className="fas fa-clipboard-list text-pink-500" /> Summary
                    </div>
                    <div className="p-4 text-sm space-y-2">
                      <div className="flex justify-between"><span className="text-slate-700">Service</span><span className="font-medium text-slate-900">{selected.serviceName || String(selected.serviceId)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-700">Status</span><span className="font-medium text-slate-900">{selected.status}</span></div>
                      <div className="flex justify-between"><span className="text-slate-700">Duration</span><span className="font-medium text-slate-900">{selected.duration} mins</span></div>
                      <div className="flex justify-between"><span className="text-slate-700">Price</span><span className="font-bold text-pink-600">${selected.price}</span></div>
                    </div>
                  </div>
                  {/* Parties */}
                  <div className="rounded-xl border border-slate-200">
                    <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center gap-2">
                      <i className="fas fa-user text-pink-500" /> Parties
                    </div>
                    <div className="p-4 text-sm space-y-2">
                      <div className="flex justify-between"><span className="text-slate-700">Client</span><span className="font-medium text-slate-900">{selected.client}</span></div>
                      {selected.clientEmail && <div className="flex justify-between"><span className="text-slate-700">Email</span><span className="font-medium text-slate-900">{selected.clientEmail}</span></div>}
                      {selected.clientPhone && <div className="flex justify-between"><span className="text-slate-700">Phone</span><span className="font-medium text-slate-900">{selected.clientPhone}</span></div>}
                      <div className="flex justify-between"><span className="text-slate-700">Staff</span><span className="font-medium text-slate-900">{selected.staffName || selected.staffId}</span></div>
                      <div className="flex justify-between"><span className="text-slate-700">Branch</span><span className="font-medium text-slate-900">{selected.branchName || selected.branchId}</span></div>
                    </div>
                  </div>
                  {/* Details */}
                  <div className="rounded-xl border border-slate-200">
                    <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 flex items-center gap-2">
                      <i className="fas fa-calendar-day text-pink-500" /> Details
                    </div>
                    <div className="p-4 text-sm space-y-2">
                      <div className="flex justify-between"><span className="text-slate-700">Date</span><span className="font-medium text-slate-900">{selected.date}</span></div>
                      <div className="flex justify-between"><span className="text-slate-700">Time</span><span className="font-medium text-slate-900">{selected.time}</span></div>
                      {selected.createdAt && (
                        <div className="flex justify-between">
                          <span className="text-slate-700">Created</span>
                          <span className="font-medium text-slate-900">
                            {selected.createdAt?.toDate ? selected.createdAt.toDate().toLocaleString() : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div>
                    <button className="w-full px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white">
                      <i className="fas fa-ellipsis-h mr-2" />
                      Actions
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}


