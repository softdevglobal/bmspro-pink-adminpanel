"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

type Branch = {
  id: string;
  name: string;
  address: string;
  revenue: number;
  phone?: string;
  email?: string;
  hours?: string;
  capacity?: number;
  manager?: string;
  status?: "Active" | "Pending" | "Closed";
};

export default function BranchesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("");
  const [capacity, setCapacity] = useState<number | "">("");
  const [manager, setManager] = useState("");
  const [status, setStatus] = useState<"Active" | "Pending" | "Closed">("Active");

  // seed defaults
  const defaultBranches: Branch[] = useMemo(
    () => [
      { id: "br1", name: "Downtown HQ", address: "123 Main St, Melbourne", revenue: 45200 },
      { id: "br2", name: "North Branch", address: "88 North Rd, Brunswick", revenue: 12800 },
    ],
    []
  );

  // auth + role guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);
      } catch {
        router.replace("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = (snap.data()?.role || "").toString();
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }
        setOwnerUid(user.uid);
      } catch {
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  // load persisted data
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("bms_branch_data") : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        setBranches(parsed?.branches || defaultBranches);
      } else {
        setBranches(defaultBranches);
        if (typeof window !== "undefined") {
          localStorage.setItem("bms_branch_data", JSON.stringify({ branches: defaultBranches }));
        }
      }
    } catch {
      setBranches(defaultBranches);
    }
  }, [defaultBranches]);

  const saveData = (next: Branch[]) => {
    setBranches(next);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("bms_branch_data", JSON.stringify({ branches: next }));
      }
    } catch {}
  };

  const openModal = () => {
    setName("");
    setAddress("");
    setPhone("");
    setEmail("");
    setHours("");
    setCapacity("");
    setManager("");
    setStatus("Active");
    setIsModalOpen(true);
  };
  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    const newBranch: Branch = {
      id: `br${Date.now()}`,
      name: name.trim(),
      address: address.trim(),
      revenue: 0,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      hours: hours.trim() || undefined,
      capacity: typeof capacity === "number" ? capacity : capacity === "" ? undefined : Number(capacity),
      manager: manager.trim() || undefined,
      status,
    };
    saveData([...branches, newBranch]);
    setIsModalOpen(false);
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

          <div className="mb-8">
            <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="fas fa-store" />
                    </div>
                    <h1 className="text-2xl font-bold">Branch Management</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">Manage your salon locations and addresses.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Branch Locations</h2>
              <button
                onClick={openModal}
                className="w-full sm:w-auto px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 font-medium shadow-md transition"
              >
                <i className="fas fa-plus mr-2" />
                Add Branch
              </button>
            </div>

                <div id="branch-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {branches.map((b, idx) => {
                const isHQ = b.id === "br1";
                const rate = isHQ ? 75 : 45; // mock metric
                return (
                  <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-xl">
                        <i className="fas fa-building" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg text-slate-900 truncate">{b.name}</h3>
                            <p className="text-sm text-slate-500 truncate">{b.address}</p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                              {b.manager && <span className="inline-flex items-center gap-1"><i className="fas fa-user-tie" /> {b.manager}</span>}
                              {b.status && (
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${b.status === "Active" ? "bg-emerald-50 text-emerald-700" : b.status === "Pending" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                                  <i className="fas fa-circle" />
                                  {b.status}
                                </span>
                              )}
                            </div>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="truncate">Occupancy Rate (Mock)</span>
                          <span className="ml-3">{rate}%</span>
                    </div>
                        {(b.phone || b.email) && (
                          <div className="mt-3 text-xs text-slate-500 flex flex-col gap-1">
                            {b.phone && <div><i className="fas fa-phone mr-1" /> {b.phone}</div>}
                            {b.email && <div className="truncate"><i className="fas fa-envelope mr-1" /> {b.email}</div>}</div>
                        )}
                  </div>
                );
              })}
              {branches.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-slate-500">
                  No branches yet. Use “Add Branch” to create one.
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Add Branch</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={closeModal}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Branch Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="e.g. Westside Plaza"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Address</label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="123 Street Name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Primary Contact Phone Number</label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      type="tel"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      placeholder="e.g. 0400 000 000"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Primary Contact Email</label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      placeholder="e.g. manager@salon.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Operating Hours</label>
                  <input
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    placeholder="e.g. Mon-Fri 9:00–17:00, Sat 10:00–16:00"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Capacity (Stations/Seats/Rooms)</label>
                    <input
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                      type="number"
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      placeholder="e.g. 12"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Branch Manager/Head</label>
                    <input
                      value={manager}
                      onChange={(e) => setManager(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      placeholder="e.g. Jane Doe"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">System Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-lg shadow-md transition mt-2"
                >
                  Add Branch
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


