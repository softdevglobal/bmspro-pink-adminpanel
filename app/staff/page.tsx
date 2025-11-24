"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";

export default function SettingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"directory" | "training" | "roster">("directory");
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string }>>([]);

  type StaffTraining = { ohs: boolean; prod: boolean; tool: boolean };
  type Staff = {
    id: string;
    name: string;
    role: string;
    branch: string;
    status: "Active" | "Suspended";
    avatar: string;
    training: StaffTraining;
  };
  type Branch = { id: string; name: string; address: string; revenue: number };

  const defaultData: { staff: Staff[]; branches: Branch[] } = {
    staff: [
      {
        id: "st1",
        name: "Sarah Jenkins",
        role: "Senior Therapist",
        branch: "Downtown HQ",
        status: "Active",
        avatar: "Sarah",
        training: { ohs: true, prod: true, tool: true },
      },
      {
        id: "st2",
        name: "Mike Ross",
        role: "Junior Associate",
        branch: "North Branch",
        status: "Suspended",
        avatar: "Mike",
        training: { ohs: true, prod: false, tool: false },
      },
    ],
    branches: [
      { id: "br1", name: "Downtown HQ", address: "123 Main St, Melbourne", revenue: 45200 },
      { id: "br2", name: "North Branch", address: "88 North Rd, Brunswick", revenue: 12800 },
    ],
  };

  const [data, setData] = useState<{ staff: Staff[]; branches: Branch[] }>(defaultData);

  useEffect(() => {
    (async () => {
      const { auth } = await import("@/lib/firebase");
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
        }
      });
      return () => unsub();
    })();
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("bms_staff_data");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.staff && parsed?.branches) setData(parsed);
      } catch {
        // ignore parse errors, keep defaults
      }
    } else {
      localStorage.setItem("bms_staff_data", JSON.stringify(defaultData));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("bms_staff_data", JSON.stringify(data));
  }, [data]);

  const showToast = (message: string) => {
    const id = `${Date.now()}`;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  const toggleStaffStatus = (id: string) => {
    setData((prev) => {
      const next = {
        ...prev,
        staff: prev.staff.map((s) => {
          if (s.id !== id) return s;
          const newStatus: Staff["status"] = s.status === "Active" ? "Suspended" : "Active";
          return { ...s, status: newStatus };
        }),
      };
      const updated = next.staff.find((s) => s.id === id);
      if (updated) showToast(`Staff set to ${updated.status}`);
      return next;
    });
  };

  const resetData = () => {
    if (confirm("Are you sure you want to reset all staff data to default? This cannot be undone.")) {
      setData(defaultData);
      if (typeof window !== "undefined") {
        localStorage.setItem("bms_staff_data", JSON.stringify(defaultData));
        location.reload();
      }
    }
  };

  const handleStaffSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const role = String(formData.get("role") || "").trim();
    const branch = String(formData.get("branch") || "").trim();
    if (!name || !role || !branch) return;
    const newStaff: Staff = {
      id: "st" + Date.now(),
      name,
      role,
      branch,
      status: "Active",
      avatar: name,
      training: {
        ohs: formData.get("train_ohs") === "on",
        prod: formData.get("train_prod") === "on",
        tool: formData.get("train_tool") === "on",
      },
    };
    setData((prev) => ({ ...prev, staff: [...prev.staff, newStaff] }));
    setIsStaffModalOpen(false);
    form.reset();
    showToast("Staff onboarded successfully!");
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
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 font-medium shadow-md transition"
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
                        </div>
                        <div className="text-right mr-4">
                          <div className={`text-sm font-bold ${isSuspended ? "text-red-500" : "text-green-600"}`}>{s.status}</div>
                          <button onClick={() => toggleStaffStatus(s.id)} className="text-xs text-blue-500 hover:underline">
                            Toggle Status
                          </button>
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
                  <button
                    onClick={resetData}
                    className="mt-4 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-xs font-medium transition border border-slate-700"
                  >
                    <i className="fa-solid fa-rotate-right mr-1" />
                    Reset Test Data
                  </button>
                </div>
              </div>
            )}

            {activeTab === "training" && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm text-slate-600">
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
                    {data.staff.map((s) => {
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
                            <button className="text-xs text-blue-600 hover:underline">Update</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "roster" && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="font-bold text-lg mb-4">Weekly Roster</h3>
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
                      {data.staff
                        .filter((s) => s.status === "Active")
                        .map((s) => {
                          const shifts = ["9:00 - 5:00", "9:00 - 5:00", "10:00 - 6:00", "OFF", "9:00 - 5:00", "10:00 - 4:00", "OFF"];
                          return (
                            <tr key={s.id} className="border-b hover:bg-slate-50">
                              <td className="p-3 border-r font-medium text-slate-800">{s.name}</td>
                              {shifts.map((shift, i) => {
                                const isOff = shift === "OFF";
                                return (
                                  <td
                                    key={i}
                                    className={`p-3 text-center border-r text-xs ${
                                      isOff ? "bg-slate-100 text-slate-400" : "text-green-700 font-medium"
                                    }`}
                                  >
                                    {shift}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center rounded-t-xl">
              <h3 className="font-bold text-slate-800">Onboard Staff</h3>
              <button onClick={() => setIsStaffModalOpen(false)} className="text-slate-400 hover:text-red-500">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <form onSubmit={handleStaffSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Full Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  placeholder="Mike Ross"
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
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Branch</label>
                <select
                  name="branch"
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
                >
                  {data.branches.length > 0 ? (
                    data.branches.map((b) => (
                      <option key={b.id} value={b.name}>
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
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" name="train_ohs" className="rounded text-pink-600" /> <span>OHS</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" name="train_prod" className="rounded text-pink-600" /> <span>Product</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" name="train_tool" className="rounded text-pink-600" /> <span>Tools</span>
                  </label>
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-lg shadow-md transition mt-2"
              >
                Onboard Staff
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


