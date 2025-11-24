"use client";
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

type Customer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  visits?: number;
  lastVisit?: string;
  notes?: string;
  status?: "Active" | "Inactive";
};

export default function CustomersPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaultCustomers: Customer[] = useMemo(
    () => [
      { id: "cu1", name: "Jane Doe", phone: "0412 345 678", email: "jane@test.com", visits: 3, lastVisit: "2025-05-21", status: "Active" },
      { id: "cu2", name: "John Smith", phone: "0498 765 432", email: "john@test.com", visits: 1, lastVisit: "2025-05-02", status: "Inactive" },
    ],
    []
  );

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

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("bms_customers_data") : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        setCustomers(parsed?.customers || defaultCustomers);
      } else {
        setCustomers(defaultCustomers);
        if (typeof window !== "undefined") localStorage.setItem("bms_customers_data", JSON.stringify({ customers: defaultCustomers }));
      }
    } catch {
      setCustomers(defaultCustomers);
    }
  }, [defaultCustomers]);

  const saveData = (next: Customer[]) => {
    setCustomers(next);
    try {
      if (typeof window !== "undefined") localStorage.setItem("bms_customers_data", JSON.stringify({ customers: next }));
    } catch {}
  };

  const openModal = (cust?: Customer) => {
    if (cust) {
      setEditingId(cust.id);
      setName(cust.name || "");
      setPhone(cust.phone || "");
      setEmail(cust.email || "");
      setNotes(cust.notes || "");
      setStatus(cust.status || "Active");
    } else {
      setEditingId(null);
      setName("");
      setPhone("");
      setEmail("");
      setNotes("");
      setStatus("Active");
    }
    setIsModalOpen(true);
  };
  const closeModal = () => setIsModalOpen(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editingId) {
      const next = customers.map((c) =>
        c.id === editingId ? { ...c, name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined, status } : c
      );
      saveData(next);
    } else {
      const newC: Customer = {
        id: "cu" + Date.now(),
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        visits: 0,
        lastVisit: undefined,
        notes: notes.trim() || undefined,
        status,
      };
      saveData([...customers, newC]);
    }
    setIsModalOpen(false);
  };

  const removeCustomer = (id: string) => {
    if (!confirm("Delete this customer?")) return;
    saveData(customers.filter((c) => c.id !== id));
  };

  const resetCustomersData = () => {
    if (!confirm("Reset customer data to defaults?")) return;
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("bms_customers_data");
        location.reload();
      }
    } catch {}
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
                  <i className="fas fa-user-group" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Customers</h1>
                  <p className="text-sm text-white/80 mt-1">Customer directory and contact details</p>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Customer Directory</h2>
              <button onClick={() => openModal()} className="w-full sm:w-auto px-4 py-2 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-700 font-medium shadow-md transition">
                <i className="fas fa-user-plus mr-2" />
                Add Customer
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                {customers.map((c) => {
                  const inactive = c.status === "Inactive";
                  const borderColor = inactive ? "border-red-400" : "border-green-500";
                  return (
                    <div
                      key={c.id}
                      className={`bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between border-l-4 ${borderColor} ${
                        inactive ? "opacity-75" : ""
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-100 to-pink-200 text-pink-700 flex items-center justify-center font-bold">
                          {c.name.substring(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{c.name}</div>
                          <div className="text-xs text-slate-500">
                            {c.phone || "No phone"} • {c.email || "No email"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Visits</div>
                          <div className="font-semibold text-slate-800">{c.visits ?? 0}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Last Visit</div>
                          <div className="font-semibold text-slate-800">{c.lastVisit || "—"}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-bold ${inactive ? "text-red-500" : "text-green-600"}`}>{c.status || "Active"}</div>
                          <div className="flex items-center gap-2 justify-end mt-1">
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => openModal(c)}>
                              Edit
                            </button>
                            <button className="text-xs text-rose-600 hover:underline" onClick={() => removeCustomer(c.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {customers.length === 0 && <div className="bg-white rounded-xl border border-slate-200 p-6 text-slate-500">No customers yet. Add your first customer.</div>}
              </div>
              <div className="bg-slate-900 text-white rounded-xl p-4 border-none h-fit">
                <h3 className="font-bold mb-4">Customer Quick Stats</h3>
                <div className="space-y-4">
                  <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                    <span>Total Customers</span>
                    <span className="font-bold">{customers.length}</span>
                  </div>
                  <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                    <span>Active</span>
                    <span className="font-bold text-green-400">
                      {customers.filter((c) => c.status !== "Inactive").length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative flex items-center justify-center min-h-screen p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <h3 className="text-base font-semibold text-slate-900">{editingId ? "Edit Customer" : "Add Customer"}</h3>
                <button className="text-slate-400 hover:text-slate-600" onClick={closeModal}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(92vh - 56px)" }}>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Full Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="Jane Doe" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="0400 000 000" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="jane@example.com" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none">
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none" placeholder="Any details..." />
                </div>
                <button type="submit" className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-2.5 rounded-lg shadow-md transition mt-2">
                  {editingId ? "Save Changes" : "Add Customer"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



