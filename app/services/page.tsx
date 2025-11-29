"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { subscribeBranchesForOwner } from "@/lib/branches";
import { subscribeSalonStaffForOwner } from "@/lib/salonStaff";
import { createServiceForOwner, deleteService as deleteServiceDoc, subscribeServicesForOwner, updateService } from "@/lib/services";

type Service = {
  id: string;
  name: string;
  price: number;
  cost: number;
  duration: number;
  icon: string;
  reviews?: number;
  staffIds: string[];
  branches: string[];
};

type Staff = { id: string; name: string; role: string; branch: string; status: "Active" | "Suspended"; avatar: string };
type Branch = { id: string; name: string };

export default function ServicesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);

  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // modal/form
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [previewService, setPreviewService] = useState<Service | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [duration, setDuration] = useState<number | "">("");
  const [icon, setIcon] = useState("fa-solid fa-star");
  const [selectedStaff, setSelectedStaff] = useState<Record<string, boolean>>({});
  const [selectedBranches, setSelectedBranches] = useState<Record<string, boolean>>({});
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconOptions = [
    { label: "Star", value: "fa-solid fa-star" },
    { label: "Scissors", value: "fa-solid fa-scissors" },
    { label: "Spa", value: "fa-solid fa-spa" },
    { label: "Spray", value: "fa-solid fa-spray-can-sparkles" },
    { label: "Hand Sparkles", value: "fa-solid fa-hand-sparkles" },
    { label: "Heart", value: "fa-solid fa-heart" },
    { label: "Leaf", value: "fa-solid fa-leaf" },
    { label: "Gem", value: "fa-solid fa-gem" },
    { label: "Magic Wand", value: "fa-solid fa-wand-magic-sparkles" },
  ];

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
        if (role === "salon_branch_admin") {
          router.replace("/branches");
          return;
        }
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

  // live Firestore data for this owner
  useEffect(() => {
    if (!ownerUid) return;
    const unsubBranches = subscribeBranchesForOwner(ownerUid, (rows) => {
      setBranches(rows.map((r) => ({ id: String(r.id), name: String(r.name || "") })));
    });
    const unsubStaff = subscribeSalonStaffForOwner(ownerUid, (rows) => {
      setStaff(
        rows.map((r) => ({
          id: String(r.id),
          name: String(r.name || ""),
          role: String(r.role || ""),
          branch: String(r.branchName || ""),
          status: (r.status as any) === "Suspended" ? "Suspended" : "Active",
          avatar: String(r.avatar || r.name || ""),
        }))
      );
    });
    const unsubServices = subscribeServicesForOwner(ownerUid, (rows) => {
      setServices(
        rows.map((r) => ({
          id: String(r.id),
          name: String(r.name || ""),
          price: Number(r.price || 0),
          cost: Number(r.cost || 0),
          duration: Number(r.duration || 0),
          icon: String(r.icon || "fa-solid fa-star"),
          reviews: Number(r.reviews || 0),
          branches: (Array.isArray(r.branches) ? r.branches : []).map(String),
          staffIds: (Array.isArray(r.staffIds) ? r.staffIds : []).map(String),
        }))
      );
    });
    return () => {
      unsubBranches();
      unsubStaff();
      unsubServices();
    };
  }, [ownerUid]);

  // toast
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const showToast = (text: string) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  const openModal = () => {
    setEditingServiceId(null);
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

  const openEdit = (svc: Service) => {
    setEditingServiceId(svc.id);
    setName(svc.name);
    setPrice(svc.price);
    setCost(svc.cost);
    setDuration(svc.duration);
    setIcon(svc.icon || "fa-solid fa-star");
    const staffMap: Record<string, boolean> = {};
    const branchMap: Record<string, boolean> = {};
    staff.forEach((s) => (staffMap[s.id] = svc.staffIds?.includes(s.id) || false));
    branches.forEach((b) => (branchMap[b.id] = svc.branches?.includes(b.id) || false));
    setSelectedStaff(staffMap);
    setSelectedBranches(branchMap);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !price || !cost || !duration) return;
    const qualifiedStaff = Object.keys(selectedStaff).filter((id) => selectedStaff[id]);
    const selectedBrs = Object.keys(selectedBranches).filter((id) => selectedBranches[id]);
    if (!ownerUid) return;
    setSaving(true);
    try {
      if (editingServiceId) {
        await updateService(editingServiceId, {
          name: name.trim(),
          price: Number(price),
          cost: Number(cost),
          duration: Number(duration),
          icon: icon || "fa-solid fa-star",
          staffIds: qualifiedStaff,
          branches: selectedBrs,
        });
      } else {
        await createServiceForOwner(ownerUid, {
          name: name.trim(),
          price: Number(price),
          cost: Number(cost),
          duration: Number(duration),
          icon: icon || "fa-solid fa-star",
          reviews: 0,
          staffIds: qualifiedStaff,
          branches: selectedBrs,
        });
      }
      setIsModalOpen(false);
      setEditingServiceId(null);
      showToast(editingServiceId ? "Service updated." : "Service added to catalog!");
    } catch {
      showToast(editingServiceId ? "Failed to update service" : "Failed to add service");
    } finally {
      setSaving(false);
    }
  };

  const deleteService = (id: string) => {
    if (!confirm("Remove this service?")) return;
    deleteServiceDoc(id)
      .then(() => showToast("Service removed."))
      .catch(() => showToast("Failed to remove service."));
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
                const staffCount = s.staffIds?.length || 0;
                const branchCount = s.branches?.length || 0;
                const branchLabel = branchCount === totalBranches ? "All Branches" : `${branchCount} Branches`;
                return (
                  <div key={s.id} className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:border-pink-300 transition">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                        <i className={s.icon} />
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-right">
                          <span className="block text-lg font-bold text-slate-800">${s.price}</span>
                          <span className="text-xs text-slate-400 block">Cost: ${s.cost || 0}</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-400">
                          <button onClick={() => setPreviewService(s)} title="Preview" className="hover:text-slate-600">
                            <i className="fas fa-eye" />
                          </button>
                          <button onClick={() => openEdit(s)} title="Edit" className="hover:text-blue-600">
                            <i className="fas fa-pen" />
                          </button>
                          <button onClick={() => deleteService(s.id)} title="Delete" className="hover:text-rose-500">
                            <i className="fas fa-trash" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 mb-1">{s.name}</h3>
                    <div className="text-xs text-slate-600 mb-3">
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] flex flex-col">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-3 sm:p-5 border-b border-slate-700 flex justify-between items-center rounded-t-xl shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <i className="fa-solid fa-tags text-white text-sm sm:text-base" />
                </div>
                <h3 className="font-bold text-white text-sm sm:text-lg">{editingServiceId ? "Edit Service" : "Add New Service"}</h3>
              </div>
              <button 
                type="button"
                onClick={closeModal}
                className="text-white/60 hover:text-white transition w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark text-xl" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-3 sm:p-6 space-y-3 sm:space-y-4">
                {/* Basic Service Information */}
                <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-200">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                    <i className="fas fa-sparkles text-pink-600" />
                    Service Details
                  </h4>
                  <div className="space-y-2.5 sm:space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Service Name</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="e.g. Deep Tissue Massage" />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Duration (mins)</label>
                        <input value={duration} onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="60" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Customer Price ($)</label>
                        <input value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="120" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Internal Cost ($)</label>
                      <input value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} type="number" required className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="40" />
                      <p className="text-[10px] text-slate-500 mt-1">Your cost to provide this service</p>
                    </div>
                  </div>
                </div>
                {/* Icon Selection */}
                <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-pink-200">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                    <i className="fas fa-icons text-purple-600" />
                    Service Icon
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-lg">
                        <i className={`${icon} text-xl`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          value={icon}
                          onChange={(e) => setIcon(e.target.value)}
                          className="w-full border border-pink-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white"
                          placeholder="fa-solid fa-star"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setIconPickerOpen((v) => !v)}
                        className="px-2 sm:px-3 py-2 text-xs sm:text-sm rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 text-white hover:from-pink-700 hover:to-purple-700 shadow-md transition-all shrink-0 font-medium"
                        title="Choose icon"
                      >
                        <i className="fas fa-palette mr-1" />
                        <span className="hidden sm:inline">Pick</span>
                      </button>
                    </div>
                    {iconPickerOpen && (
                      <div className="mt-2 border-2 border-purple-200 rounded-xl p-3 bg-white shadow-inner">
                        <div className="grid grid-cols-3 gap-2 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
                          {iconOptions.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setIcon(opt.value);
                                setIconPickerOpen(false);
                              }}
                              className={`flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-purple-50 border-2 transition-all ${
                                icon === opt.value ? "border-purple-500 bg-purple-50 shadow-md" : "border-slate-200"
                              }`}
                            >
                              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-100 to-purple-100 text-pink-600 flex items-center justify-center">
                                <i className={opt.value} />
                              </span>
                              <span className="text-[10px] font-medium text-slate-700 text-center leading-tight">{opt.label}</span>
                            </button>
                          ))}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-purple-100">
                          <i className="fas fa-info-circle mr-1" />
                          Select an icon or enter Font Awesome class above
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Available Branches */}
                <div className="bg-blue-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-blue-200">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                    <i className="fas fa-store text-blue-600" />
                    Available Branches
                  </h4>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto border-2 border-blue-200 rounded-lg p-2 sm:p-3 bg-white custom-scrollbar">
                    {branches.length > 0 ? (
                      branches.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 p-2 hover:bg-blue-50 rounded-md cursor-pointer transition group">
                          <input
                            type="checkbox"
                            checked={!!selectedBranches[b.id]}
                            onChange={(e) => setSelectedBranches((m) => ({ ...m, [b.id]: e.target.checked }))}
                            className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <span className="text-xs sm:text-sm text-slate-700 font-medium group-hover:text-blue-700">
                            <i className="fas fa-building text-blue-400 mr-1.5" />
                            {b.name}
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 text-center py-3">
                        <i className="fas fa-store-slash mb-1 block text-slate-300" />
                        No Branches Configured.
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-blue-600 mt-1.5">
                    <i className="fas fa-info-circle mr-1" />
                    Select which locations offer this service
                  </p>
                </div>
                {/* Qualified Staff */}
                <div className="bg-emerald-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-emerald-200">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                    <i className="fas fa-user-check text-emerald-600" />
                    Qualified Staff
                  </h4>
                  <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto border-2 border-emerald-200 rounded-lg p-2 sm:p-3 bg-white custom-scrollbar">
                    {staff.filter((s) => s.status === "Active").length > 0 ? (
                      staff
                        .filter((s) => s.status === "Active")
                        .map((s) => (
                          <label key={s.id} className="flex items-center gap-2 p-2 hover:bg-emerald-50 rounded-md cursor-pointer transition group">
                            <input
                              type="checkbox"
                              checked={!!selectedStaff[s.id]}
                              onChange={(e) => setSelectedStaff((m) => ({ ...m, [s.id]: e.target.checked }))}
                              className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                            />
                            <img
                              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(s.avatar)}`}
                              alt={s.name}
                              className="w-6 h-6 rounded-full bg-slate-100"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs sm:text-sm text-slate-700 font-medium group-hover:text-emerald-700 block truncate">{s.name}</span>
                              <span className="text-[10px] text-slate-500">{s.role}</span>
                            </div>
                          </label>
                        ))
                    ) : (
                      <div className="text-xs text-slate-400 text-center py-3">
                        <i className="fas fa-user-slash mb-1 block text-slate-300" />
                        No Active Staff Found.
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-emerald-600 mt-1.5">
                    <i className="fas fa-info-circle mr-1" />
                    Only selected staff can perform this service
                  </p>
                </div>
                </div>
                
                {/* Footer with Submit Button */}
                <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 rounded-b-xl shrink-0">
                  <button
                    type="submit"
                    disabled={saving}
                    className={`w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold py-2.5 sm:py-3 rounded-lg shadow-lg transition-all text-sm sm:text-base ${
                      saving ? "opacity-60 cursor-not-allowed" : "hover:from-pink-700 hover:to-purple-700 hover:shadow-xl transform active:scale-95 sm:hover:scale-[1.02]"
                    }`}
                  >
                    {saving ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <i className="fa-solid fa-circle-notch fa-spin" />
                        Saving...
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        <i className="fa-solid fa-save" />
                        {editingServiceId ? "Save Changes" : "Add Service"}
                      </span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
      )}

      {/* Preview Service Modal */}
      {previewService && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreviewService(null)} />
          <div className="relative flex items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Service Preview</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={() => setPreviewService(null)}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                    <i className={previewService.icon} />
                  </div>
                  <div className="flex-1">
                    <div className="text-lg font-semibold text-slate-900">{previewService.name}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {previewService.duration} mins • ${previewService.price} {" "}
                      <span className="text-slate-400">(Cost: ${previewService.cost})</span>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-600 mb-2">Available Branches</div>
                  <div className="flex flex-wrap gap-2">
                    {previewService.branches.length > 0 ? (
                      previewService.branches.map((bid) => {
                        const b = branches.find((x) => x.id === bid);
                        return (
                          <span key={bid} className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs">
                            {b?.name || bid}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-slate-400">No branches selected.</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setPreviewService(null)}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 font-medium shadow-md transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


