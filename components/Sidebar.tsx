"use client";
import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";

type SidebarProps = {
  mobile?: boolean;
  onClose?: () => void;
};

export default function Sidebar({ mobile = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard" || pathname === "/";
  const isTenants = pathname?.startsWith("/tenants");
  const isBilling = pathname?.startsWith("/billing");

  return (
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
        <Link href="/tenants" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isTenants ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
          <i className="fas fa-store w-5" />
          <span>Tenant Management</span>
        </Link>
        <Link href="/billing" className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition ${isBilling ? "bg-pink-500 text-white shadow-lg" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}>
          <i className="fas fa-credit-card w-5" />
          <span>Billing & Invoices</span>
        </Link>
        <Link
          href="#"
          className="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
        >
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
            <p className="text-xs text-slate-400">Super Admin</p>
          </div>
          <i className="fas fa-chevron-right text-slate-400 text-xs" />
        </div>
      </div>
    </nav>
  );
}


