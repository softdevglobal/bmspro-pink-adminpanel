"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { logTenantPlanChanged } from "@/lib/auditLog";

type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  branches: number;
  staff: number;
  features: string[];
  popular?: boolean;
  color: string;
  icon: string;
};

const PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 99,
    priceLabel: "AU$99/mo",
    branches: 1,
    staff: 1,
    features: [
      "1 Branch Location",
      "1 Staff Member",
      "Admin Account Included",
      "Basic Booking System",
      "Customer Management",
      "Email Support"
    ],
    color: "blue",
    icon: "fa-star"
  },
  {
    id: "pro",
    name: "Pro",
    price: 149,
    priceLabel: "AU$149/mo",
    branches: 3,
    staff: 10,
    features: [
      "Up to 3 Branch Locations",
      "Up to 10 Staff Members",
      "Admin Account Included",
      "Advanced Booking System",
      "Customer Management",
      "Staff Management",
      "Analytics Dashboard",
      "Priority Email Support"
    ],
    popular: true,
    color: "pink",
    icon: "fa-crown"
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 299,
    priceLabel: "AU$299/mo",
    branches: -1, // Unlimited
    staff: -1, // Unlimited
    features: [
      "Unlimited Branch Locations",
      "Unlimited Staff Members",
      "Admin Account Included",
      "Advanced Booking System",
      "Customer Management",
      "Staff Management",
      "Advanced Analytics",
      "Custom Integrations",
      "Dedicated Support",
      "Custom Features"
    ],
    color: "purple",
    icon: "fa-building"
  }
];

export default function PackagesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState<SubscriptionPlan | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<{ uid: string; name: string } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);

        // Check if user is super admin
        const superAdminDoc = await getDoc(doc(db, "super_admins", user.uid));
        
        if (!superAdminDoc.exists()) {
          router.replace("/dashboard");
          return;
        }

        const superAdminData = superAdminDoc.data();
        setCurrentAdmin({
          uid: user.uid,
          name: superAdminData?.displayName || superAdminData?.name || user.email || "Super Admin"
        });

        setLoading(false);
      } catch (error) {
        console.error("Error checking auth:", error);
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  // Fetch all tenants
  useEffect(() => {
    if (loading) return;

    const tenantsQuery = query(collection(db, "users"), where("role", "==", "salon_owner"));
    const unsub = onSnapshot(
      tenantsQuery,
      (snapshot) => {
        const tenantList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setTenants(tenantList);
      },
      (error) => {
        if (error.code === "permission-denied") {
          console.warn("Permission denied for tenants query.");
          setTenants([]);
        } else {
          console.error("Error in tenants snapshot:", error);
        }
      }
    );

    return () => unsub();
  }, [loading]);

  const handlePlanChange = (tenantId: string, plan: SubscriptionPlan) => {
    setConfirmingPlan(plan);
  };

  const confirmPlanChange = async () => {
    if (!selectedTenant || !confirmingPlan || updating) return;
    
    setUpdating(true);
    try {
      const tenant = tenants.find(t => t.id === selectedTenant);
      const previousPlan = tenant?.plan || "None";
      
      await updateDoc(doc(db, "users", selectedTenant), {
        plan: confirmingPlan.name,
        price: confirmingPlan.priceLabel,
        updatedAt: serverTimestamp(),
      });
      
      // Log plan change to super admin audit logs
      if (currentAdmin) {
        try {
          await logTenantPlanChanged(
            selectedTenant,
            tenant?.name || "Unknown Tenant",
            previousPlan,
            confirmingPlan.name,
            currentAdmin
          );
        } catch (auditError) {
          console.warn("Failed to create audit log:", auditError);
        }
      }
      
      setConfirmingPlan(null);
      setSelectedTenant(null);
      // Show success message
      alert(`✅ Successfully updated ${tenant?.name || "tenant"} to ${confirmingPlan.name} plan`);
    } catch (error: any) {
      console.error("Error updating plan:", error);
      alert(`❌ Failed to update plan: ${error.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const cancelPlanChange = () => {
    setConfirmingPlan(null);
  };

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
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

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <i className="fas fa-circle-notch fa-spin text-4xl text-pink-500" />
                <p className="text-slate-500 font-medium">Loading packages...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="mb-8">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                      <i className="fas fa-box text-2xl" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">Subscription Packages</h1>
                      <p className="text-sm text-white/80 mt-1">Manage subscription plans for tenants</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {PLANS.map((plan) => {
                  const planTenants = tenants.filter((t: any) => (t.plan || "").toLowerCase() === plan.name.toLowerCase());
                  return (
                    <div key={plan.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          plan.color === "blue" ? "bg-blue-50" : plan.color === "pink" ? "bg-pink-50" : "bg-purple-50"
                        }`}>
                          <i className={`fas ${plan.icon} ${
                            plan.color === "blue" ? "text-blue-500" : plan.color === "pink" ? "text-pink-500" : "text-purple-500"
                          }`} />
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          plan.color === "blue" ? "bg-blue-50 text-blue-700" : plan.color === "pink" ? "bg-pink-50 text-pink-700" : "bg-purple-50 text-purple-700"
                        }`}>
                          {planTenants.length} {planTenants.length === 1 ? "Tenant" : "Tenants"}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                      <p className="text-2xl font-bold text-slate-900 mb-2">{plan.priceLabel}</p>
                      <p className="text-sm text-slate-500">
                        {plan.branches === -1 ? "Unlimited" : plan.branches} {plan.branches === 1 ? "Branch" : "Branches"} • {" "}
                        {plan.staff === -1 ? "Unlimited" : plan.staff} {plan.staff === 1 ? "Staff" : "Staff"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Subscription Plans */}
              <div className="mb-8">
                <h2 className="text-xl font-bold text-slate-900 mb-6">Available Plans</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {PLANS.map((plan) => (
                    <div
                      key={plan.id}
                      className={`bg-white rounded-2xl p-6 shadow-sm border-2 ${
                        plan.popular ? "border-pink-500" : "border-slate-200"
                      } hover:shadow-lg transition-all relative`}
                    >
                      {plan.popular && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pink-500 text-white text-xs font-bold px-4 py-1 rounded-full">
                          Most Popular
                        </div>
                      )}
                      <div className="text-center mb-6">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                          plan.color === "blue" ? "bg-blue-50" : plan.color === "pink" ? "bg-pink-50" : "bg-purple-50"
                        }`}>
                          <i className={`fas ${plan.icon} text-2xl ${
                            plan.color === "blue" ? "text-blue-500" : plan.color === "pink" ? "text-pink-500" : "text-purple-500"
                          }`} />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                        <div className="text-4xl font-bold text-slate-900 mb-1">
                          AU${plan.price}
                          <span className="text-lg font-normal text-slate-500">/mo</span>
                        </div>
                        <p className="text-sm text-slate-500">
                          {plan.branches === -1 ? "Unlimited" : plan.branches} {plan.branches === 1 ? "Branch" : "Branches"} • {" "}
                          {plan.staff === -1 ? "Unlimited" : plan.staff} {plan.staff === 1 ? "Staff" : "Staff"}
                        </p>
                      </div>
                      <ul className="space-y-3 mb-6">
                        {plan.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <i className="fas fa-check text-emerald-500 mt-1 flex-shrink-0" />
                            <span className="text-sm text-slate-700">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tenant Plan Management */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="p-6 border-b border-slate-200">
                  <h2 className="text-xl font-bold text-slate-900">Manage Tenant Subscriptions</h2>
                  <p className="text-sm text-slate-500 mt-1">Update subscription plans for individual tenants</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">Tenant</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">Current Plan</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">Status</th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {tenants.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                            No tenants found
                          </td>
                        </tr>
                      ) : (
                        tenants.map((tenant: any) => {
                          const initials = (tenant.name || "?")
                            .split(" ")
                            .map((s: string) => s[0])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join("")
                            .toUpperCase();
                          const currentPlan = PLANS.find(p => p.name.toLowerCase() === (tenant.plan || "").toLowerCase());
                          const statusLower = (tenant.status || "").toLowerCase();
                          const statusCls = statusLower.includes("suspend")
                            ? "bg-rose-50 text-rose-700"
                            : statusLower.includes("active")
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700";

                          return (
                            <tr key={tenant.id} className="hover:bg-slate-50 transition">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-pink-400 to-pink-600 rounded-lg flex items-center justify-center">
                                    <span className="text-white font-semibold text-sm">{initials}</span>
                                  </div>
                                  <div>
                                    <p className="font-medium text-slate-900">{tenant.name || "Unknown"}</p>
                                    <p className="text-xs text-slate-500">{tenant.email || ""}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                {currentPlan ? (
                                  <div className="flex items-center gap-2">
                                    <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                                      currentPlan.color === "blue" ? "bg-blue-50 text-blue-700" : 
                                      currentPlan.color === "pink" ? "bg-pink-50 text-pink-700" : 
                                      "bg-purple-50 text-purple-700"
                                    }`}>
                                      {currentPlan.name}
                                    </span>
                                    <span className="text-sm text-slate-500">{tenant.price || currentPlan.priceLabel}</span>
                                  </div>
                                ) : (
                                  <span className="text-sm text-slate-400">No plan assigned</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-3 py-1 ${statusCls} rounded-lg text-sm font-medium`}>
                                  {tenant.status || "Active"}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => setSelectedTenant(selectedTenant === tenant.id ? null : tenant.id)}
                                  className="px-4 py-2 text-sm font-medium text-pink-600 hover:bg-pink-50 rounded-lg transition"
                                >
                                  {selectedTenant === tenant.id ? "Cancel" : "Change Plan"}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Plan Selection Modal */}
              {selectedTenant && (
                <div className="fixed inset-0 z-50">
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !updating && setSelectedTenant(null)} />
                  <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto relative">
                      {/* Header */}
                      <div className="bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-5 rounded-t-2xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                              <i className="fas fa-crown" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold">Change Subscription Plan</h3>
                              <p className="text-xs text-white/80 mt-0.5">
                                {tenants.find(t => t.id === selectedTenant)?.name || "Tenant"}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => !updating && setSelectedTenant(null)}
                            disabled={updating}
                            className="w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition disabled:opacity-50"
                          >
                            <i className="fas fa-times text-sm" />
                          </button>
                        </div>
                      </div>

                      {/* Current Plan Info - Compact */}
                      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
                        {(() => {
                          const tenant = tenants.find(t => t.id === selectedTenant);
                          const currentPlan = PLANS.find(p => p.name.toLowerCase() === (tenant?.plan || "").toLowerCase());
                          return currentPlan ? (
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                currentPlan.color === "blue" ? "bg-blue-100" : currentPlan.color === "pink" ? "bg-pink-100" : "bg-purple-100"
                              }`}>
                                <i className={`fas ${currentPlan.icon} text-xs ${
                                  currentPlan.color === "blue" ? "text-blue-600" : currentPlan.color === "pink" ? "text-pink-600" : "text-purple-600"
                                }`} />
                              </div>
                              <span className="text-xs text-slate-500">Current:</span>
                              <span className="font-semibold text-slate-900">{currentPlan.name}</span>
                              <span className="text-xs text-slate-500">•</span>
                              <span className="text-sm text-slate-600">{tenant?.price || currentPlan.priceLabel}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">No plan currently assigned</div>
                          );
                        })()}
                      </div>

                      {/* Plans Grid - Compact */}
                      <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {PLANS.map((plan) => {
                            const tenant = tenants.find(t => t.id === selectedTenant);
                            const isCurrentPlan = (tenant?.plan || "").toLowerCase() === plan.name.toLowerCase();
                            
                            return (
                              <div
                                key={plan.id}
                                className={`relative rounded-xl border-2 transition-all ${
                                  isCurrentPlan
                                    ? "border-pink-500 bg-gradient-to-br from-pink-50 to-pink-100 shadow-md"
                                    : plan.popular
                                    ? "border-pink-300 bg-white hover:border-pink-500 hover:shadow-lg"
                                    : "border-slate-200 bg-white hover:border-pink-300 hover:shadow-md"
                                }`}
                              >
                                {plan.popular && !isCurrentPlan && (
                                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-md">
                                    Popular
                                  </div>
                                )}
                                {isCurrentPlan && (
                                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-pink-500 text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-md flex items-center gap-1">
                                    <i className="fas fa-check-circle text-[8px]" />
                                    Current
                                  </div>
                                )}
                                
                                <div className="p-4">
                                  {/* Plan Header - Compact */}
                                  <div className="text-center mb-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-2 ${
                                      plan.color === "blue" ? "bg-blue-100" : plan.color === "pink" ? "bg-pink-100" : "bg-purple-100"
                                    }`}>
                                      <i className={`fas ${plan.icon} ${
                                        plan.color === "blue" ? "text-blue-600" : plan.color === "pink" ? "text-pink-600" : "text-purple-600"
                                      }`} />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-900 mb-1">{plan.name}</h4>
                                    <div className="mb-2">
                                      <span className="text-3xl font-bold text-slate-900">AU${plan.price}</span>
                                      <span className="text-sm text-slate-500">/mo</span>
                                    </div>
                                    <div className="text-xs text-slate-600">
                                      {plan.branches === -1 ? "∞" : plan.branches} {plan.branches === 1 ? "Branch" : "Branches"} • {" "}
                                      {plan.staff === -1 ? "∞" : plan.staff} {plan.staff === 1 ? "Staff" : "Staff"}
                                    </div>
                                  </div>

                                  {/* Action Button */}
                                  {isCurrentPlan ? (
                                    <div className="w-full py-2.5 px-4 rounded-lg bg-slate-100 text-slate-500 text-xs font-semibold text-center cursor-not-allowed">
                                      Current Plan
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handlePlanChange(selectedTenant!, plan)}
                                      disabled={updating}
                                      className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:from-pink-700 hover:to-fuchsia-700 text-white text-xs font-semibold transition-all shadow-md shadow-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                    >
                                      <i className="fas fa-arrow-right text-[10px]" />
                                      Switch to {plan.name}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer Note - Compact */}
                      <div className="px-6 pb-5">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <i className="fas fa-info-circle text-amber-600 text-xs mt-0.5" />
                            <p className="text-xs text-amber-800">
                              <span className="font-semibold">Note:</span> Changes take effect immediately. Tenant will be notified.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Confirmation Modal */}
              {confirmingPlan && selectedTenant && (
                <div className="fixed inset-0 z-[60]">
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={cancelPlanChange} />
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                      <div className="p-6 border-b border-slate-200">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                            <i className="fas fa-exclamation-triangle text-amber-600 text-xl" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">Confirm Plan Change</h3>
                            <p className="text-sm text-slate-500">Are you sure you want to change the subscription plan?</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-6">
                        {(() => {
                          const tenant = tenants.find(t => t.id === selectedTenant);
                          const currentPlan = PLANS.find(p => p.name.toLowerCase() === (tenant?.plan || "").toLowerCase());
                          
                          return (
                            <div className="space-y-4">
                              <div className="bg-slate-50 rounded-xl p-4">
                                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Tenant</p>
                                <p className="font-semibold text-slate-900">{tenant?.name || "Unknown"}</p>
                              </div>
                              
                              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">Current Plan</p>
                                  <p className="font-semibold text-slate-900">{currentPlan?.name || "No Plan"}</p>
                                  <p className="text-sm text-slate-500">{currentPlan?.priceLabel || "—"}</p>
                                </div>
                                <i className="fas fa-arrow-right text-slate-400 text-xl mx-4" />
                                <div>
                                  <p className="text-xs text-slate-500 mb-1">New Plan</p>
                                  <p className="font-semibold text-slate-900">{confirmingPlan.name}</p>
                                  <p className="text-sm text-slate-500">{confirmingPlan.priceLabel}</p>
                                </div>
                              </div>

                              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <div className="flex items-start gap-2">
                                  <i className="fas fa-info-circle text-blue-600 mt-0.5" />
                                  <p className="text-sm text-blue-800">
                                    This change will take effect immediately. The tenant will be notified of the plan update.
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
                        <button
                          onClick={cancelPlanChange}
                          disabled={updating}
                          className="px-5 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmPlanChange}
                          disabled={updating}
                          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:from-pink-700 hover:to-fuchsia-700 text-white text-sm font-semibold transition-all shadow-lg shadow-pink-500/25 disabled:opacity-50 flex items-center gap-2"
                        >
                          {updating ? (
                            <>
                              <i className="fas fa-circle-notch fa-spin" />
                              Updating...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-check" />
                              Confirm Change
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
