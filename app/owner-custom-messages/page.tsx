"use client";

import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { OwnerCustomMessagesBoard } from "@/components/owner-custom-messages-board";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export default function OwnerCustomMessagesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = (snap.data()?.role || "").toString();
        if (role === "salon_branch_admin") {
          router.replace("/branches");
          return;
        }
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      } catch {
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  if (!ready) {
    return (
      <div id="app" className="flex h-screen overflow-hidden bg-white">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center bg-neutral-50">
          <div className="text-center">
            <i className="fas fa-spinner fa-spin mb-3 text-2xl text-neutral-400" />
            <p className="text-sm text-neutral-500">Loading custom messages…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto bg-neutral-50 p-4 sm:p-6 lg:p-8">
          <div className="mb-4 md:hidden">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-neutral-700 shadow-sm hover:bg-neutral-50"
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
                aria-hidden
              />
              <div className="absolute bottom-0 left-0 top-0">
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
                      <i className="fas fa-comment-sms" />
                    </div>
                    <h1 className="text-2xl font-bold">Custom Messages</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Send SMS to your customers and staff
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-7xl">
            <OwnerCustomMessagesBoard />
          </div>
        </main>
      </div>
    </div>
  );
}
