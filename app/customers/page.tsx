"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";

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
  const [previewCust, setPreviewCust] = useState<Customer | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bookingsAgg, setBookingsAgg] = useState<Customer[]>([]);
  const [savedCustomers, setSavedCustomers] = useState<Customer[]>([]);


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

  // Remove dummy/local storage seed; show only real customers from bookings

  // Live customers derived from bookings for this owner
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(collection(db, "bookings"), where("ownerUid", "==", ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const map = new Map<string, Customer>();
        snap.forEach((doc) => {
          const d = doc.data() as any;
          const name = String(d.client || "").trim();
          const email = (d.clientEmail || undefined) as string | undefined;
          const phone = (d.clientPhone || undefined) as string | undefined;
          if (!name && !email && !phone) return;
          const key = (email || phone || name).toString().toLowerCase();
          const date = String(d.date || "");
          const existing = map.get(key);
          if (!existing) {
            map.set(key, {
              id: key,
              name: name || email || phone || "Customer",
              email,
              phone,
              visits: 1,
              lastVisit: date || undefined,
              status: "Active",
            });
          } else {
            existing.visits = (existing.visits || 0) + 1;
            if ((existing.lastVisit || "") < date) existing.lastVisit = date;
          }
        });
        // Save aggregate from bookings
        setBookingsAgg(Array.from(map.values()));
      },
      (error) => {
        if (error.code === "permission-denied") {
          console.warn("Permission denied for customers bookings query.");
          setBookingsAgg([]);
        } else {
          console.error("Error in customers bookings snapshot:", error);
          setBookingsAgg([]);
        }
      }
    );
    return () => unsub();
  }, [ownerUid]);

  // Live customers saved in a dedicated "customers" collection (if your system writes them)
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(collection(db, "customers"), where("ownerUid", "==", ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Customer[] = [];
        snap.forEach((doc) => {
          const d = doc.data() as any;
          list.push({
            id: String(doc.id),
            name: String(d.name || d.fullName || d.client || "Customer"),
            phone: d.phone || d.clientPhone || undefined,
          email: d.email || d.clientEmail || undefined,
          notes: d.notes || undefined,
          visits: typeof d.visits === "number" ? d.visits : undefined,
          lastVisit: d.lastVisit || undefined,
          status: (d.status as any) || "Active",
        });
      });
      setSavedCustomers(list);
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for customers query.");
        setSavedCustomers([]);
      } else {
        console.error("Error in customers snapshot:", error);
        setSavedCustomers([]);
      }
    }
    );
    return () => unsub();
  }, [ownerUid]);

  // Combine both sources
  useEffect(() => {
    const keyFor = (c: Customer) => (c.email || c.phone || c.name).toString().toLowerCase();
    const map = new Map<string, Customer>();
    for (const c of savedCustomers) {
      map.set(keyFor(c), { ...c });
    }
    for (const b of bookingsAgg) {
      const k = keyFor(b);
      const existing = map.get(k);
      if (!existing) {
        map.set(k, { ...b });
      } else {
        const visits = (existing.visits || 0) + (b.visits || 0);
        const lastVisit = (existing.lastVisit || "") < (b.lastVisit || "") ? b.lastVisit : existing.lastVisit;
        map.set(k, { ...existing, visits, lastVisit });
      }
    }
    setCustomers(Array.from(map.values()));
  }, [bookingsAgg, savedCustomers]);

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
                      className={`bg-white rounded-xl border border-slate-200 p-4 border-l-4 ${borderColor} ${
                        inactive ? "opacity-75" : ""
                      } hover:shadow-md transition-shadow`}
                    >
                      {/* Mobile & Tablet Layout */}
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-pink-100 to-pink-200 text-pink-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                          {c.name.substring(0, 1).toUpperCase()}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          {/* Name and Contact */}
                          <div className="mb-3">
                            <div className="font-bold text-base sm:text-lg text-slate-900 mb-1">{c.name}</div>
                            <div className="text-xs sm:text-sm text-slate-500 flex flex-wrap gap-x-2 gap-y-1">
                              <span className="flex items-center gap-1">
                                <i className="fas fa-phone text-pink-600" />
                                {c.phone || "No phone"}
                              </span>
                              <span className="hidden sm:inline">•</span>
                              <span className="flex items-center gap-1">
                                <i className="fas fa-envelope text-indigo-600" />
                                {c.email || "No email"}
                              </span>
                            </div>
                          </div>
                          
                          {/* Stats Row */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-4 sm:gap-6">
                              <div>
                                <div className="text-xs text-slate-500 mb-0.5">Bookings</div>
                                <div className="font-bold text-pink-600">{c.visits ?? 0}</div>
                              </div>
                              <div>
                                <div className="text-xs text-slate-500 mb-0.5">Last Visit</div>
                                <div className="font-semibold text-sm text-slate-800">{c.lastVisit || "—"}</div>
                              </div>
                            </div>
                            
                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-600 flex items-center justify-center transition-colors"
                                title="Preview Customer"
                                onClick={() => {
                                  setPreviewCust(c);
                                  setPreviewOpen(true);
                                }}
                              >
                                <i className="fas fa-eye" />
                              </button>
                              <button 
                                className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-600 flex items-center justify-center transition-colors" 
                                title="Delete Customer" 
                                onClick={() => removeCustomer(c.id)}
                              >
                                <i className="fas fa-trash" />
                              </button>
                            </div>
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

      {/* Preview modal */}
      {previewOpen && previewCust && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreviewOpen(false)} />
          <div className="relative flex items-center justify-center min-h-screen p-2 sm:p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 px-4 sm:px-5 py-3 sm:py-4 text-white flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/20 flex items-center justify-center">
                    <i className="fas fa-user text-sm sm:text-base" />
                  </div>
                  <h3 className="text-base sm:text-lg font-bold">Customer Details</h3>
                </div>
                <button className="text-white/80 hover:text-white text-lg" onClick={() => setPreviewOpen(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>
              
              <div className="p-4 sm:p-5 space-y-3 sm:space-y-4 overflow-y-auto flex-1">
                {/* Profile Section */}
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-pink-100 to-pink-200 text-pink-700 flex items-center justify-center font-bold text-lg sm:text-xl flex-shrink-0">
                    {previewCust.name.substring(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-base sm:text-lg text-slate-900">{previewCust.name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        previewCust.status === "Inactive" 
                          ? "bg-red-100 text-red-700" 
                          : "bg-green-100 text-green-700"
                      }`}>
                        {previewCust.status || "Active"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <h5 className="font-semibold text-sm text-slate-900 mb-2 flex items-center gap-2">
                    <i className="fas fa-address-book text-pink-600 text-xs" />
                    Contact Information
                  </h5>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-phone text-pink-600 text-xs" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-500">Phone</div>
                        <div className="font-medium text-sm text-slate-900">{previewCust.phone || "Not provided"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-envelope text-indigo-600 text-xs" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-500">Email</div>
                        <div className="font-medium text-sm text-slate-900 truncate">{previewCust.email || "Not provided"}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Booking Statistics */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <h5 className="font-semibold text-sm text-slate-900 mb-2 flex items-center gap-2">
                    <i className="fas fa-chart-line text-pink-600 text-xs" />
                    Booking Statistics
                  </h5>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white rounded-lg p-2 border border-slate-200 text-center">
                      <div className="text-2xl font-bold text-pink-600 mb-0.5">{previewCust.visits ?? 0}</div>
                      <div className="text-xs text-slate-500">Total Bookings</div>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-slate-200 text-center">
                      <div className="text-sm font-bold text-slate-900 mb-0.5">{previewCust.lastVisit || "Never"}</div>
                      <div className="text-xs text-slate-500">Last Visit</div>
                    </div>
                  </div>
                </div>

                {/* Loyalty Badge */}
                <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-50 to-indigo-50 rounded-lg p-2 border border-pink-200">
                  <span className="text-2xl">
                    {(previewCust.visits ?? 0) >= 10 ? "🌟" : (previewCust.visits ?? 0) >= 5 ? "💎" : "🆕"}
                  </span>
                  <span className="font-semibold text-sm text-slate-900">
                    {(previewCust.visits ?? 0) >= 10 ? "VIP Member" : 
                     (previewCust.visits ?? 0) >= 5 ? "Regular Customer" : 
                     "New Customer"}
                  </span>
                </div>

                {/* Notes Section */}
                {previewCust.notes && (
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                    <h5 className="font-semibold text-sm text-slate-900 mb-1.5 flex items-center gap-2">
                      <i className="fas fa-sticky-note text-amber-600 text-xs" />
                      Notes
                    </h5>
                    <div className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3">{previewCust.notes}</div>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setPreviewOpen(false)} 
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
                  >
                    <i className="fas fa-times mr-1" />
                    Close
                  </button>
                  <button 
                    onClick={() => { setPreviewOpen(false); removeCustomer(previewCust.id); }} 
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition"
                  >
                    <i className="fas fa-trash mr-1" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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



