"use client";
import React, { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Script from "next/script";

export default function DashboardPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(0);
  const [totalBookings, setTotalBookings] = useState<number>(0);
  const [activeStaff, setActiveStaff] = useState<number>(0);
  const [activeServices, setActiveServices] = useState<number>(0);
  const revCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [charts, setCharts] = useState<{ revenue?: any; status?: any }>({});
  useEffect(() => {
    (async () => {
      const { auth } = await import("@/lib/firebase");
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.replace("/login");
          return;
        }
        try {
          const token = await user.getIdToken();
          if (typeof window !== "undefined") localStorage.setItem("idToken", token);
        } catch {
          router.replace("/login");
        }
      });
      return () => unsub();
    })();
  }, [router]);

  // lightweight KPI aggregation from localStorage stores (best-effort)
  useEffect(() => {
    try {
      // bookings store not standardized yet; keep 0
      setTotalBookings(0);
      const staffRaw = typeof window !== "undefined" ? localStorage.getItem("bms_staff_data") : null;
      if (staffRaw) {
        const parsed = JSON.parse(staffRaw);
        const count = Array.isArray(parsed?.staff) ? parsed.staff.filter((s: any) => s.status === "Active").length : 0;
        setActiveStaff(count);
      }
      const servicesRaw = typeof window !== "undefined" ? localStorage.getItem("bms_services_data") : null;
      if (servicesRaw) {
        const parsed = JSON.parse(servicesRaw);
        const count = Array.isArray(parsed?.services) ? parsed.services.length : 0;
        setActiveServices(count);
      }
      // mock revenue until bookings subsystem emits data
      setMonthlyRevenue(0);
    } catch {}
  }, []);

  // Initialize charts with Chart.js (loaded via CDN Script)
  const buildCharts = () => {
    // @ts-ignore
    const Chart = (window as any)?.Chart;
    if (!Chart) return;

    // Destroy existing instances to avoid duplicates
    try {
      charts.revenue?.destroy();
    } catch {}
    try {
      charts.status?.destroy();
    } catch {}

    // Revenue line + area
    const revenueSeries = [12000, 19000, 15000, 25000, 22000, 30000];
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
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
                return `$${Math.round(v / 1000)}k`;
              },
            },
          },
        },
      },
    });

    // Booking status donut
    const ctx2 = statusCanvasRef.current?.getContext("2d");
    const status = new Chart(ctx2 as any, {
      type: "doughnut",
      data: {
        labels: ["Confirmed", "Pending"],
        datasets: [
          {
            data: [1, 1],
            backgroundColor: ["#10b981", "#f59e0b"],
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

    setCharts({ revenue, status });
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
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-up text-xs mr-1" />
                  +12%
                </span>
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
                  +0
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
                    Revenue Trend (Mock)
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
                  Confirmed vs Pending (Mock)
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
                  <p className="text-sm text-slate-500 mt-1">Latest onboarding activity</p>
                </div>
                <button className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition">
                  View All
                  <i className="fas fa-arrow-right ml-2 text-xs" />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
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
                  {[
                    { abbr: "BB", name: "Bondi Beach Cuts", time: "Registered 2h ago", state: "NSW", plan: "Pro", price: "AU$149", statusCls: "bg-emerald-50 text-emerald-700", statusIcon: "fa-check-circle", status: "Active", colorFrom: "from-pink-400", colorTo: "to-pink-600", stateCls: "bg-blue-50 text-blue-700" },
                    { abbr: "GS", name: "Glamour Studio Melbourne", time: "Registered 5h ago", state: "VIC", plan: "Enterprise", price: "AU$299", statusCls: "bg-amber-50 text-amber-700", statusIcon: "fa-clock", status: "Provisioning", colorFrom: "from-blue-400", colorTo: "to-blue-600", stateCls: "bg-purple-50 text-purple-700" },
                    { abbr: "SB", name: "Style Bar Brisbane", time: "Registered 1d ago", state: "QLD", plan: "Starter", price: "AU$99", statusCls: "bg-rose-50 text-rose-700", statusIcon: "fa-exclamation-circle", status: "Pending ABN", colorFrom: "from-purple-400", colorTo: "to-purple-600", stateCls: "bg-orange-50 text-orange-700" },
                    { abbr: "CH", name: "Chic Hair Perth", time: "Registered 1d ago", state: "WA", plan: "Pro", price: "AU$149", statusCls: "bg-emerald-50 text-emerald-700", statusIcon: "fa-check-circle", status: "Active", colorFrom: "from-teal-400", colorTo: "to-teal-600", stateCls: "bg-indigo-50 text-indigo-700" },
                    { abbr: "LS", name: "Luxe Salon Adelaide", time: "Registered 2d ago", state: "SA", plan: "Starter", price: "AU$99", statusCls: "bg-emerald-50 text-emerald-700", statusIcon: "fa-check-circle", status: "Active", colorFrom: "from-rose-400", colorTo: "to-rose-600", stateCls: "bg-green-50 text-green-700" },
                  ].map((r) => (
                    <tr key={r.name} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 bg-gradient-to-br ${r.colorFrom} ${r.colorTo} rounded-lg flex items-center justify-center`}>
                            <span className="text-white font-semibold text-sm">{r.abbr}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{r.name}</p>
                            <p className="text-xs text-slate-500">{r.time}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 ${r.stateCls} rounded-lg text-sm font-medium`}>{r.state}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <span className="px-3 py-1 bg-pink-50 text-pink-700 rounded-lg text-sm font-semibold">{r.plan}</span>
                          <span className="text-sm text-slate-500">{r.price}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 ${r.statusCls} rounded-lg text-sm font-medium flex items-center w-fit`}>
                          <i className={`fas ${r.statusIcon} text-xs mr-1.5`} />
                          {r.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition">
                          Manage
                          <i className="fas fa-arrow-right ml-2 text-xs" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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


