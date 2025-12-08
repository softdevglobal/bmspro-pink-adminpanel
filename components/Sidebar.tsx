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
  const isBookings = pathname?.startsWith("/bookings");
  const isBookingsDashboard = pathname === "/bookings/dashboard";
  const isBookingsAll = pathname === "/bookings/all";
  const isBookingsPending = pathname === "/bookings/pending";
  const isBookingsConfirmed = pathname === "/bookings/confirmed";
  const isBookingsCompleted = pathname === "/bookings/completed";
  const isBookingsCancelled = pathname === "/bookings/cancelled";
  const isServices = pathname?.startsWith("/services");
  const isBranches = pathname?.startsWith("/branches");
  const isCustomers = pathname?.startsWith("/customers");
  const isTenants = pathname?.startsWith("/tenants");
  const isStaff = pathname?.startsWith("/staff");
  const isBilling = pathname?.startsWith("/billing");
  const isSettings = pathname?.startsWith("/settings");
  const isOwnerSettings = pathname?.startsWith("/owner-settings");
  const [role, setRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openBookings, setOpenBookings] = useState(pathname?.startsWith("/bookings") || false);
  const [openStaff, setOpenStaff] = useState(pathname?.startsWith("/staff") || false); // Staff Toggle State
  // Do not auto-open based on route; keep user preference until manually changed

  useEffect(() => {
    // Keep role in sync with auth state and Firestore; seed from localStorage for instant render
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole(null);
        setUserName("");
        setUserEmail("");
        if (typeof window !== "undefined") {
          localStorage.removeItem("role");
          localStorage.removeItem("userName");
        }
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const userData = snap.data();
        const r = (userData?.role || "").toString();
        const displayName = userData?.displayName || userData?.name || user.displayName || "";
        const email = userData?.email || user.email || "";
        
        setRole(r || null);
        setUserName(displayName);
        setUserEmail(email);
        
        if (typeof window !== "undefined") {
          localStorage.setItem("role", r || "");
          localStorage.setItem("userName", displayName);
        }
      } catch {
        setRole(null);
        setUserName(user.displayName || user.email || "");
        setUserEmail(user.email || "");
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
        const cachedName = localStorage.getItem("userName");
        if (cachedName) setUserName(cachedName);
        const ob = localStorage.getItem("sidebarOpenBookings");
        if (ob === "1" || ob === "0") setOpenBookings(ob === "1");
        const os = localStorage.getItem("sidebarOpenStaff"); // Staff Toggle Hydration
        if (os === "1" || os === "0") setOpenStaff(os === "1");
      }
    } catch {}
  }, []);

  const toggleBookings = () => {
    setOpenBookings((v) => {
      const nv = !v;
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("sidebarOpenBookings", nv ? "1" : "0");
        }
      } catch {}
      return nv;
    });
  };

  const toggleStaff = () => {
    setOpenStaff((v) => {
      const nv = !v;
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("sidebarOpenStaff", nv ? "1" : "0");
        }
      } catch {}
      return nv;
    });
  };

  const handleSignOut = () => {
    setConfirmOpen(true);
  };

  const confirmSignOut = () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("idToken");
        localStorage.removeItem("role");
        localStorage.removeItem("userName");
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
      className={`${mobile ? "flex w-64 h-full" : "hidden md:flex md:w-64 md:h-full"} bg-slate-900 flex-col`}
    >
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <img
            src="/bmspink-icon.jpeg"
            alt="BMS Pro Pink"
            className="w-10 h-10 rounded-xl shadow-lg object-cover"
          />
          <div>
            <h1 className="font-bold text-base text-white">BMS PRO</h1>
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
      <div className="flex-1 p-4 space-y-1 overflow-y-auto sidebar-scroll bg-slate-900">
        {mounted && role !== "salon_branch_admin" && (
          <Link
            href="/dashboard"
            className={`flex items-center space-x-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
              isDashboard
                ? "bg-pink-500 text-white shadow-lg"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <i className="fas fa-chart-line w-5" />
            <span>Dashboard</span>
          </Link>
        )}
        {mounted && (role === "salon_owner" || role === "salon_branch_admin") && (
          <>
            <div
              role="button"
              onClick={toggleBookings}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition cursor-pointer ${
                isBookings ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              <i className="fas fa-calendar-check w-5" />
              <span>Bookings</span>
              <span className="ml-auto opacity-70">
                <i className={`fas fa-chevron-${openBookings ? "down" : "right"}`} />
              </span>
            </div>
            {openBookings && (
              <>
                <Link
                  href="/bookings/dashboard"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isBookingsDashboard ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-gauge w-4" />
                  <span>Today's Bookings</span>
                </Link>
                <Link
                  href="/bookings/pending"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isBookingsPending ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-hourglass-half w-4" />
                  <span>Booking Requests</span>
                </Link>
                <Link
                  href="/bookings/confirmed"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isBookingsConfirmed ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-check-circle w-4" />
                  <span>Confirmed Bookings</span>
                </Link>
                <Link
                  href="/bookings/completed"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isBookingsCompleted ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-flag-checkered w-4" />
                  <span>Completed Bookings</span>
                </Link>
                <Link
                  href="/bookings/cancelled"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isBookingsCancelled ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-ban w-4" />
                  <span>Cancelled Bookings</span>
                </Link>
              </>
            )}
          </>
        )}
        {mounted && role === "salon_owner" && (
          <Link
            href="/services"
            className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${
              isServices ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <i className="fas fa-tags w-5" />
            <span>Services</span>
          </Link>
        )}
      {mounted && role === "salon_owner" && (
        <Link
          href="/customers"
          className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${
            isCustomers ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
          }`}
        >
          <i className="fas fa-user-group w-5" />
          <span>Customers</span>
        </Link>
      )}
      {mounted && (role === "salon_owner" || role === "salon_branch_admin") && (
        <Link
          href="/branches"
          className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${
            isBranches ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
          }`}
        >
          <i className="fas fa-store w-5" />
          <span>Branch Management</span>
        </Link>
      )}
        {mounted && role === "super_admin" && (
          <Link href="/tenants" className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${isTenants ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-store w-5" />
            <span>Tenant Management</span>
          </Link>
        )}
        {mounted && role === "salon_owner" && (
          <>
            <div
              role="button"
              onClick={toggleStaff}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition cursor-pointer ${
                isStaff ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              <i className="fas fa-users w-5" />
              <span>Staff</span>
              <span className="ml-auto opacity-70">
                <i className={`fas fa-chevron-${openStaff ? "down" : "right"}`} />
              </span>
            </div>
            {openStaff && (
              <>
                <Link
                  href="/staff/manage"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    pathname === "/staff" || pathname?.startsWith("/staff/manage")
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-user-cog w-4" />
                  <span>Staff Management</span>
                </Link>
                <Link
                  href="/staff/attendance"
                  className={`ml-3 flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    pathname === "/staff/attendance"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <i className="fas fa-calendar-check w-4" />
                  <span>Attendance</span>
                </Link>
              </>
            )}
          </>
        )}
        {/* {mounted && role !== "salon_branch_admin" && (
          <Link href="/billing" className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${isBilling ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-credit-card w-5" />
            <span>Billing & Invoices</span>
          </Link>
        )} */}
        {mounted && role === "super_admin" && (
          <Link href="/settings" className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${isSettings ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-cog w-5" />
            <span>Platform Settings</span>
          </Link>
        )}
        {mounted && role === "salon_owner" && (
          <Link href="/owner-settings" className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm transition ${isOwnerSettings ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
            <i className="fas fa-cog w-5" />
            <span>Settings</span>
          </Link>
        )}
      </div>
      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 cursor-pointer transition">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center text-white font-semibold text-sm">
            {userName ? userName.charAt(0).toUpperCase() : userEmail ? userEmail.charAt(0).toUpperCase() : <i className="fas fa-user" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {userName || userEmail.split('@')[0] || "Account"}
            </p>
            <p className="text-xs text-slate-400">
              {mounted && role
                ? role === "super_admin"
                  ? "Super Admin"
                  : role === "salon_owner"
                  ? "Salon Owner"
                  : role === "salon_branch_admin"
                  ? "Branch Admin"
                  : role === "salon_staff"
                  ? "Staff Member"
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


