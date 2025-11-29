"use client";
import React, { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Script from "next/script";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";

export default function DashboardPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(0);
  const [totalBookings, setTotalBookings] = useState<number>(0);
  const [activeStaff, setActiveStaff] = useState<number>(0);
  const [activeServices, setActiveServices] = useState<number>(0);
  const [revenueData, setRevenueData] = useState<number[]>([]);
  const [revenueLabels, setRevenueLabels] = useState<string[]>([]);
  const [statusData, setStatusData] = useState({ confirmed: 0, pending: 0, completed: 0, canceled: 0 });
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [weeklyBookings, setWeeklyBookings] = useState<number>(0);
  const [revenueGrowth, setRevenueGrowth] = useState<number>(0);
  const [recentTenants, setRecentTenants] = useState<any[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const revCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartsRef = useRef<{ revenue?: any; status?: any }>({});
  const builtRef = useRef(false);

  // Authentication
  useEffect(() => {
    (async () => {
      const { auth, db } = await import("@/lib/firebase");
      const { doc, getDoc } = await import("firebase/firestore");
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.replace("/login");
          return;
        }
        try {
          const token = await user.getIdToken();
          if (typeof window !== "undefined") localStorage.setItem("idToken", token);
          setOwnerUid(user.uid);
          
          // Check if user is super admin or branch admin
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const role = userDoc.data()?.role || "";
          
          // Redirect salon_branch_admin to branches page
          if (role === "salon_branch_admin") {
            router.replace("/branches");
            return;
          }
          
          setIsSuperAdmin(role === "super_admin");
        } catch {
          router.replace("/login");
        }
      });
      return () => unsub();
    })();
  }, [router]);

  // Fetch real data from Firestore
  useEffect(() => {
    if (!ownerUid) return;

    let unsubBookings: (() => void) | undefined;
    let unsubStaff: (() => void) | undefined;
    let unsubServices: (() => void) | undefined;

    (async () => {
      const { db } = await import("@/lib/firebase");

      // Subscribe to bookings
      const bookingsQuery = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid));
      unsubBookings = onSnapshot(bookingsQuery, (snapshot) => {
        const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Total bookings
        setTotalBookings(bookings.length);

        // Calculate monthly revenue (current month)
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        const currentMonthRevenue = bookings
          .filter((b: any) => {
            if (!b.date) return false;
            const bookingDate = new Date(b.date);
            return bookingDate.getMonth() === currentMonth && bookingDate.getFullYear() === currentYear;
          })
          .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);
        
        setMonthlyRevenue(currentMonthRevenue);

        // Calculate previous month revenue for growth comparison
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const prevMonthRevenue = bookings
          .filter((b: any) => {
            if (!b.date) return false;
            const bookingDate = new Date(b.date);
            return bookingDate.getMonth() === prevMonth && bookingDate.getFullYear() === prevYear;
          })
          .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);

        // Calculate growth percentage
        if (prevMonthRevenue > 0) {
          const growth = ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100;
          setRevenueGrowth(Math.round(growth));
        } else if (currentMonthRevenue > 0) {
          setRevenueGrowth(100);
        } else {
          setRevenueGrowth(0);
        }

        // Calculate weekly bookings (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const weeklyCount = bookings.filter((b: any) => {
          if (!b.date) return false;
          const bookingDate = new Date(b.date);
          return bookingDate >= sevenDaysAgo;
        }).length;
        setWeeklyBookings(weeklyCount);

        // Calculate revenue trend for last 6 months
        const last6Months: { month: string; revenue: number }[] = [];
        for (let i = 5; i >= 0; i--) {
          const date = new Date(currentYear, currentMonth - i, 1);
          const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
          const month = date.getMonth();
          const year = date.getFullYear();
          
          const monthRevenue = bookings
            .filter((b: any) => {
              if (!b.date) return false;
              const bookingDate = new Date(b.date);
              return bookingDate.getMonth() === month && bookingDate.getFullYear() === year;
            })
            .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);
          
          last6Months.push({ month: monthStr, revenue: monthRevenue });
        }
        
        setRevenueLabels(last6Months.map(m => m.month));
        setRevenueData(last6Months.map(m => m.revenue));

        // Calculate booking status breakdown
        const statusCount = {
          confirmed: 0,
          pending: 0,
          completed: 0,
          canceled: 0
        };
        
        bookings.forEach((b: any) => {
          const status = (b.status || '').toLowerCase();
          if (status === 'confirmed') statusCount.confirmed++;
          else if (status === 'pending') statusCount.pending++;
          else if (status === 'completed') statusCount.completed++;
          else if (status === 'canceled' || status === 'cancelled') statusCount.canceled++;
        });
        
        setStatusData(statusCount);
      });

      // Subscribe to salon staff
      const staffQuery = query(collection(db, "salon_staff"), where("ownerUid", "==", ownerUid));
      unsubStaff = onSnapshot(staffQuery, (snapshot) => {
        const staff = snapshot.docs.map(doc => doc.data());
        const activeCount = staff.filter((s: any) => s.status === "Active").length;
        setActiveStaff(activeCount);
      });

      // Subscribe to services
      const servicesQuery = query(collection(db, "services"), where("ownerUid", "==", ownerUid));
      unsubServices = onSnapshot(servicesQuery, (snapshot) => {
        setActiveServices(snapshot.docs.length);
      });
    })();

    return () => {
      unsubBookings?.();
      unsubStaff?.();
      unsubServices?.();
    };
  }, [ownerUid]);

  // Fetch recent activity (tenants for super admin, bookings for salon owners)
  useEffect(() => {
    if (!ownerUid) return;

    let unsubTenants: (() => void) | undefined;

    (async () => {
      const { db } = await import("@/lib/firebase");

      if (isSuperAdmin) {
        // For super admin, fetch recent tenants
        const tenantsQuery = query(
          collection(db, "users"),
          where("role", "==", "salon_owner")
        );
        unsubTenants = onSnapshot(tenantsQuery, (snapshot) => {
          const tenants = snapshot.docs
            .map(doc => ({
              id: doc.id,
              ...doc.data(),
              createdAt: doc.data().createdAt
            }))
            .sort((a: any, b: any) => {
              // Sort by createdAt descending (newest first)
              const aTime = a.createdAt?.toMillis?.() || 0;
              const bTime = b.createdAt?.toMillis?.() || 0;
              return bTime - aTime;
            })
            .slice(0, 5); // Get 5 most recent
          
          setRecentTenants(tenants);
        });
      }
    })();

    return () => {
      unsubTenants?.();
    };
  }, [ownerUid, isSuperAdmin]);

  // Initialize charts with Chart.js (loaded via CDN Script)
  const buildCharts = () => {
    // @ts-ignore
    const Chart = (window as any)?.Chart;
    if (!Chart) return;
    if (!revCanvasRef.current || !statusCanvasRef.current) return;

    // Destroy existing instances to avoid duplicates
    try {
      chartsRef.current.revenue?.destroy();
    } catch {}
    try {
      chartsRef.current.status?.destroy();
    } catch {}

    // Revenue line + area with real data
    const revenueSeries = revenueData.length > 0 ? revenueData : [0, 0, 0, 0, 0, 0];
    const labels = revenueLabels.length > 0 ? revenueLabels : ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const ctx = revCanvasRef.current?.getContext("2d");
    let gradient: CanvasGradient | undefined;
    if (ctx) {
      gradient = ctx.createLinearGradient(0, 0, 0, 300);
      gradient.addColorStop(0, "rgba(236, 72, 153, 0.25)");
      gradient.addColorStop(1, "rgba(236, 72, 153, 0)");
    }
    const revenue = new Chart(ctx as any, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue",
            data: revenueSeries,
            borderColor: "#ec4899",
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
          y: {
            grid: { color: "#e2e8f0" },
            ticks: {
              color: "#94a3b8",
              callback: function (value: number) {
                const v = Number(value);
                if (v >= 1000) {
                  return `AU$${Math.round(v / 1000)}k`;
                }
                return `AU$${v}`;
              },
            },
          },
        },
      },
    });

    // Booking status donut with real data
    const ctx2 = statusCanvasRef.current?.getContext("2d");
    const statusLabels: string[] = [];
    const statusValues: number[] = [];
    const statusColors: string[] = [];
    
    if (statusData.confirmed > 0) {
      statusLabels.push("Confirmed");
      statusValues.push(statusData.confirmed);
      statusColors.push("#10b981");
    }
    if (statusData.pending > 0) {
      statusLabels.push("Pending");
      statusValues.push(statusData.pending);
      statusColors.push("#f59e0b");
    }
    if (statusData.completed > 0) {
      statusLabels.push("Completed");
      statusValues.push(statusData.completed);
      statusColors.push("#3b82f6");
    }
    if (statusData.canceled > 0) {
      statusLabels.push("Canceled");
      statusValues.push(statusData.canceled);
      statusColors.push("#ef4444");
    }

    // If no data, show empty state
    if (statusValues.length === 0) {
      statusLabels.push("No Data");
      statusValues.push(1);
      statusColors.push("#e5e7eb");
    }

    const status = new Chart(ctx2 as any, {
      type: "doughnut",
      data: {
        labels: statusLabels,
        datasets: [
          {
            data: statusValues,
            backgroundColor: statusColors,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { display: true, position: "right", labels: { color: "#64748b" } },
        },
      },
    });

    chartsRef.current = { revenue, status };
    builtRef.current = true;
  };

  // Build charts when data changes
  useEffect(() => {
    const tryBuild = () => {
      // @ts-ignore
      const Chart = (window as any)?.Chart;
      if (Chart && revCanvasRef.current && statusCanvasRef.current) {
        buildCharts();
      }
    };
    tryBuild();
    const id = setInterval(tryBuild, 200);
    return () => {
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueData, revenueLabels, statusData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        chartsRef.current.revenue?.destroy();
      } catch {}
      try {
        chartsRef.current.status?.destroy();
      } catch {}
    };
  }, []);
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
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setMobileOpen(false)}
              />
              <div className="absolute left-0 top-0 bottom-0">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-lg relative overflow-hidden">
              <div className="relative z-10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <i className="fas fa-chart-line" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Dashboard</h1>
                  <p className="text-sm text-white/80 mt-1">Real-time system overview</p>
                </div>
              </div>
              <div className="absolute top-0 right-0 -mr-10 -mt-10 w-64 h-64 rounded-full bg-white opacity-10 blur-2xl" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Monthly Recurring Revenue
                </span>
                <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-dollar-sign text-pink-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">AU${monthlyRevenue.toLocaleString()}</h3>
              </div>
              <div className="flex items-center space-x-2">
                {revenueGrowth !== 0 && (
                  <span className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center ${
                    revenueGrowth > 0 
                      ? "bg-emerald-50 text-emerald-700" 
                      : "bg-rose-50 text-rose-700"
                  }`}>
                    <i className={`fas fa-arrow-${revenueGrowth > 0 ? 'up' : 'down'} text-xs mr-1`} />
                    {revenueGrowth > 0 ? '+' : ''}{revenueGrowth}%
                  </span>
                )}
                <span className="text-xs text-slate-500">vs last month</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Total Bookings
                </span>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-calendar-check text-blue-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{totalBookings}</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-plus text-xs mr-1" />
                  +{weeklyBookings}
                </span>
                <span className="text-xs text-slate-500">this week</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Active Staff
                </span>
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-users text-amber-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{activeStaff}</h3>
              </div>
              <div className="text-xs text-slate-500">Available for booking</div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Active Services
                </span>
                <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-tags text-purple-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{activeServices}</h3>
              </div>
              <div className="text-xs text-slate-500">In catalog</div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">
                    Revenue Trend
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Last 6 months
                  </p>
                </div>
              </div>
              <div className="h-[280px] relative">
                <canvas ref={revCanvasRef} />
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="mb-6">
                <h3 className="font-semibold text-lg text-slate-900">
                  Booking Status
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Distribution by status
                </p>
              </div>
              <div className="space-y-4">
                <div className="relative h-48 mb-2">
                  <canvas ref={statusCanvasRef} />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">Recent Activity</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {isSuperAdmin ? "Latest tenant onboardings" : "Recent bookings"}
                  </p>
                </div>
                {isSuperAdmin && (
                  <button 
                    onClick={() => router.push("/tenants")}
                    className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition"
                  >
                    View All
                    <i className="fas fa-arrow-right ml-2 text-xs" />
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              {isSuperAdmin ? (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Business Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Location</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Plan</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {recentTenants.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                          No recent activity
                        </td>
                      </tr>
                    ) : (
                      recentTenants.map((tenant: any, idx: number) => {
                        const initials = (tenant.name || tenant.displayName || "?")
                          .split(" ")
                          .map((s: string) => s[0])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join("")
                          .toUpperCase();
                        
                        const statusLabel = tenant.status || "Active";
                        const statusLower = statusLabel.toLowerCase();
                        const statusCls = statusLower.includes("suspend")
                          ? "bg-rose-50 text-rose-700"
                          : statusLower.includes("active")
                          ? "bg-emerald-50 text-emerald-700"
                          : statusLower.includes("pending")
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-700";
                        const statusIcon = statusLower.includes("active")
                          ? "fa-check-circle"
                          : statusLower.includes("pending")
                          ? "fa-clock"
                          : "fa-circle-info";

                        const state = tenant.state || "";
                        const stateCls = state === "NSW"
                          ? "bg-blue-50 text-blue-700"
                          : state === "VIC"
                          ? "bg-purple-50 text-purple-700"
                          : state === "QLD"
                          ? "bg-orange-50 text-orange-700"
                          : state === "WA"
                          ? "bg-indigo-50 text-indigo-700"
                          : state === "SA"
                          ? "bg-green-50 text-green-700"
                          : "bg-slate-100 text-slate-700";

                        const colors = [
                          { from: "from-pink-400", to: "to-pink-600" },
                          { from: "from-blue-400", to: "to-blue-600" },
                          { from: "from-purple-400", to: "to-purple-600" },
                          { from: "from-teal-400", to: "to-teal-600" },
                          { from: "from-rose-400", to: "to-rose-600" },
                        ];
                        const color = colors[idx % colors.length];

                        // Calculate relative time
                        const createdAt = tenant.createdAt?.toDate?.();
                        let timeAgo = "Recently";
                        if (createdAt) {
                          const now = new Date();
                          const diffMs = now.getTime() - createdAt.getTime();
                          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                          const diffDays = Math.floor(diffHours / 24);
                          
                          if (diffHours < 1) {
                            timeAgo = "Just now";
                          } else if (diffHours < 24) {
                            timeAgo = `Registered ${diffHours}h ago`;
                          } else if (diffDays === 1) {
                            timeAgo = "Registered 1d ago";
                          } else {
                            timeAgo = `Registered ${diffDays}d ago`;
                          }
                        }

                        return (
                          <tr key={tenant.id} className="hover:bg-slate-50 transition">
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-3">
                                <div className={`w-10 h-10 bg-gradient-to-br ${color.from} ${color.to} rounded-lg flex items-center justify-center`}>
                                  <span className="text-white font-semibold text-sm">{initials}</span>
                                </div>
                                <div>
                                  <p className="font-medium text-slate-900">{tenant.name || tenant.displayName || "Unknown"}</p>
                                  <p className="text-xs text-slate-500">{timeAgo}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {state ? (
                                <span className={`px-2 py-1 ${stateCls} rounded-lg text-sm font-medium`}>{state}</span>
                              ) : (
                                <span className="text-sm text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-2">
                                <span className="px-3 py-1 bg-pink-50 text-pink-700 rounded-lg text-sm font-semibold">
                                  {tenant.plan || "Starter"}
                                </span>
                                {tenant.price && (
                                  <span className="text-sm text-slate-500">{tenant.price}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-3 py-1 ${statusCls} rounded-lg text-sm font-medium flex items-center w-fit`}>
                                <i className={`fas ${statusIcon} text-xs mr-1.5`} />
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => router.push("/tenants")}
                                className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition"
                              >
                                Manage
                                <i className="fas fa-arrow-right ml-2 text-xs" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-8 text-center text-slate-500">
                  <i className="fas fa-calendar-check text-4xl text-slate-300 mb-3" />
                  <p>Booking activity will appear here</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Load Chart.js from CDN and build charts */}
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js"
        strategy="afterInteractive"
        onLoad={buildCharts}
      />
    </div>
  );
}


