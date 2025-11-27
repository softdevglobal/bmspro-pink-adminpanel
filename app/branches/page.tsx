"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { BranchInput, createBranchForOwner, subscribeBranchesForOwner } from "@/lib/branches";
import { subscribeSalonStaffForOwner } from "@/lib/salonStaff";
import { subscribeServicesForOwner } from "@/lib/services";

type Branch = {
  id: string;
  name: string;
  address: string;
  revenue: number;
  phone?: string;
  email?: string;
  staffIds?: string[];
  serviceIds?: string[];
  hours?:
    | string
    | {
        Monday?: { open?: string; close?: string; closed?: boolean };
        Tuesday?: { open?: string; close?: string; closed?: boolean };
        Wednesday?: { open?: string; close?: string; closed?: boolean };
        Thursday?: { open?: string; close?: string; closed?: boolean };
        Friday?: { open?: string; close?: string; closed?: boolean };
        Saturday?: { open?: string; close?: string; closed?: boolean };
        Sunday?: { open?: string; close?: string; closed?: boolean };
      };
  capacity?: number;
  manager?: string;
  adminStaffId?: string;
  status?: "Active" | "Pending" | "Closed";
};

type HoursDay = { open?: string; close?: string; closed?: boolean };
type HoursMap = {
  Monday?: HoursDay;
  Tuesday?: HoursDay;
  Wednesday?: HoursDay;
  Thursday?: HoursDay;
  Friday?: HoursDay;
  Saturday?: HoursDay;
  Sunday?: HoursDay;
};

export default function BranchesPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewBranch, setPreviewBranch] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); // Added email state
  // structured hours builder state
  const [hoursObj, setHoursObj] = useState<HoursMap>({
    Monday: { open: "09:00", close: "17:00", closed: false },
    Tuesday: { open: "09:00", close: "17:00", closed: false },
    Wednesday: { open: "09:00", close: "17:00", closed: false },
    Thursday: { open: "09:00", close: "17:00", closed: false },
    Friday: { open: "09:00", close: "17:00", closed: false },
    Saturday: { open: "10:00", close: "16:00", closed: false },
    Sunday: { open: "10:00", close: "16:00", closed: true },
  });
  const [capacity, setCapacity] = useState<number | "">("");
  const [adminStaffId, setAdminStaffId] = useState("");
  const [status, setStatus] = useState<"Active" | "Pending" | "Closed">("Active");
  // checklists sourced from services store (if present)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [staffOptions, setStaffOptions] = useState<Array<{ id: string; name: string; email?: string; status?: string; branch?: string }>>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Record<string, boolean>>({});
  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, boolean>>({});

  // seed defaults (only used when no data in db; not persisted)
  const defaultBranches: Branch[] = useMemo(() => [], []);

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

  // subscribe to branches for this owner
  useEffect(() => {
    if (!ownerUid) return;
    const unsub = subscribeBranchesForOwner(ownerUid, (rows) => {
      const mapped: Branch[] = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name || ""),
        address: String(r.address || ""),
        revenue: Number(r.revenue || 0),
        phone: r.phone,
        email: r.email,
        // @ts-ignore
        hours: r.hours,
        capacity: r.capacity,
        manager: r.manager,
        adminStaffId: r.adminStaffId, // Map adminStaffId from Firestore
        status: (r.status as any) || "Active",
        staffIds: Array.isArray((r as any).staffIds) ? (r as any).staffIds.map(String) : [],
        serviceIds: Array.isArray((r as any).serviceIds) ? (r as any).serviceIds.map(String) : [],
      }));
      setBranches(mapped.length ? mapped : defaultBranches);
    });
    return () => unsub();
  }, [ownerUid, defaultBranches]);

  // Real-time services and staff lists for assignment checklists
  useEffect(() => {
    if (!ownerUid) return;
    const unsubStaff = subscribeSalonStaffForOwner(ownerUid, (rows) => {
      setStaffOptions(
        rows.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || s.displayName || "Staff"),
          email: s.email,
          status: s.status,
          branch: s.branchName,
        }))
      );
    });
    const unsubServices = subscribeServicesForOwner(ownerUid, (rows) => {
      setServiceOptions(
        rows.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || "Service"),
        }))
      );
    });
    return () => {
      unsubStaff();
      unsubServices();
    };
  }, [ownerUid]);

  const saveData = (next: Branch[]) => setBranches(next);

  const openModal = () => {
    setEditingId(null);
    setName("");
    setAddress("");
    setPhone("");
    setEmail(""); // Reset email state
    setHoursObj({
      Monday: { open: "09:00", close: "17:00", closed: false },
      Tuesday: { open: "09:00", close: "17:00", closed: false },
      Wednesday: { open: "09:00", close: "17:00", closed: false },
      Thursday: { open: "09:00", close: "17:00", closed: false },
      Friday: { open: "09:00", close: "17:00", closed: false },
      Saturday: { open: "10:00", close: "16:00", closed: false },
      Sunday: { open: "10:00", close: "16:00", closed: true },
    });
    setCapacity("");
    setAdminStaffId("");
    setStatus("Active");
    setSelectedServiceIds({});
    setSelectedStaffIds({});
    setIsModalOpen(true);
  };
  const closeModal = () => setIsModalOpen(false);

  const openEditModal = (b: Branch) => {
    setEditingId(b.id);
    setName(b.name || "");
    setAddress((b as any).address || "");
    setPhone((b as any).phone || "");
    setEmail(b.email || ""); // Set email state
    // prefill assignments
    const staffMap: Record<string, boolean> = {};
    const serviceMap: Record<string, boolean> = {};
    (b.staffIds || []).forEach((id) => (staffMap[id] = true));
    (b.serviceIds || []).forEach((id) => (serviceMap[id] = true));
    setSelectedStaffIds(staffMap);
    setSelectedServiceIds(serviceMap);
    // prefill hours when present as object
    const h = (b as any).hours;
    if (h && typeof h === "object") {
      setHoursObj(h as HoursMap);
    } else {
      setHoursObj({
        Monday: { open: "09:00", close: "17:00", closed: false },
        Tuesday: { open: "09:00", close: "17:00", closed: false },
        Wednesday: { open: "09:00", close: "17:00", closed: false },
        Thursday: { open: "09:00", close: "17:00", closed: false },
        Friday: { open: "09:00", close: "17:00", closed: false },
        Saturday: { open: "10:00", close: "16:00", closed: false },
        Sunday: { open: "10:00", close: "16:00", closed: true },
      });
    }
    setCapacity((b as any).capacity ?? "");
    setAdminStaffId((b as any).adminStaffId || "");
    setStatus(((b as any).status as any) || "Active");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !ownerUid) return;
    setSaving(true);
    try {
      // Derive manager and email from adminStaffId if present
      let derivedManager: string | undefined = undefined;
      let derivedEmail: string | undefined = undefined;
      if (adminStaffId) {
        const st = staffOptions.find((s) => s.id === adminStaffId);
        if (st) {
          derivedManager = st.name;
          derivedEmail = st.email;
        }
      }

      const payload: BranchInput = {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || undefined,
        email: derivedEmail,
        staffIds: Object.keys(selectedStaffIds).filter((id) => selectedStaffIds[id]),
        serviceIds: Object.keys(selectedServiceIds).filter((id) => selectedServiceIds[id]),
        hours: hoursObj,
        capacity: typeof capacity === "number" ? capacity : capacity === "" ? undefined : Number(capacity),
        manager: derivedManager,
        adminStaffId: adminStaffId || null,
        status,
      };
      if (editingId) {
        await (await import("@/lib/branches")).updateBranch(editingId, payload);
      } else {
        await createBranchForOwner(ownerUid, payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error("Failed to create branch", err);
    } finally {
      setSaving(false);
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
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
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
                      <div className="flex items-center gap-3 text-slate-400">
                        <button onClick={() => router.push(`/branches/${b.id}`)} title="Preview" className="hover:text-slate-600">
                          <i className="fas fa-eye" />
                        </button>
                        <button onClick={() => openEditModal(b)} title="Edit" className="hover:text-blue-600">
                          <i className="fas fa-pen" />
                        </button>
                        <button onClick={() => setDeleteTarget(b)} title="Delete" className="hover:text-rose-600">
                          <i className="fas fa-trash" />
                        </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden transform transition-all scale-100">
            
            {/* Creative Header */}
            <div className="relative bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 px-8 py-6 text-white shrink-0 overflow-hidden">
              <div className="absolute -right-6 -top-6 text-white/10">
                <i className="fas fa-store text-9xl" />
              </div>
              
              {/* Close Button - Absolute Top Right */}
              <button 
                onClick={closeModal}
                className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-sm z-20"
              >
                <i className="fas fa-times text-lg" />
              </button>

              <div className="relative z-10">
                <h3 className="text-2xl font-bold">{editingId ? "Edit Branch" : "New Branch"}</h3>
                <p className="text-purple-100 text-sm mt-1">
                  {editingId ? "Update branch details and settings." : "Set up a new salon location."}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 sm:p-8 bg-slate-50/50">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* Left Column: Core Details */}
                <div className="space-y-6">
                  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2 mb-2">
                      <i className="fas fa-info-circle text-purple-500" />
                      Basic Information
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Branch Name</label>
                        <div className="relative">
                          <i className="fas fa-store absolute left-3 top-3 text-slate-400" />
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all outline-none"
                            placeholder="e.g. Westside Plaza"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Address</label>
                        <div className="relative">
                          <i className="fas fa-map-marker-alt absolute left-3 top-3 text-slate-400" />
                          <input
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all outline-none"
                            placeholder="123 Street Name, City"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacity</label>
                        <div className="relative">
                          <i className="fas fa-chair absolute left-3 top-3 text-slate-400" />
                          <input
                            value={capacity}
                            onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                            type="number"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all outline-none"
                            placeholder="e.g. 12 stations"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2 mb-2">
                      <i className="fas fa-address-book text-purple-500" />
                      Contact & Admin
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Phone</label>
                        <div className="relative">
                          <i className="fas fa-phone absolute left-3 top-3 text-slate-400" />
                          <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            type="tel"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all outline-none"
                            placeholder="+1 234 567 890"
                          />
                        </div>
                      </div>

                      <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                        <label className="block text-xs font-bold text-purple-800 uppercase mb-2">Assign Branch Admin</label>
                        <div className="relative">
                          <i className="fas fa-user-shield absolute left-3 top-3 text-purple-400" />
                          <select
                            value={adminStaffId}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAdminStaffId(val);
                              if (val) {
                                const st = staffOptions.find((s) => s.id === val);
                                if (st && st.email) setEmail(st.email);
                              }
                            }}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-purple-200 rounded-lg text-sm focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 transition-all outline-none appearance-none text-slate-700"
                          >
                            <option value="">-- No Admin Assigned --</option>
                            {staffOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.branch ? `(${s.branch})` : ""}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-3 top-3 pointer-events-none text-purple-400">
                            <i className="fas fa-chevron-down" />
                          </div>
                        </div>
                        <p className="text-xs text-purple-600 mt-2">
                          <i className="fas fa-info-circle mr-1" />
                          User role will become <strong>Branch Admin</strong>.
                        </p>
                        {adminStaffId && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-purple-700 bg-purple-100/50 p-2 rounded">
                            <i className="fas fa-envelope" />
                            Auto-linked email: <strong>{email || "No email found"}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Hours & Status */}
                <div className="space-y-6">
                  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                      <div className="flex items-center gap-2 text-slate-800 font-semibold">
                        <i className="fas fa-clock text-purple-500" />
                        Operating Hours
                      </div>
                      <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">Local Time</span>
                    </div>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar overflow-x-hidden">
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => {
                        const d = day as keyof HoursMap;
                        const row = (hoursObj[d] as HoursDay) || { open: "09:00", close: "17:00", closed: false };
                        const isClosed = Boolean(row.closed);
                        
                        const setRow = (patch: Partial<{ open: string; close: string; closed: boolean }>) =>
                          setHoursObj((prev) => {
                            const base = (prev || {}) as HoursMap;
                            const current = (base[d] as HoursDay) || {};
                            return { ...base, [d]: { ...current, ...patch } };
                          });

                        return (
                          <div 
                            key={day} 
                            className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all ${
                              isClosed 
                                ? "bg-slate-50 border-slate-100" 
                                : "bg-white border-slate-200 shadow-sm hover:border-purple-300"
                            }`}
                          >
                            <div className="w-20 font-medium text-sm text-slate-700 shrink-0">{day}</div>
                            
                            <div className="flex items-center justify-center gap-1 flex-1">
                              {!isClosed ? (
                                <>
                                  <input
                                    type="time"
                                    className="bg-slate-50 border border-slate-200 rounded px-1 py-1 text-xs text-slate-600 focus:border-purple-500 focus:ring-0 outline-none w-28 text-center"
                                    value={row.open || ""}
                                    onChange={(e) => setRow({ open: e.target.value })}
                                  />
                                  <span className="text-slate-300 text-xs">-</span>
                                  <input
                                    type="time"
                                    className="bg-slate-50 border border-slate-200 rounded px-1 py-1 text-xs text-slate-600 focus:border-purple-500 focus:ring-0 outline-none w-28 text-center"
                                    value={row.close || ""}
                                    onChange={(e) => setRow({ close: e.target.value })}
                                  />
                                </>
                              ) : (
                                <span className="text-xs font-medium text-slate-400 italic">Closed</span>
                              )}
                            </div>

                            <div className="shrink-0 flex items-center">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="sr-only peer" 
                                  checked={!isClosed} 
                                  onChange={() => setRow({ closed: !isClosed })}
                                />
                                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2 mb-2">
                      <i className="fas fa-server text-purple-500" />
                      System Status
                    </div>
                    <div>
                      <div className="grid grid-cols-3 gap-2">
                        {["Active", "Pending", "Closed"].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s as any)}
                            className={`py-2 px-3 rounded-lg text-sm font-medium border transition-all ${
                              status === s
                                ? s === "Active" 
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm ring-1 ring-emerald-200"
                                  : s === "Pending"
                                  ? "bg-amber-50 border-amber-200 text-amber-700 shadow-sm ring-1 ring-amber-200"
                                  : "bg-rose-50 border-rose-200 text-rose-700 shadow-sm ring-1 ring-rose-200"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Checklists Section (Staff / Services) */}
              {(staffOptions.length > 0 || serviceOptions.length > 0) && (
                <div className="mt-8 bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold mb-4">
                    <i className="fas fa-tasks text-purple-500" />
                    Assignments
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {staffOptions.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Staff Members</label>
                        <div className="h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50 space-y-1 custom-scrollbar">
                          {staffOptions.map((s) => (
                            <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all cursor-pointer group">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 transition"
                                checked={Boolean(selectedStaffIds[s.id])}
                                onChange={(e) =>
                                  setSelectedStaffIds((prev) => ({ ...prev, [s.id]: e.target.checked }))
                                }
                              />
                              <span className="text-sm text-slate-700 group-hover:text-purple-700">{s.name}</span>
                              {s.branch && <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{s.branch}</span>}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {serviceOptions.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Services Offered</label>
                        <div className="h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50/50 space-y-1 custom-scrollbar">
                          {serviceOptions.map((s) => (
                            <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all cursor-pointer group">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 transition"
                                checked={Boolean(selectedServiceIds[s.id])}
                                onChange={(e) =>
                                  setSelectedServiceIds((prev) => ({ ...prev, [s.id]: e.target.checked }))
                                }
                              />
                              <span className="text-sm text-slate-700 group-hover:text-purple-700">{s.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="p-6 border-t border-slate-100 bg-white flex items-center justify-end gap-3 shrink-0">
              <button
                onClick={closeModal}
                disabled={saving}
                className="px-6 py-2.5 rounded-xl text-slate-600 font-medium hover:bg-slate-100 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))}
                disabled={saving}
                className="px-8 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-purple-500/30 transform hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-70 disabled:transform-none"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <i className="fas fa-circle-notch fa-spin" />
                    Saving...
                  </span>
                ) : (
                  editingId ? "Save Changes" : "Create Branch"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Branch Modal */}
      {previewBranch && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreviewBranch(null)} />
          <div className="relative flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">
                    <i className="fas fa-building" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-semibold truncate">{previewBranch.name}</div>
                    <div className="text-sm text-white/80 truncate">{previewBranch.address}</div>
                  </div>
                </div>
                {previewBranch.status && (
                  <div
                    className={`ml-4 shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                      previewBranch.status === "Active"
                        ? "bg-emerald-100 text-emerald-800"
                        : previewBranch.status === "Pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    <i className="fas fa-circle" />
                    {previewBranch.status}
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-600">Contact</div>
                  <div className="text-sm text-slate-700 space-y-2">
                    {previewBranch.phone && (
                      <div className="flex items-center gap-2">
                        <i className="fas fa-phone text-slate-400" /> {previewBranch.phone}
                      </div>
                    )}
                    {previewBranch.email && (
                      <div className="flex items-center gap-2 truncate">
                        <i className="fas fa-envelope text-slate-400" /> {previewBranch.email}
                      </div>
                    )}
                    {previewBranch.manager && (
                      <div className="flex items-center gap-2">
                        <i className="fas fa-user-tie text-slate-400" /> {previewBranch.manager}
                      </div>
                    )}
                    {typeof previewBranch.capacity !== "undefined" && previewBranch.capacity !== null && previewBranch.capacity !== ("" as any) && (
                      <div className="flex items-center gap-2">
                        <i className="fas fa-chair text-slate-400" /> Capacity: {String(previewBranch.capacity)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Hours */}
                <div>
                  <div className="text-xs font-bold text-slate-600 mb-2">Operating Hours</div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                    <div className="max-h-48 overflow-y-auto">
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day) => {
                        const d = day as keyof HoursMap;
                        const row = (previewBranch.hours as any)?.[d] as HoursDay | undefined;
                        const text = row
                          ? row.closed
                            ? "Closed"
                            : row.open && row.close
                            ? `${row.open} - ${row.close}`
                            : "—"
                          : "—";
                        const isClosed = row?.closed;
                        return (
                          <div key={day} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-b-0 border-slate-200 bg-white">
                            <span className="text-slate-600">{day}</span>
                            <span className={`font-medium ${isClosed ? "text-rose-600" : "text-slate-800"}`}>{text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer actions */}
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setPreviewBranch(null);
                    openEditModal(previewBranch);
                  }}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 font-medium shadow-md transition"
                >
                  <i className="fas fa-pen mr-2" /> Edit
                </button>
                <button
                  onClick={() => setPreviewBranch(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg text-sm hover:bg-slate-300 font-medium transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                  <i className="fa-solid fa-triangle-exclamation" />
                </div>
                <h3 className="font-semibold text-slate-900">Delete branch?</h3>
              </div>
              <div className="p-5 text-sm text-slate-600">
                This will permanently remove <span className="font-semibold text-slate-800">{deleteTarget.name}</span>.
              </div>
              <div className="px-5 pb-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!deleteTarget) return;
                    setDeleting(true);
                    try {
                      await (await import("@/lib/branches")).deleteBranch(deleteTarget.id);
                      setDeleteTarget(null);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="px-4 py-2 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? (
                    <span className="inline-flex items-center gap-2">
                      <i className="fa-solid fa-circle-notch fa-spin" /> Deleting...
                    </span>
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


