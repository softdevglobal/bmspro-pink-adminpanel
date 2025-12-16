"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export default function SubscriptionPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<{ name: string; email: string; plan?: string; price?: string } | null>(null);

  // Calculator state
  const [branches, setBranches] = useState(1);
  const [staff, setStaff] = useState(0);
  const PRICE_BRANCH = 29.0;
  const PRICE_STAFF = 9.99;

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

        setMounted(true);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user data:", error);
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

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

  const selectPlan = (name: string, price: number) => {
    alert(`You selected the ${name} plan for $${price}/mo`);
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                  {/* Starter Plan */}
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 flex flex-col items-center text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                    <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Starter</div>
                    <div className="text-5xl font-bold text-slate-900 mb-2">
                      $29<span className="text-lg font-normal text-slate-500">/mo</span>
                    </div>
                    <p className="text-slate-500 mb-6 min-h-[48px]">Perfect for solo pros starting out.</p>
                    <ul className="w-full text-left space-y-3 mb-8">
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">1 Branch</span>
                      </li>
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">1 Staff Member</span>
                      </li>
                      <li className="flex items-center gap-3 py-2">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">Admin Included</span>
                      </li>
                    </ul>
                    <button
                      onClick={() => selectPlan("Starter", 29)}
                      className="w-full py-3 px-6 rounded-xl border-2 border-pink-500 text-pink-500 font-semibold hover:bg-pink-50 transition-colors"
                    >
                      Select Plan
                    </button>
                  </div>

                  {/* Growth Plan - Most Popular */}
                  <div className="relative bg-white rounded-2xl p-8 shadow-lg border-2 border-pink-500 flex flex-col items-center text-center hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-pink-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wide">
                      Most Popular
                    </div>
                    <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Growth</div>
                    <div className="text-5xl font-bold text-slate-900 mb-2">
                      $69<span className="text-lg font-normal text-slate-500">/mo</span>
                    </div>
                    <p className="text-slate-500 mb-6 min-h-[48px]">For growing teams and small salons.</p>
                    <ul className="w-full text-left space-y-3 mb-8">
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">1 Branch</span>
                      </li>
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">5 Staff Members</span>
                      </li>
                      <li className="flex items-center gap-3 py-2">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">Admin Included</span>
                      </li>
                    </ul>
                    <button
                      onClick={() => selectPlan("Growth", 69)}
                      className="w-full py-3 px-6 rounded-xl bg-pink-500 text-white font-semibold hover:bg-pink-600 transition-colors shadow-lg shadow-pink-500/30"
                    >
                      Select Plan
                    </button>
                  </div>

                  {/* Pro Plan */}
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 flex flex-col items-center text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                    <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Pro</div>
                    <div className="text-5xl font-bold text-slate-900 mb-2">
                      $99<span className="text-lg font-normal text-slate-500">/mo</span>
                    </div>
                    <p className="text-slate-500 mb-6 min-h-[48px]">For busy salons running at scale.</p>
                    <ul className="w-full text-left space-y-3 mb-8">
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">1 Branch</span>
                      </li>
                      <li className="flex items-center gap-3 py-2 border-b border-slate-100">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">10 Staff Members</span>
                      </li>
                      <li className="flex items-center gap-3 py-2">
                        <i className="fas fa-check text-pink-500 font-bold" />
                        <span className="text-slate-700">Admin Included</span>
                      </li>
                    </ul>
                    <button
                      onClick={() => selectPlan("Pro", 99)}
                      className="w-full py-3 px-6 rounded-xl border-2 border-pink-500 text-pink-500 font-semibold hover:bg-pink-50 transition-colors"
                    >
                      Select Plan
                    </button>
                  </div>
                </div>

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
    </div>
  );
}

