"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { subscribeBranchesForOwner } from "@/lib/branches";
import {
  createSalonStaffForOwner as createStaff,
  subscribeSalonStaffForOwner,
  updateSalonStaff,
  deleteSalonStaff,
} from "@/lib/salonStaff";

export default function SettingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"directory" | "training" | "roster">("directory");
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string }>>([]);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [savingStaff, setSavingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [previewStaff, setPreviewStaff] = useState<Staff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const [deleting, setDeleting] = useState(false);

  type StaffTraining = { ohs: boolean; prod: boolean; tool: boolean };
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
  type Staff = {
    id: string;
    name: string;
    role: string;
    branch: string;
    branchId?: string;
    email?: string | null;
    authUid?: string | null;
    status: "Active" | "Suspended";
    avatar: string;
    training: StaffTraining;
    systemRole?: string;
  };
  type Branch = { id: string; name: string; address?: string; revenue?: number; hours?: HoursMap };

  const [data, setData] = useState<{ staff: Staff[]; branches: Branch[] }>({
    staff: [],
    branches: [],
  });

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
      setOwnerUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  // Subscribe to branches and staff for this owner
  useEffect(() => {
    if (!ownerUid) return;
    const unsubBranches = subscribeBranchesForOwner(ownerUid, (rows) => {
      const branches = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name || ""),
        hours: (r as any).hours as HoursMap | undefined,
      }));
      setData((prev) => ({ ...prev, branches }));
    });
    const unsubStaff = subscribeSalonStaffForOwner(ownerUid, (rows) => {
      const staff: Staff[] = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name || ""),
        role: String(r.role || ""),
        branch: String(r.branchName || ""),
        branchId: String((r as any).branchId || ""),
        email: (r as any).email || null,
        authUid: (r as any).authUid || null,
        systemRole: (r as any).systemRole || "salon_staff",
        status: (r.status as any) === "Suspended" ? "Suspended" : "Active",
        avatar: String(r.avatar || r.name || ""),
        training: {
          ohs: Boolean(r?.training?.ohs),
          prod: Boolean(r?.training?.prod),
          tool: Boolean(r?.training?.tool),
        },
      }));
      setData((prev) => ({ ...prev, staff }));
    });
    return () => {
      unsubBranches();
      unsubStaff();
    };
  }, [ownerUid]);

  const showToast = (message: string) => {
    const id = `${Date.now()}`;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  // Suspension toggling removed – staff status changes are not exposed in UI.

  const resetData = () => {
    // Optional: remove bulk reset for Firestore-backed data; keeping button but disabling action
    showToast("Reset is disabled for live data.");
  };

  const handleStaffSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const role = String(formData.get("role") || "").trim();
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "").trim();
    const branchId = String(formData.get("branch") || "").trim();
    const systemRole = String(formData.get("system_role") || "salon_staff");

    if (!name || !role || !email || !ownerUid) return;
    const branchRow = data.branches.find((b) => b.id === branchId);
    setSavingStaff(true);
    try {
      if (editingStaffId) {
        await updateSalonStaff(editingStaffId, {
          name,
          role,
          branchId,
          branchName: branchRow?.name || "",
          systemRole,
          training: {
            ohs: formData.get("train_ohs") === "on",
            prod: formData.get("train_prod") === "on",
            tool: formData.get("train_tool") === "on",
          },
        });
        // Also update users collection role if authUid exists
        if (editingStaff?.authUid) {
           try {
             await setDoc(doc(db, "users", editingStaff.authUid), { role: systemRole }, { merge: true });
           } catch {}
        }
      } else {
        // 1) create auth user via server API
        let authUid: string | null = null;
        try {
          const res = await fetch("/api/staff/auth/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, displayName: name, password }),
          });
          const json = await res.json();
          if (res.ok && json?.uid) {
            authUid = String(json.uid);
            // Create the actual user document in 'users' collection so they can login with correct role
            await setDoc(doc(db, "users", authUid), {
              uid: authUid,
              email,
              displayName: name,
              role: systemRole, // salon_staff or salon_branch_admin
              ownerUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              provider: "password",
              status: "Active"
            });
          }
        } catch (err) {
          console.error("Failed to create auth user", err);
        }

        // 2) create staff record
        await createStaff(ownerUid, {
          email,
          name,
          role,
          branchId,
          branchName: branchRow?.name || "",
          status: "Active",
          authUid: authUid || undefined,
          systemRole,
          avatar: name,
          training: {
            ohs: formData.get("train_ohs") === "on",
            prod: formData.get("train_prod") === "on",
            tool: formData.get("train_tool") === "on",
          },
        });
      }
      setIsStaffModalOpen(false);
      form.reset();
      setEditingStaffId(null);
      setEditingStaff(null);
      showToast(editingStaffId ? "Staff updated successfully!" : "Staff onboarded successfully!");
    } catch {
      showToast(editingStaffId ? "Failed to update staff" : "Failed to onboard staff");
    } finally {
      setSavingStaff(false);
    }
  };

  const openEditStaff = (s: Staff) => {
    setEditingStaffId(s.id);
    setEditingStaff(s);
    setIsStaffModalOpen(true);
  };

  const handleDeleteStaff = (id: string) => {
    const target = data.staff.find((s) => s.id === id) || null;
    setDeleteTarget(target);
  };

  const confirmDeleteStaff = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Attempt auth deletion first (best-effort)
      try {
        await fetch("/api/staff/auth/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: deleteTarget.authUid, email: deleteTarget.email }),
        });
      } catch {}
      // Then remove Firestore record
      await deleteSalonStaff(deleteTarget.id);
      setDeleteTarget(null);
      showToast("Staff deleted");
    } catch {
      showToast("Failed to delete staff");
    } finally {
      setDeleting(false);
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
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <i className="fas fa-users" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Staff Management</h1>
                  <p className="text-sm text-white/80 mt-1">Directory, Training Matrix, Roster</p>
                </div>
              </div>
            </div>
          </div>

          <section>
            <div className="flex justify-between items-center mb-6">
              <div />
              <div className="bg-white border border-slate-200 p-1 rounded-lg flex">
                <button
                  onClick={() => setActiveTab("directory")}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                    activeTab === "directory" ? "bg-pink-50 text-pink-600" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Directory
                </button>
                <button
                  onClick={() => setActiveTab("training")}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                    activeTab === "training" ? "bg-pink-50 text-pink-600" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Training Matrix
                </button>
                <button
                  onClick={() => setActiveTab("roster")}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                    activeTab === "roster" ? "bg-pink-50 text-pink-600" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Time Table/Roster
                </button>
              </div>

              <button
                onClick={() => setIsStaffModalOpen(true)}
                className="hidden sm:inline-block px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 font-medium shadow-md transition"
              >
                <i className="fa-solid fa-user-plus mr-2" /> Onboard Staff
              </button>
            </div>

            {/* Mobile full-width Onboard button */}
            <div className="sm:hidden mb-4">
              <button
                onClick={() => setIsStaffModalOpen(true)}
                className="w-full py-2.5 bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-md hover:bg-slate-700"
              >
                <i className="fa-solid fa-user-plus mr-2" /> Onboard Staff
              </button>
            </div>

            {activeTab === "directory" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  {data.staff.map((s) => {
                    const isSuspended = s.status === "Suspended";
                    const borderColor = isSuspended ? "border-red-400" : "border-green-500";
                    const opacity = isSuspended ? "opacity-75" : "";
                    return (
                      <div
                        key={s.id}
                        className={`bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center hover:shadow-md transition border-l-4 ${borderColor} ${opacity}`}
                      >
                        <img
                          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(s.avatar)}`}
                          alt="Avatar"
                          className="w-12 h-12 rounded-full bg-slate-100 mr-4"
                        />
                        <div className="flex-1">
                          <h4 className="font-bold text-slate-800">{s.name}</h4>
                          <p className="text-xs text-slate-500">
                            {s.role} • {s.branch}
                          </p>
                          {s.email && (
                            <p className="text-[11px] text-slate-400 mt-0.5">{s.email}</p>
                          )}
                        </div>
                        <div className="text-right mr-4">
                          <div className={`text-sm font-bold ${isSuspended ? "text-red-500" : "text-green-600"}`}>{s.status}</div>
                          <div className="mt-1 flex items-center justify-end gap-3 text-slate-400">
                            <button
                              className="hover:text-slate-600"
                              title="Preview"
                              onClick={() => router.push(`/staff/${s.id}`)}
                            >
                              <i className="fa-solid fa-eye" />
                            </button>
                            <button
                              className="text-blue-600 hover:text-blue-700"
                              title="Edit"
                              onClick={() => openEditStaff(s)}
                            >
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button
                              className="text-rose-600 hover:text-rose-700"
                              title="Delete"
                              onClick={() => handleDeleteStaff(s.id)}
                            >
                              <i className="fa-solid fa-trash" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="bg-slate-900 text-white rounded-xl p-4 border-none h-fit">
                  <h3 className="font-bold mb-4">Staff Quick Stats</h3>
                  <div className="space-y-4">
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Total Staff</span>
                      <span className="font-bold">{data.staff.length}</span>
                    </div>
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Active</span>
                      <span className="font-bold text-green-400">{data.staff.filter((s) => s.status === "Active").length}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "training" && (
              <div className="bg-white border border-slate-200 rounded-xl">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-sm text-slate-600">
                  <thead className="bg-slate-50 text-slate-800 font-semibold border-b border-slate-100">
                    <tr>
                      <th className="p-4 pl-6">Staff Member</th>
                      <th className="p-4 text-center">OHS Training</th>
                      <th className="p-4 text-center">Product Knowledge</th>
                      <th className="p-4 text-center">Tools & Equipment</th>
                      <th className="p-4 text-right pr-6">Action</th>
                    </tr>
                  </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.staff.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-500">
                            No staff members yet.
                          </td>
                        </tr>
                      ) : (
                        data.staff.map((s) => {
                          const t = s.training || { ohs: false, prod: false, tool: false };
                          const Badge = ({ completed }: { completed: boolean }) => (
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-bold ${
                                completed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                              }`}
                            >
                              <i className={`fa-solid ${completed ? "fa-check" : "fa-xmark"} mr-1`} />
                              {completed ? "Done" : "Pending"}
                            </span>
                          );
                          return (
                            <tr key={s.id} className="hover:bg-slate-50 transition border-b border-slate-100 last:border-0">
                              <td className="p-4 pl-6 font-medium text-slate-900">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs">
                                    {s.name.substring(0, 2)}
                                  </div>
                                  {s.name}
                                </div>
                              </td>
                              <td className="p-4 text-center">
                                <Badge completed={t.ohs} />
                              </td>
                              <td className="p-4 text-center">
                                <Badge completed={t.prod} />
                              </td>
                              <td className="p-4 text-center">
                                <Badge completed={t.tool} />
                              </td>
                              <td className="p-4 text-right pr-6">
                                <button
                                  onClick={() => openEditStaff(s)}
                                  className="text-blue-600 hover:text-blue-700"
                                  title="Edit training"
                                >
                                  <i className="fa-solid fa-pen" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                  </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "roster" && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="text-slate-800 text-lg font-bold mb-4">Weekly Roster</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b text-slate-700">
                        <th className="p-3 text-left border-r min-w-[150px]">Staff</th>
                        <th className="p-3 text-center border-r">Mon</th>
                        <th className="p-3 text-center border-r">Tue</th>
                        <th className="p-3 text-center border-r">Wed</th>
                        <th className="p-3 text-center border-r">Thu</th>
                        <th className="p-3 text-center border-r">Fri</th>
                        <th className="p-3 text-center border-r">Sat</th>
                        <th className="p-3 text-center">Sun</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.staff.filter((s) => s.status === "Active").length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-6 text-center text-slate-500">
                            No staff members yet.
                          </td>
                        </tr>
                      ) : (
                        data.staff
                          .filter((s) => s.status === "Active")
                          .map((s) => {
                          const branch = data.branches.find((b) => b.id === s.branchId || b.name === s.branch);
                          const days: Array<{ key: keyof HoursMap; label: string }> = [
                            { key: "Monday", label: "Mon" },
                            { key: "Tuesday", label: "Tue" },
                            { key: "Wednesday", label: "Wed" },
                            { key: "Thursday", label: "Thu" },
                            { key: "Friday", label: "Fri" },
                            { key: "Saturday", label: "Sat" },
                            { key: "Sunday", label: "Sun" },
                          ];
                          return (
                            <tr key={s.id} className="border-b hover:bg-slate-50">
                              <td className="p-3 border-r font-medium text-slate-800">{s.name}</td>
                              {days.map((d, i) => {
                                const h = (branch?.hours?.[d.key] as HoursDay) || undefined;
                                const isOff = h?.closed;
                                const text = isOff
                                  ? "OFF"
                                  : h?.open && h?.close
                                  ? `${h.open} - ${h.close}`
                                  : "";
                                return (
                                  <td
                                    key={i}
                                    className={`p-3 text-center border-r text-xs ${
                                      isOff ? "bg-slate-100 text-slate-400" : "text-green-700 font-medium"
                                    }`}
                                  >
                                    {text}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg border-l-4 border-pink-500 flex items-center gap-2"
          >
            <i className="fa-solid fa-circle-check text-pink-500" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Staff Modal */}
      {isStaffModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 sm:mx-0">
            <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center rounded-t-xl">
              <h3 className="font-bold text-slate-800">{editingStaffId ? "Edit Staff" : "Onboard Staff"}</h3>
              <button onClick={() => setIsStaffModalOpen(false)} className="text-slate-400 hover:text-red-500">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <form onSubmit={handleStaffSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  required={!editingStaffId}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  placeholder="name@salon.com"
                  defaultValue={editingStaff?.email || ""}
                />
              </div>
              {!editingStaffId && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Password</label>
                  <input
                    type="text"
                    name="password"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                    placeholder="Leave empty for auto-generated"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Set a password for them to login immediately.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Full Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  placeholder="Mike Ross"
                  defaultValue={editingStaff?.name || ""}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Role/Title</label>
                <input
                  type="text"
                  name="role"
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  placeholder="Senior Therapist"
                  defaultValue={editingStaff?.role || ""}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Access Level</label>
                <select
                  name="system_role"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  defaultValue={(editingStaff as any)?.systemRole || "salon_staff"}
                >
                  <option value="salon_staff">Standard Staff</option>
                  <option value="salon_branch_admin">Branch Admin</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Branch Admins can manage bookings and staff for their branch.</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Branch (Optional)</label>
                <select
                  name="branch"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  defaultValue={editingStaff?.branchId || ""}
                >
                  <option value="">-- Unassigned --</option>
                  {data.branches.length > 0 ? (
                    data.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>
                      No Branches Configured
                    </option>
                  )}
                </select>
              </div>
              <div className="border-t pt-2">
                <label className="block text-xs font-bold text-slate-600 mb-2">Initial Training Complete?</label>
                <div className="flex gap-3">
                  <label className="flex items-center">
                    <input id="train_ohs" type="checkbox" name="train_ohs" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.ohs)} />
                    <span className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-colors">
                      OHS
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input id="train_prod" type="checkbox" name="train_prod" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.prod)} />
                    <span className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-colors">
                      Product
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input id="train_tool" type="checkbox" name="train_tool" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.tool)} />
                    <span className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-colors">
                      Tools
                    </span>
                  </label>
                </div>
              </div>
              <button
                type="submit"
                disabled={savingStaff}
                className={`w-full bg-slate-800 text-white font-bold py-2.5 rounded-lg shadow-md transition mt-2 ${
                  savingStaff ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-900"
                }`}
              >
                {savingStaff ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <i className="fa-solid fa-circle-notch fa-spin" />
                    Saving...
                  </span>
                ) : (
                  editingStaffId ? "Save Changes" : "Onboard Staff"
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Preview Staff Modal */}
      {previewStaff && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden mx-4 sm:mx-0">
            <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Staff Preview</h3>
              <button onClick={() => setPreviewStaff(null)} className="text-slate-400 hover:text-red-500">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(previewStaff.avatar)}`}
                  alt="Avatar"
                  className="w-16 h-16 rounded-full bg-slate-100"
                />
                <div>
                  <div className="text-lg font-semibold text-slate-900">{previewStaff.name}</div>
                  <div className="text-sm text-slate-600">
                    {previewStaff.role} • {previewStaff.branch}
                  </div>
                    {previewStaff.email && (
                      <div className="text-xs text-slate-500 mt-0.5">{previewStaff.email}</div>
                    )}
                  <div className={`text-xs font-bold mt-1 ${previewStaff.status === "Active" ? "text-green-600" : "text-red-600"}`}>
                    {previewStaff.status}
                  </div>
                </div>
              </div>
              <div className="border-t pt-4 mt-2">
                <div className="text-xs font-bold text-slate-600 mb-2">Training</div>
                <div className="flex gap-2">
                  <span className={`px-2 py-1 rounded text-xs ${previewStaff.training?.ohs ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    OHS
                  </span>
                  <span className={`px-2 py-1 rounded text-xs ${previewStaff.training?.prod ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    Product
                  </span>
                  <span className={`px-2 py-1 rounded text-xs ${previewStaff.training?.tool ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    Tools
                  </span>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setPreviewStaff(null)}
                  className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 font-medium shadow-md transition"
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 sm:mx-0 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                <i className="fa-solid fa-triangle-exclamation" />
              </div>
              <h3 className="font-semibold text-slate-900">Delete staff member?</h3>
            </div>
            <div className="p-5 text-sm text-slate-600">
              This will permanently remove <span className="font-semibold text-slate-800">{deleteTarget.name}</span> from your
              staff directory.
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
                onClick={confirmDeleteStaff}
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
      )}
    </div>
  );
}


