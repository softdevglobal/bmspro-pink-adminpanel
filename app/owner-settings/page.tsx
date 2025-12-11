"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

type UserData = {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  abn?: string;
  address?: string;
  role: string;
  logoUrl?: string;
  appointmentReminders?: boolean;
  marketingEmails?: boolean;
  minimumLeadTime?: string;
  cancellationWindow?: string;
};

export default function OwnerSettingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);

  // Form states
  const [salonName, setSalonName] = useState("");
  const [abn, setAbn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [minimumLeadTime, setMinimumLeadTime] = useState("1 hour");
  const [cancellationWindow, setCancellationWindow] = useState("2 hours");
  const [appointmentReminders, setAppointmentReminders] = useState(false);
  const [marketingEmails, setMarketingEmails] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);
        
        // Fetch user data
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.data();
        const role = (data?.role || "").toString();
        
        if (role === "salon_branch_admin") {
          router.replace("/branches");
          return;
        }
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }

        // Set user data
        const userData: UserData = {
          uid: user.uid,
          name: data?.name || data?.displayName || "",
          email: user.email || data?.email || "",
          phone: data?.phone || "",
          abn: data?.abn || "",
          address: data?.address || "",
          role: role,
          logoUrl: data?.logoUrl || "",
          appointmentReminders: data?.appointmentReminders ?? true,
          marketingEmails: data?.marketingEmails ?? false,
          minimumLeadTime: data?.minimumLeadTime || "1 hour",
          cancellationWindow: data?.cancellationWindow || "2 hours",
        };
        
        setUserData(userData);
        
        // Initialize form fields
        setSalonName(userData.name);
        setAbn(userData.abn || "");
        setAddress(userData.address || "");
        setPhone(userData.phone || "");
        setMinimumLeadTime(userData.minimumLeadTime || "1 hour");
        setCancellationWindow(userData.cancellationWindow || "2 hours");
        setAppointmentReminders(userData.appointmentReminders ?? true);
        setMarketingEmails(userData.marketingEmails ?? false);
        
        setMounted(true);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user data:", error);
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  const handleSaveProfile = async () => {
    if (!userData) return;
    setSaving("profile");
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        name: salonName,
        displayName: salonName,
        abn: abn,
        address: address,
        phone: phone,
        updatedAt: serverTimestamp(),
      });
      setUserData({ ...userData, name: salonName, abn, address, phone });
      alert("Profile saved successfully!");
    } catch (error) {
      console.error("Error saving profile:", error);
      alert("Failed to save profile. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveRules = async () => {
    if (!userData) return;
    setSaving("rules");
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        minimumLeadTime,
        cancellationWindow,
        updatedAt: serverTimestamp(),
      });
      setUserData({ ...userData, minimumLeadTime, cancellationWindow });
      alert("Booking rules saved successfully!");
    } catch (error) {
      console.error("Error saving rules:", error);
      alert("Failed to save rules. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveNotifications = async () => {
    if (!userData) return;
    setSaving("notifications");
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        appointmentReminders,
        marketingEmails,
        updatedAt: serverTimestamp(),
      });
      setUserData({ ...userData, appointmentReminders, marketingEmails });
      alert("Notification preferences saved successfully!");
    } catch (error) {
      console.error("Error saving notifications:", error);
      alert("Failed to save notifications. Please try again.");
    } finally {
      setSaving(null);
    }
  };

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
                <p className="text-slate-500 font-medium">Loading settings...</p>
              </div>
            </div>
          ) : mounted && userData && (
            <>
              <div className="mb-8">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                        <i className="fas fa-cog" />
                      </div>
                      <div>
                        <h1 className="text-2xl font-bold">Salon Settings</h1>
                        <p className="text-sm text-white/80 mt-1">Business profile, branding, booking rules, notifications</p>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-full">
                      <i className="fas fa-user-tie text-sm" />
                      <span className="text-sm font-medium">{userData.email}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <section className="lg:col-span-2 space-y-6">
                  {/* Business Profile */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4">Business Profile</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Salon Name</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="Your Salon Name"
                          value={salonName}
                          onChange={(e) => setSalonName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">ABN</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="00 000 000 000"
                          value={abn}
                          onChange={(e) => setAbn(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="+61 xxx xxx xxx"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed" 
                          value={userData.email}
                          disabled
                          title="Email cannot be changed"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
                        <textarea 
                          rows={3} 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="Street, City, Postcode"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveProfile}
                        disabled={saving === "profile"}
                        className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {saving === "profile" ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-save" />
                            Save Profile
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Booking Rules */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4">Booking Rules</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Minimum Lead Time</label>
                        <select 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-pink-500"
                          value={minimumLeadTime}
                          onChange={(e) => setMinimumLeadTime(e.target.value)}
                        >
                          <option value="30 minutes">30 minutes</option>
                          <option value="1 hour">1 hour</option>
                          <option value="2 hours">2 hours</option>
                          <option value="3 hours">3 hours</option>
                          <option value="6 hours">6 hours</option>
                          <option value="12 hours">12 hours</option>
                          <option value="24 hours">24 hours</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Cancellation Window</label>
                        <select 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-pink-500"
                          value={cancellationWindow}
                          onChange={(e) => setCancellationWindow(e.target.value)}
                        >
                          <option value="1 hour">1 hour</option>
                          <option value="2 hours">2 hours</option>
                          <option value="4 hours">4 hours</option>
                          <option value="6 hours">6 hours</option>
                          <option value="12 hours">12 hours</option>
                          <option value="24 hours">24 hours</option>
                          <option value="48 hours">48 hours</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveRules}
                        disabled={saving === "rules"}
                        className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {saving === "rules" ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-save" />
                            Save Rules
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                <aside className="space-y-6">
                  {/* Account Info Card */}
                  <div className="bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-100 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center font-bold text-lg">
                        {salonName ? salonName.slice(0, 2).toUpperCase() : "SA"}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{salonName || "Your Salon"}</h3>
                        <p className="text-xs text-slate-500">{userData.email}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between py-2 border-b border-pink-100">
                        <span className="text-slate-600">Role</span>
                        <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded-full text-xs font-medium">Salon Owner</span>
                      </div>
                      {phone && (
                        <div className="flex items-center justify-between py-2 border-b border-pink-100">
                          <span className="text-slate-600">Phone</span>
                          <span className="text-slate-800">{phone}</span>
                        </div>
                      )}
                      {abn && (
                        <div className="flex items-center justify-between py-2">
                          <span className="text-slate-600">ABN</span>
                          <span className="text-slate-800">{abn}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Branding */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-base font-semibold text-slate-900 mb-4">Branding</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Logo</label>
                        <div className="flex items-center justify-center border border-dashed border-slate-300 rounded-xl h-28 text-slate-500 hover:border-pink-400 hover:bg-pink-50 transition cursor-pointer">
                          <div className="text-center">
                            <i className="fas fa-upload mr-2" />
                            <span>Upload PNG/SVG</span>
                            <p className="text-xs text-slate-400 mt-1">Coming soon</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notifications */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-base font-semibold text-slate-900 mb-4">Notifications</h3>
                    <div className="space-y-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm text-slate-700">Appointment reminders</span>
                        <input 
                          type="checkbox" 
                          className="h-4 w-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                          checked={appointmentReminders}
                          onChange={(e) => setAppointmentReminders(e.target.checked)}
                        />
                      </label>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm text-slate-700">Marketing emails</span>
                        <input 
                          type="checkbox" 
                          className="h-4 w-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                          checked={marketingEmails}
                          onChange={(e) => setMarketingEmails(e.target.checked)}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveNotifications}
                        disabled={saving === "notifications"}
                        className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {saving === "notifications" ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-save" />
                            Save
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
