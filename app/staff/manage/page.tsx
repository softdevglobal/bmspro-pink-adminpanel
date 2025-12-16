"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { subscribeBranchesForOwner, syncBranchStaffFromSchedule, removeStaffFromAllBranches } from "@/lib/branches";
import {
  createSalonStaffForOwner as createStaff,
  subscribeSalonStaffForOwner,
  updateSalonStaff,
  deleteSalonStaff,
} from "@/lib/salonStaff";
import { updateBranch } from "@/lib/branches";
import { deleteDoc } from "firebase/firestore";
import WeeklyScheduleSelector, { WeeklySchedule } from "@/components/staff/WeeklyScheduleSelector";

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
  const [showPassword, setShowPassword] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Staff | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({});
  const [selectedSystemRole, setSelectedSystemRole] = useState<string>("salon_staff");

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
    mobile?: string | null;
    authUid?: string | null;
    status: "Active" | "Suspended";
    avatar: string;
    training: StaffTraining;
    systemRole?: string;
    weeklySchedule?: WeeklySchedule;
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
        
        // Check role
        const { getDoc, doc } = await import("firebase/firestore");
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
        mobile: (r as any).mobile || null,
        authUid: (r as any).authUid || null,
        systemRole: (r as any).systemRole || "salon_staff",
        status: (r.status as any) === "Suspended" ? "Suspended" : "Active",
        avatar: String(r.avatar || r.name || ""),
        training: {
          ohs: Boolean(r?.training?.ohs),
          prod: Boolean(r?.training?.prod),
          tool: Boolean(r?.training?.tool),
        },
        weeklySchedule: (r as any).weeklySchedule || {},
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

  // Toggle staff suspension status
  const handleSuspendStaff = (staff: Staff) => {
    setSuspendTarget(staff);
  };

  const confirmSuspendStaff = async () => {
    if (!suspendTarget || !ownerUid) return;
    setSuspending(true);
    try {
      const newStatus = suspendTarget.status === "Active" ? "Suspended" : "Active";
      
      // Update staff record in Firestore
      await updateSalonStaff(suspendTarget.id, { status: newStatus });
      
      // If suspending, also disable their Firebase Auth account
      if (suspendTarget.authUid) {
        try {
          await fetch("/api/staff/auth/suspend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              uid: suspendTarget.authUid, 
              disabled: newStatus === "Suspended" 
            }),
          });
        } catch (err) {
          console.error("Failed to update auth status", err);
        }
      }
      
      setSuspendTarget(null);
      showToast(newStatus === "Suspended" 
        ? `${suspendTarget.name} has been suspended` 
        : `${suspendTarget.name} has been reactivated`
      );
    } catch (err) {
      console.error("Failed to update staff status", err);
      showToast("Failed to update staff status");
    } finally {
      setSuspending(false);
    }
  };

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
    const mobile = String(formData.get("mobile") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const branchId = String(formData.get("branch") || "").trim();
    const systemRole = String(formData.get("system_role") || "salon_staff");

    if (!name || !role || !email || !mobile || !ownerUid) return;
    
    // Branch Admin must have a branch assigned
    if (systemRole === "salon_branch_admin" && !branchId) {
      showToast("Branch Admins must be assigned to a branch");
      return;
    }
    
    const branchRow = data.branches.find((b) => b.id === branchId);
    
    // For Branch Admins, create a schedule ONLY for days when the branch is open
    let finalSchedule: WeeklySchedule = {};
    if (systemRole === "salon_branch_admin" && branchRow) {
      const branchAssignment = { branchId: branchRow.id, branchName: branchRow.name };
      const branchHrs = branchRow.hours || {};
      const daysOfWeek: Array<keyof HoursMap> = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      
      daysOfWeek.forEach((day) => {
        const dayHours = branchHrs[day];
        const isClosed = dayHours?.closed === true;
        // Only assign admin to days when branch is open
        if (!isClosed) {
          finalSchedule[day] = branchAssignment;
        } else {
          finalSchedule[day] = null;
        }
      });
    } else {
      // For regular staff, use the weekly schedule they configured
      finalSchedule = weeklySchedule;
    }
    
    setSavingStaff(true);
    try {
      if (editingStaffId) {
        // Check if we need to generate auth credentials for an existing staff member who has none
        let newAuthUid = editingStaff?.authUid;
        if (!newAuthUid && (systemRole === "salon_branch_admin" || password)) {
           try {
              const res = await fetch("/api/staff/auth/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, displayName: name, password }),
              });
              const json = await res.json();
              if (res.ok && json?.uid) {
                newAuthUid = String(json.uid);
                // Create user doc
                await setDoc(doc(db, "users", newAuthUid), {
                  uid: newAuthUid,
                  email,
                  displayName: name,
                  role: systemRole,
                  ownerUid,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                  provider: "password",
                  status: "Active"
                });
              }
           } catch (err) {
             console.error("Failed to generate auth for existing staff", err);
           }
        }

        // MIGRATION LOGIC:
        // If we have a valid authUid, but the current document ID (editingStaffId) DOES NOT match it,
        // it means we have a legacy record (random ID) that needs to be migrated to be keyed by authUid.
        if (newAuthUid && newAuthUid !== editingStaffId) {
          // 1. Create/Overwrite the correct record at users/{newAuthUid}
          // Need to use the same create logic as "Add Staff" but ensure it uses newAuthUid
          // We can call createStaff with authUid: newAuthUid
          await createStaff(ownerUid, {
            email,
            name,
            role,
            branchId,
            branchName: branchRow?.name || "",
            status: "Active",
            authUid: newAuthUid,
            systemRole,
            avatar: name,
            mobile,
            training: {
              ohs: formData.get("train_ohs") === "on",
              prod: formData.get("train_prod") === "on",
              tool: formData.get("train_tool") === "on",
            },
            weeklySchedule: finalSchedule,
          });

          // SYNC: Update branch staffIds from the schedule (old schedule from editingStaff)
          const oldSchedule = editingStaff?.weeklySchedule || null;
          await syncBranchStaffFromSchedule(newAuthUid, finalSchedule, oldSchedule, ownerUid);
          
          // 2. Delete the old legacy record (users/{editingStaffId})
          // We use try-catch because it might not exist if it was in the old 'salon_staff' collection
          try {
            await deleteSalonStaff(editingStaffId);
            // Also try to delete from legacy collection just in case (requires importing deleteDoc, doc, db from firebase/firestore)
            // Assuming these are available in scope or imported at top
            await deleteDoc(doc(db, "salon_staff", editingStaffId));
          } catch {}

          // 3. Update local state to reflect the new ID to prevent further errors if modal stays open
          setEditingStaffId(newAuthUid);

        } else {
          // Standard Update (ID matches or no Auth ID to migrate to)
          try {
            await updateSalonStaff(editingStaffId, {
              name,
              role,
              branchId,
              branchName: branchRow?.name || "",
              systemRole,
              authUid: newAuthUid || undefined,
              mobile,
              training: {
                ohs: formData.get("train_ohs") === "on",
                prod: formData.get("train_prod") === "on",
                tool: formData.get("train_tool") === "on",
              },
              weeklySchedule: finalSchedule,
            });

            // SYNC: Update branch staffIds from the schedule
            const oldSchedule = editingStaff?.weeklySchedule || null;
            await syncBranchStaffFromSchedule(editingStaffId, finalSchedule, oldSchedule, ownerUid);
          } catch (err: any) {
            // If update fails (e.g. doc not found), try to recreate it if we have data
            if (err?.code === 'not-found' || err?.message?.includes('No document')) {
               if (newAuthUid) {
                 // Fallback: Create new
                 await createStaff(ownerUid, {
                    email,
                    name,
                    role,
                    branchId,
                    branchName: branchRow?.name || "",
                    status: "Active",
                    authUid: newAuthUid,
                    systemRole,
                    avatar: name,
                    training: {
                      ohs: formData.get("train_ohs") === "on",
                      prod: formData.get("train_prod") === "on",
                      tool: formData.get("train_tool") === "on",
                    },
                    weeklySchedule: finalSchedule,
                 });
                 
                 // SYNC: Update branch staffIds from the schedule
                 const oldSchedule = editingStaff?.weeklySchedule || null;
                 await syncBranchStaffFromSchedule(newAuthUid, finalSchedule, oldSchedule, ownerUid);
                 
                 // Try to cleanup old ID if possible
                 try { await deleteDoc(doc(db, "salon_staff", editingStaffId)); } catch {}
               } else {
                 throw err; // Cannot recover without ID
               }
            } else {
              throw err;
            }
          }
        }
        
        // NOTE: No need to separately update 'users' doc role, as updateSalonStaff now targets 'users' directly.

        // SYNC: If role is branch admin, update the branch record
        if (systemRole === "salon_branch_admin" && branchId) {
          await updateBranch(branchId, { adminStaffId: editingStaffId });
        }
        // SYNC: If role was branch admin but changed to staff, remove from branch if they were the admin
        if (editingStaff?.systemRole === "salon_branch_admin" && systemRole === "salon_staff" && editingStaff.branchId) {
          // We need to check if they were the admin of their old branch.
          // Since we don't have that specific check handy without fetching, we can just try to update 
          // the old branch. But `updateBranch` logic handles clearing if we pass null/undefined? 
          // Actually `updateBranch` in lib/branches handles "if adminStaffId provided".
          // We'd need to fetch the branch to see if they are the admin. 
          // Or we can just assume if they are demoted, we should clear admin IF it matches them.
          // For now, let's rely on the user to assign a new admin in Branch settings, 
          // OR we could try to clear it. 
          // Let's fetch the branch to be safe.
          try {
            const bSnap = await import("firebase/firestore").then(m => m.getDoc(m.doc(db, "branches", editingStaff.branchId!)));
            if (bSnap.exists() && bSnap.data().adminStaffId === editingStaffId) {
               await updateBranch(editingStaff.branchId!, { adminStaffId: null });
            }
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

        // 2) create staff record in users collection
        // We MUST have an authUid now because we force creation/lookup above
        if (authUid) {
          const newRef = await createStaff(ownerUid, {
            email,
            name,
            role,
            branchId,
            branchName: branchRow?.name || "",
            status: "Active",
            authUid: authUid,
            systemRole,
            avatar: name,
            mobile,
            training: {
              ohs: formData.get("train_ohs") === "on",
              prod: formData.get("train_prod") === "on",
              tool: formData.get("train_tool") === "on",
            },
            weeklySchedule: finalSchedule,
          });

          // SYNC: Update branch staffIds from the schedule
          await syncBranchStaffFromSchedule(authUid, finalSchedule, null, ownerUid);

          // SYNC: If new staff is branch admin, update branch
          if (systemRole === "salon_branch_admin" && branchId) {
             await updateBranch(branchId, { adminStaffId: newRef });
          }
        } else {
          // Fallback if auth failed (should catch above)
          showToast("Failed to create user account. Please try again.");
          setSavingStaff(false);
          return;
        }
      }
      setIsStaffModalOpen(false);
      form.reset();
      setEditingStaffId(null);
      setEditingStaff(null);
      setWeeklySchedule({});
      setSelectedSystemRole("salon_staff");
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
    setWeeklySchedule(s.weeklySchedule || {});
    setSelectedSystemRole(s.systemRole || "salon_staff");
    setIsStaffModalOpen(true);
  };

  const handleDeleteStaff = (id: string) => {
    const target = data.staff.find((s) => s.id === id) || null;
    setDeleteTarget(target);
  };

  const confirmDeleteStaff = async () => {
    if (!deleteTarget || !ownerUid) return;
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
      
      // Remove staff from all branches first
      await removeStaffFromAllBranches(deleteTarget.id, ownerUid);
      
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
                onClick={() => {
                  setIsStaffModalOpen(true);
                  setSelectedSystemRole("salon_staff");
                  setWeeklySchedule({});
                }}
                className="hidden sm:inline-block px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 font-medium shadow-md transition"
              >
                <i className="fa-solid fa-user-plus mr-2" /> Onboard Staff
              </button>
            </div>

            {/* Mobile full-width Onboard button */}
            <div className="sm:hidden mb-4">
              <button
                onClick={() => {
                  setIsStaffModalOpen(true);
                  setSelectedSystemRole("salon_staff");
                  setWeeklySchedule({});
                }}
                className="w-full py-2.5 bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-md hover:bg-slate-700"
              >
                <i className="fa-solid fa-user-plus mr-2" /> Onboard Staff
              </button>
            </div>

            {!ownerUid && (
              <div className="flex justify-center items-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <i className="fas fa-circle-notch fa-spin text-4xl text-pink-500" />
                  <p className="text-slate-500 font-medium">Loading staff data...</p>
                </div>
              </div>
            )}

            {ownerUid && activeTab === "directory" && (
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
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-800">{s.name}</h4>
                            {s.systemRole === "salon_branch_admin" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700">
                                <i className="fas fa-crown" />
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            {s.role}{s.branch ? ` • ${s.branch}` : ""}
                          </p>
                          {s.email && (
                            <p className="text-[11px] text-slate-400 mt-0.5">{s.email}</p>
                          )}
                          {s.mobile && (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              <i className="fas fa-phone text-slate-300 mr-1" />
                              {s.mobile}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Status Badge */}
                          <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                            isSuspended 
                              ? "bg-red-100 text-red-600" 
                              : "bg-green-100 text-green-600"
                          }`}>
                            {s.status}
                          </div>
                          
                          {/* Action Buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition"
                              title="Preview"
                              onClick={() => router.push(`/staff/${s.id}`)}
                            >
                              <i className="fa-solid fa-eye" />
                            </button>
                            <button
                              className="w-8 h-8 rounded-lg hover:bg-blue-50 flex items-center justify-center text-blue-500 hover:text-blue-600 transition"
                              title="Edit"
                              onClick={() => openEditStaff(s)}
                            >
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                                isSuspended 
                                  ? "hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600" 
                                  : "hover:bg-amber-50 text-amber-500 hover:text-amber-600"
                              }`}
                              title={isSuspended ? "Reactivate Account" : "Suspend Account"}
                              onClick={() => handleSuspendStaff(s)}
                            >
                              <i className={`fa-solid ${isSuspended ? "fa-user-check" : "fa-user-slash"}`} />
                            </button>
                            <button
                              className="w-8 h-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-rose-500 hover:text-rose-600 transition"
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
                  <div className="space-y-3">
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Total Staff</span>
                      <span className="font-bold">{data.staff.length}</span>
                    </div>
                    <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                      <span>Active</span>
                      <span className="font-bold text-green-400">{data.staff.filter((s) => s.status === "Active").length}</span>
                    </div>
                    {data.staff.filter((s) => s.status === "Suspended").length > 0 && (
                      <div className="bg-amber-500/20 p-3 rounded-lg flex justify-between">
                        <span className="text-amber-200">Suspended</span>
                        <span className="font-bold text-amber-400">{data.staff.filter((s) => s.status === "Suspended").length}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Quick Actions */}
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Quick Actions</h4>
                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          setIsStaffModalOpen(true);
                          setSelectedSystemRole("salon_staff");
                          setWeeklySchedule({});
                        }}
                        className="w-full py-2 px-3 bg-pink-600 hover:bg-pink-700 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
                      >
                        <i className="fa-solid fa-user-plus" />
                        Add New Staff
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {ownerUid && activeTab === "training" && (
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

            {ownerUid && activeTab === "roster" && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <h3 className="text-slate-800 text-lg font-bold">Weekly Roster</h3>
                  <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" />
                      <span>Staff Working</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-indigo-50 border border-indigo-200" />
                      <span>Branch Admin</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-slate-100 border border-slate-200" />
                      <span>Off Day</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200 text-slate-700">
                        <th className="p-3 text-left border-r min-w-[150px] font-bold">
                          <div className="flex items-center gap-2">
                            <i className="fas fa-user text-slate-400" />
                            Staff Member
                          </div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Mon</div>
                          <div className="text-[10px] text-slate-500 font-normal">☀️</div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Tue</div>
                          <div className="text-[10px] text-slate-500 font-normal">🌤️</div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Wed</div>
                          <div className="text-[10px] text-slate-500 font-normal">🌻</div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Thu</div>
                          <div className="text-[10px] text-slate-500 font-normal">🌸</div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Fri</div>
                          <div className="text-[10px] text-slate-500 font-normal">🎉</div>
                        </th>
                        <th className="p-3 text-center border-r">
                          <div className="font-bold">Sat</div>
                          <div className="text-[10px] text-slate-500 font-normal">🎨</div>
                        </th>
                        <th className="p-3 text-center">
                          <div className="font-bold">Sun</div>
                          <div className="text-[10px] text-slate-500 font-normal">🌙</div>
                        </th>
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
                          const schedule = s.weeklySchedule || {};
                          const days: Array<keyof WeeklySchedule> = [
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                            "Saturday",
                            "Sunday",
                          ];
                          return (
                            <tr key={s.id} className="border-b hover:bg-slate-50/50 transition">
                              <td className="p-3 border-r font-medium text-slate-800">
                                <div className="flex items-center gap-3">
                                  <img
                                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(s.avatar)}`}
                                    alt={s.name}
                                    className="w-8 h-8 rounded-full bg-slate-100"
                                  />
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold">{s.name}</span>
                                      {s.systemRole === "salon_branch_admin" && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500 text-white">
                                          <i className="fas fa-crown" />
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-500">{s.role}</div>
                                  </div>
                                </div>
                              </td>
                              {days.map((day) => {
                                const assignment = schedule[day];
                                const isBranchAdmin = s.systemRole === "salon_branch_admin";
                                
                                // For branch admins, check if the branch is actually open on this day
                                let isWorking: boolean = Boolean(assignment && assignment.branchId);
                                
                                if (isBranchAdmin && assignment?.branchId) {
                                  const adminBranch = data.branches.find(b => b.id === assignment.branchId);
                                  if (adminBranch?.hours) {
                                    const dayHours = adminBranch.hours[day];
                                    if (dayHours?.closed === true) {
                                      isWorking = false; // Branch is closed, so admin is off
                                    }
                                  }
                                }
                                
                                return (
                                  <td
                                    key={day}
                                    className={`p-3 text-center border-r text-xs transition ${
                                      isWorking 
                                        ? isBranchAdmin 
                                          ? "bg-indigo-50 hover:bg-indigo-100" 
                                          : "bg-emerald-50 hover:bg-emerald-100"
                                        : "bg-slate-50 hover:bg-slate-100"
                                    }`}
                                  >
                                    {isWorking && assignment ? (
                                      <div className="space-y-1">
                                        <div className={`font-semibold text-xs ${isBranchAdmin ? "text-indigo-800" : "text-emerald-800"}`}>
                                          {assignment.branchName}
                                        </div>
                                        <div className={`text-[10px] ${isBranchAdmin ? "text-indigo-600" : "text-emerald-600"}`}>
                                          <i className={`fas ${isBranchAdmin ? "fa-crown" : "fa-store"} mr-1`} />
                                          {isBranchAdmin ? "Admin" : "Working"}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-slate-400 text-xs">
                                        <i className="fas fa-beach mr-1" />
                                        Off
                                      </div>
                                    )}
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
                
                {/* Summary Cards */}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
                        <i className="fas fa-calendar-check" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-emerald-900">
                          {data.staff.reduce((acc, s) => {
                            const schedule = s.weeklySchedule || {};
                            const isBranchAdmin = s.systemRole === "salon_branch_admin";
                            const days: Array<keyof WeeklySchedule> = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                            
                            return acc + days.filter(day => {
                              const assignment = schedule[day];
                              if (!assignment?.branchId) return false;
                              
                              // For branch admins, check if branch is open
                              if (isBranchAdmin) {
                                const adminBranch = data.branches.find(b => b.id === assignment.branchId);
                                if (adminBranch?.hours?.[day]?.closed) return false;
                              }
                              return true;
                            }).length;
                          }, 0)}
                        </div>
                        <div className="text-xs text-emerald-700">Total Shifts This Week</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-500 text-white flex items-center justify-center">
                        <i className="fas fa-users" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-900">
                          {data.staff.filter(s => s.status === "Active").length}
                        </div>
                        <div className="text-xs text-blue-700">Active Staff Members</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-500 text-white flex items-center justify-center">
                        <i className="fas fa-store" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-purple-900">
                          {data.branches.length}
                        </div>
                        <div className="text-xs text-purple-700">Total Branches</div>
                      </div>
                    </div>
                  </div>
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] sm:max-h-[90vh] flex flex-col">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-3 sm:p-5 border-b border-slate-700 flex justify-between items-center rounded-t-xl shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <i className="fa-solid fa-user-pen text-white text-sm sm:text-base" />
                </div>
                <h3 className="font-bold text-white text-sm sm:text-lg">{editingStaffId ? "Edit Staff" : "Onboard New Staff"}</h3>
              </div>
              <button 
                type="button"
                onClick={() => {
                  setIsStaffModalOpen(false);
                  setEditingStaffId(null);
                  setEditingStaff(null);
                  setWeeklySchedule({});
                  setSelectedSystemRole("salon_staff");
                }} 
                className="text-white/60 hover:text-white transition w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark text-xl" />
              </button>
            </div>
            <form onSubmit={handleStaffSubmit} className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-3 sm:p-6 space-y-3 sm:space-y-4">
              {/* Basic Information Section */}
              <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-200">
                <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                  <i className="fas fa-id-card text-pink-600" />
                  Basic Information
                </h4>
                <div className="space-y-2.5 sm:space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                    <input
                      type="email"
                      name="email"
                      required={!editingStaffId}
                      className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                      placeholder="name@salon.com"
                      defaultValue={editingStaff?.email || ""}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      Mobile Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      name="mobile"
                      required
                      className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                      placeholder="+1234567890"
                      defaultValue={editingStaff?.mobile || ""}
                    />
                  </div>
                  {(!editingStaffId || (editingStaffId && !editingStaff?.authUid)) && (
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          name="password"
                          className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 pr-10 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                          placeholder={editingStaffId ? "Create password for login" : "Leave empty for auto-generated"}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <i className={`fa-solid ${showPassword ? "fa-eye-slash" : "fa-eye"}`} />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">Set a password for them to login immediately.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Full Name</label>
                      <input
                        type="text"
                        name="name"
                        required
                        className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
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
                        className="w-full border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                        placeholder="Senior Therapist"
                        defaultValue={editingStaff?.role || ""}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Access Level Section */}
              <div className="bg-indigo-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-indigo-200">
                <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                  <i className="fas fa-shield-halved text-indigo-600" />
                  Access Level
                </h4>
                <div className="space-y-2.5 sm:space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Staff Type</label>
                    <select
                      name="system_role"
                      className="w-full border border-indigo-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      defaultValue={(editingStaff as any)?.systemRole || "salon_staff"}
                      onChange={(e) => setSelectedSystemRole(e.target.value)}
                    >
                      <option value="salon_staff">Standard Staff</option>
                      <option value="salon_branch_admin">Branch Admin</option>
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {selectedSystemRole === "salon_branch_admin" 
                        ? "Has full management access to their assigned branch."
                        : "Can be scheduled at different branches using the weekly roster below."
                      }
                    </p>
                  </div>
                  
                  {/* Branch Selection - Only shown for Branch Admin */}
                  {selectedSystemRole === "salon_branch_admin" && (
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        Assigned Branch <span className="text-rose-500">*</span>
                      </label>
                      <select
                        name="branch"
                        className="w-full border border-indigo-300 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        defaultValue={editingStaff?.branchId || ""}
                        required
                      >
                        <option value="">-- Select Branch --</option>
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
                      <p className="text-[10px] text-indigo-600 mt-1 font-medium">
                        <i className="fas fa-info-circle mr-1" />
                        This admin will manage this branch on all opening days.
                      </p>
                    </div>
                  )}
                  
                  {/* Hidden field for Standard Staff - no branch required */}
                  {selectedSystemRole === "salon_staff" && (
                    <input type="hidden" name="branch" value="" />
                  )}
                </div>
              </div>
              {/* Training Section */}
              <div className="bg-emerald-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-emerald-200">
                <h4 className="text-xs sm:text-sm font-bold text-slate-700 mb-2 sm:mb-3 flex items-center gap-2">
                  <i className="fas fa-graduation-cap text-emerald-600" />
                  Initial Training Complete?
                </h4>
                <div className="flex flex-wrap gap-2 sm:gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input id="train_ohs" type="checkbox" name="train_ohs" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.ohs)} />
                    <span className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-all active:scale-95 sm:hover:scale-105">
                      <i className="fas fa-hard-hat mr-1" /> OHS
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input id="train_prod" type="checkbox" name="train_prod" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.prod)} />
                    <span className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-all active:scale-95 sm:hover:scale-105">
                      <i className="fas fa-box mr-1" /> Product
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input id="train_tool" type="checkbox" name="train_tool" className="peer sr-only" defaultChecked={Boolean(editingStaff?.training?.tool)} />
                    <span className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold bg-slate-600 text-white/90 peer-checked:bg-emerald-600 peer-checked:text-white border border-slate-500 peer-checked:border-emerald-700 shadow-sm select-none transition-all active:scale-95 sm:hover:scale-105">
                      <i className="fas fa-wrench mr-1" /> Tools
                    </span>
                  </label>
                </div>
              </div>
              
              {/* Weekly Schedule Selector - Only for Standard Staff */}
              {selectedSystemRole === "salon_staff" && (
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-purple-200">
                  <WeeklyScheduleSelector
                    branches={data.branches}
                    schedule={weeklySchedule}
                    onChange={setWeeklySchedule}
                  />
                </div>
              )}
              
              {/* Branch Admin Notice */}
              {selectedSystemRole === "salon_branch_admin" && (
                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border-2 border-indigo-200">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-indigo-500 text-white flex items-center justify-center shrink-0">
                      <i className="fas fa-building text-xs sm:text-base" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-indigo-900 mb-1">
                        Branch Admin Schedule
                      </h4>
                      <p className="text-[10px] sm:text-xs text-indigo-700 leading-relaxed">
                        As a <strong>Branch Admin</strong>, this staff member will be assigned to their selected branch on all <strong>opening days</strong>. Full management access to bookings, staff, and operations.
                      </p>
                      <div className="mt-2 sm:mt-3 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
                        <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-white/60 rounded-md">
                          <i className="fas fa-calendar-week text-indigo-600" />
                          <span className="font-medium text-indigo-800 whitespace-nowrap">Open Days Only</span>
                        </div>
                        <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-white/60 rounded-md">
                          <i className="fas fa-crown text-indigo-600" />
                          <span className="font-medium text-indigo-800 whitespace-nowrap">Full Access</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
              
              {/* Footer with Submit Button */}
              <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 rounded-b-xl shrink-0">
                <button
                  type="submit"
                  disabled={savingStaff}
                  className={`w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold py-2.5 sm:py-3 rounded-lg shadow-lg transition-all text-sm sm:text-base ${
                    savingStaff ? "opacity-60 cursor-not-allowed" : "hover:from-pink-700 hover:to-purple-700 hover:shadow-xl transform active:scale-95 sm:hover:scale-[1.02]"
                  }`}
                >
                  {savingStaff ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <i className="fa-solid fa-circle-notch fa-spin" />
                      Saving...
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center gap-2">
                      <i className="fa-solid fa-save" />
                      {editingStaffId ? "Save Changes" : "Onboard Staff"}
                    </span>
                  )}
                </button>
              </div>
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
                    {previewStaff.mobile && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        <i className="fas fa-phone text-slate-300 mr-1" />
                        {previewStaff.mobile}
                      </div>
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

      {/* Suspend/Reactivate Confirm Modal */}
      {suspendTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 sm:mx-0 overflow-hidden">
            <div className={`p-5 border-b ${suspendTarget.status === "Active" ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl ${suspendTarget.status === "Active" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"} flex items-center justify-center`}>
                  <i className={`fa-solid ${suspendTarget.status === "Active" ? "fa-user-slash" : "fa-user-check"} text-xl`} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">
                    {suspendTarget.status === "Active" ? "Suspend Staff Account?" : "Reactivate Staff Account?"}
                  </h3>
                  <p className="text-sm text-slate-600">{suspendTarget.name}</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              {suspendTarget.status === "Active" ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    Suspending this account will:
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-ban text-amber-500 mt-0.5" />
                      <span className="text-slate-600">Prevent <strong>{suspendTarget.name}</strong> from logging into the system</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-calendar-xmark text-amber-500 mt-0.5" />
                      <span className="text-slate-600">Hide them from booking availability</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-clock-rotate-left text-amber-500 mt-0.5" />
                      <span className="text-slate-600">Can be reactivated anytime</span>
                    </li>
                  </ul>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    <i className="fa-solid fa-info-circle mr-1" />
                    Existing bookings with this staff member will remain unchanged.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    Reactivating this account will:
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-check text-emerald-500 mt-0.5" />
                      <span className="text-slate-600">Allow <strong>{suspendTarget.name}</strong> to login again</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-calendar-check text-emerald-500 mt-0.5" />
                      <span className="text-slate-600">Show them in booking availability</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <i className="fa-solid fa-user-check text-emerald-500 mt-0.5" />
                      <span className="text-slate-600">Restore full staff access</span>
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <div className="px-5 pb-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setSuspendTarget(null)}
                disabled={suspending}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmSuspendStaff}
                disabled={suspending}
                className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-60 flex items-center gap-2 ${
                  suspendTarget.status === "Active" 
                    ? "bg-amber-500 hover:bg-amber-600" 
                    : "bg-emerald-500 hover:bg-emerald-600"
                }`}
              >
                {suspending ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin" />
                    Processing...
                  </>
                ) : suspendTarget.status === "Active" ? (
                  <>
                    <i className="fa-solid fa-user-slash" />
                    Suspend Account
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-user-check" />
                    Reactivate Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


