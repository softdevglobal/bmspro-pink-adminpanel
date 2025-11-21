"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

type Service = {
  id: number;
  name: string;
  price: number;
  cost: number;
  duration: number;
  icon: string;
  reviews?: number;
  qualifiedStaff: string[];
  branches: string[];
};

type Staff = { id: string; name: string; role: string; branch: string; status: "Active" | "Suspended"; avatar: string };
type Branch = { id: string; name: string; address: string; revenue: number };

type ServicesStore = {
  services: Service[];
  staff: Staff[];
  branches: Branch[];
};

export default function ServicesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);

  // data
  const defaults = useMemo<ServicesStore>(
    () => ({
      services: [
        { id: 1, name: "Full Body Massage", price: 120, cost: 40, duration: 60, icon: "fa-solid fa-spa", reviews: 124, qualifiedStaff: ["st1", "st2"], branches: ["br1", "br2"] },
        { id: 2, name: "Express Facial", price: 60, cost: 15, duration: 30, icon: "fa-solid fa-spray-can-sparkles", reviews: 85, qualifiedStaff: ["st1"], branches: ["br1"] },
      ],
      staff: [
        { id: "st1", name: "Sarah Jenkins", role: "Senior Therapist", branch: "Downtown HQ", status: "Active", avatar: "Sarah" },
        { id: "st2", name: "Mike Ross", role: "Junior Associate", branch: "North Branch", status: "Active", avatar: "Mike" },
      ],
      branches: [
        { id: "br1", name: "Downtown HQ", address: "123 Main St, Melbourne", revenue: 45200 },
        { id: "br2", name: "North Branch", address: "88 North Rd, Brunswick", revenue: 12800 },
      ],
    }),
    []
  );

  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // modal/form
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [duration, setDuration] = useState<number | "">("");
  const [icon, setIcon] = useState("fa-solid fa-star");
  const [selectedStaff, setSelectedStaff] = useState<Record<string, boolean>>({});
  const [selectedBranches, setSelectedBranches] = useState<Record<string, boolean>>({});

  // guard
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

  // load
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("bms_services_data") : null;
      if (raw) {
        const parsed = JSON.parse(raw) as ServicesStore;
        setServices(parsed?.services || defaults.services);
        setStaff(parsed?.staff || defaults.staff);
        setBranches(parsed?.branches || defaults.branches);
      } else {
        setServices(defaults.services);
        setStaff(defaults.staff);
        setBranches(defaults.branches);
        if (typeof window !== "undefined") localStorage.setItem("bms_services_data", JSON.stringify(defaults));
      }
    } catch {
      setServices(defaults.services);
      setStaff(defaults.staff);
      setBranches(defaults.branches);
    }
  }, [defaults]);

  const saveStore = (next: Partial<ServicesStore>) => {
    const store: ServicesStore = {
      services: next.services ?? services,
      staff: next.staff ?? staff,
      branches: next.branches ?? branches,
    };
    setServices(store.services);
    setStaff(store.staff);
    setBranches(store.branches);
    try {
      if (typeof window !== "undefined") localStorage.setItem("bms_services_data", JSON.stringify(store));
    } catch {}
  };

  // toast
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const showToast = (text: string) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  const openModal = () => {
    setName("");
    setPrice("");
    setCost("");
    setDuration("");
    setIcon("fa-solid fa-star");
    const staffMap: Record<string, boolean> = {};
    const branchMap: Record<string, boolean> = {};
    staff.forEach((s) => (staffMap[s.id] = false));
    branches.forEach((b) => (branchMap[b.id] = false));
    setSelectedStaff(staffMap);
    setSelectedBranches(branchMap);
    setIsModalOpen(true);
  };
  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !price || !cost || !duration) return;
    const qualifiedStaff = Object.keys(selectedStaff).filter((id) => selectedStaff[id]);
    const selectedBrs = Object.keys(selectedBranches).filter((id) => selectedBranches[id]);
    const newService: Service = {
      id: Date.now(),
      name: name.trim(),
      price: Number(price),
      cost: Number(cost),
      duration: Number(duration),
      icon: icon || "fa-solid fa-star",
      reviews: 0,
      qualifiedStaff,
      branches: selectedBrs,
    };
    saveStore({ services: [newService, ...services] });
    setIsModalOpen(false);
    showToast("Service added to catalog!");
  };

  const deleteService = (id: number) => {
    if (!confirm("Remove this service?")) return;
    saveStore({ services: services.filter((s) => s.id !== id) });
    showToast("Service removed.");
  };

  const totalBranches = branches.length;

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
                      <i className="fas fa-tags" />
                    </div>
                    <h1 className="text-2xl font-bold">Services</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">Manage your catalog of services.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Services</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {services.map((s) => {
                const staffCount = s.qualifiedStaff?.length || 0;
                const branchCount = s.branches?.length || 0;
                const branchLabel = branchCount === totalBranches ? "All Branches" : `${branchCount} Branches`;
                return (
                  <div key={s.id} className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:border-pink-300 transition relative">
                    <button onClick={() => deleteService(s.id)} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500">
                      <i className="fas fa-trash" />
                    </button>
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                        <i className={s.icon} />
                      </div>
                      <div className="text-right pr-6">
                        <span className="block text-lg font-bold text-slate-800">${s.price}</span>
                        <span className="text-xs text-slate-400 block">Cost: ${s.cost || 0}</span>
                      </div>
                    </div>
                    <h3 className="font-bold text-lg mb-1">{s.name}</h3>
                    <div className="text-xs text-slate-500 mb-3">
                      {s.duration} mins • <span className="text-purple-600 font-medium">{branchLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1 text-amber-400">
                        <i className="fas fa-star" />
                        <span className="text-slate-400 ml-1">({s.reviews || 0})</span>
                      </div>
                      <div className="text-slate-500 bg-slate-100 px-2 py-1 rounded-full" title="Qualified Staff">
                        <i className="fas fa-user-check mr-1" /> {staffCount} Staff
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={openModal}
                className="card border-dashed border-2 border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-pink-400 hover:text-pink-500 transition h-full min-h-[200px]"
              >
                <i className="fas fa-plus text-3xl mb-2" />
                <span className="font-medium">Add New Service</span>
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Toasts */}
      <div id="toast-container" className="fixed bottom-5 right-5 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="toast bg-slate-800 text-white px-4 py-3 rounded-lg shadow-md border-l-4 border-pink-500 flex items-center gap-2">
            <i className="fas fa-circle-check text-pink-500" />
            <span className="text-sm">{t.text}</span>
          </div>
        ))}
      </div>

      {/* Add Service Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Add Service</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={closeModal}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                <div className="p-6 space-y-4 overflow-y-auto">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Service Name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="e.g. Deep Tissue Massage" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Cust. Price ($)</label>
                      <input value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="120" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Internal Cost ($)</label>
                      <input value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="40" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Duration (mins)</label>
                    <input value={duration} onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="60" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Icon Class (FontAwesome)</label>
                    <input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="fa-solid fa-star" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Available at Branches</label>
                    <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                      {branches.length > 0 ? (
                        branches.map((b) => (
                          <label key={b.id} className="flex items-center space-x-2 p-1 hover:bg-slate-100 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!selectedBranches[b.id]}
                              onChange={(e) => setSelectedBranches((m) => ({ ...m, [b.id]: e.target.checked }))}
                              className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-sm text-slate-700">{b.name}</span>
                          </label>
                        ))
                      ) : (
                        <div className="text-xs text-slate-400 text-center py-2">No Branches Configured.</div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Select which locations offer this service.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Qualified Staff</label>
                    <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                      {staff.filter((s) => s.status === "Active").length > 0 ? (
                        staff
                          .filter((s) => s.status === "Active")
                          .map((s) => (
                            <label key={s.id} className="flex items-center space-x-2 p-1 hover:bg-slate-100 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!selectedStaff[s.id]}
                                onChange={(e) => setSelectedStaff((m) => ({ ...m, [s.id]: e.target.checked }))}
                                className="rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                              />
                              <span className="text-sm text-slate-700">{s.name}</span>
                            </label>
                          ))
                      ) : (
                        <div className="text-xs text-slate-400 text-center py-2">No Active Staff Found.</div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Only selected staff can be assigned this service.</p>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-slate-200">
                  <button type="submit" className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-2.5 rounded-lg shadow-md transition">
                    Save Service
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


