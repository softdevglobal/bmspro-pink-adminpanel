 "use client";
import React, { useState } from "react";
import Sidebar from "@/components/Sidebar";

export default function DashboardPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
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
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fas fa-chart-line" />
                    </div>
                    <h1 className="text-2xl font-bold">Dashboard</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Today’s status across bookings, availability, and payments.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div id="kpi-section" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 min-w-0">
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
                <h3 className="text-3xl font-bold text-slate-900">AU$45,200</h3>
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
                  Active Salons
                </span>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-store text-blue-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">142</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-plus text-xs mr-1" />
                  +5
                </span>
                <span className="text-xs text-slate-500">this week</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Avg Revenue Per User
                </span>
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-chart-line text-amber-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">AU$318</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold">
                  Stable
                </span>
                <span className="text-xs text-slate-500">per salon/month</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">
                  Churn Rate
                </span>
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-minus text-rose-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">1.2%</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-down text-xs mr-1" />
                  -0.2%
                </span>
                <span className="text-xs text-slate-500">improvement</span>
              </div>
            </div>
          </div>
          <div id="charts-section" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 min-w-0">
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0 overflow-hidden">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">
                    Revenue Growth
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Last 12 months MRR trend
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                    Month
                  </button>
                  <button className="px-3 py-1.5 text-xs font-medium bg-pink-50 text-pink-600 rounded-lg">
                    Year
                  </button>
                </div>
              </div>
              <div className="h-[280px] relative">
                <div className="absolute left-0 top-0 bottom-8 flex flex-col justify-between text-xs text-slate-400 pr-2">
                  <span>$50k</span>
                  <span>$40k</span>
                  <span>$30k</span>
                  <span>$20k</span>
                  <span>$10k</span>
                  <span>$0</span>
                </div>
                <div className="ml-12 h-full overflow-x-auto sm:overflow-visible pr-2">
                  <div className="h-full min-w-[700px] sm:min-w-0 flex items-end justify-between space-x-2">
                    {[
                      45, 52, 58, 62, 68, 72, 78, 82, 88, 92, 96, 100,
                    ].map((h, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div
                          className="w-full bg-gradient-to-t from-pink-500 to-pink-400 rounded-t-lg chart-bar"
                          style={{ height: `${h}%` }}
                        />
                        <span className="text-xs text-slate-500 mt-3">
                          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="mb-6">
                <h3 className="font-semibold text-lg text-slate-900">
                  Tenant Distribution
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  By subscription plan
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-pink-500 rounded" />
                      <span className="text-sm font-medium text-slate-700">
                        Pro
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      68
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-pink-500 h-2 rounded-full" style={{ width: "48%" }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    AU$149/mo • 48% of total
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-blue-500 rounded" />
                      <span className="text-sm font-medium text-slate-700">
                        Starter
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      52
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: "37%" }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    AU$99/mo • 37% of total
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-amber-500 rounded" />
                      <span className="text-sm font-medium text-slate-700">
                        Enterprise
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      22
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-amber-500 h-2 rounded-full" style={{ width: "15%" }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    AU$299/mo • 15% of total
                  </p>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Total Active</span>
                  <span className="text-lg font-bold text-slate-900">142</span>
                </div>
              </div>
            </div>
          </div>
          <div id="activity-section" className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">Recent Signups</h3>
                  <p className="text-sm text-slate-500 mt-1">Latest salon onboarding activity</p>
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
    </div>
  );
}


