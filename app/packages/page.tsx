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
  active?: boolean;
};

export default function PackagesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState<SubscriptionPlan | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<{ uid: string; name: string } | null>(null);
  
  // Package management states
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [editingPackage, setEditingPackage] = useState<SubscriptionPlan | null>(null);
  const [deletingPackage, setDeletingPackage] = useState<SubscriptionPlan | null>(null);
  const [savingPackage, setSavingPackage] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    priceLabel: "",
    branches: "1",
    staff: "1",
    unlimitedBranches: false,
    unlimitedStaff: false,
    features: "",
    popular: false,
    color: "blue",
    icon: "fa-star",
    active: true,
  });

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

  // Fetch packages from API
  useEffect(() => {
    if (loading) return;
    
    const fetchPackages = async () => {
      try {
        setPackagesLoading(true);
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch("/api/packages", {
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setPlans(data.plans || []);
          }
        } else {
          console.error("Failed to fetch packages");
        }
      } catch (error) {
        console.error("Error fetching packages:", error);
      } finally {
        setPackagesLoading(false);
      }
    };

    fetchPackages();
  }, [loading]);

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

  // Package CRUD functions
  const openCreatePackage = () => {
    setFormData({
      name: "",
      price: "",
      priceLabel: "",
      branches: "1",
      staff: "1",
      unlimitedBranches: false,
      unlimitedStaff: false,
      features: "",
      popular: false,
      color: "blue",
      icon: "fa-star",
      active: true,
    });
    setEditingPackage(null);
    setShowPackageForm(true);
  };

  const openEditPackage = (pkg: SubscriptionPlan) => {
    const isUnlimitedBranches = pkg.branches === -1;
    const isUnlimitedStaff = pkg.staff === -1;
    setFormData({
      name: pkg.name,
      price: pkg.price.toString(),
      priceLabel: pkg.priceLabel,
      branches: isUnlimitedBranches ? "1" : pkg.branches.toString(),
      staff: isUnlimitedStaff ? "1" : pkg.staff.toString(),
      unlimitedBranches: isUnlimitedBranches,
      unlimitedStaff: isUnlimitedStaff,
      features: pkg.features.join("\n"),
      popular: pkg.popular || false,
      color: pkg.color,
      icon: pkg.icon,
      active: pkg.active !== false,
    });
    setEditingPackage(pkg);
    setShowPackageForm(true);
  };

  const handleSavePackage = async () => {
    if (!formData.name || !formData.price || !formData.priceLabel) {
      alert("Please fill in all required fields (Name, Price, Price Label)");
      return;
    }

    setSavingPackage(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const featuresArray = formData.features
        .split("\n")
        .map(f => f.trim())
        .filter(f => f.length > 0);

      const payload = {
        ...(editingPackage ? { id: editingPackage.id } : {}),
        name: formData.name.trim(),
        price: parseFloat(formData.price),
        priceLabel: formData.priceLabel.trim(),
        branches: formData.unlimitedBranches ? -1 : parseInt(formData.branches, 10),
        staff: formData.unlimitedStaff ? -1 : parseInt(formData.staff, 10),
        features: featuresArray,
        popular: formData.popular,
        color: formData.color,
        icon: formData.icon,
        active: formData.active,
      };

      const url = editingPackage ? "/api/packages" : "/api/packages";
      const method = editingPackage ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh packages
        const refreshResponse = await fetch("/api/packages", {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData.success) {
            setPlans(refreshData.plans || []);
          }
        }
        
        setShowPackageForm(false);
        setEditingPackage(null);
        alert(`✅ Package ${editingPackage ? "updated" : "created"} successfully!`);
      } else {
        alert(`❌ Failed to ${editingPackage ? "update" : "create"} package: ${data.error}`);
      }
    } catch (error: any) {
      console.error("Error saving package:", error);
      alert(`❌ Error: ${error.message}`);
    } finally {
      setSavingPackage(false);
    }
  };

  const handleDeletePackage = async () => {
    if (!deletingPackage) return;

    setSavingPackage(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/packages?id=${deletingPackage.id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        // Refresh packages
        const refreshResponse = await fetch("/api/packages", {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData.success) {
            setPlans(refreshData.plans || []);
          }
        }
        
        setDeletingPackage(null);
        alert("✅ Package deleted successfully!");
      } else {
        alert(`❌ Failed to delete package: ${data.error}`);
      }
    } catch (error: any) {
      console.error("Error deleting package:", error);
      alert(`❌ Error: ${error.message}`);
    } finally {
      setSavingPackage(false);
    }
  };

  const activePlans = plans.filter(p => p.active !== false);

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

          {loading || packagesLoading ? (
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
              {activePlans.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  {activePlans.slice(0, 3).map((plan) => {
                    const planTenants = tenants.filter((t: any) => (t.plan || "").toLowerCase() === plan.name.toLowerCase());
                    return (
                      <div key={plan.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                            plan.color === "blue" ? "bg-blue-50" : plan.color === "pink" ? "bg-pink-50" : plan.color === "purple" ? "bg-purple-50" : "bg-slate-50"
                          }`}>
                            <i className={`fas ${plan.icon} ${
                              plan.color === "blue" ? "text-blue-500" : plan.color === "pink" ? "text-pink-500" : plan.color === "purple" ? "text-purple-500" : "text-slate-500"
                            }`} />
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            plan.color === "blue" ? "bg-blue-50 text-blue-700" : plan.color === "pink" ? "bg-pink-50 text-pink-700" : plan.color === "purple" ? "bg-purple-50 text-purple-700" : "bg-slate-50 text-slate-700"
                          }`}>
                            {planTenants.length} {planTenants.length === 1 ? "Tenant" : "Tenants"}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                        <p className="text-2xl font-bold text-slate-900 mb-2">{plan.priceLabel}</p>
                        <p className="text-sm text-slate-500">
                          {plan.branches === -1 ? "Unlimited Branches" : `${plan.branches} ${plan.branches === 1 ? "Branch" : "Branches"}`} • {" "}
                          {plan.staff === -1 ? "Unlimited Staff" : `${plan.staff} ${plan.staff === 1 ? "Staff" : "Staff"}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Subscription Plans */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-slate-900">Available Plans</h2>
                  {activePlans.length === 0 && (
                    <button
                      onClick={openCreatePackage}
                      className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-semibold transition flex items-center gap-2"
                    >
                      <i className="fas fa-plus" />
                      Create First Package
                    </button>
                  )}
                </div>
                {activePlans.length === 0 ? (
                  <div className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center">
                    <i className="fas fa-box-open text-5xl text-slate-400 mb-4" />
                    <h3 className="text-xl font-semibold text-slate-700 mb-2">No Packages Yet</h3>
                    <p className="text-slate-500 mb-6">Create your first subscription package to get started.</p>
                    <button
                      onClick={openCreatePackage}
                      className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-xl font-semibold transition inline-flex items-center gap-2"
                    >
                      <i className="fas fa-plus" />
                      Create Package
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {activePlans.map((plan) => (
                      <div
                        key={plan.id}
                        className={`bg-white rounded-2xl p-6 shadow-sm border-2 ${
                          plan.popular ? "border-pink-500" : "border-slate-200"
                        } hover:shadow-lg transition-all relative`}
                      >
                        <div className="absolute top-4 right-4 flex items-center gap-2">
                          <button
                            onClick={() => openEditPackage(plan)}
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition"
                            title="Edit Package"
                          >
                            <i className="fas fa-edit text-xs text-slate-600" />
                          </button>
                          <button
                            onClick={() => setDeletingPackage(plan)}
                            className="w-8 h-8 rounded-lg bg-rose-100 hover:bg-rose-200 flex items-center justify-center transition"
                            title="Delete Package"
                          >
                            <i className="fas fa-trash text-xs text-rose-600" />
                          </button>
                        </div>
                        {plan.popular && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pink-500 text-white text-xs font-bold px-4 py-1 rounded-full">
                            Most Popular
                          </div>
                        )}
                        <div className="text-center mb-6">
                          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                            plan.color === "blue" ? "bg-blue-50" : plan.color === "pink" ? "bg-pink-50" : plan.color === "purple" ? "bg-purple-50" : "bg-slate-50"
                          }`}>
                            <i className={`fas ${plan.icon} text-2xl ${
                              plan.color === "blue" ? "text-blue-500" : plan.color === "pink" ? "text-pink-500" : plan.color === "purple" ? "text-purple-500" : "text-slate-500"
                            }`} />
                          </div>
                          <h3 className="text-2xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                          <div className="text-4xl font-bold text-slate-900 mb-1">
                            {plan.priceLabel}
                          </div>
                          <p className="text-sm text-slate-500">
                            {plan.branches === -1 ? "Unlimited Branches" : `${plan.branches} ${plan.branches === 1 ? "Branch" : "Branches"}`} • {" "}
                            {plan.staff === -1 ? "Unlimited Staff" : `${plan.staff} ${plan.staff === 1 ? "Staff" : "Staff"}`}
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
                )}
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
                          const currentPlan = activePlans.find(p => p.name.toLowerCase() === (tenant.plan || "").toLowerCase());
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
                                      currentPlan.color === "purple" ? "bg-purple-50 text-purple-700" : "bg-slate-50 text-slate-700"
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

              {/* Package Form Modal */}
              {showPackageForm && (
                <div className="fixed inset-0 z-50">
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !savingPackage && setShowPackageForm(false)} />
                  <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-auto relative max-h-[90vh] overflow-y-auto">
                      <div className="sticky top-0 bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-5 rounded-t-2xl z-10">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold">
                            {editingPackage ? "Edit Package" : "Create New Package"}
                          </h3>
                          <button
                            onClick={() => !savingPackage && setShowPackageForm(false)}
                            disabled={savingPackage}
                            className="w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition disabled:opacity-50"
                          >
                            <i className="fas fa-times text-sm" />
                          </button>
                        </div>
                      </div>

                      <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Package Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                              placeholder="e.g., Starter, Pro, Enterprise"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Price <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={formData.price}
                              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                              placeholder="99.00"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Price Label <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={formData.priceLabel}
                            onChange={(e) => setFormData({ ...formData, priceLabel: e.target.value })}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                            placeholder="AU$99/mo"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Branches
                            </label>
                            <div className="space-y-2">
                              <input
                                type="number"
                                value={formData.branches}
                                onChange={(e) => setFormData({ ...formData, branches: e.target.value })}
                                disabled={formData.unlimitedBranches}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:bg-slate-100 disabled:cursor-not-allowed"
                                placeholder="1"
                              />
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.unlimitedBranches}
                                  onChange={(e) => setFormData({ ...formData, unlimitedBranches: e.target.checked })}
                                  className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                                />
                                <span className="text-sm text-slate-700">Unlimited Branches</span>
                              </label>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Staff
                            </label>
                            <div className="space-y-2">
                              <input
                                type="number"
                                value={formData.staff}
                                onChange={(e) => setFormData({ ...formData, staff: e.target.value })}
                                disabled={formData.unlimitedStaff}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:bg-slate-100 disabled:cursor-not-allowed"
                                placeholder="1"
                              />
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.unlimitedStaff}
                                  onChange={(e) => setFormData({ ...formData, unlimitedStaff: e.target.checked })}
                                  className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                                />
                                <span className="text-sm text-slate-700">Unlimited Staff</span>
                              </label>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Features (one per line)
                          </label>
                          <textarea
                            value={formData.features}
                            onChange={(e) => setFormData({ ...formData, features: e.target.value })}
                            rows={6}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                            placeholder="1 Branch Location&#10;1 Staff Member&#10;Admin Account Included"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Color</label>
                            <select
                              value={formData.color}
                              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                            >
                              <option value="blue">Blue</option>
                              <option value="pink">Pink</option>
                              <option value="purple">Purple</option>
                              <option value="green">Green</option>
                              <option value="orange">Orange</option>
                              <option value="teal">Teal</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Icon (Font Awesome)</label>
                            <input
                              type="text"
                              value={formData.icon}
                              onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                              placeholder="fa-star, fa-crown, fa-building"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.popular}
                              onChange={(e) => setFormData({ ...formData, popular: e.target.checked })}
                              className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                            />
                            <span className="text-sm font-semibold text-slate-700">Mark as Popular</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.active}
                              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                              className="w-4 h-4 text-pink-600 rounded focus:ring-pink-500"
                            />
                            <span className="text-sm font-semibold text-slate-700">Active</span>
                          </label>
                        </div>
                      </div>

                      <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
                        <button
                          onClick={() => !savingPackage && setShowPackageForm(false)}
                          disabled={savingPackage}
                          className="px-5 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSavePackage}
                          disabled={savingPackage}
                          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:from-pink-700 hover:to-fuchsia-700 text-white text-sm font-semibold transition-all shadow-lg shadow-pink-500/25 disabled:opacity-50 flex items-center gap-2"
                        >
                          {savingPackage ? (
                            <>
                              <i className="fas fa-circle-notch fa-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-check" />
                              {editingPackage ? "Update Package" : "Create Package"}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete Confirmation Modal */}
              {deletingPackage && (
                <div className="fixed inset-0 z-[60]">
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !savingPackage && setDeletingPackage(null)} />
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                      <div className="p-6 border-b border-slate-200">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center">
                            <i className="fas fa-exclamation-triangle text-rose-600 text-xl" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">Delete Package</h3>
                            <p className="text-sm text-slate-500">Are you sure you want to delete this package?</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-6">
                        <div className="bg-slate-50 rounded-xl p-4">
                          <p className="font-semibold text-slate-900">{deletingPackage.name}</p>
                          <p className="text-sm text-slate-500">{deletingPackage.priceLabel}</p>
                        </div>
                        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                          <div className="flex items-start gap-2">
                            <i className="fas fa-info-circle text-amber-600 mt-0.5" />
                            <p className="text-sm text-amber-800">
                              This action cannot be undone. The package will be permanently deleted.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
                        <button
                          onClick={() => !savingPackage && setDeletingPackage(null)}
                          disabled={savingPackage}
                          className="px-5 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleDeletePackage}
                          disabled={savingPackage}
                          className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-all shadow-lg shadow-rose-500/25 disabled:opacity-50 flex items-center gap-2"
                        >
                          {savingPackage ? (
                            <>
                              <i className="fas fa-circle-notch fa-spin" />
                              Deleting...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-trash" />
                              Delete Package
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Plan Selection Modal (for tenants) */}
              {selectedTenant && (
                <div className="fixed inset-0 z-50">
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !updating && setSelectedTenant(null)} />
                  <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto relative">
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

                      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
                        {(() => {
                          const tenant = tenants.find(t => t.id === selectedTenant);
                          const currentPlan = activePlans.find(p => p.name.toLowerCase() === (tenant?.plan || "").toLowerCase());
                          return currentPlan ? (
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                currentPlan.color === "blue" ? "bg-blue-100" : currentPlan.color === "pink" ? "bg-pink-100" : currentPlan.color === "purple" ? "bg-purple-100" : "bg-slate-100"
                              }`}>
                                <i className={`fas ${currentPlan.icon} text-xs ${
                                  currentPlan.color === "blue" ? "text-blue-600" : currentPlan.color === "pink" ? "text-pink-600" : currentPlan.color === "purple" ? "text-purple-600" : "text-slate-600"
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

                      <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {activePlans.map((plan) => {
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
                                  <div className="text-center mb-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-2 ${
                                      plan.color === "blue" ? "bg-blue-100" : plan.color === "pink" ? "bg-pink-100" : plan.color === "purple" ? "bg-purple-100" : "bg-slate-100"
                                    }`}>
                                      <i className={`fas ${plan.icon} ${
                                        plan.color === "blue" ? "text-blue-600" : plan.color === "pink" ? "text-pink-600" : plan.color === "purple" ? "text-purple-600" : "text-slate-600"
                                      }`} />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-900 mb-1">{plan.name}</h4>
                                    <div className="mb-2">
                                      <span className="text-3xl font-bold text-slate-900">{plan.priceLabel}</span>
                                    </div>
                                    <div className="text-xs text-slate-600">
                                      {plan.branches === -1 ? "Unlimited Branches" : `${plan.branches} ${plan.branches === 1 ? "Branch" : "Branches"}`} • {" "}
                                      {plan.staff === -1 ? "Unlimited Staff" : `${plan.staff} ${plan.staff === 1 ? "Staff" : "Staff"}`}
                                    </div>
                                  </div>

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
                          const currentPlan = activePlans.find(p => p.name.toLowerCase() === (tenant?.plan || "").toLowerCase());
                          
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
