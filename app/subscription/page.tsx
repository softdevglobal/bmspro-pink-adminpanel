"use client";
import React, { useEffect, useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

interface Package {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  branches: number;
  staff: number;
  features: string[];
  popular?: boolean;
  color: string;
  image?: string;
  icon?: string;
  active?: boolean;
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<{ name: string; email: string; plan?: string; price?: string } | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  
  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [updating, setUpdating] = useState(false);

  // Calculator state
  const [branches, setBranches] = useState(1);
  const [staff, setStaff] = useState(0);
  const PRICE_BRANCH = 29.0;
  const PRICE_STAFF = 9.99;

  // Fetch packages from API
  const fetchPackages = useCallback(async () => {
    try {
      setPackagesLoading(true);
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const token = await currentUser.getIdToken();
      const res = await fetch("/api/packages", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        // API returns 'plans' not 'packages'
        const allPackages = data.plans || data.packages || [];
        const activePackages = allPackages.filter((p: Package) => p.active !== false);
        setPackages(activePackages);
      }
    } catch (error) {
      console.error("Error fetching packages:", error);
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);

        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.data();
        const role = (data?.role || "").toString();

        // Only salon_owner can access this page
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }

        setUserData({
          name: data?.name || data?.displayName || "",
          email: user.email || data?.email || "",
          plan: data?.plan || "",
          price: data?.price || "",
        });

        // Fetch packages after auth is ready
        fetchPackages();

        setMounted(true);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user data:", error);
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router, fetchPackages]);

  const updateCalc = (type: "branch" | "staff", change: number) => {
    if (type === "branch") {
      setBranches((prev) => Math.max(1, prev + change));
    } else {
      setStaff((prev) => Math.max(0, prev + change));
    }
  };

  const branchTotal = branches * PRICE_BRANCH;
  const staffTotal = staff * PRICE_STAFF;
  const grandTotal = branchTotal + staffTotal;

  const selectPlan = (pkg: Package) => {
    setSelectedPackage(pkg);
    setShowConfirmModal(true);
  };

  const confirmPlanChange = async () => {
    if (!selectedPackage || !auth.currentUser) return;
    
    try {
      setUpdating(true);
      
      // Update the user's subscription in Firestore
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, {
        plan: selectedPackage.name,
        price: selectedPackage.priceLabel,
        planId: selectedPackage.id,
        planUpdatedAt: new Date(),
      });
      
      // Also update the owner document if exists
      const ownerRef = doc(db, "owners", auth.currentUser.uid);
      const ownerSnap = await getDoc(ownerRef);
      if (ownerSnap.exists()) {
        await updateDoc(ownerRef, {
          plan: selectedPackage.name,
          price: selectedPackage.priceLabel,
          planId: selectedPackage.id,
          planUpdatedAt: new Date(),
        });
      }
      
      // Update local state
      setUserData(prev => prev ? {
        ...prev,
        plan: selectedPackage.name,
        price: selectedPackage.priceLabel,
      } : null);
      
      setShowConfirmModal(false);
      setSelectedPackage(null);
      
    } catch (error) {
      console.error("Error updating subscription:", error);
      alert("Failed to update subscription. Please try again.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-slate-50">
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

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <i className="fas fa-circle-notch fa-spin text-4xl text-pink-500" />
                <p className="text-slate-500 font-medium">Loading subscription...</p>
              </div>
            </div>
          ) : (
            mounted &&
            userData && (
              <>
                {/* Header Banner */}
                <div className="mb-8">
                  <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-indigo-500 text-white p-8 shadow-xl">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
                          <i className="fas fa-crown text-2xl" />
                        </div>
                        <div>
                          <h1 className="text-3xl font-bold">Upgrade Membership</h1>
                          <p className="text-white/90 mt-1">Scale your business with flexible pricing plans. Change anytime.</p>
                        </div>
                      </div>
                      {userData.plan && (
                        <div className="flex items-center gap-2 bg-white/20 backdrop-blur px-4 py-2 rounded-xl">
                          <i className="fas fa-check-circle" />
                          <span className="font-medium">
                            Current: {userData.plan} {userData.price ? `(${userData.price})` : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pricing Cards */}
                {packagesLoading ? (
                  <div className="flex items-center justify-center py-12 mb-10">
                    <div className="flex flex-col items-center gap-3">
                      <i className="fas fa-circle-notch fa-spin text-3xl text-pink-500" />
                      <p className="text-slate-500">Loading packages...</p>
                    </div>
                  </div>
                ) : packages.length === 0 ? (
                  <div className="text-center py-12 mb-10">
                    <i className="fas fa-box-open text-4xl text-slate-300 mb-3" />
                    <p className="text-slate-500">No subscription plans available at the moment.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
                    {packages.map((pkg) => {
                      const isCurrentPlan = userData?.plan === pkg.name;
                      const gradientClass = pkg.color === "blue" ? "from-blue-500 via-blue-600 to-indigo-600" 
                        : pkg.color === "pink" ? "from-pink-500 via-rose-500 to-fuchsia-600" 
                        : pkg.color === "purple" ? "from-purple-500 via-violet-500 to-indigo-600" 
                        : pkg.color === "green" ? "from-emerald-500 via-green-500 to-teal-600"
                        : pkg.color === "orange" ? "from-orange-500 via-amber-500 to-yellow-500"
                        : pkg.color === "teal" ? "from-teal-500 via-cyan-500 to-blue-500"
                        : "from-pink-500 via-rose-500 to-fuchsia-600";
                      const lightBgClass = pkg.color === "blue" ? "bg-blue-50" 
                        : pkg.color === "pink" ? "bg-pink-50" 
                        : pkg.color === "purple" ? "bg-purple-50" 
                        : pkg.color === "green" ? "bg-emerald-50"
                        : pkg.color === "orange" ? "bg-orange-50"
                        : pkg.color === "teal" ? "bg-teal-50"
                        : "bg-pink-50";
                      
                      return (
                        <div 
                          key={pkg.id}
                          className={`group relative bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 ${
                            isCurrentPlan ? "ring-2 ring-emerald-500 ring-offset-1" : ""
                          }`}
                        >
                          {/* Gradient Header - Compact */}
                          <div className={`relative h-20 bg-gradient-to-br ${gradientClass} overflow-visible`}>
                            {/* Decorative circles */}
                            <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/10 rounded-full" />
                            <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/10 rounded-full" />
                            
                            {/* Popular badge */}
                            {pkg.popular && (
                              <div className="absolute top-2 left-2 bg-white/20 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 z-10">
                                <i className="fas fa-crown text-yellow-300 text-[8px]" />
                                Popular
                              </div>
                            )}
                            
                            {/* Current Plan badge */}
                            {isCurrentPlan && (
                              <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 z-10">
                                <i className="fas fa-check text-[8px]" />
                                Current
                              </div>
                            )}
                            
                            {/* Package Image/Icon - Compact */}
                            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-20">
                              <div className={`w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shadow-lg ring-2 ring-white ${lightBgClass}`}>
                                {pkg.image ? (
                                  <img src={pkg.image} alt={pkg.name} className="w-full h-full object-cover" />
                                ) : pkg.icon ? (
                                  <i className={`fas ${pkg.icon} text-xl bg-gradient-to-br ${gradientClass} bg-clip-text text-transparent`} />
                                ) : (
                                  <i className={`fas fa-box text-xl bg-gradient-to-br ${gradientClass} bg-clip-text text-transparent`} />
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Card Content - Compact */}
                          <div className="pt-10 pb-4 px-4">
                            {/* Plan Name */}
                            <div className="text-center mb-3">
                              <h3 className="text-base font-bold text-slate-900 mb-1">{pkg.name}</h3>
                              <div className={`text-2xl font-extrabold bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                                {pkg.priceLabel}
                              </div>
                            </div>
                            
                            {/* Branches & Staff */}
                            <div className="flex items-center justify-center gap-2 mb-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <i className="fas fa-building text-[10px]" />
                                {pkg.branches === -1 ? "Unlimited" : pkg.branches} Branch
                              </span>
                              <span className="w-0.5 h-0.5 bg-slate-300 rounded-full" />
                              <span className="flex items-center gap-1">
                                <i className="fas fa-users text-[10px]" />
                                {pkg.staff === -1 ? "Unlimited" : pkg.staff} Staff
                              </span>
                            </div>
                            
                            {/* Divider */}
                            <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-3" />
                            
                            {/* Features List - Compact */}
                            {pkg.features && pkg.features.length > 0 && (
                              <ul className="space-y-1.5 mb-4">
                                {pkg.features.slice(0, 4).map((feature, idx) => (
                                  <li key={idx} className="flex items-center gap-2">
                                    <div className={`w-4 h-4 rounded-full bg-gradient-to-br ${gradientClass} flex items-center justify-center flex-shrink-0`}>
                                      <i className="fas fa-check text-white text-[8px]" />
                                    </div>
                                    <span className="text-xs text-slate-600 line-clamp-1">{feature}</span>
                                  </li>
                                ))}
                                {pkg.features.length > 4 && (
                                  <li className="text-xs text-slate-400 text-center">
                                    +{pkg.features.length - 4} more
                                  </li>
                                )}
                              </ul>
                            )}
                            
                            {/* Select Button - Compact */}
                            <button
                              onClick={() => selectPlan(pkg)}
                              disabled={isCurrentPlan}
                              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all duration-200 ${
                                isCurrentPlan
                                  ? "bg-emerald-100 text-emerald-600 cursor-not-allowed"
                                  : `bg-gradient-to-r ${gradientClass} text-white hover:shadow-lg hover:scale-[1.02]`
                              }`}
                            >
                              {isCurrentPlan ? (
                                <>
                                  <i className="fas fa-check-circle mr-1.5" />
                                  Current
                                </>
                              ) : (
                                "Select Plan"
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Custom Enterprise Calculator */}
                <div className="bg-white rounded-2xl shadow-sm border-t-4 border-pink-500 overflow-hidden">
                  <div className="p-8">
                    <div className="mb-8">
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Custom Enterprise Plan</h2>
                      <p className="text-slate-500">Build a plan that fits your exact business structure.</p>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-8">
                      {/* Controls */}
                      <div className="flex-[2] space-y-4">
                        {/* Branches Control */}
                        <div className="flex items-center justify-between bg-slate-50 p-5 rounded-xl border border-slate-200">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">Branches</h3>
                            <p className="text-sm text-slate-500 mt-1">$29.00 per branch (Includes 1 Admin)</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => updateCalc("branch", -1)}
                              className="w-10 h-10 rounded-full border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 text-xl font-bold transition-colors"
                            >
                              −
                            </button>
                            <span className="text-xl font-bold text-slate-900 w-8 text-center">{branches}</span>
                            <button
                              onClick={() => updateCalc("branch", 1)}
                              className="w-10 h-10 rounded-full border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 text-xl font-bold transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Staff Control */}
                        <div className="flex items-center justify-between bg-slate-50 p-5 rounded-xl border border-slate-200">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">Staff Members</h3>
                            <p className="text-sm text-slate-500 mt-1">$9.99 per additional staff member</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => updateCalc("staff", -1)}
                              className="w-10 h-10 rounded-full border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 text-xl font-bold transition-colors"
                            >
                              −
                            </button>
                            <span className="text-xl font-bold text-slate-900 w-8 text-center">{staff}</span>
                            <button
                              onClick={() => updateCalc("staff", 1)}
                              className="w-10 h-10 rounded-full border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 text-xl font-bold transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Summary Card */}
                      <div className="flex-1 min-w-[280px] bg-slate-900 text-white p-8 rounded-2xl shadow-xl">
                        <h3 className="text-lg font-semibold mb-6 pb-4 border-b border-white/20">Est. Monthly Cost</h3>

                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between opacity-80">
                            <span>
                              Branches ({branches} × $29)
                            </span>
                            <span>${branchTotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between opacity-80">
                            <span>
                              Staff ({staff} × $9.99)
                            </span>
                            <span>${staffTotal.toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center mt-6 pt-6 border-t border-white/20 text-2xl font-bold text-pink-400">
                          <span>Total</span>
                          <span>${grandTotal.toFixed(2)}</span>
                        </div>

                        <button
                          onClick={() => alert("Proceeding to checkout with Custom Plan...")}
                          className="w-full mt-6 py-3.5 px-6 rounded-xl bg-pink-500 text-white font-semibold hover:bg-pink-600 transition-colors shadow-lg shadow-pink-500/30"
                        >
                          Upgrade to Custom
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* FAQ or Help Section */}
                <div className="mt-10 text-center text-slate-500 text-sm">
                  <p>
                    Need help choosing a plan?{" "}
                    <a href="#" className="text-pink-500 hover:text-pink-600 font-medium">
                      Contact our sales team
                    </a>
                  </p>
                </div>
              </>
            )
          )}
        </main>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && selectedPackage && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !updating && setShowConfirmModal(false)} />
          <div className="relative flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className={`bg-gradient-to-r ${
                selectedPackage.color === "blue" ? "from-blue-500 to-indigo-600" 
                : selectedPackage.color === "pink" ? "from-pink-500 to-fuchsia-600" 
                : selectedPackage.color === "purple" ? "from-purple-500 to-indigo-600" 
                : selectedPackage.color === "green" ? "from-emerald-500 to-teal-600"
                : selectedPackage.color === "orange" ? "from-orange-500 to-yellow-500"
                : selectedPackage.color === "teal" ? "from-teal-500 to-blue-500"
                : "from-pink-500 to-fuchsia-600"
              } p-6 text-white`}>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                    <i className="fas fa-exchange-alt text-2xl" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Change Subscription</h3>
                    <p className="text-white/80 text-sm">Confirm your plan change</p>
                  </div>
                </div>
              </div>
              
              {/* Content */}
              <div className="p-6">
                <div className="text-center mb-6">
                  <p className="text-slate-600 mb-4">
                    You are about to change your subscription to:
                  </p>
                  <div className="inline-flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-xl">
                    {selectedPackage.image && (
                      <img src={selectedPackage.image} alt={selectedPackage.name} className="w-10 h-10 rounded-lg object-cover" />
                    )}
                    <div className="text-left">
                      <div className="font-bold text-slate-900">{selectedPackage.name}</div>
                      <div className="text-sm text-pink-600 font-semibold">{selectedPackage.priceLabel}</div>
                    </div>
                  </div>
                </div>
                
                {/* Plan Details */}
                <div className="bg-slate-50 rounded-xl p-4 mb-6">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-500">Branches</span>
                    <span className="font-medium text-slate-700">
                      {selectedPackage.branches === -1 ? "Unlimited" : selectedPackage.branches}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-500">Staff</span>
                    <span className="font-medium text-slate-700">
                      {selectedPackage.staff === -1 ? "Unlimited" : selectedPackage.staff}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Features</span>
                    <span className="font-medium text-slate-700">
                      {selectedPackage.features?.length || 0} included
                    </span>
                  </div>
                </div>
                
                {/* Current Plan Info */}
                {userData?.plan && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 p-3 rounded-lg mb-6">
                    <i className="fas fa-info-circle" />
                    <span>Your current plan: <strong>{userData.plan}</strong> ({userData.price})</span>
                  </div>
                )}
                
                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={updating}
                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmPlanChange}
                    disabled={updating}
                    className={`flex-1 py-3 px-4 rounded-xl text-white font-semibold transition-all disabled:opacity-70 bg-gradient-to-r ${
                      selectedPackage.color === "blue" ? "from-blue-500 to-indigo-600" 
                      : selectedPackage.color === "pink" ? "from-pink-500 to-fuchsia-600" 
                      : selectedPackage.color === "purple" ? "from-purple-500 to-indigo-600" 
                      : selectedPackage.color === "green" ? "from-emerald-500 to-teal-600"
                      : selectedPackage.color === "orange" ? "from-orange-500 to-yellow-500"
                      : selectedPackage.color === "teal" ? "from-teal-500 to-blue-500"
                      : "from-pink-500 to-fuchsia-600"
                    } hover:shadow-lg`}
                  >
                    {updating ? (
                      <>
                        <i className="fas fa-circle-notch fa-spin mr-2" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-check mr-2" />
                        Confirm Change
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

