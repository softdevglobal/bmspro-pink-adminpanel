"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { BranchInput, createBranchForOwner, subscribeBranchesForOwner } from "@/lib/branches";

type Branch = {
  id: string;
  name: string;
  address: string;
  revenue: number;
  phone?: string;
  email?: string;
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
  const [email, setEmail] = useState("");
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
  const [manager, setManager] = useState("");
  const [status, setStatus] = useState<"Active" | "Pending" | "Closed">("Active");
  // checklists sourced from services store (if present)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [staffOptions, setStaffOptions] = useState<Array<{ id: string; name: string; status?: string; branch?: string }>>([]);
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
        status: (r.status as any) || "Active",
      }));
      setBranches(mapped.length ? mapped : defaultBranches);
    });
    return () => unsub();
  }, [ownerUid, defaultBranches]);

  // load services/staff for checklists (best-effort from services store)
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("bms_services_data") : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const services = Array.isArray(parsed?.services) ? parsed.services : [];
      const staff = Array.isArray(parsed?.staff) ? parsed.staff : [];
      setServiceOptions(
        services.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || "Service"),
        }))
      );
      setStaffOptions(
        staff.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || s.displayName || "Staff"),
          status: s.status,
          branch: s.branch,
        }))
      );
    } catch {}
  }, []);

  const saveData = (next: Branch[]) => setBranches(next);

  const openModal = () => {
    setEditingId(null);
    setName("");
    setAddress("");
    setPhone("");
    setEmail("");
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
    setManager("");
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
    setEmail((b as any).email || "");
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
    setManager((b as any).manager || "");
    setStatus(((b as any).status as any) || "Active");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !ownerUid) return;
    setSaving(true);
    try {
      const payload: BranchInput = {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        hours: hoursObj,
        capacity: typeof capacity === "number" ? capacity : capacity === "" ? undefined : Number(capacity),
        manager: manager.trim() || undefined,
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
                        <button onClick={() => setPreviewBranch(b)} title="Preview" className="hover:text-slate-600">
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
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-base font-semibold text-slate-900">{editingId ? "Edit Branch" : "Add Branch"}</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={closeModal}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <form
                onSubmit={handleSubmit}
                className="p-6 space-y-4 overflow-y-auto overflow-x-hidden"
                style={{ maxHeight: "calc(92vh - 56px)" }}
              >
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
                  <label className="block text-xs font-bold text-slate-600 mb-2">Operating Hours</label>
                  <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-slate-50 max-h-72 overflow-y-auto overflow-x-hidden">
                    {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day) => {
                      const d = day as keyof HoursMap;
                      const row = (hoursObj[d] as HoursDay) || { open: "09:00", close: "17:00", closed: false };
                      const setRow = (patch: Partial<{ open: string; close: string; closed: boolean }>) =>
                        setHoursObj((prev) => {
                          const base = (prev || {}) as HoursMap;
                          const current = (base[d] as HoursDay) || {};
                          return {
                            ...base,
                            [d]: { ...current, ...patch },
                          };
                        });
                      return (
                        <div key={day} className="flex flex-wrap items-center gap-3 bg-white p-2 rounded border border-slate-100 text-sm">
                          <div className="w-24 md:w-28 font-medium text-slate-700 shrink-0">{day}</div>
                          <div className={`flex items-center gap-2 ${row.closed ? "opacity-50 pointer-events-none" : ""}`}>
                            <input
                              type="time"
                              className="border rounded p-1 text-xs w-24 md:w-28 shrink-0"
                              value={row.open || ""}
                              onChange={(e) => setRow({ open: e.target.value })}
                            />
                            <span className="text-slate-400">-</span>
                            <input
                              type="time"
                              className="border rounded p-1 text-xs w-24 md:w-28 shrink-0"
                              value={row.close || ""}
                              onChange={(e) => setRow({ close: e.target.value })}
                            />
                          </div>
                          <div className="ml-auto flex items-center gap-2 shrink-0">
                            <span className={`text-xs ${row.closed ? "font-bold text-rose-500" : "text-slate-400"}`}>
                              {row.closed ? "Closed" : "Open"}
                            </span>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={Boolean(row.closed)}
                                onChange={(e) => setRow({ closed: e.target.checked })}
                              />
                              <div className="w-10 h-5 bg-slate-300 rounded-full peer-focus:ring-2 peer-focus:ring-purple-500 peer peer-checked:bg-purple-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                {/* Staff checklist */}
                {staffOptions.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Assign Staff (Tick to Add)</label>
                    <div className="h-32 overflow-y-auto overflow-x-hidden border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1">
                      {staffOptions.map((s) => (
                        <label key={s.id} className="flex items-center space-x-2 p-1 hover:bg-slate-100 rounded cursor-pointer text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            checked={Boolean(selectedStaffIds[s.id])}
                            onChange={(e) =>
                              setSelectedStaffIds((prev) => ({ ...prev, [s.id]: e.target.checked }))
                            }
                          />
                          <span>{s.name}</span>
                          {s.branch && <span className="text-xs text-slate-400">({s.branch})</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* Services checklist */}
                {serviceOptions.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Assign Services (Tick to Add)</label>
                    <div className="h-32 overflow-y-auto overflow-x-hidden border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1">
                      {serviceOptions.map((s) => (
                        <label key={s.id} className="flex items-center space-x-2 p-1 hover:bg-slate-100 rounded cursor-pointer text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            checked={Boolean(selectedServiceIds[s.id])}
                            onChange={(e) =>
                              setSelectedServiceIds((prev) => ({ ...prev, [s.id]: e.target.checked }))
                            }
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className={`w-full bg-purple-600 text-white font-bold py-2.5 rounded-lg shadow-md mt-2 transition ${
                    saving ? "opacity-60 cursor-not-allowed" : "hover:bg-purple-700"
                  }`}
                >
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <i className="fas fa-circle-notch fa-spin" />
                      Saving...
                    </span>
                  ) : (
                    editingId ? "Save Changes" : "Add Branch"
                  )}
                </button>
              </form>
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


