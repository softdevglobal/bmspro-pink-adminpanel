"use client";

import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { BookingStatus } from "@/lib/bookingTypes";
import Sidebar from "@/components/Sidebar";
import { updateBookingStatus } from "@/lib/bookings";

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
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  status?: string | null;
  bookingCode?: string | null;
  bookingSource?: string | null;
};

function useBookingsByStatus(status: BookingStatus) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const ensureAuth = async () => {
      const user = auth.currentUser;
      if (user?.uid) return user.uid;
      return new Promise<string>((resolve, reject) => {
        let off: (() => void) | null = null;
        const timeout = setTimeout(() => {
          if (off) off();
          reject(new Error("Authentication timeout"));
        }, 10000); // 10 second timeout
        off = auth.onAuthStateChanged((u) => {
          if (u?.uid) {
            clearTimeout(timeout);
            if (off) off();
            resolve(u.uid);
          }
        });
      });
    };

    (async () => {
      try {
        const userId = await ensureAuth();
        if (cancelled) return;
      
      // Get user data to check role and branch
      const { getDoc, doc: firestoreDoc } = await import("firebase/firestore");
      const userSnap = await getDoc(firestoreDoc(db, "users", userId));
      const userData = userSnap.data();
      const userRole = (userData?.role || "").toString();
      const ownerUid = userRole === "salon_owner" ? userId : (userData?.ownerUid || userId);
      const userBranchId = userData?.branchId;
      
      // Build query constraints
      const constraints = [where("ownerUid", "==", ownerUid)];
      
      // Branch admin should only see bookings for their branch
      if (userRole === "salon_branch_admin" && userBranchId) {
        constraints.push(where("branchId", "==", userBranchId));
      }
      
      // Query only "bookings" collection (booking engine now saves directly to bookings)
      const q = query(collection(db, "bookings"), ...constraints);
      unsub = onSnapshot(q, (snap) => {
        if (cancelled) return;
        
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
              clientEmail: d.clientEmail || null,
              clientPhone: d.clientPhone || null,
              notes: d.notes || null,
              status: d.status || null,
              bookingCode: d.bookingCode || null,
              bookingSource: d.bookingSource || null,
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
      }, (e) => {
        if (cancelled) return;
        if (e?.code === "permission-denied") {
          console.warn("Permission denied for bookings query. User may not be authenticated.");
          setError("Permission denied. Please check your authentication.");
          setRows([]);
        } else {
          setError(e?.message || "Failed to load bookings");
        }
        setLoading(false);
      });
      } catch (authError: any) {
        if (cancelled) return;
        console.error("Authentication error:", authError);
        setError("Authentication failed. Please log in again.");
        setLoading(false);
        setRows([]);
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [status]);

  return { rows, loading, error };
}

export default function BookingsListByStatus({ status, title }: { status: BookingStatus; title: string }) {
  const { rows, loading, error } = useBookingsByStatus(status);
  const [updatingMap, setUpdatingMap] = useState<Record<string, boolean>>({});
  const allowedActions = useMemo<ReadonlyArray<"Confirm" | "Cancel" | "Complete">>(() => {
    if (status === "Pending") return ["Confirm", "Cancel"];
    if (status === "Confirmed") return ["Complete"];
    return [];
  }, [status]);
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const onAction = async (rowId: string, action: "Confirm" | "Cancel" | "Complete") => {
    try {
      setUpdatingMap((m) => ({ ...m, [rowId]: true }));
      const next: BookingStatus =
        action === "Confirm" ? "Confirmed" :
        action === "Cancel" ? "Canceled" :
        "Completed";
      await updateBookingStatus(rowId, next);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(e?.message || "Failed to update status");
    } finally {
      setUpdatingMap((m) => {
        const { [rowId]: _, ...rest } = m;
        return rest;
      });
    }
  };

  const openPreview = (row: Row) => {
    setPreviewRow(row);
    setPreviewOpen(true);
  };
  const closePreview = () => setPreviewOpen(false);

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

            {/* Right-side preview slide-over */}
            <div
              className={`fixed inset-0 z-50 ${previewOpen ? "pointer-events-auto" : "pointer-events-none"}`}
              aria-hidden={!previewOpen}
            >
              <div
                onClick={closePreview}
                className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${previewOpen ? "opacity-100" : "opacity-0"}`}
              />
              <aside
                className={`absolute top-0 h-full right-0 w-[92vw] sm:w-[30rem] bg-white shadow-2xl border-l border-slate-200 transform transition-transform duration-200 ${previewOpen ? "translate-x-0" : "translate-x-full"}`}
              >
                <div className="flex h-full flex-col">
                  <div className="p-0 border-b border-slate-200">
                    <div className="bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 p-5 text-white flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                          <i className="fas fa-eye" />
                        </div>
                        <h3 className="text-lg font-semibold">Booking Preview</h3>
                      </div>
                      <button onClick={closePreview} className="text-white/80 hover:text-white">
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 p-5 space-y-4 overflow-y-auto">
                  {!previewRow && <div className="text-slate-500 text-sm">No booking selected.</div>}
                  {previewRow && (
                    <div className="space-y-4 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white flex items-center justify-center text-sm font-bold shadow-md">
                          {(previewRow.client || "?").split(" ").map(s => s[0]).slice(0,2).join("")}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{previewRow.client}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {previewRow.clientEmail && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"><i className="fas fa-envelope" />{previewRow.clientEmail}</span>}
                            {previewRow.clientPhone && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"><i className="fas fa-phone" />{previewRow.clientPhone}</span>}
                          </div>
                        </div>
                      </div>
                      
                      <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs uppercase tracking-wide">Booking Code</span>
                          <span className="font-mono font-bold text-slate-800">{previewRow.bookingCode || previewRow.id.substring(0, 8)}</span>
                        </div>
                        {previewRow.bookingSource && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                            <span className="text-slate-500 text-xs uppercase tracking-wide">Source</span>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                              previewRow.bookingSource === "booking_engine" 
                                ? "bg-blue-100 text-blue-700" 
                                : "bg-purple-100 text-purple-700"
                            }`}>
                              {previewRow.bookingSource === "booking_engine" ? "Booking Engine" : "Admin Panel"}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                        <div className="flex items-center gap-2 text-slate-700 font-medium">
                          <i className="fas fa-sparkles text-pink-500" />
                          {previewRow.serviceName || "-"}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-slate-400">Date & Time</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-clock text-slate-400" />
                            {previewRow.date} {previewRow.time}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Duration</p>
                          <p className="font-medium text-slate-700">{previewRow.duration} mins</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-slate-400">Staff</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-user text-slate-400" />
                            {previewRow.staffName || "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Branch</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-store text-slate-400" />
                            {previewRow.branchName || "-"}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-400">Status</p>
                        <p className="inline-flex items-center gap-2 px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-700">
                          <i className="fas fa-circle text-[8px] text-slate-400" />
                          {previewRow.status || status}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Price</p>
                        <p className="font-semibold text-slate-800 flex items-center gap-1"><i className="fas fa-dollar-sign text-slate-400" />{previewRow.price}</p>
                      </div>
                      {previewRow.notes && (
                        <div>
                          <p className="text-slate-400">Notes</p>
                          <p className="text-slate-700 whitespace-pre-wrap">{previewRow.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                  <div className="shrink-0 border-t border-slate-200 p-4 flex items-center justify-end gap-2 bg-white/90 backdrop-blur">
                    <button
                      onClick={closePreview}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
                    >
                      Close
                    </button>
                    {previewRow && allowedActions.includes("Confirm") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => onAction(previewRow.id, "Confirm")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-emerald-300 text-white" : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-check-circle" />}
                        {updatingMap[previewRow.id] ? "Confirming..." : "Confirm"}
                      </button>
                    )}
                    {previewRow && allowedActions.includes("Complete") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => onAction(previewRow.id, "Complete")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-indigo-300 text-white" : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-flag-checkered" />}
                        {updatingMap[previewRow.id] ? "Completing..." : "Complete"}
                      </button>
                    )}
                    {previewRow && allowedActions.includes("Cancel") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => onAction(previewRow.id, "Cancel")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-rose-300 text-white" : "bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-ban" />}
                        {updatingMap[previewRow.id] ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* Footer now lives inside the aside for correct order */}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="relative overflow-x-auto">
                <table className="min-w-[960px] w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50/90 backdrop-blur text-slate-800 font-semibold border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="p-4 pl-6">Client &amp; Service</th>
                    <th className="p-4">Date &amp; Time</th>
                    <th className="p-4">Staff</th>
                    <th className="p-4">Branch</th>
                    <th className="p-4 text-right pr-6">Price</th>
                    <th className="p-4 text-right pr-6">Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {loading && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={5}>Loading...</td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td className="p-6 text-rose-600" colSpan={6}>{error}</td>
                    </tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={6}>No bookings.</td>
                    </tr>
                  )}
                  {!loading &&
                    rows.map((r) => {
                      const initials = r.client
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s) => s[0]?.toUpperCase() || "")
                        .join("");
                      return (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="p-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                              {initials || <i className="fas fa-user" />}
                            </div>
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-semibold text-slate-800">{r.client}</div>
                                {r.bookingCode && (
                                  <div className="text-xs text-slate-500 font-mono mt-0.5">{r.bookingCode}</div>
                                )}
                              </div>
                              {/* Mobile-first preview trigger (visible before horizontal scroll) */}
                              <button
                                aria-label="Preview"
                                title="Preview"
                                onClick={() => openPreview(r)}
                                className="sm:hidden text-slate-400 hover:text-pink-600 transition transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-full h-7 w-7 inline-flex items-center justify-center"
                              >
                                <i className="fas fa-eye text-[13px]" />
                              </button>
                            </div>
                              <div className="text-xs mt-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                  <i className="fas fa-sparkles text-[10px]" />
                                  {r.serviceName || "Unknown Service"}
                                </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-medium text-slate-700">{r.date}</div>
                          <div className="text-xs text-slate-500">{r.time}</div>
                        </td>
                        <td className="p-4">{r.staffName || "-"}</td>
                        <td className="p-4">{r.branchName || "-"}</td>
                        <td className="p-4 text-right pr-6">
                          <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                            <i className="fas fa-dollar-sign text-slate-400" />
                            {r.price}
                          </span>
                        </td>
                        <td className="p-4 text-right pr-6">
                          <div className="inline-flex items-center gap-2 justify-end bg-slate-100/60 rounded-full px-2 py-1">
                            <button
                              aria-label="Preview"
                              title="Preview"
                              onClick={() => openPreview(r)}
                              className="hidden sm:inline-flex text-slate-400 hover:text-pink-600 transition transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-full h-8 w-8 items-center justify-center"
                            >
                              <i className="fas fa-eye" />
                            </button>
                            {allowedActions.length > 0 && (
                              <>
                              {allowedActions.includes("Confirm" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => onAction(r.id, "Confirm")}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-emerald-300 text-white" : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-check-circle" />}
                                  {updatingMap[r.id] ? "Confirming..." : "Confirm"}
                                </button>
                              )}
                              {allowedActions.includes("Complete" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => onAction(r.id, "Complete")}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-indigo-300 text-white" : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-flag-checkered" />}
                                  {updatingMap[r.id] ? "Completing..." : "Complete"}
                                </button>
                              )}
                              {allowedActions.includes("Cancel" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => onAction(r.id, "Cancel")}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-rose-300 text-white" : "bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-ban" />}
                                  {updatingMap[r.id] ? "Cancelling..." : "Cancel"}
                                </button>
                              )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}


