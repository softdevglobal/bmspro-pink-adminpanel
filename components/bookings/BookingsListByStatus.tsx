"use client";

import React, { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { BookingStatus } from "@/lib/bookingTypes";
import Sidebar from "@/components/Sidebar";

type Row = {
  id: string;
  client: string;
  serviceName?: string | null;
  staffName?: string | null;
  branchName?: string | null;
  date: string;
  time: string;
  duration: number;
  price: number;
};

function useBookingsByStatus(status: BookingStatus) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    setLoading(true);

    const ensureAuth = async () => {
      const user = auth.currentUser;
      if (user?.uid) return user.uid;
      return new Promise<string>((resolve) => {
        const off = auth.onAuthStateChanged((u) => {
          if (u?.uid) {
            off();
            resolve(u.uid);
          }
        });
      });
    };

    (async () => {
      const ownerUid = await ensureAuth();
      if (cancelled) return;
      // Avoid composite index requirement by not ordering in Firestore; we'll sort client-side
      const q = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid));
      unsub = onSnapshot(q, (snap) => {
        let next: Row[] = [];
        snap.forEach((doc) => {
          const d = doc.data() as any;
          if (String(d?.status || "") === status) {
            next.push({
              id: doc.id,
              client: String(d.client || ""),
              serviceName: d.serviceName || null,
              staffName: d.staffName || null,
              branchName: d.branchName || null,
              date: String(d.date || ""),
              time: String(d.time || ""),
              duration: Number(d.duration || 0),
              price: Number(d.price || 0),
            });
          }
        });
        // Sort by date desc, then time desc
        next = next.sort((a, b) => {
          if (a.date === b.date) {
            return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
          }
          return a.date < b.date ? 1 : -1;
        });
        setRows(next);
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [status]);

  return { rows, loading };
}

export default function BookingsListByStatus({ status, title }: { status: BookingStatus; title: string }) {
  const { rows, loading } = useBookingsByStatus(status);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <i className="fas fa-calendar-check" />
                  </div>
                  <h1 className="text-2xl font-bold">{title}</h1>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-800 font-semibold border-b border-slate-100">
                  <tr>
                    <th className="p-4 pl-6">Client &amp; Service</th>
                    <th className="p-4">Date &amp; Time</th>
                    <th className="p-4">Staff</th>
                    <th className="p-4">Branch</th>
                    <th className="p-4 text-right pr-6">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={5}>Loading...</td>
                    </tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={5}>No bookings.</td>
                    </tr>
                  )}
                  {!loading &&
                    rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="p-4 pl-6">
                          <span className="font-bold text-slate-800">{r.client}</span>
                          <span className="block text-xs text-slate-500">{r.serviceName || "Unknown Service"}</span>
                        </td>
                        <td className="p-4">
                          <span className="font-medium text-slate-700">
                            {r.date} {r.time}
                          </span>
                        </td>
                        <td className="p-4">{r.staffName || "-"}</td>
                        <td className="p-4">{r.branchName || "-"}</td>
                        <td className="p-4 text-right pr-6 font-bold text-slate-800">${r.price}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}


