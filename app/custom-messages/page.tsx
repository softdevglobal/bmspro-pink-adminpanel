"use client";

import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { CustomMessagesBoard } from "@/components/custom-messages-board";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export default function CustomMessagesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const superAdminDoc = await getDoc(doc(db, "super_admins", user.uid));
        if (!superAdminDoc.exists()) {
          router.replace("/dashboard");
          return;
        }
        setLoading(false);
      } catch {
        router.replace("/dashboard");
      }
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <i className="fas fa-spinner fa-spin text-2xl text-pink-500" />
      </div>
    );
  }

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
          <div className="md:hidden mb-4">
            <button
              type="button"
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
                className="absolute inset-0 bg-black/50"
                onClick={() => setMobileOpen(false)}
              />
              <div className="relative h-full w-64">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                  <i className="fas fa-bullhorn text-2xl" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Custom notification</h1>
                  <p className="text-sm text-white/80 mt-1">
                    Send a platform-wide announcement to business owners and staff.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <CustomMessagesBoard />
        </main>
      </div>
    </div>
  );
}
