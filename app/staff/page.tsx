"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

type StaffRow = {
  initials: string;
  name: string;
  role: string;
  state: "NSW" | "VIC" | "QLD" | "WA";
  stateCls: string;
  badgeFrom: string;
  badgeTo: string;
  status: "Active" | "Onboarding" | "Inactive";
  statusCls: string;
  statusIcon: string;
};

const STAFF: StaffRow[] = [
  {
    initials: "AS",
    name: "Alice Summers",
    role: "Senior Stylist",
    state: "NSW",
    stateCls: "bg-blue-50 text-blue-700",
    badgeFrom: "from-pink-400",
    badgeTo: "to-pink-600",
    status: "Active",
    statusCls: "bg-emerald-50 text-emerald-700",
    statusIcon: "fa-check-circle",
  },
  {
    initials: "BM",
    name: "Ben Matthews",
    role: "Color Specialist",
    state: "VIC",
    stateCls: "bg-purple-50 text-purple-700",
    badgeFrom: "from-purple-400",
    badgeTo: "to-purple-600",
    status: "Onboarding",
    statusCls: "bg-amber-50 text-amber-700",
    statusIcon: "fa-clock",
  },
  {
    initials: "CG",
    name: "Chloe Grant",
    role: "Reception",
    state: "QLD",
    stateCls: "bg-orange-50 text-orange-700",
    badgeFrom: "from-amber-400",
    badgeTo: "to-amber-600",
    status: "Active",
    statusCls: "bg-emerald-50 text-emerald-700",
    statusIcon: "fa-check-circle",
  },
  {
    initials: "DP",
    name: "Daniel Price",
    role: "Barber",
    state: "WA",
    stateCls: "bg-indigo-50 text-indigo-700",
    badgeFrom: "from-teal-400",
    badgeTo: "to-teal-600",
    status: "Inactive",
    statusCls: "bg-rose-50 text-rose-700",
    statusIcon: "fa-circle-xmark",
  },
];

export default function StaffPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  const stepIndicatorClass = (step: 1 | 2 | 3) => {
    const base =
      "w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm";
    if (currentStep === step) return `${base} bg-pink-600 text-white`;
    if (currentStep > step) return `${base} bg-emerald-500 text-white`;
    return `${base} bg-slate-200 text-slate-500`;
  };

  const openModal = () => {
    setIsModalOpen(true);
    setCurrentStep(1);
    setVerified(false);
    setIsVerifying(false);
  };

  const closeModal = () => setIsModalOpen(false);

  const goNext = () => {
    if (currentStep < 3) setCurrentStep((s) => ((s + 1) as 1 | 2 | 3));
    else closeModal();
  };
  const goBack = () => {
    if (currentStep > 1) setCurrentStep((s) => ((s - 1) as 1 | 2 | 3));
  };

  const nextCtaLabel = useMemo(() => {
    return currentStep === 3 ? "Complete Onboarding" : "Next Step";
  }, [currentStep]);

  useEffect(() => {
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
        return;
      }
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      const role = (snap.data()?.role || "").toString();
      if (role !== "salon_owner") router.replace("/dashboard");
    });
    return () => unsub();
  }, [router]);

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
                      <i className="fas fa-users" />
                    </div>
                    <h1 className="text-2xl font-bold">Staff Management</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Manage staff profiles, roles, and onboarding
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div id="stats-section" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 min-w-0">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Total Staff</span>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-users text-blue-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">48</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-up text-xs mr-1" />
                  +3
                </span>
                <span className="text-xs text-slate-500">this month</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Active Staff</span>
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-check text-emerald-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">42</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-plus text-xs mr-1" />
                  +2
                </span>
                <span className="text-xs text-slate-500">this week</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">New Hires</span>
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-plus text-amber-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">5</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-semibold">
                  Onboarding
                </span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Turnover</span>
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-minus text-rose-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">0.8%</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-down text-xs mr-1" />
                  -0.1%
                </span>
                <span className="text-xs text-slate-500">vs last month</span>
              </div>
            </div>
          </div>

          <div id="staff-table-section" className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-200">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">Staff Management</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage roles, states and status</p>
                </div>
                <button
                  className="w-full sm:w-auto px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition flex items-center justify-center sm:justify-start space-x-2"
                  onClick={openModal}
                >
                  <i className="fas fa-user-plus text-sm" />
                  <span>Onboard New Staff</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {STAFF.map((s) => (
                    <tr key={s.name} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 bg-gradient-to-br ${s.badgeFrom} ${s.badgeTo} rounded-lg flex items-center justify-center`}>
                            <span className="text-white font-semibold text-sm">{s.initials}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{s.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-700">{s.role}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 ${s.stateCls} rounded-lg text-sm font-medium`}>{s.state}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 ${s.statusCls} rounded-lg text-sm font-medium flex items-center w-fit`}>
                          <i className={`fas ${s.statusIcon} text-xs mr-1.5`} />
                          {s.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition" title="View">
                            <i className="fas fa-eye text-sm" />
                          </button>
                          <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition" title="Edit">
                            <i className="fas fa-edit text-sm" />
                          </button>
                          <button className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Remove">
                            <i className="fas fa-trash text-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
              <div className="px-8 py-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Onboard New Staff</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Add a new staff member to the platform
                    </p>
                  </div>
                  <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg transition">
                    <i className="fas fa-times text-slate-400" />
                  </button>
                </div>
                <div className="flex items-center space-x-4 mt-6">
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(1)}>1</div>
                    <span className="ml-2 text-sm font-medium text-slate-900">Personal</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(2)}>2</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Role & Location</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(3)}>3</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Account</span>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6 overflow-y-auto flex-1">
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">First Name *</label>
                        <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="e.g., Alice" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Last Name *</label>
                        <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="e.g., Summers" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Email *</label>
                      <input type="email" className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="alice@salon.com.au" />
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Role *</label>
                        <select className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent">
                          <option>Select role</option>
                          <option>Senior Stylist</option>
                          <option>Stylist</option>
                          <option>Color Specialist</option>
                          <option>Reception</option>
                          <option>Barber</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Location *</label>
                        <select className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent">
                          <option>Select state</option>
                          <option>NSW</option>
                          <option>VIC</option>
                          <option>QLD</option>
                          <option>WA</option>
                          <option>SA</option>
                          <option>TAS</option>
                          <option>ACT</option>
                          <option>NT</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-slate-900">Full-time</p>
                        <p className="text-sm text-slate-500 mt-1">Toggle to set staff as full-time</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-pink-500 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                      </label>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Username *</label>
                      <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="alice.summers" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Temporary Password *</label>
                        <input type="password" className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="••••••••" />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => {
                            setIsVerifying(true);
                            setTimeout(() => {
                              setIsVerifying(false);
                              setVerified(true);
                            }, 1000);
                          }}
                          className="px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
                        >
                          {isVerifying ? "Generating..." : "Generate Strong Password"}
                        </button>
                      </div>
                    </div>
                    {verified && (
                      <p className="text-sm text-emerald-600">Strong password generated.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-8 py-6 border-t border-slate-200 flex items-center justify-between">
                <button
                  onClick={goBack}
                  className={`px-6 py-3 text-slate-700 font-semibold hover:bg-slate-100 rounded-lg transition ${
                    currentStep === 1 ? "invisible" : ""
                  }`}
                >
                  <i className="fas fa-arrow-left mr-2" />
                  Back
                </button>
                <div className="flex-1" />
                <button
                  onClick={closeModal}
                  className="px-6 py-3 text-slate-700 font-semibold hover:bg-slate-100 rounded-lg transition mr-3"
                >
                  Cancel
                </button>
                <button
                  onClick={goNext}
                  className="px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition"
                >
                  {nextCtaLabel} <i className="fas fa-arrow-right ml-2" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


