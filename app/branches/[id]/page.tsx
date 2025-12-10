"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
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

type StaffByDay = {
  Monday?: string[];
  Tuesday?: string[];
  Wednesday?: string[];
  Thursday?: string[];
  Friday?: string[];
  Saturday?: string[];
  Sunday?: string[];
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

type Branch = {
  id: string;
  name: string;
  address: string;
  revenue?: number;
  phone?: string;
  email?: string;
  staffIds?: string[];
  staffByDay?: StaffByDay;
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
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "analytics" | "appointments" | "services" | "staff" | "customers" | "schedule"
  >("overview");
  const [allServices, setAllServices] = useState<Array<{ id: string; name: string; icon?: string; price?: number; duration?: number; branches?: string[] }>>([]);
  const [allStaff, setAllStaff] = useState<Array<{ id: string; name: string; status?: string; branch?: string; staffRole?: string; weeklySchedule?: WeeklySchedule }>>([]);
  const [branchBookings, setBranchBookings] = useState<Array<any>>([]);
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
        setUserRole(role);
        setCurrentUserUid(user.uid);
        
        if (role === "salon_owner") {
          setOwnerUid(user.uid);
        } else if (role === "salon_branch_admin") {
          setOwnerUid(snap.data()?.ownerUid || null);
        } else {
          router.replace("/dashboard");
          return;
        }
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
    const unsub = onSnapshot(
      doc(db, "branches", branchId),
      (d) => {
        if (!d.exists()) {
          setBranch(null);
          setLoading(false);
          return;
        }
        const data = d.data() as any;
        
        // Check if branch admin is trying to access a branch they don't manage
        if (userRole === "salon_branch_admin" && currentUserUid) {
          const branchAdminId = data.adminStaffId;
          if (branchAdminId !== currentUserUid) {
            // Redirect to branches page if they try to access unauthorized branch
            router.push("/branches");
            return;
          }
        }
        
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
          staffByDay: data.staffByDay as StaffByDay | undefined,
          serviceIds: Array.isArray(data.serviceIds) ? data.serviceIds.map(String) : [],
        };
        setBranch(b);
        setLoading(false);
      },
      (error) => {
        if (error.code === "permission-denied") {
          console.warn("Permission denied for branch query.");
          router.replace("/login");
        } else {
          console.error("Error in branch snapshot:", error);
          setLoading(false);
        }
      }
    );
    return () => unsub();
  }, [ownerUid, branchId, userRole, currentUserUid, router]);

  // subscribe to bookings for this branch
  useEffect(() => {
    if (!ownerUid || !branchId) return;
    const q = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid), where("branchId", "==", branchId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: any[] = [];
        snap.forEach((d) => {
          const b = d.data() as any;
          rows.push({ id: d.id, ...b });
        });
        // show most recent first by createdAt if exists
        rows.sort((a, b) => {
          const ams = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const bms = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return bms - ams;
        });
        setBranchBookings(rows);
      },
      (error) => {
        if (error.code === "permission-denied") {
          console.warn("Permission denied for branch bookings query.");
          setBranchBookings([]);
        } else {
          console.error("Error in branch bookings snapshot:", error);
          setBranchBookings([]);
        }
      }
    );
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
          branches: Array.isArray(s.branches) ? s.branches.map(String) : undefined,
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
          staffRole: s.staffRole || s.role || "Staff",
          weeklySchedule: s.weeklySchedule || {},
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
  
  // Count staff who work at this branch (based on weeklySchedule)
  const staffCount = useMemo(() => {
    if (!branch) return 0;
    return allStaff.filter((st) => {
      const schedule = st.weeklySchedule || {};
      return Object.values(schedule).some(
        (day) => day && day.branchId === branch.id
      );
    }).length;
  }, [allStaff, branch]);

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

          {/* Only show back button for salon owners */}
          {userRole === "salon_owner" && (
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
          )}

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
                <div className="mt-2 text-2xl font-bold text-slate-800">{staffCount}</div>
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
                { key: "overview", label: "Overview", icon: "fa-compass" },
                { key: "analytics", label: "Branch Analytics", icon: "fa-chart-pie" },
                { key: "appointments", label: "Appointments", icon: "fa-calendar-check" },
                { key: "services", label: `Services (${serviceCount})`, icon: "fa-scissors" },
                { key: "staff", label: `Staff (${staffCount})`, icon: "fa-users" },
                { key: "customers", label: "Customers", icon: "fa-user-group" },
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

                {activeTab === "overview" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-2 mt-6">
                    {/* Upcoming Appointments */}
                    <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                      <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <i className="fa-regular fa-calendar-check text-blue-500" /> Upcoming Appointments
                        </h3>
                        <button
                          onClick={() => setActiveTab("appointments")}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          View All
                        </button>
                      </div>
                      <div className="p-4 overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-400 uppercase bg-slate-50/50">
                            <tr>
                              <th className="px-4 py-3 rounded-l-lg">Time</th>
                              <th className="px-4 py-3">Customer</th>
                              <th className="px-4 py-3">Service</th>
                              <th className="px-4 py-3">Staff</th>
                              <th className="px-4 py-3 rounded-r-lg">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {[...branchBookings]
                              .filter((b) => {
                                const today = new Date().toISOString().slice(0, 10);
                                return String(b.date || "") === today;
                              })
                              .sort((a, b) => {
                                const aD = new Date(`${a.date || ""}T${(a.time || "00:00")}:00`);
                                const bD = new Date(`${b.date || ""}T${(b.time || "00:00")}:00`);
                                return aD.getTime() - bD.getTime();
                              })
                              .slice(0, 3)
                              .map((b, i) => (
                                <tr key={b.id || i} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-3 font-semibold text-slate-700">{b.time || "-"}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 text-xs flex items-center justify-center">
                                        {(b.client || "U").toString().slice(0, 1).toUpperCase()}
                                      </div>
                                      <span className="text-slate-800 font-medium">{b.client || "Unknown"}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-slate-500">{b.serviceName || String(b.serviceId || "")}</td>
                                  <td className="px-4 py-3 text-slate-500">{b.staffName || b.staffId || "-"}</td>
                                  <td className="px-4 py-3">
                                    <span
                                      className={`px-2 py-1 rounded-md text-xs font-medium ${
                                        b.status === "Confirmed"
                                          ? "bg-green-100 text-green-700"
                                          : b.status === "Pending"
                                          ? "bg-yellow-100 text-yellow-700"
                                          : b.status === "Completed"
                                          ? "bg-blue-100 text-blue-700"
                                          : "bg-slate-100 text-slate-600"
                                      }`}
                                    >
                                      {b.status || "-"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            {branchBookings.filter((b) => String(b.date || "") === new Date().toISOString().slice(0,10)).length === 0 && (
                              <tr>
                                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                                  No bookings today.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* New Customers */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                      <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <i className="fa-solid fa-users text-orange-500" /> New Customers
                        </h3>
                        <button
                          onClick={() => setActiveTab("customers")}
                          className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                        >
                          View All
                        </button>
                      </div>
                      <div className="p-4 space-y-4">
                        {Array.from(
                          new Map(
                            [...branchBookings]
                              .filter((b) => String(b.date || "") === new Date().toISOString().slice(0, 10))
                              .sort((a, b) => {
                                const ams = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                                const bms = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                                return bms - ams;
                              })
                              .map((b: any) => [String(b.client || ""), { name: b.client, meta: b.clientEmail || b.clientPhone }])
                          ).values()
                        )
                          .slice(0, 3)
                          .map((c: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
                                {(c.name || "U").toString().slice(0, 1).toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-slate-800">{c.name || "Unknown"}</h4>
                                <p className="text-xs text-slate-500 truncate">{c.meta || ""}</p>
                              </div>
                              <button className="text-slate-400 hover:text-pink-500">
                                <i className="fa-solid fa-message" />
                              </button>
                            </div>
                          ))}
                        {branchBookings.filter((b) => String(b.date || "") === new Date().toISOString().slice(0,10)).length === 0 && (
                          <div className="text-sm text-slate-500">No customers today.</div>
                        )}
                        <button
                          onClick={() => setActiveTab("customers")}
                          className="w-full mt-2 py-2 text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors border border-dashed border-slate-200"
                        >
                          + Add New Customer manually
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === "analytics" && (
                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-50 pb-4 mb-4">
                        <h3 className="font-bold text-lg text-slate-800">Branch Performance</h3>
                        <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
                          <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-white shadow-sm text-slate-800">Daily</button>
                          <button className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-slate-800">Weekly</button>
                          <button className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-slate-800">Monthly</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white p-5 rounded-xl border border-slate-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-slate-500 font-medium">Total Revenue</p>
                              <h4 className="text-2xl font-bold text-slate-800 mt-1">${(branch?.revenue || 0).toLocaleString()}</h4>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
                              <i className="fas fa-dollar-sign" />
                            </div>
                          </div>
                        </div>
                        <div className="bg-white p-5 rounded-xl border border-slate-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-slate-500 font-medium">Total Appointments</p>
                              <h4 className="text-2xl font-bold text-slate-800 mt-1">{branchBookings.length}</h4>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                              <i className="fas fa-calendar-check" />
                            </div>
                          </div>
                        </div>
                        <div className="bg-white p-5 rounded-xl border border-slate-100">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-slate-500 font-medium">Active Services</p>
                              <h4 className="text-2xl font-bold text-slate-800 mt-1">{serviceCount}</h4>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-pink-50 text-pink-600 flex items-center justify-center">
                              <i className="fas fa-tags" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                        <h4 className="font-bold text-slate-800 mb-6">Appointments by Date (sample)</h4>
                        <div className="flex items-end gap-2 sm:gap-4 h-48 border-b border-slate-200 pb-2">
                          {[40, 65, 80, 55, 90, 70, 30].map((h, i) => (
                            <div key={i} className={`flex-1 rounded-t bg-pink-${i === 4 ? "500" : "300"} ${i === 4 ? "shadow-lg shadow-pink-200" : ""}`} style={{ height: `${h}%` }} />
                          ))}
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 mt-2 px-1">
                          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                        </div>
                      </div>
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                        <h4 className="font-bold text-slate-800 mb-4">Top Services</h4>
                        <div className="space-y-4">
                          {["Hair", "Facial", "Manicure", "Others"].map((label, idx) => (
                            <div key={label}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-slate-600">{label}</span>
                                <span className="font-semibold text-slate-800">{[45, 30, 15, 10][idx]}%</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${["bg-purple-500","bg-pink-500","bg-indigo-500","bg-slate-400"][idx]}`} style={{ width: `${[45,30,15,10][idx]}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "appointments" && (
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-slate-800">Booking Management</h2>
                        <p className="text-sm text-slate-500">Manage, track and schedule all branch appointments.</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 font-semibold">
                              <th className="p-4">Customer</th>
                              <th className="p-4">Service</th>
                              <th className="p-4">Date & Time</th>
                              <th className="p-4">Staff</th>
                              <th className="p-4">Total</th>
                              <th className="p-4">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-sm">
                            {branchBookings.map((b) => (
                              <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4">
                                  <div className="font-semibold text-slate-800">{b.client || "—"}</div>
                                  {b.clientPhone && <div className="text-xs text-slate-400">{b.clientPhone}</div>}
                                </td>
                                <td className="p-4">
                                  <div className="font-medium text-slate-700">{b.serviceName || String(b.serviceId)}</div>
                                  {b.duration && <div className="text-xs text-slate-400">⏱ {b.duration} mins</div>}
                                </td>
                                <td className="p-4">
                                  <div className="font-medium text-slate-700">{b.date}</div>
                                  <div className="text-xs text-slate-500">{b.time}</div>
                                </td>
                                <td className="p-4">{b.staffName || b.staffId || "—"}</td>
                                <td className="p-4 font-semibold text-slate-700">${Number(b.price || 0).toFixed(0)}</td>
                                <td className="p-4">
                                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                      b.status === "Confirmed"
                                        ? "bg-green-50 text-green-600 border border-green-100"
                                        : b.status === "Pending"
                                        ? "bg-yellow-50 text-yellow-600 border border-yellow-100"
                                        : b.status === "Completed"
                                        ? "bg-blue-50 text-blue-600 border border-blue-100"
                                        : "bg-slate-100 text-slate-600 border border-slate-200"
                                    }`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                    {b.status || "—"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {branchBookings.length === 0 && (
                              <tr>
                                <td className="p-4 text-slate-400" colSpan={6}>No appointments found for this branch.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
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
                          .filter((s) => {
                            // Prefer canonical service.branches; fallback to legacy branch.serviceIds
                            if (Array.isArray(s.branches)) return s.branches.includes(branch.id);
                            return (branch.serviceIds || []).includes(s.id);
                          })
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
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-bold text-slate-700">Staff assigned to this branch</div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Working Day</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-slate-300" />
                          <span>Off Day</span>
                        </div>
                      </div>
                    </div>
                    {(() => {
                      // Get staff who work at this branch (check weeklySchedule for branchId match)
                      const branchStaff = allStaff.filter((st) => {
                        // Check if any day in their schedule is for this branch
                        const schedule = st.weeklySchedule || {};
                        return Object.values(schedule).some(
                          (day) => day && day.branchId === branch.id
                        );
                      });

                      if (branchStaff.length === 0) {
                        return <div className="text-sm text-slate-400">No staff assigned.</div>;
                      }

                      const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
                      const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

                      return (
                        <div className="space-y-3">
                          {branchStaff.map((st) => {
                            const schedule = st.weeklySchedule || {};
                            const statusColor =
                              st.status === "Active" ? "bg-emerald-100 text-emerald-700" : st.status === "Suspended" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600";
                            
                            // Get days this staff works at THIS branch
                            const workingDays = DAYS.filter(
                              (day) => schedule[day]?.branchId === branch.id
                            );

                            return (
                              <div key={st.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-md transition bg-white">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                  {/* Staff info */}
                                  <div className="flex items-center gap-3 min-w-[200px]">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-100 to-purple-100 text-pink-600 flex items-center justify-center font-semibold text-sm">
                                      {st.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-semibold text-slate-800 truncate">{st.name}</div>
                                      <div className="text-xs text-slate-500 truncate">{st.staffRole}</div>
                                    </div>
                                  </div>

                                  {/* Weekly schedule pills */}
                                  <div className="flex-1">
                                    <div className="flex flex-wrap gap-1.5">
                                      {DAYS.map((day, idx) => {
                                        const isWorking = schedule[day]?.branchId === branch.id;
                                        return (
                                          <div
                                            key={day}
                                            className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                                              isWorking
                                                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                                : "bg-slate-50 text-slate-400 border border-slate-100"
                                            }`}
                                            title={isWorking ? `Works here on ${day}` : `Off on ${day}`}
                                          >
                                            {SHORT_DAYS[idx]}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Status badge */}
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-500">
                                      {workingDays.length} day{workingDays.length !== 1 ? "s" : ""}/week
                                    </span>
                                    {st.status && (
                                      <div className={`inline-flex text-xs px-2 py-0.5 rounded-full ${statusColor}`}>
                                        {st.status}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {activeTab === "customers" && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                    <div className="px-0 pb-4 flex justify-between items-center border-b border-slate-100 mb-4">
                      <h3 className="font-bold text-slate-800">Recent Customers</h3>
                    </div>
                    <div className="space-y-3">
                      {Array.from(
                        new Map(
                          branchBookings.map((b: any) => [String(b.client || ""), { name: b.client, email: b.clientEmail, phone: b.clientPhone }])
                        ).values()
                      ).map((c: any, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center font-bold text-xs">
                            {(c.name || "U").toString().slice(0, 1).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-800 truncate">{c.name || "Unknown"}</div>
                            <div className="text-xs text-slate-500 truncate">{c.email || c.phone || "—"}</div>
                          </div>
                        </div>
                      ))}
                      {branchBookings.length === 0 && <div className="text-sm text-slate-500">No recent customers.</div>}
                    </div>
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


