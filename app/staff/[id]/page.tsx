"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

type StaffStatus = "Active" | "Suspended";
type StaffTraining = { ohs?: boolean; prod?: boolean; tool?: boolean };
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

type WeeklySchedule = {
  Monday?: { branchId: string; branchName: string } | null;
  Tuesday?: { branchId: string; branchName: string } | null;
  Wednesday?: { branchId: string; branchName: string } | null;
  Thursday?: { branchId: string; branchName: string } | null;
  Friday?: { branchId: string; branchName: string } | null;
  Saturday?: { branchId: string; branchName: string } | null;
  Sunday?: { branchId: string; branchName: string } | null;
};

type Staff = {
  id: string;
  name: string;
  role: string;
  email?: string | null;
  status: StaffStatus;
  avatar: string;
  branchId?: string;
  branchName?: string;
  training?: StaffTraining;
  weeklySchedule?: WeeklySchedule;
};

export default function StaffPreviewPage() {
  const router = useRouter();
  const params = useParams() as { id?: string | string[] };
  const staffId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [branchHours, setBranchHours] = useState<HoursMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "schedule" | "training" | "appointments" | "customers"
  >("overview");
  const [monthYear, setMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

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

  // subscribe to staff doc
  useEffect(() => {
    if (!ownerUid || !staffId) return;
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "users", staffId),
      async (d) => {
        if (!d.exists()) {
          setStaff(null);
          setLoading(false);
          return;
        }
        const s = d.data() as any;
        const row: Staff = {
          id: d.id,
          name: String(s.displayName || s.name || ""),
          role: String(s.staffRole || s.role || ""),
          email: s.email || null,
          status: (s.status as StaffStatus) || "Active",
          avatar: String(s.avatar || s.name || s.displayName || ""),
          branchId: s.branchId || undefined,
          branchName: s.branchName || undefined,
        training: (s.training as StaffTraining) || {},
        weeklySchedule: (s.weeklySchedule as WeeklySchedule) || {},
      };
      setStaff(row);
      // fetch hours for their branch for schedule tab
      if (s.branchId) {
        try {
          const bsnap = await getDoc(doc(db, "branches", String(s.branchId)));
          setBranchHours((bsnap.data() as any)?.hours || null);
        } catch {
          setBranchHours(null);
        }
      } else {
        setBranchHours(null);
      }
      setLoading(false);
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for staff query.");
        setStaff(null);
        setLoading(false);
      } else {
        console.error("Error in staff snapshot:", error);
        setLoading(false);
      }
    }
    );
    return () => unsub();
  }, [ownerUid, staffId]);

  const headerTitle = useMemo(() => (staff ? staff.name : "Staff"), [staff]);
  const monthName = useMemo(() => {
    return new Date(monthYear.year, monthYear.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [monthYear]);

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
    const keys: (keyof HoursMap)[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const key = keys[weekdayIndex];
    return (branchHours as any)?.[key] as HoursDay | undefined;
  };

  const buildMonthCells = () => {
    const firstDayWeekIdx = new Date(monthYear.year, monthYear.month, 1).getDay();
    const numDays = new Date(monthYear.year, monthYear.month + 1, 0).getDate();
    const cells: Array<{ label?: number; date?: Date; off?: boolean }> = [];
    for (let i = 0; i < firstDayWeekIdx; i++) cells.push({});
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(monthYear.year, monthYear.month, d);
      const h = getHoursForWeekday(dt.getDay());
      const off = Boolean(h?.closed);
      cells.push({ label: d, date: dt, off });
    }
    while (cells.length % 7 !== 0) cells.push({});
    return cells;
  };

  const selectedDayText = () => {
    const w = selectedDate.toLocaleDateString(undefined, { weekday: "long" });
    const h = getHoursForWeekday(selectedDate.getDay());
    if (!h) return `${w}: —`;
    if (h.closed) return `${w}: Off`;
    if (h.open && h.close) return `${w}: ${h.open} - ${h.close}`;
    return `${w}: —`;
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

          {/* Back */}
          <div className="mb-3">
            <button
              onClick={() => {
                try {
                  if (typeof window !== "undefined" && window.history.length > 1) router.back();
                  else router.push("/staff");
                } catch {
                  router.push("/staff");
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <i className="fas fa-arrow-left" />
              Back to Staff
            </button>
          </div>

          {/* Header */}
          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staff?.avatar || "staff")}`}
                  alt="Avatar"
                  className="w-14 h-14 rounded-full bg-white/20"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-bold truncate">{headerTitle}</h1>
                  {staff && (
                    <p className="text-sm text-white/80 mt-1 truncate">
                      {staff.role} {staff.branchName ? `• ${staff.branchName}` : ""}
                    </p>
                  )}
                </div>
                {staff?.status && (
                  <div
                    className={`shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                      staff.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    <i className="fas fa-circle" />
                    {staff.status}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="max-w-7xl mx-auto">
            <div className="rounded-2xl bg-white border border-slate-200 p-1 mb-6 shadow-sm flex flex-wrap">
              {[
                { key: "overview", label: "Overview", icon: "fa-id-badge" },
                { key: "training", label: "Training", icon: "fa-graduation-cap" },
                { key: "schedule", label: "Schedule", icon: "fa-calendar-days" },
                { key: "appointments", label: "Appointments", icon: "fa-calendar-check" },
                { key: "customers", label: "Customers", icon: "fa-users" },
              ].map((t: any) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium transition mr-1 mb-1 ${
                    activeTab === t.key ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <i className={`fas ${t.icon} mr-2`} />
                  {t.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="text-slate-500">Loading staff…</div>
            ) : !staff ? (
              <div className="text-rose-600">Staff member not found.</div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="rounded-2xl border border-pink-100 shadow-sm overflow-hidden bg-gradient-to-br from-pink-50 to-rose-50">
                        <div className="px-6 py-4 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                            <i className="fas fa-address-card" />
                          </div>
                          <div className="text-sm font-semibold">Contact</div>
                        </div>
                        <div className="p-6 text-sm text-slate-700">
                          <div className="flex flex-wrap gap-2">
                            {staff.email && (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100 truncate">
                                <i className="fas fa-envelope text-pink-600" /> {staff.email}
                              </div>
                            )}
                            {staff.branchName && (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pink-100">
                                <i className="fas fa-store text-pink-600" /> {staff.branchName}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-indigo-100 shadow-sm overflow-hidden bg-white">
                        <div className="px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                            <i className="fas fa-shield-heart" />
                          </div>
                          <div className="text-sm font-semibold">Role & Status</div>
                        </div>
                        <div className="p-6 text-sm text-slate-700">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-3 py-1.5 rounded-full bg-slate-100">{staff.role}</span>
                            <span
                              className={`px-3 py-1.5 rounded-full text-xs ${
                                staff.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {staff.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Weekly Schedule Overview */}
                    {staff.weeklySchedule && Object.keys(staff.weeklySchedule).length > 0 && (
                      <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                        <div className="px-6 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                            <i className="fas fa-calendar-week" />
                          </div>
                          <div className="text-sm font-semibold">Weekly Schedule</div>
                        </div>
                        <div className="p-6">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                            {[
                              { key: "Monday" as keyof WeeklySchedule, label: "Mon", icon: "☀️" },
                              { key: "Tuesday" as keyof WeeklySchedule, label: "Tue", icon: "🌤️" },
                              { key: "Wednesday" as keyof WeeklySchedule, label: "Wed", icon: "🌻" },
                              { key: "Thursday" as keyof WeeklySchedule, label: "Thu", icon: "🌸" },
                              { key: "Friday" as keyof WeeklySchedule, label: "Fri", icon: "🎉" },
                              { key: "Saturday" as keyof WeeklySchedule, label: "Sat", icon: "🎨" },
                              { key: "Sunday" as keyof WeeklySchedule, label: "Sun", icon: "🌙" },
                            ].map((day) => {
                              const assignment = staff.weeklySchedule?.[day.key];
                              const isWorking = assignment && assignment.branchId;
                              return (
                                <div
                                  key={day.key}
                                  className={`rounded-lg border-2 p-3 text-center transition ${
                                    isWorking
                                      ? "border-emerald-200 bg-emerald-50"
                                      : "border-slate-200 bg-slate-50"
                                  }`}
                                >
                                  <div className="text-xl mb-1">{day.icon}</div>
                                  <div className="text-xs font-bold text-slate-700 mb-1">
                                    {day.label}
                                  </div>
                                  {isWorking ? (
                                    <div className="text-[10px] text-emerald-700 font-medium truncate">
                                      {assignment.branchName}
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-slate-400">Off</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "training" && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="text-sm font-bold text-slate-700 mb-4">Training Matrix</div>
                    <div className="flex gap-3">
                      <span className={`px-3 py-1.5 rounded-full text-xs ${staff.training?.ohs ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        OHS
                      </span>
                      <span className={`px-3 py-1.5 rounded-full text-xs ${staff.training?.prod ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        Product
                      </span>
                      <span className={`px-3 py-1.5 rounded-full text-xs ${staff.training?.tool ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        Tools
                      </span>
                    </div>
                  </div>
                )}

                {activeTab === "schedule" && (
                  <>
                    {!branchHours ? (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-sm text-slate-500">
                        No linked branch hours. Assign a branch to this staff member.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Calendar */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-bold text-slate-700">Staff Calendar</div>
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
                                          className={`w-2 h-2 rounded-full mt-1 ${c.off ? "bg-rose-400" : "bg-emerald-400"}`}
                                          title={c.off ? "Off" : "On"}
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
                          <div className="text-sm text-slate-600 mb-4">{selectedDayText()}</div>
                          <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                            <div className="text-sm text-slate-500">
                              Placeholder for shift/booking details. Connect your booking data to show this staff member's assignments for the selected date.
                            </div>
                            <button className="mt-4 px-4 py-2 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-700">
                              <i className="fas fa-plus mr-2" />
                              Assign Shift
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {activeTab === "appointments" && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-bold text-slate-700">
                        Appointments
                      </div>
                      <div className="text-xs text-slate-500">
                        {staff?.name ? `For ${staff.name}` : ""}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-4 bg-slate-50 text-sm text-slate-600">
                      No booking data connected yet. Integrate your booking system to display this staff member’s upcoming and past appointments here.
                    </div>
                  </div>
                )}

                {activeTab === "customers" && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="text-sm font-bold text-slate-700 mb-4">
                      Customers
                    </div>
                    <div className="rounded-lg border border-slate-200 p-4 bg-slate-50 text-sm text-slate-600">
                      Link customer history to show clients served by this staff member, with visit counts and last-visit dates.
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


