"use client";
import React, { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Script from "next/script";
import { subscribeBookingsForOwner } from "@/lib/bookings";
import { subscribeSalonStaffForOwner } from "@/lib/salonStaff";
import { subscribeServicesForOwner } from "@/lib/services";
import { subscribeBranchesForOwner } from "@/lib/branches";

export default function DashboardPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(0);
  const [revenueGrowth, setRevenueGrowth] = useState<number>(0);
  const [totalBookings, setTotalBookings] = useState<number>(0);
  const [weeklyBookings, setWeeklyBookings] = useState<number>(0);
  const [activeStaff, setActiveStaff] = useState<number>(0);
  const [activeServices, setActiveServices] = useState<number>(0);
  const [activeBranches, setActiveBranches] = useState<number>(0);
  const [bookingsByStatus, setBookingsByStatus] = useState<{ [key: string]: number }>({});
  const [revenueByMonth, setRevenueByMonth] = useState<number[]>([]);
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [userUid, setUserUid] = useState<string | null>(null);
  const revCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartsRef = useRef<{ revenue?: any; status?: any }>({});
  const builtRef = useRef(false);
  
  useEffect(() => {
    (async () => {
      const { auth, db } = await import("@/lib/firebase");
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          // Clear token to prevent loop if we are redirected back to login
          if (typeof window !== "undefined") localStorage.removeItem("idToken");
          router.replace("/login");
          return;
        }
        try {
          const token = await user.getIdToken();
          if (typeof window !== "undefined") localStorage.setItem("idToken", token);
          // Resolve ownerUid based on role
          const { getDoc, doc } = await import("firebase/firestore");
          const snap = await getDoc(doc(db, "users", user.uid));
          const userData = snap.data();
          const role = (userData?.role || "").toString();
          
          if (role === "salon_owner") {
            setUserUid(user.uid);
          } else if (role === "salon_branch_admin") {
            // Branch admins should not see the main dashboard; redirect to branches
            router.replace("/branches");
            return;
          } else {
             // fallback for other roles or if ownerUid missing, 
             // though normally they shouldn't be here if not authorized.
             // For now, defaulting to user.uid might break things if they aren't owners, 
             // but let's stick to logic.
             setUserUid(user.uid);
          }
        } catch (e) {
          console.error("Dashboard auth/role error", e);
          router.replace("/login");
        }
      });
      return () => unsub();
    })();
  }, [router]);

  // Fetch real data from Firestore
  useEffect(() => {
    if (!userUid) return;

    // Subscribe to bookings
    const unsubBookings = subscribeBookingsForOwner(userUid, (bookings) => {
      setTotalBookings(bookings.length);
      
      // Calculate monthly revenue (sum of all booking prices)
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const currentMonthTotal = bookings
        .filter((b: any) => {
          const bookingDate = new Date(b.date);
          return bookingDate.getMonth() === currentMonth && bookingDate.getFullYear() === currentYear;
        })
        .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);
      setMonthlyRevenue(currentMonthTotal);

      // Calculate previous month revenue for growth percentage
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const lastMonthTotal = bookings
        .filter((b: any) => {
          const bookingDate = new Date(b.date);
          return bookingDate.getMonth() === lastMonth && bookingDate.getFullYear() === lastMonthYear;
        })
        .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);
      
      const growth = lastMonthTotal > 0 
        ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 
        : currentMonthTotal > 0 ? 100 : 0;
      setRevenueGrowth(Math.round(growth));

      // Calculate weekly bookings (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weeklyCount = bookings.filter((b: any) => {
        const bookingDate = new Date(b.date);
        return bookingDate >= weekAgo;
      }).length;
      setWeeklyBookings(weeklyCount);

      // Calculate bookings by status
      const statusCounts: { [key: string]: number } = {};
      bookings.forEach((b: any) => {
        const status = b.status || "Pending";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      setBookingsByStatus(statusCounts);

      // Calculate revenue by month for the last 6 months
      const monthlyRevenues: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const targetDate = new Date();
        targetDate.setMonth(targetDate.getMonth() - i);
        const targetMonth = targetDate.getMonth();
        const targetYear = targetDate.getFullYear();
        
        const monthTotal = bookings
          .filter((b: any) => {
            const bookingDate = new Date(b.date);
            return bookingDate.getMonth() === targetMonth && bookingDate.getFullYear() === targetYear;
          })
          .reduce((sum: number, b: any) => sum + (Number(b.price) || 0), 0);
        monthlyRevenues.push(monthTotal);
      }
      setRevenueByMonth(monthlyRevenues);

      // Get recent bookings (last 5, sorted by creation date)
      const sorted = [...bookings].sort((a: any, b: any) => {
        const dateA = a.createdAt?.toDate?.() || new Date(a.date);
        const dateB = b.createdAt?.toDate?.() || new Date(b.date);
        return dateB.getTime() - dateA.getTime();
      });
      setRecentBookings(sorted.slice(0, 5));
    });

    // Subscribe to staff
    const unsubStaff = subscribeSalonStaffForOwner(userUid, (staff) => {
      const activeCount = staff.filter((s: any) => s.status === "Active").length;
      setActiveStaff(activeCount);
    });

    // Subscribe to services
    const unsubServices = subscribeServicesForOwner(userUid, (services) => {
      setActiveServices(services.length);
    });

    // Subscribe to branches
    const unsubBranches = subscribeBranchesForOwner(userUid, (branches) => {
      const activeCount = branches.filter((b: any) => b.status === "Active").length;
      setActiveBranches(activeCount);
    });

    return () => {
      unsubBookings();
      unsubStaff();
      unsubServices();
      unsubBranches();
    };
  }, [userUid]);

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

    // Revenue line + area - Use real data
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const labels: string[] = [];
    const currentDate = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(currentDate.getMonth() - i);
      labels.push(monthNames[date.getMonth()]);
    }
    
    const revenueSeries = revenueByMonth.length > 0 ? revenueByMonth : [0, 0, 0, 0, 0, 0];
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
            pointRadius: 0,
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
                  return `$${Math.round(v / 1000)}k`;
                }
                return `$${v}`;
              },
            },
          },
        },
      },
    });

    // Booking status donut - Use real data
    const statusLabels = Object.keys(bookingsByStatus).length > 0 
      ? Object.keys(bookingsByStatus) 
      : ["Pending", "Confirmed"];
    const statusData = Object.keys(bookingsByStatus).length > 0 
      ? Object.values(bookingsByStatus) 
      : [1, 1];
    const statusColors: { [key: string]: string } = {
      "Pending": "#f59e0b",
      "Confirmed": "#10b981",
      "Completed": "#3b82f6",
      "Canceled": "#ef4444",
    };
    const backgroundColors = statusLabels.map(label => statusColors[label] || "#64748b");

    const ctx2 = statusCanvasRef.current?.getContext("2d");
    const status = new Chart(ctx2 as any, {
      type: "doughnut",
      data: {
        labels: statusLabels,
        datasets: [
          {
            data: statusData,
            backgroundColor: backgroundColors,
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

  // Build charts on first mount or when navigating back to this page
  useEffect(() => {
    const tryBuild = () => {
      // @ts-ignore
      const Chart = (window as any)?.Chart;
      if (!builtRef.current && Chart && revCanvasRef.current && statusCanvasRef.current) {
        buildCharts();
      }
    };
    tryBuild();
    const id = setInterval(tryBuild, 200);
    return () => {
      clearInterval(id);
      try {
        chartsRef.current.revenue?.destroy();
      } catch {}
      try {
        chartsRef.current.status?.destroy();
      } catch {}
      builtRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild charts when data changes
  useEffect(() => {
    if (builtRef.current && (revenueByMonth.length > 0 || Object.keys(bookingsByStatus).length > 0)) {
      builtRef.current = false;
      buildCharts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueByMonth, bookingsByStatus]);
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
                  <span className={`px-2 py-1 ${revenueGrowth > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"} rounded-lg text-xs font-semibold flex items-center`}>
                    <i className={`fas fa-arrow-${revenueGrowth > 0 ? "up" : "down"} text-xs mr-1`} />
                    {revenueGrowth > 0 ? "+" : ""}{revenueGrowth}%
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
                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-calendar-week text-xs mr-1" />
                  {weeklyBookings}
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
                  Current distribution
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
                  <h3 className="font-semibold text-lg text-slate-900">Recent Bookings</h3>
                  <p className="text-sm text-slate-500 mt-1">Latest booking activity</p>
                </div>
                <button 
                  onClick={() => router.push("/bookings")}
                  className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition"
                >
                  View All
                  <i className="fas fa-arrow-right ml-2 text-xs" />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              {recentBookings.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i className="fas fa-calendar-alt text-2xl text-slate-400" />
                  </div>
                  <p className="text-slate-600 font-medium mb-2">No bookings yet</p>
                  <p className="text-sm text-slate-500">Bookings will appear here once created</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Client</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Service</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date & Time</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Staff</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {recentBookings.map((booking, idx) => {
                      const statusColors: { [key: string]: { bg: string; text: string; icon: string } } = {
                        "Pending": { bg: "bg-amber-50", text: "text-amber-700", icon: "fa-clock" },
                        "Confirmed": { bg: "bg-emerald-50", text: "text-emerald-700", icon: "fa-check-circle" },
                        "Completed": { bg: "bg-blue-50", text: "text-blue-700", icon: "fa-check-double" },
                        "Canceled": { bg: "bg-rose-50", text: "text-rose-700", icon: "fa-times-circle" },
                      };
                      const status = booking.status || "Pending";
                      const statusStyle = statusColors[status] || statusColors["Pending"];
                      const initials = booking.client?.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase() || "??";
                      const colors = [
                        "from-pink-400 to-pink-600",
                        "from-blue-400 to-blue-600",
                        "from-purple-400 to-purple-600",
                        "from-teal-400 to-teal-600",
                        "from-rose-400 to-rose-600",
                      ];
                      const colorClass = colors[idx % colors.length];

                      return (
                        <tr key={booking.id} className="hover:bg-slate-50 transition">
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              <div className={`w-10 h-10 bg-gradient-to-br ${colorClass} rounded-lg flex items-center justify-center`}>
                                <span className="text-white font-semibold text-sm">{initials}</span>
                              </div>
                              <div>
                                <p className="font-medium text-slate-900">{booking.client || "Unknown"}</p>
                                <p className="text-xs text-slate-500">{booking.clientEmail || ""}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-900">{booking.serviceName || "Service"}</p>
                            <p className="text-xs text-slate-500">{booking.duration || 0} min</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-900">{booking.date || "N/A"}</p>
                            <p className="text-xs text-slate-500">{booking.time || ""}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-900">{booking.staffName || "N/A"}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-medium text-slate-900">AU${Number(booking.price || 0).toFixed(2)}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 ${statusStyle.bg} ${statusStyle.text} rounded-lg text-sm font-medium flex items-center w-fit`}>
                              <i className={`fas ${statusStyle.icon} text-xs mr-1.5`} />
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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


