"use client";
import React, { useMemo, useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";

type TenantRow = {
  initials: string;
  name: string;
  subtitle: string;
  abn: string | "PENDING";
  abnStatus: "verified" | "pending";
  state: "NSW" | "VIC" | "QLD" | "WA";
  stateCls: string;
  badgeFrom: string;
  badgeTo: string;
  plan: "Starter" | "Pro" | "Enterprise";
  price: string;
  status: "Active" | "Pending ABN" | "Provisioning";
  statusCls: string;
  statusIcon: string;
};

const TENANTS: TenantRow[] = [
  {
    initials: "BG",
    name: "Bondi Glow Studio",
    subtitle: "Premium Beauty & Wellness",
    abn: "12 345 678 901",
    abnStatus: "verified",
    state: "NSW",
    stateCls: "bg-blue-50 text-blue-700",
    badgeFrom: "from-pink-400",
    badgeTo: "to-pink-600",
    plan: "Pro",
    price: "AU$149/mo",
    status: "Active",
    statusCls: "bg-emerald-50 text-emerald-700",
    statusIcon: "fa-check-circle",
  },
  {
    initials: "MC",
    name: "Melbourne Cuts Pty Ltd",
    subtitle: "Professional Hair Styling",
    abn: "98 765 432 109",
    abnStatus: "verified",
    state: "VIC",
    stateCls: "bg-purple-50 text-purple-700",
    badgeFrom: "from-purple-400",
    badgeTo: "to-purple-600",
    plan: "Enterprise",
    price: "AU$299/mo",
    status: "Active",
    statusCls: "bg-emerald-50 text-emerald-700",
    statusIcon: "fa-check-circle",
  },
  {
    initials: "GC",
    name: "Gold Coast Beauty Bar",
    subtitle: "Luxury Beauty Services",
    abn: "PENDING",
    abnStatus: "pending",
    state: "QLD",
    stateCls: "bg-orange-50 text-orange-700",
    badgeFrom: "from-amber-400",
    badgeTo: "to-amber-600",
    plan: "Starter",
    price: "AU$99/mo",
    status: "Pending ABN",
    statusCls: "bg-amber-50 text-amber-700",
    statusIcon: "fa-clock",
  },
  {
    initials: "PS",
    name: "Perth Style Studio",
    subtitle: "Modern Hair & Beauty",
    abn: "55 123 456 789",
    abnStatus: "verified",
    state: "WA",
    stateCls: "bg-indigo-50 text-indigo-700",
    badgeFrom: "from-teal-400",
    badgeTo: "to-teal-600",
    plan: "Pro",
    price: "AU$149/mo",
    status: "Provisioning",
    statusCls: "bg-blue-50 text-blue-700",
    statusIcon: "fa-cog",
  },
];

export default function TenantsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [isVerifyingAbn, setIsVerifyingAbn] = useState(false);
  const [abnVerified, setAbnVerified] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "pro" | "enterprise" | null>(
    null
  );

  const stepIndicatorClass = (step: 1 | 2 | 3) => {
    const base =
      "step-indicator w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm";
    if (currentStep === step) return `${base} bg-pink-600 text-white`;
    if (currentStep > step) return `${base} bg-emerald-500 text-white`;
    return `${base} bg-slate-200 text-slate-500`;
  };

  const openOnboardModal = () => {
    setIsModalOpen(true);
    setCurrentStep(1);
    setSelectedPlan(null);
    setAbnVerified(false);
    setIsVerifyingAbn(false);
  };

  const closeOnboardModal = () => {
    setIsModalOpen(false);
  };

  const goNext = () => {
    if (currentStep < 3) setCurrentStep((s) => ((s + 1) as 1 | 2 | 3));
    else closeOnboardModal();
  };

  const goBack = () => {
    if (currentStep > 1) setCurrentStep((s) => ((s - 1) as 1 | 2 | 3));
  };

  const verifyAbn = () => {
    setIsVerifyingAbn(true);
    setTimeout(() => {
      setIsVerifyingAbn(false);
      setAbnVerified(true);
    }, 1500);
  };

  const nextCtaLabel = useMemo(() => {
    return currentStep === 3 ? "Complete Onboarding" : "Next Step";
  }, [currentStep]);

  useEffect(() => {
    const authed = typeof window !== "undefined" && localStorage.getItem("auth");
    if (!authed) {
      router.replace("/login");
    }
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
                      <i className="fas fa-store" />
                    </div>
                    <h1 className="text-2xl font-bold">Tenant Management</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Manage salon subscriptions and compliance
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div id="stats-section" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 min-w-0">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Total Tenants</span>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-store text-blue-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">156</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-up text-xs mr-1" />
                  +8
                </span>
                <span className="text-xs text-slate-500">this month</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Active Pro Users</span>
                <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-crown text-pink-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">68</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-plus text-xs mr-1" />
                  +12
                </span>
                <span className="text-xs text-slate-500">upgrades this week</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Pending ABN</span>
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-clock text-amber-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">7</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-semibold">
                  Requires attention
                </span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Churn Rate</span>
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-minus text-rose-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">1.8%</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-down text-xs mr-1" />
                  -0.3%
                </span>
                <span className="text-xs text-slate-500">vs last month</span>
              </div>
            </div>
          </div>

          <div id="tenant-table-section" className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-200">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">Tenant Management</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage salon subscriptions and compliance</p>
                </div>
                <button
                  className="w-full sm:w-auto px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition flex items-center justify-center sm:justify-start space-x-2"
                  onClick={openOnboardModal}
                >
                  <i className="fas fa-plus text-sm" />
                  <span>Onboard New Salon</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Business Name
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      ABN
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Plan
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
                  {TENANTS.map((t) => (
                    <tr key={t.name} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-10 h-10 bg-gradient-to-br ${t.badgeFrom} ${t.badgeTo} rounded-lg flex items-center justify-center`}
                          >
                            <span className="text-white font-semibold text-sm">{t.initials}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{t.name}</p>
                            <p className="text-xs text-slate-500">{t.subtitle}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {t.abn === "PENDING" ? (
                          <div className="font-mono text-sm text-amber-600">Pending Verification</div>
                        ) : (
                          <div className="font-mono text-sm text-slate-700">{t.abn}</div>
                        )}
                        <div className="flex items-center space-x-1 mt-1">
                          {t.abnStatus === "verified" ? (
                            <>
                              <i className="fas fa-check-circle text-emerald-500 text-xs" />
                              <span className="text-xs text-emerald-600">Verified</span>
                            </>
                          ) : (
                            <>
                              <i className="fas fa-clock text-amber-500 text-xs" />
                              <span className="text-xs text-amber-600">Awaiting ABN</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 ${t.stateCls} rounded-lg text-sm font-medium`}>
                          {t.state}
                        </span>
                        <p className="text-xs text-slate-500 mt-1">
                          {t.state === "NSW" && "Bondi Beach, 2026"}
                          {t.state === "VIC" && "South Yarra, 3141"}
                          {t.state === "QLD" && "Surfers Paradise, 4217"}
                          {t.state === "WA" && "Fremantle, 6160"}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <span className="px-3 py-1 bg-pink-50 text-pink-700 rounded-lg text-sm font-semibold">
                            {t.plan}
                          </span>
                          <span className="text-sm text-slate-500">{t.price}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 ${t.statusCls} rounded-lg text-sm font-medium flex items-center w-fit`}
                        >
                          <i className={`fas ${t.statusIcon} text-xs mr-1.5`} />
                          {t.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
                            <i className="fas fa-eye text-sm" />
                          </button>
                          <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
                            <i className="fas fa-edit text-sm" />
                          </button>
                          <button className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition">
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
          <div className="absolute inset-0 bg-black/50" onClick={closeOnboardModal} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
              <div className="px-8 py-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Onboard New Salon</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Setup a new tenant with Australian compliance
                    </p>
                  </div>
                  <button onClick={closeOnboardModal} className="p-2 hover:bg-slate-100 rounded-lg transition">
                    <i className="fas fa-times text-slate-400" />
                  </button>
                </div>
                <div className="flex items-center space-x-4 mt-6">
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(1)}>1</div>
                    <span className="ml-2 text-sm font-medium text-slate-900">Business Entity</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(2)}>2</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Location & Contact</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(3)}>3</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Subscription</span>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6 overflow-y-auto flex-1">
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Business Name *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., Sydney Style Studio"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Australian Business Number (ABN) *
                      </label>
                      <div className="flex space-x-3">
                        <input
                          id="abn-input"
                          type="text"
                          placeholder="12 345 678 901"
                          maxLength={14}
                          className={`flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent font-mono ${
                            abnVerified ? "border-emerald-300" : "border-slate-300"
                          }`}
                        />
                        <button
                          disabled={isVerifyingAbn}
                          onClick={verifyAbn}
                          className="px-6 py-3 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition flex items-center space-x-2 disabled:opacity-60"
                        >
                          <i className="fas fa-check-circle" />
                          <span>{isVerifyingAbn ? "Verifying..." : "Verify"}</span>
                        </button>
                      </div>
                      {abnVerified && (
                        <div className="mt-2 text-sm text-emerald-600">ABN verified successfully!</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Business Structure *
                      </label>
                      <select className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent">
                        <option>Select structure</option>
                        <option>Pty Ltd</option>
                        <option>Sole Trader</option>
                        <option>Partnership</option>
                        <option>Trust</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-slate-900">Registered for GST?</p>
                        <p className="text-sm text-slate-500 mt-1">
                          Required for businesses with turnover over AU$75,000
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-pink-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500" />
                      </label>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Business Address *
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Street address"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          State *
                        </label>
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
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Postcode *
                        </label>
                        <input
                          type="text"
                          placeholder="2000"
                          maxLength={4}
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Contact Phone *
                      </label>
                      <div className="flex space-x-3">
                        <input
                          type="text"
                          value="+61"
                          readOnly
                          className="w-16 px-3 py-3 bg-slate-100 border border-slate-300 rounded-lg font-mono text-center"
                        />
                        <input
                          type="text"
                          placeholder="412 345 678"
                          className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Contact Email *
                      </label>
                      <input
                        type="email"
                        placeholder="contact@salon.com.au"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-6">
                    <p className="text-sm text-slate-600">
                      Select a subscription plan for this tenant
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        {
                          key: "starter" as const,
                          iconCls: "fa-star text-blue-600",
                          iconWrapCls: "bg-blue-100",
                          title: "Starter",
                          price: "$99",
                          features: ["Basic features", "1 location"],
                        },
                        {
                          key: "pro" as const,
                          iconCls: "fa-crown text-pink-600",
                          iconWrapCls: "bg-pink-100",
                          title: "Pro",
                          price: "$149",
                          features: ["All features", "3 locations"],
                        },
                        {
                          key: "enterprise" as const,
                          iconCls: "fa-building text-amber-600",
                          iconWrapCls: "bg-amber-100",
                          title: "Enterprise",
                          price: "$299",
                          features: ["Premium support", "Unlimited"],
                        },
                      ].map((p) => {
                        const isSelected = selectedPlan === p.key;
                        return (
                          <button
                            key={p.key}
                            onClick={() => setSelectedPlan(p.key)}
                            className={`text-left border-2 rounded-xl p-5 transition ${
                              isSelected
                                ? "border-pink-400 bg-pink-50"
                                : "border-slate-200 hover:border-pink-300"
                            }`}
                          >
                            <div className="text-center">
                              <div
                                className={`w-12 h-12 ${p.iconWrapCls} rounded-full flex items-center justify-center mx-auto mb-3`}
                              >
                                <i className={`fas ${p.iconCls}`} />
                              </div>
                              <h4 className="font-bold text-slate-900 mb-2">{p.title}</h4>
                              <div className="text-3xl font-bold text-slate-900 mb-1">
                                {p.price}
                              </div>
                              <p className="text-sm text-slate-500">per month</p>
                              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                                {p.features.map((f) => (
                                  <li key={f} className="flex items-center justify-center">
                                    <i className="fas fa-check text-emerald-500 mr-2 text-xs" />
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800">
                        <i className="fas fa-info-circle mr-2" />
                        Invoice will be generated upon tenant activation
                      </p>
                    </div>
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
                  onClick={closeOnboardModal}
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


