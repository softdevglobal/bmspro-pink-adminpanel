"use client";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type SidebarProps = {
  mobile?: boolean;
  onClose?: () => void;
};

export default function Sidebar({ mobile = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isDashboard = pathname === "/dashboard" || pathname === "/";
  const isTenants = pathname?.startsWith("/tenants");
  const isStaff = pathname?.startsWith("/staff");
  const isBilling = pathname?.startsWith("/billing");
  const isSettings = pathname?.startsWith("/settings");
  const [role, setRole] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    // Keep role in sync with auth state and Firestore; seed from localStorage for instant render
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole(null);
        if (typeof window !== "undefined") localStorage.removeItem("role");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const r = (snap.data()?.role || "").toString();
        setRole(r || null);
        if (typeof window !== "undefined") localStorage.setItem("role", r || "");
      } catch {
        setRole(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // Ensure hydration-safe rendering by deferring role-based links until after mount
    setMounted(true);
    // Immediately hydrate from localStorage to avoid link flicker during client navigation
    try {
      if (typeof window !== "undefined") {
        const cached = localStorage.getItem("role");
        if (cached) setRole(cached);
      }
    } catch {}
  }, []);

  const handleSignOut = () => {
    setConfirmOpen(true);
  };

  const confirmSignOut = () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("idToken");
        localStorage.removeItem("role");
      }
      signOut(auth).catch(() => {});
    } catch {}
    router.replace("/login");
  };

  const cancelSignOut = () => setConfirmOpen(false);

  return (
    <>
    <nav
      id="sidebar"
      className={`${mobile ? "flex w-64 h-full" : "hidden md:flex md:w-56 md:h-full"} bg-slate-900 flex-col`}
    >
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
            <i className="fas fa-scissors text-white text-lg" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">BMS PRO</h1>
            <p className="text-xs font-semibold text-pink-400">PINK</p>
          </div>
        </div>
        {mobile && (
          <button
            aria-label="Close menu"
            onClick={onClose}
            className="absolute right-3 top-3 text-slate-400 hover:text-white md:hidden"
          >
            <i className="fas fa-times" />
          </button>
        )}
      </div>
      <div className="flex-1 p-4 space-y-1">
        <Link
          href="/dashboard"
          className={`flex items-center space-x-3 px-4 py-3 rounded-xl font-medium transition ${
            isDashboard
              ? "bg-pink-500 text-white shadow-lg"
              : "text-slate-400 hover:bg-slate-800 hover:text-white"
          }`}
        >
          <i className="fas fa-chart-line w-5" />
          <span>Dashboard</span>
        </Link>
        {mounted && role === "super_admin" && (
          <Link href="/tenants" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isTenants ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-store w-5" />
            <span>Tenant Management</span>
          </Link>
        )}
        {mounted && role === "salon_owner" && (
          <Link href="/staff" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isStaff ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-users w-5" />
            <span>Staff Management</span>
          </Link>
        )}
        <Link href="/billing" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isBilling ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
          <i className="fas fa-credit-card w-5" />
          <span>Billing & Invoices</span>
        </Link>
        <Link href="/settings" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isSettings ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
          <i className="fas fa-cog w-5" />
          <span>Platform Settings</span>
        </Link>
      </div>
      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 cursor-pointer transition">
          <img
            src="https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-2.jpg"
            className="w-10 h-10 rounded-full object-cover"
            alt="Admin avatar"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Admin User</p>
            <p className="text-xs text-slate-400">
              {mounted && role
                ? role === "super_admin"
                  ? "Super Admin"
                  : role === "salon_owner"
                  ? "Salon Owner"
                  : "User"
                : "User"}
            </p>
          </div>
          <i className="fas fa-chevron-right text-slate-400 text-xs" />
        </div>
        <button
          onClick={handleSignOut}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition"
        >
          <i className="fas fa-right-from-bracket" />
          Sign Out
        </button>
      </div>
    </nav>

    {/* Sign-out confirmation modal */}
    {confirmOpen && (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/50" onClick={cancelSignOut} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Sign out</h3>
              <button className="text-slate-400 hover:text-slate-600" onClick={cancelSignOut}>
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600">Are you sure you want to sign out?</p>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={cancelSignOut} className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                Cancel
              </button>
              <button onClick={confirmSignOut} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


