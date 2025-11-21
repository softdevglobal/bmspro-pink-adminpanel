"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { createSalonStaffForOwner, subscribeSalonStaffForOwner } from "@/lib/users";

type StaffRow = {
  id: string;
  initials: string;
  name: string;
  role: string;
  state: string;
  stateCls: string;
  badgeFrom: string;
  badgeTo: string;
  status: "Active" | "Onboarding" | "Inactive";
  statusCls: string;
  statusIcon: string;
  email?: string;
  username?: string | null;
  fullTime?: boolean;
};

export default function StaffPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formState, setFormState] = useState("");
  const [fullTime, setFullTime] = useState(false);
  const [username, setUsername] = useState("");

  // list
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [staffDocs, setStaffDocs] = useState<Array<{ id: string; data: any }>>([]);

  // preview/edit/delete state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStaff, setPreviewStaff] = useState<{ id: string; data: any } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editState, setEditState] = useState("");
  const [editFullTime, setEditFullTime] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editStatus, setEditStatus] = useState<"Active" | "Onboarding" | "Inactive">("Onboarding");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const computeStateCls = (state: string) => {
    const s = state.toUpperCase();
    if (s === "NSW") return "bg-blue-50 text-blue-700";
    if (s === "VIC") return "bg-purple-50 text-purple-700";
    if (s === "QLD") return "bg-orange-50 text-orange-700";
    if (s === "WA") return "bg-indigo-50 text-indigo-700";
    return "bg-slate-50 text-slate-700";
  };
  const computeStatus = (status?: string) => {
    const st = (status || "Onboarding") as StaffRow["status"];
    if (st === "Active") return { status: st, statusCls: "bg-emerald-50 text-emerald-700", statusIcon: "fa-check-circle" };
    if (st === "Inactive") return { status: st, statusCls: "bg-rose-50 text-rose-700", statusIcon: "fa-circle-xmark" };
    return { status: "Onboarding" as const, statusCls: "bg-amber-50 text-amber-700", statusIcon: "fa-clock" };
  };

  const stepIndicatorClass = (step: 1 | 2 | 3) => {
    const base =
      "w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm";
    if (currentStep === step) return `${base} bg-pink-600 text-white`;
    if (currentStep > step) return `${base} bg-emerald-500 text-white`;
    return `${base} bg-slate-200 text-slate-500`;
  };

  const openModal = () => {
    setIsModalOpen(true);
    setCurrentStep(1);
    setVerified(false);
    setIsVerifying(false);
    // reset form
    setFirstName("");
    setLastName("");
    setEmail("");
    setFormRole("");
    setFormState("");
    setFullTime(false);
    setUsername("");
  };

  const closeModal = () => setIsModalOpen(false);

  const goNext = async () => {
    if (currentStep < 3) {
      setCurrentStep((s) => ((s + 1) as 1 | 2 | 3));
      return;
    }
    // Step 3 -> create staff
    if (!ownerUid) return;
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !formRole.trim() || !formState.trim()) {
      alert("Please fill in all required fields.");
      return;
    }
    try {
      setSaving(true);
      await createSalonStaffForOwner(ownerUid, {
        email,
        firstName,
        lastName,
        staffRole: formRole,
        state: formState,
        fullTime,
        username: username || null,
        status: "Onboarding",
      });
      setSaving(false);
      closeModal();
    } catch (e: any) {
      setSaving(false);
      alert(e?.message || "Failed to create staff.");
    }
  };
  const goBack = () => {
    if (currentStep > 1) setCurrentStep((s) => ((s - 1) as 1 | 2 | 3));
  };

  const nextCtaLabel = useMemo(() => {
    return currentStep === 3 ? (saving ? "Creating..." : "Complete Onboarding") : "Next Step";
  }, [currentStep, saving]);

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
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      const role = (snap.data()?.role || "").toString();
      const suspended = Boolean(snap.data()?.suspended);
      const statusText = (snap.data()?.status || "").toString().toLowerCase();
      if (suspended || statusText.includes("suspend")) {
        // force sign-out and redirect if suspended
        try { (await import("firebase/auth")).signOut(auth); } catch {}
        router.replace("/login");
        return;
      }
      if (role !== "salon_owner") {
        router.replace("/dashboard");
        return;
      }
      setOwnerUid(user.uid);
      // subscribe to staff for this owner
      const unsubStaff = subscribeSalonStaffForOwner(user.uid, (list) => {
        const docs = list.map((d) => ({ id: d.id, data: d }));
        setStaffDocs(docs);
        const mapped: StaffRow[] = docs.map(({ id, data: d }, idx) => {
          const name =
            (d.displayName as string) ||
            `${(d.firstName as string) || ""} ${(d.lastName as string) || ""}`.trim();
          const initials = name
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase() || "")
            .join("");
          const state = (d.state as string) || "";
          const { status, statusCls, statusIcon } = computeStatus((d.status as string) || "Onboarding");
          // simple alternating gradient for avatars
          const gradients = [
            ["from-pink-400", "to-pink-600"],
            ["from-purple-400", "to-purple-600"],
            ["from-amber-400", "to-amber-600"],
            ["from-teal-400", "to-teal-600"],
          ];
          const [from, to] = gradients[idx % gradients.length];
          return {
            id,
            initials,
            name,
            role: (d.staffRole as string) || "",
            state,
            stateCls: computeStateCls(state),
            badgeFrom: from,
            badgeTo: to,
            status,
            statusCls,
            statusIcon,
            email: (d.email as string) || "",
            username: (d.username as string) || "",
            fullTime: Boolean(d.fullTime),
          };
        });
        setRows(mapped);
      });
      // chain unsubscribe with auth unsub
      return () => {
        try { unsubStaff(); } catch {}
      };
    });
    return () => unsub();
  }, [router]);

  const totalStaff = rows.length;
  const activeStaff = rows.filter((r) => r.status === "Active").length;
  const onboardingStaff = rows.filter((r) => r.status === "Onboarding").length;

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
                      <i className="fas fa-users" />
                    </div>
                    <h1 className="text-2xl font-bold">Staff Management</h1>
                  </div>
                  <p className="text-sm text-white/80 mt-2">
                    Manage staff profiles, roles, and onboarding
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div id="stats-section" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 min-w-0">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Total Staff</span>
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-users text-blue-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{totalStaff}</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-up text-xs mr-1" />
                  +3
                </span>
                <span className="text-xs text-slate-500">this month</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Active Staff</span>
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-check text-emerald-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{activeStaff}</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-plus text-xs mr-1" />
                  +2
                </span>
                <span className="text-xs text-slate-500">this week</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">New Hires</span>
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-plus text-amber-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">{onboardingStaff}</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-semibold">
                  Onboarding
                </span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-600">Turnover</span>
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-minus text-rose-500" />
                </div>
              </div>
              <div className="mb-2">
                <h3 className="text-3xl font-bold text-slate-900">0.8%</h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center">
                  <i className="fas fa-arrow-down text-xs mr-1" />
                  -0.1%
                </span>
                <span className="text-xs text-slate-500">vs last month</span>
              </div>
            </div>
          </div>

          <div id="staff-table-section" className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-200">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-900">Staff Management</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage roles, states and status</p>
                </div>
                <button
                  className="w-full sm:w-auto px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition flex items-center justify-center sm:justify-start space-x-2"
                  onClick={openModal}
                >
                  <i className="fas fa-user-plus text-sm" />
                  <span>Onboard New Staff</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.length === 0 && (
                    <tr>
                      <td className="px-6 py-6 text-slate-500" colSpan={5}>No staff members yet.</td>
                    </tr>
                  )}
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 bg-gradient-to-br ${s.badgeFrom} ${s.badgeTo} rounded-lg flex items-center justify-center`}>
                            <span className="text-white font-semibold text-sm">{s.initials}</span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{s.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-700">{s.role}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 ${s.stateCls} rounded-lg text-sm font-medium`}>{s.state}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 ${s.statusCls} rounded-lg text-sm font-medium flex items-center w-fit`}>
                          <i className={`fas ${s.statusIcon} text-xs mr-1.5`} />
                          {s.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                            title="View"
                            onClick={() => {
                              const found = staffDocs.find((d) => d.id === s.id);
                              if (found) {
                                setPreviewStaff(found);
                                setPreviewOpen(true);
                              }
                            }}
                          >
                            <i className="fas fa-eye text-sm" />
                          </button>
                          <button
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                            title="Edit"
                            onClick={() => {
                              const found = staffDocs.find((d) => d.id === s.id);
                              if (!found) return;
                              const d = found.data;
                              setEditId(found.id);
                              setEditFirstName((d.firstName as string) || "");
                              setEditLastName((d.lastName as string) || "");
                              setEditEmail((d.email as string) || "");
                              setEditRole((d.staffRole as string) || "");
                              setEditState((d.state as string) || "");
                              setEditFullTime(Boolean(d.fullTime));
                              setEditUsername((d.username as string) || "");
                              setEditStatus(((d.status as string) || "Onboarding") as any);
                              setEditOpen(true);
                            }}
                          >
                            <i className="fas fa-edit text-sm" />
                          </button>
                          <button
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Remove"
                            onClick={() => setDeleteId(s.id)}
                          >
                            <i className="fas fa-trash text-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
              <div className="px-8 py-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Onboard New Staff</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Add a new staff member to the platform
                    </p>
                  </div>
                  <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg transition">
                    <i className="fas fa-times text-slate-400" />
                  </button>
                </div>
                <div className="flex items-center space-x-4 mt-6">
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(1)}>1</div>
                    <span className="ml-2 text-sm font-medium text-slate-900">Personal</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(2)}>2</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Role & Location</span>
                  </div>
                  <div className="flex-1 h-0.5 bg-slate-200" />
                  <div className="flex items-center">
                    <div className={stepIndicatorClass(3)}>3</div>
                    <span className="ml-2 text-sm font-medium text-slate-500">Account</span>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6 overflow-y-auto flex-1">
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">First Name *</label>
                        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="e.g., Alice" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Last Name *</label>
                        <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="e.g., Summers" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Email *</label>
                      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="alice@salon.com.au" />
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Role *</label>
                        <select value={formRole} onChange={(e) => setFormRole(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent">
                          <option value="">Select role</option>
                          <option value="Senior Stylist">Senior Stylist</option>
                          <option value="Stylist">Stylist</option>
                          <option value="Color Specialist">Color Specialist</option>
                          <option value="Reception">Reception</option>
                          <option value="Barber">Barber</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Location *</label>
                        <select value={formState} onChange={(e) => setFormState(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent">
                          <option value="">Select state</option>
                          <option value="NSW">NSW</option>
                          <option value="VIC">VIC</option>
                          <option value="QLD">QLD</option>
                          <option value="WA">WA</option>
                          <option value="SA">SA</option>
                          <option value="TAS">TAS</option>
                          <option value="ACT">ACT</option>
                          <option value="NT">NT</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-slate-900">Full-time</p>
                        <p className="text-sm text-slate-500 mt-1">Toggle to set staff as full-time</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input checked={fullTime} onChange={(e) => setFullTime(e.target.checked)} type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-pink-500 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                      </label>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Username *</label>
                      <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="alice.summers" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Temporary Password *</label>
                        <input type="password" className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" placeholder="••••••••" />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => {
                            setIsVerifying(true);
                            setTimeout(() => {
                              setIsVerifying(false);
                              setVerified(true);
                            }, 1000);
                          }}
                          className="px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
                        >
                          {isVerifying ? "Generating..." : "Generate Strong Password"}
                        </button>
                      </div>
                    </div>
                    {verified && (
                      <p className="text-sm text-emerald-600">Strong password generated.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-8 py-6 border-t border-slate-200 flex items-center justify-between">
                <button
                  onClick={goBack}
                  className={`px-6 py-3 text-slate-700 font-semibold hover:bg-slate-100 rounded-lg transition ${
                    currentStep === 1 ? "invisible" : ""
                  }`}
                >
                  <i className="fas fa-arrow-left mr-2" />
                  Back
                </button>
                <div className="flex-1" />
                <button
                  onClick={closeModal}
                  className="px-6 py-3 text-slate-700 font-semibold hover:bg-slate-100 rounded-lg transition mr-3"
                >
                  Cancel
                </button>
                <button
                  onClick={goNext}
                  className="px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition"
                >
                  {nextCtaLabel} <i className="fas fa-arrow-right ml-2" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Right preview drawer */}
      {previewOpen && previewStaff && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white border-l border-slate-200 shadow-2xl flex flex-col">
            <div className="relative p-6">
              <div className="relative rounded-2xl shadow-md p-[1px] overflow-hidden" style={{ background: "linear-gradient(120deg, #ff52a2, #a855f7, #60a5fa, #f472b6)", backgroundSize: "300% 300%", animation: "gradientShift 9s ease infinite" }}>
                <div className="relative rounded-2xl bg-white/90 backdrop-blur-sm p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-indigo-600 text-white flex items-center justify-center font-semibold shadow-sm">
                      {((previewStaff.data.displayName as string) || `${previewStaff.data.firstName || ""} ${previewStaff.data.lastName || ""}`)
                        .trim()
                        .split(" ")
                        .map((s: string) => s[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-lg text-slate-900 truncate">
                        {(previewStaff.data.displayName as string) ||
                          `${previewStaff.data.firstName || ""} ${previewStaff.data.lastName || ""}`.trim()}
                      </h3>
                      <p className="text-xs text-slate-500 truncate">{previewStaff.data.email || ""}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {previewStaff.data.staffRole && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white text-xs font-semibold shadow-sm">
                        <i className="fas fa-briefcase" /> {previewStaff.data.staffRole}
                      </span>
                    )}
                    {previewStaff.data.status && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white text-xs font-semibold shadow-sm ${String(previewStaff.data.status).toLowerCase().includes("active") ? "bg-gradient-to-r from-emerald-500 to-teal-600" : String(previewStaff.data.status).toLowerCase().includes("inactive") ? "bg-gradient-to-r from-rose-500 to-rose-600" : "bg-gradient-to-r from-amber-500 to-orange-600"}`}>
                        <i className={`fas ${String(previewStaff.data.status).toLowerCase().includes("active") ? "fa-check-circle" : String(previewStaff.data.status).toLowerCase().includes("inactive") ? "fa-circle-xmark" : "fa-clock"}`} />
                        {previewStaff.data.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button className="absolute top-3 right-3 text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-full w-8 h-8 flex items-center justify-center shadow-sm" onClick={() => setPreviewOpen(false)} aria-label="Close preview">
                <i className="fas fa-times text-sm" />
              </button>
            </div>
            <style jsx>{`
              @keyframes gradientShift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
            `}</style>
            <div className="flex-1 overflow-auto bg-slate-50">
              <div className="p-6 space-y-6">
                <div className="text-xs font-semibold text-slate-500">Overview</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-slate-500">Email</div>
                    <div className="mt-1 font-medium text-slate-900 break-words">{previewStaff.data.email || "—"}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-slate-500">Username</div>
                    <div className="mt-1 font-medium text-slate-900">{previewStaff.data.username || "—"}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-slate-500">State</div>
                    <div className="mt-1 font-medium text-slate-900">{previewStaff.data.state || "—"}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-slate-500">Full-time</div>
                    <div className="mt-1 font-medium text-slate-900">{previewStaff.data.fullTime ? "Yes" : "No"}</div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 mb-3">Quick actions</div>
                  <div className="flex items-center gap-3">
                    <button
                      className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold shadow-sm"
                      onClick={() => {
                        const d = previewStaff.data;
                        setEditId(previewStaff.id);
                        setEditFirstName((d.firstName as string) || "");
                        setEditLastName((d.lastName as string) || "");
                        setEditEmail((d.email as string) || "");
                        setEditRole((d.staffRole as string) || "");
                        setEditState((d.state as string) || "");
                        setEditFullTime(Boolean(d.fullTime));
                        setEditUsername((d.username as string) || "");
                        setEditStatus(((d.status as string) || "Onboarding") as any);
                        setEditOpen(true);
                      }}
                    >
                      <i className="fas fa-edit mr-2" />
                      Edit
                    </button>
                    <button
                      className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm"
                      onClick={() => setDeleteId(previewStaff.id)}
                    >
                      <i className="fas fa-trash mr-2" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editOpen && editId && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditOpen(false)} />
          <div className="relative flex items-start md:items-center justify-center min-h-screen p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Edit Staff</h3>
                <button className="text-slate-500 hover:text-slate-700" onClick={() => setEditOpen(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className="p-6 space-y-4 overflow-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                    <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                    <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-600" value={editEmail} disabled />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                    <select className="w-full appearance-none pr-10 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                      <option value="">Select role</option>
                      <option>Senior Stylist</option>
                      <option>Stylist</option>
                      <option>Color Specialist</option>
                      <option>Reception</option>
                      <option>Barber</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                    <div className="relative">
                      <select className="w-full appearance-none pr-10 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editState} onChange={(e) => setEditState(e.target.value)}>
                        <option value="">Select state</option>
                        <option>NSW</option>
                        <option>VIC</option>
                        <option>QLD</option>
                        <option>WA</option>
                        <option>SA</option>
                        <option>TAS</option>
                        <option>ACT</option>
                        <option>NT</option>
                      </select>
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">
                        <i className="fas fa-chevron-down" />
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                    <input className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" className="sr-only peer" checked={editFullTime} onChange={(e) => setEditFullTime(e.target.checked)} />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-pink-500 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                      <span className="ml-3 text-sm text-slate-700">Full-time</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                    <option>Onboarding</option>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 text-sm font-semibold disabled:opacity-60" onClick={() => setEditOpen(false)} disabled={savingEdit}>
                  Cancel
                </button>
                <button
                  className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold disabled:opacity-70 inline-flex items-center gap-2"
                  disabled={savingEdit}
                  onClick={async () => {
                    if (!editId) return;
                    try {
                      setSavingEdit(true);
                      const displayName = `${editFirstName || ""} ${editLastName || ""}`.trim();
                      await updateDoc(doc(db, "users", editId), {
                        firstName: editFirstName.trim(),
                        lastName: editLastName.trim(),
                        displayName,
                        staffRole: editRole || null,
                        state: editState || null,
                        username: editUsername || null,
                        fullTime: Boolean(editFullTime),
                        status: editStatus,
                        updatedAt: serverTimestamp(),
                      });
                    } catch (e: any) {
                      alert(e?.message || "Failed to update");
                    } finally {
                      setSavingEdit(false);
                      setEditOpen(false);
                    }
                  }}
                >
                  {savingEdit ? (
                    <>
                      <i className="fas fa-circle-notch fa-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save changes"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteId(null)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Delete staff</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={() => setDeleteId(null)}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className="px-5 py-4">
                <p className="text-sm text-slate-600">This action cannot be undone. Are you sure?</p>
              </div>
              <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await deleteDoc(doc(db, "users", deleteId));
                      setDeleteId(null);
                      if (previewStaff?.id === deleteId) {
                        setPreviewOpen(false);
                        setPreviewStaff(null);
                      }
                    } catch (e: any) {
                      alert(e?.message || "Failed to delete");
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

