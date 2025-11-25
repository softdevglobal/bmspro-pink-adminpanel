"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { subscribeServicesForOwner } from "@/lib/services";
import { subscribeSalonStaffForOwner } from "@/lib/salonStaff";

type HoursDay = { open?: string; close?: string; closed?: boolean };
type HoursMap = {
  Monday?: HoursDay;
  Tuesday?: HoursDay;
  Wednesday?: HoursDay;
  Thursday?: HoursDay;
  Friday?: HoursDay;
  Saturday?: HoursDay;
  Sunday?: HoursDay;
};

type Branch = {
  id: string;
  name: string;
  address: string;
  revenue?: number;
  phone?: string;
  email?: string;
  staffIds?: string[];
  serviceIds?: string[];
  hours?: string | HoursMap;
  capacity?: number;
  manager?: string;
  status?: "Active" | "Pending" | "Closed";
};

export default function BranchDetailsPage() {
  const router = useRouter();
  const params = useParams() as { id?: string | string[] };
  const branchId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "services" | "staff" | "schedule">("overview");
  const [allServices, setAllServices] = useState<Array<{ id: string; name: string; icon?: string; price?: number; duration?: number }>>([]);
  const [allStaff, setAllStaff] = useState<Array<{ id: string; name: string; status?: string; branch?: string }>>([]);
  const [monthYear, setMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // auth + role guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = (snap.data()?.role || "").toString();
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }
        setOwnerUid(user.uid);
      } catch {
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  // subscribe to the specific branch
  useEffect(() => {
    if (!ownerUid || !branchId) return;
    setLoading(true);
    const unsub = onSnapshot(doc(db, "branches", branchId), (d) => {
      if (!d.exists()) {
        setBranch(null);
        setLoading(false);
        return;
      }
      const data = d.data() as any;
      const b: Branch = {
        id: d.id,
        name: String(data.name || ""),
        address: String(data.address || ""),
        revenue: Number(data.revenue || 0),
        phone: data.phone,
        email: data.email,
        hours: data.hours as any,
        capacity: data.capacity,
        manager: data.manager,
        status: (data.status as any) || "Active",
        staffIds: Array.isArray(data.staffIds) ? data.staffIds.map(String) : [],
        serviceIds: Array.isArray(data.serviceIds) ? data.serviceIds.map(String) : [],
      };
      setBranch(b);
      setLoading(false);
    });
    return () => unsub();
  }, [ownerUid, branchId]);

  // subscribe to owner's services and staff to populate tabs (filtered by ids on render)
  useEffect(() => {
    if (!ownerUid) return;
    const unsubServices = subscribeServicesForOwner(ownerUid, (rows) => {
      setAllServices(
        rows.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || "Service"),
          icon: String(s.icon || "fa-scissors"),
          price: typeof s.price === "number" ? s.price : undefined,
          duration: typeof s.duration === "number" ? s.duration : undefined,
        }))
      );
    });
    const unsubStaff = subscribeSalonStaffForOwner(ownerUid, (rows) => {
      setAllStaff(
        rows.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || s.displayName || "Staff"),
          status: s.status,
          branch: s.branchName,
        }))
      );
    });
    return () => {
      unsubServices();
      unsubStaff();
    };
  }, [ownerUid]);

  const headerTitle = useMemo(() => (branch ? branch.name : "Branch"), [branch]);
  const monthName = useMemo(() => {
    return new Date(monthYear.year, monthYear.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [monthYear]);

  const serviceCount = (branch?.serviceIds || []).length;
  const staffCount = (branch?.staffIds || []).length;

  const goPrevMonth = () =>
    setMonthYear(({ month, year }) => {
      const nm = month - 1;
      return nm < 0 ? { month: 11, year: year - 1 } : { month: nm, year };
    });
  const goNextMonth = () =>
    setMonthYear(({ month, year }) => {
      const nm = month + 1;
      return nm > 11 ? { month: 0, year: year + 1 } : { month: nm, year };
    });

  const getHoursForWeekday = (weekdayIndex: number): HoursDay | undefined => {
    // JS: 0=Sun..6=Sat. Our map uses "Monday"... names
    const mapKey: (keyof HoursMap)[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const key = mapKey[weekdayIndex];
    return (branch?.hours as any)?.[key] as HoursDay | undefined;
  };

  const getSelectedDateText = () => {
    const w = selectedDate.toLocaleDateString(undefined, { weekday: "long" });
    const h = getHoursForWeekday(selectedDate.getDay());
    if (!h) return `${w}: —`;
    if (h.closed) return `${w}: Closed`;
    if (h.open && h.close) return `${w}: ${h.open} - ${h.close}`;
    return `${w}: —`;
  };

  const buildMonthCells = () => {
    const firstDayWeekIdx = new Date(monthYear.year, monthYear.month, 1).getDay(); // 0=Sun
    const numDays = new Date(monthYear.year, monthYear.month + 1, 0).getDate();
    const cells: Array<{ label?: number; date?: Date; closed?: boolean }> = [];
    for (let i = 0; i < firstDayWeekIdx; i++) cells.push({});
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(monthYear.year, monthYear.month, d);
      const h = getHoursForWeekday(dt.getDay());
      const closed = Boolean(h?.closed);
      cells.push({ label: d, date: dt, closed });
    }
    // fill to complete rows of 7
    while (cells.length % 7 !== 0) cells.push({});
    return cells;
  };

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
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

          <div className="mb-3">
            <button
              onClick={() => {
                try {
                  if (typeof window !== "undefined" && window.history.length > 1) router.back();
                  else router.push("/branches");
                } catch {
                  router.push("/branches");
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <i className="fas fa-arrow-left" />
              Back to Branches
            </button>
          </div>

          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fas fa-building" />
                    </div>
                    <h1 className="text-2xl font-bold truncate">{headerTitle}</h1>
                  </div>
                  {branch && <p className="text-sm text-white/80 mt-2 truncate">{branch.address}</p>}
                </div>
                {branch?.status && (
                  <div
                    className={`shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                      branch.status === "Active"
                        ? "bg-emerald-100 text-emerald-800"
                        : branch.status === "Pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    <i className="fas fa-circle" />
                    {branch.status}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          {branch && (
            <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">Services</div>
                  <div className="w-8 h-8 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                    <i className="fas fa-scissors" />
                  </div>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-800">{(branch.serviceIds || []).length}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">Staff</div>
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    <i className="fas fa-users" />
                  </div>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-800">{(branch.staffIds || []).length}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">Capacity</div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <i className="fas fa-chair" />
                  </div>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-800">{branch.capacity ?? "—"}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">Status</div>
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                    <i className="fas fa-signal" />
                  </div>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-800">{branch.status || "—"}</div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="max-w-7xl mx-auto">
            <div className="rounded-2xl bg-white border border-slate-200 p-1 mb-6 shadow-sm flex flex-wrap">
              {[
                { key: "overview", label: "Overview", icon: "fa-gauge-high" },
                { key: "services", label: `Services (${serviceCount})`, icon: "fa-scissors" },
                { key: "staff", label: `Staff (${staffCount})`, icon: "fa-users" },
                { key: "schedule", label: "Schedule", icon: "fa-calendar-days" },
              ].map((t: any) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium transition mr-1 mb-1 ${activeTab === t.key ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <i className={`fas ${t.icon} mr-2`} />
                  {t.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="text-slate-500">Loading branch…</div>
            ) : !branch ? (
              <div className="text-rose-600">Branch not found.</div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Contact */}
                    <div className="rounded-2xl border border-pink-100 shadow-sm overflow-hidden bg-gradient-to-br from-pink-50 to-rose-50">
                      <div className="px-6 py-4 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                          <i className="fas fa-address-book" />
                        </div>
                        <div className="text-sm font-semibold">Contact</div>
                      </div>
                      <div className="p-6 text-sm text-slate-700">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {branch.phone && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100">
                              <i className="fas fa-phone text-pink-600" /> {branch.phone}
                            </div>
                          )}
                          {branch.email && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100 truncate">
                              <i className="fas fa-envelope text-pink-600" /> {branch.email}
                            </div>
                          )}
                          {branch.manager && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100">
                              <i className="fas fa-user-tie text-pink-600" /> {branch.manager}
                            </div>
                          )}
                          {typeof branch.capacity !== "undefined" && branch.capacity !== null && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100">
                              <i className="fas fa-chair text-pink-600" /> Capacity: {String(branch.capacity)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Hours */}
                    <div className="rounded-2xl border border-indigo-100 shadow-sm overflow-hidden bg-white">
                      <div className="px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                          <i className="fas fa-clock" />
                        </div>
                        <div className="text-sm font-semibold">Operating Hours</div>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => {
                          const d = day as keyof HoursMap;
                          const row = (branch.hours as any)?.[d] as HoursDay | undefined;
                          const text = row
                            ? row.closed
                              ? "Closed"
                              : row.open && row.close
                              ? `${row.open} - ${row.close}`
                              : "—"
                            : "—";
                          const isClosed = row?.closed;
                          return (
                            <div key={day} className="flex items-center justify-between px-4 py-2 text-sm border-b last:border-b-0 border-slate-200 bg-white">
                              <span className="text-slate-700">{day}</span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${isClosed ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                                <i className="fas fa-circle" />
                                {text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "services" && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="text-sm font-bold text-slate-700 mb-4">Services available at this branch</div>
                    {(branch.serviceIds || []).length === 0 ? (
                      <div className="text-sm text-slate-400">No services assigned.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {allServices
                          .filter((s) => (branch.serviceIds || []).includes(s.id))
                          .map((s) => (
                            <div key={s.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-sm transition bg-white">
                              <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                                  <i className={`fas ${s.icon || "fa-scissors"}`} />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                    {typeof s.duration === "number" && <span className="px-2 py-0.5 rounded-full bg-slate-100">⏱ {s.duration} mins</span>}
                                    {typeof s.price === "number" && <span className="px-2 py-0.5 rounded-full bg-slate-100">$ {s.price}</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "staff" && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="text-sm font-bold text-slate-700 mb-4">Staff assigned to this branch</div>
                    {(branch.staffIds || []).length === 0 ? (
                      <div className="text-sm text-slate-400">No staff assigned.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {allStaff
                          .filter((st) => (branch.staffIds || []).includes(st.id))
                          .map((st) => {
                            const statusColor =
                              st.status === "Active" ? "bg-emerald-100 text-emerald-700" : st.status === "Suspended" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600";
                            return (
                              <div key={st.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-sm transition bg-white">
                                <div className="flex items-start gap-3">
                                  <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center">
                                    <i className="fas fa-user" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-800 truncate">{st.name}</div>
                                    {st.status && <div className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-full ${statusColor}`}>{st.status}</div>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "schedule" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Calendar */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-bold text-slate-700">Branch Schedule Calendar</div>
                        <div className="flex items-center gap-2">
                          <button onClick={goPrevMonth} className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
                            <i className="fas fa-chevron-left" />
                          </button>
                          <div className="text-sm font-semibold text-slate-800 px-2">{monthName}</div>
                          <button onClick={goNextMonth} className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
                            <i className="fas fa-chevron-right" />
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="grid grid-cols-7 text-xs font-semibold bg-slate-50 text-slate-600">
                          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                            <div key={d} className="px-2 py-2 text-center">
                              {d}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7">
                          {buildMonthCells().map((c, idx) => {
                            const isSelected =
                              c.date &&
                              selectedDate.getFullYear() === c.date.getFullYear() &&
                              selectedDate.getMonth() === c.date.getMonth() &&
                              selectedDate.getDate() === c.date.getDate();
                            return (
                              <div
                                key={idx}
                                className={`h-16 border border-slate-100 p-2 text-sm ${c.date ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/40"}`}
                                onClick={() => c.date && setSelectedDate(c.date)}
                              >
                                <div className="flex items-start justify-between">
                                  <span className={`text-slate-700 ${!c.date ? "opacity-0" : ""}`}>{c.label}</span>
                                  {c.date && (
                                    <span
                                      className={`w-2 h-2 rounded-full mt-1 ${c.closed ? "bg-rose-400" : "bg-emerald-400"}`}
                                      title={c.closed ? "Closed" : "Open"}
                                    />
                                  )}
                                </div>
                                {isSelected && <div className="mt-2 text-[10px] inline-block px-2 py-0.5 rounded bg-slate-900 text-white">Selected</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Day details */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                      <div className="text-sm font-bold text-slate-700 mb-1">
                        {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      </div>
                      <div className="text-sm text-slate-600 mb-4">{getSelectedDateText()}</div>
                      <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                        <div className="text-sm text-slate-500">
                          Placeholder for booking/assignment list. Hook this panel to your booking data to show time slots or assigned staff for the selected date.
                        </div>
                        <button className="mt-4 px-4 py-2 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-700">
                          <i className="fas fa-user-plus mr-2" />
                          Assign Staff to This Date
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}


