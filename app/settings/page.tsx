"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

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
                      <i className="fas fa-cog" />
                    </div>
                    <h1 className="text-2xl font-bold">Platform Settings</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Configure branding, notifications, and security
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">General</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Product Name</label>
                    <input
                      placeholder="BMS PRO PINK"
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Support Email</label>
                    <input
                      type="email"
                      placeholder="support@bmspro.au"
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Company Address</label>
                    <textarea
                      rows={3}
                      placeholder="Street, City, Postcode, Country"
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700">
                    Save General
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Email & Notifications</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Sender Name</label>
                    <input
                      placeholder="BMS PRO"
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Sender Email</label>
                    <input
                      type="email"
                      placeholder="noreply@bmspro.au"
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <input id="notify-overdue" type="checkbox" className="h-4 w-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500" />
                    <label htmlFor="notify-overdue" className="text-sm text-slate-700">Email tenants about overdue invoices</label>
                  </div>
                  <button className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700">
                    Save Email
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Security</h2>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">Two-factor authentication</p>
                    <p className="text-sm text-slate-500">Require 2FA for admin sign-in</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-pink-500 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                  </label>
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="text-base font-semibold text-slate-900 mb-4">Branding</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Logo</label>
                    <div className="flex items-center justify-center border border-dashed border-slate-300 rounded-xl h-28 text-slate-500">
                      <i className="fas fa-upload mr-2" />
                      Upload PNG/SVG
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Accent Color</label>
                    <input type="color" defaultValue="#FF2D8F" className="h-10 w-full border border-slate-300 rounded-lg p-1 cursor-pointer" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="text-base font-semibold text-slate-900 mb-2">Danger Zone</h3>
                <p className="text-sm text-slate-500 mb-4">Actions that can have serious consequences.</p>
                <button className="w-full px-5 py-2.5 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700">
                  Reset Platform Cache
                </button>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}


