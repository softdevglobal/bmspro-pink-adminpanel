"use client";

import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { BookingStatus } from "@/lib/bookingTypes";
import Sidebar from "@/components/Sidebar";
import { updateBookingStatus } from "@/lib/bookings";

type Row = {
  id: string;
  client: string;
  serviceId?: string | null;
  serviceName?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  date: string;
  time: string;
  duration: number;
  price: number;
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  status?: string | null;
  bookingCode?: string | null;
  bookingSource?: string | null;
  services?: Array<{
    id: string | number;
    name?: string;
    price?: number;
    duration?: number;
    time?: string;
    staffId?: string | null;
    staffName?: string | null;
  }> | null;
};

function useBookingsByStatus(status: BookingStatus) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const ensureAuth = async () => {
      const user = auth.currentUser;
      if (user?.uid) return user.uid;
      return new Promise<string>((resolve, reject) => {
        let off: (() => void) | null = null;
        const timeout = setTimeout(() => {
          if (off) off();
          reject(new Error("Authentication timeout"));
        }, 10000); // 10 second timeout
        off = auth.onAuthStateChanged((u) => {
          if (u?.uid) {
            clearTimeout(timeout);
            if (off) off();
            resolve(u.uid);
          }
        });
      });
    };

    (async () => {
      try {
        const userId = await ensureAuth();
        if (cancelled) return;
      
      // Get user data to check role and branch
      const { getDoc, doc: firestoreDoc } = await import("firebase/firestore");
      const userSnap = await getDoc(firestoreDoc(db, "users", userId));
      const userData = userSnap.data();
      const userRole = (userData?.role || "").toString();
      const ownerUid = userRole === "salon_owner" ? userId : (userData?.ownerUid || userId);
      const userBranchId = userData?.branchId;
      
      // Build query constraints
      const constraints = [where("ownerUid", "==", ownerUid)];
      
      // Branch admin should only see bookings for their branch
      if (userRole === "salon_branch_admin" && userBranchId) {
        constraints.push(where("branchId", "==", userBranchId));
      }
      
      // Query only "bookings" collection (booking engine now saves directly to bookings)
      const q = query(collection(db, "bookings"), ...constraints);
      unsub = onSnapshot(q, (snap) => {
        if (cancelled) return;
        
        let next: Row[] = [];
        snap.forEach((doc) => {
          const d = doc.data() as any;
          if (String(d?.status || "") === status) {
            next.push({
              id: doc.id,
              client: String(d.client || ""),
              serviceId: d.serviceId || null,
              serviceName: d.serviceName || null,
              staffId: d.staffId || null,
              staffName: d.staffName || null,
              branchId: d.branchId || null,
              branchName: d.branchName || null,
              date: String(d.date || ""),
              time: String(d.time || ""),
              duration: Number(d.duration || 0),
              price: Number(d.price || 0),
              clientEmail: d.clientEmail || null,
              clientPhone: d.clientPhone || null,
              notes: d.notes || null,
              status: d.status || null,
              bookingCode: d.bookingCode || null,
              bookingSource: d.bookingSource || null,
              services: d.services || null,
            });
          }
        });
        // Sort by date desc, then time desc
        next = next.sort((a, b) => {
          if (a.date === b.date) {
            return a.time < b.time ? 1 : a.time > b.time ? -1 : 0;
          }
          return a.date < b.date ? 1 : -1;
        });
        setRows(next);
        setLoading(false);
      }, (e) => {
        if (cancelled) return;
        if (e?.code === "permission-denied") {
          console.warn("Permission denied for bookings query. User may not be authenticated.");
          setError("Permission denied. Please check your authentication.");
          setRows([]);
        } else {
          setError(e?.message || "Failed to load bookings");
        }
        setLoading(false);
      });
      } catch (authError: any) {
        if (cancelled) return;
        console.error("Authentication error:", authError);
        setError("Authentication failed. Please log in again.");
        setLoading(false);
        setRows([]);
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [status]);

  return { rows, loading, error };
}

export default function BookingsListByStatus({ status, title }: { status: BookingStatus; title: string }) {
  const { rows, loading, error } = useBookingsByStatus(status);
  const [updatingMap, setUpdatingMap] = useState<Record<string, boolean>>({});
  const allowedActions = useMemo<ReadonlyArray<"Confirm" | "Cancel" | "Complete">>(() => {
    if (status === "Pending") return ["Confirm", "Cancel"];
    if (status === "Confirmed") return ["Complete"];
    return [];
  }, [status]);
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Staff assignment modal state
  const [staffAssignModalOpen, setStaffAssignModalOpen] = useState(false);
  const [bookingToConfirm, setBookingToConfirm] = useState<Row | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [selectedStaffPerService, setSelectedStaffPerService] = useState<Record<string, string>>({});
  const [availableStaff, setAvailableStaff] = useState<Array<{ id: string; name: string; branchId?: string; avatar?: string }>>([]);
  const [availableStaffPerService, setAvailableStaffPerService] = useState<Record<string, Array<{ id: string; name: string; branchId?: string; avatar?: string }>>>({});
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [serviceQualifiedStaffIds, setServiceQualifiedStaffIds] = useState<string[]>([]);
  const [currentServiceQualifiedStaffIds, setCurrentServiceQualifiedStaffIds] = useState<Record<string, string[]>>({});

  // Combined effect: Fetch services and staff together to ensure proper filtering
  useEffect(() => {
    if (!staffAssignModalOpen || !bookingToConfirm) return;

    let unsubServices: (() => void) | null = null;
    let unsubStaff: (() => void) | null = null;
    
    const fetchData = async () => {
      setLoadingStaff(true);
      try {
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        const { getDoc, doc: firestoreDoc } = await import("firebase/firestore");
        const userSnap = await getDoc(firestoreDoc(db, "users", userId));
        const userData = userSnap.data();
        const userRole = (userData?.role || "").toString();
        const ownerUid = userRole === "salon_owner" ? userId : (userData?.ownerUid || userId);

        const { subscribeServicesForOwner } = await import("@/lib/services");
        const { subscribeSalonStaffForOwner } = await import("@/lib/salonStaff");

        // Track loaded data
        let servicesData: any[] = [];
        let staffData: any[] = [];

        const processData = () => {
          if (servicesData.length === 0 || staffData.length === 0) return;

          const hasMultipleServices = Array.isArray(bookingToConfirm.services) && bookingToConfirm.services.length > 0;
          
          if (hasMultipleServices) {
            // Filter staff for each service
            const staffPerService: Record<string, Array<{ id: string; name: string; branchId?: string; avatar?: string }>> = {};
            
            bookingToConfirm.services!.forEach(bookingService => {
              // Find service details
              const service = servicesData.find((s: any) => String(s.id) === String(bookingService.id));
              const qualifiedStaffIds = (service && Array.isArray(service.staffIds)) ? service.staffIds.map(String) : [];
              
              // Start with active staff
              let filtered = staffData.filter((s: any) => s.status === "Active");
              
              // CRITICAL: Filter by service qualification
              if (qualifiedStaffIds.length > 0) {
                filtered = filtered.filter((s: any) => qualifiedStaffIds.includes(String(s.id)));
              }
              
              // Filter by branch and day
              if (bookingToConfirm.branchId && bookingToConfirm.date) {
                const bookingDate = new Date(bookingToConfirm.date);
                const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                const dayName = daysOfWeek[bookingDate.getDay()];
                
                filtered = filtered.filter((s: any) => {
                  if (s.weeklySchedule && typeof s.weeklySchedule === 'object') {
                    const daySchedule = s.weeklySchedule[dayName];
                    if (daySchedule && daySchedule.branchId) {
                      return daySchedule.branchId === bookingToConfirm.branchId;
                    }
                    if (daySchedule === null || daySchedule === undefined) {
                      return false;
                    }
                  }
                  return s.branchId === bookingToConfirm.branchId;
                });
              }
              
              staffPerService[String(bookingService.id)] = filtered.map((s: any) => ({
                id: String(s.id),
                name: String(s.name || s.displayName || "Staff"),
                branchId: s.branchId,
                avatar: s.avatar || s.name || s.displayName || "Staff",
              }));
            });
            
            setAvailableStaffPerService(staffPerService);
          } else {
            // Single service
            const service = servicesData.find((s: any) => String(s.id) === String(bookingToConfirm.serviceId));
            const qualifiedStaffIds = (service && Array.isArray(service.staffIds)) ? service.staffIds.map(String) : [];
            
            let filtered = staffData.filter((s: any) => s.status === "Active");

            // CRITICAL: Filter by service qualification
            if (qualifiedStaffIds.length > 0) {
              filtered = filtered.filter((s: any) => qualifiedStaffIds.includes(String(s.id)));
            }

            if (bookingToConfirm.branchId && bookingToConfirm.date) {
              const bookingDate = new Date(bookingToConfirm.date);
              const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
              const dayName = daysOfWeek[bookingDate.getDay()];

              filtered = filtered.filter((s: any) => {
                if (s.weeklySchedule && typeof s.weeklySchedule === 'object') {
                  const daySchedule = s.weeklySchedule[dayName];
                  if (daySchedule && daySchedule.branchId) {
                    return daySchedule.branchId === bookingToConfirm.branchId;
                  }
                  if (daySchedule === null || daySchedule === undefined) {
                    return false;
                  }
                }
                return s.branchId === bookingToConfirm.branchId;
              });
            }

            setAvailableStaff(
              filtered.map((s: any) => ({
                id: String(s.id),
                name: String(s.name || s.displayName || "Staff"),
                branchId: s.branchId,
                avatar: s.avatar || s.name || s.displayName || "Staff",
              }))
            );
          }
          
          setLoadingStaff(false);
        };

        // Subscribe to services
        unsubServices = subscribeServicesForOwner(ownerUid, (services) => {
          servicesData = services;
          processData();
        });

        // Subscribe to staff
        unsubStaff = subscribeSalonStaffForOwner(ownerUid, (staff) => {
          staffData = staff;
          processData();
        });

      } catch (err) {
        console.error("Error fetching data:", err);
        setLoadingStaff(false);
      }
    };

    fetchData();

    return () => {
      if (unsubServices) unsubServices();
      if (unsubStaff) unsubStaff();
    };
  }, [staffAssignModalOpen, bookingToConfirm]);

  const handleConfirmClick = (row: Row) => {
    // Check if booking has multiple services array
    const hasMultipleServices = Array.isArray(row.services) && row.services.length > 0;
    
    if (hasMultipleServices) {
      // Check if any service needs staff assignment
      const needsStaffAssignment = row.services!.some(s => 
        !s.staffId || s.staffId === "null" || s.staffName === "Any Available" || s.staffName === "Any Staff"
      );
      
      if (needsStaffAssignment) {
        // Open multi-service staff assignment modal
        setBookingToConfirm(row);
        setSelectedStaffPerService({});
        setStaffAssignModalOpen(true);
      } else {
        // All services have staff assigned
        onAction(row.id, "Confirm");
      }
    } else {
      // Single service booking - check if needs staff assignment
      if (!row.staffId || row.staffId === "null" || row.staffName === "Any Available" || row.staffName === "Any Staff") {
        // Open staff assignment modal
        setBookingToConfirm(row);
        setSelectedStaffId("");
        setSelectedStaffPerService({});
        setStaffAssignModalOpen(true);
      } else {
        // Directly confirm without staff assignment
        onAction(row.id, "Confirm");
      }
    }
  };

  const confirmWithStaffAssignment = async () => {
    if (!bookingToConfirm) return;

    // Check if this is a multi-service booking
    const hasMultipleServices = Array.isArray(bookingToConfirm.services) && bookingToConfirm.services.length > 0;

    if (hasMultipleServices) {
      // Validate all services have staff assigned
      const servicesNeedingStaff = bookingToConfirm.services!.filter(s => 
        !s.staffId || s.staffName === "Any Available" || s.staffName === "Any Staff"
      );
      
      if (servicesNeedingStaff.length > 0) {
        const allAssigned = servicesNeedingStaff.every(s => selectedStaffPerService[String(s.id)]);
        if (!allAssigned) {
          alert("Please assign staff to all services");
          return;
        }
      }
    } else {
      // Single service - must have staff selected
      if (!selectedStaffId) return;
    }

    try {
      setUpdatingMap((m) => ({ ...m, [bookingToConfirm.id]: true }));
      
      // Get fresh token with robust fallback
      let token: string | null = null;
      try {
        if (auth.currentUser) {
          token = await auth.currentUser.getIdToken(true);
        } else {
          // Wait for auth state to settle
          const user = await new Promise<any>((resolve) => {
            const unsubscribe = auth.onAuthStateChanged((u) => {
              unsubscribe();
              resolve(u);
            });
          });
          if (user) {
            token = await user.getIdToken(true);
          } else {
             // Fallback to stored token if available (less reliable but better than nothing)
             token = typeof window !== "undefined" ? localStorage.getItem("idToken") : null;
          }
        }
      } catch (err) {
        console.error("Error getting token:", err);
      }

      if (hasMultipleServices) {
        // Update services array with selected staff
        const updatedServices = bookingToConfirm.services!.map(service => {
          const needsStaff = !service.staffId || service.staffName === "Any Available" || service.staffName === "Any Staff";
          if (needsStaff && selectedStaffPerService[String(service.id)]) {
            const staffId = selectedStaffPerService[String(service.id)];
            const staff = availableStaffPerService[String(service.id)]?.find(s => s.id === staffId);
            return {
              ...service,
              staffId: staffId,
              staffName: staff?.name || "Staff"
            };
          }
          return service;
        });

        // Update main staffId and staffName (use first service's staff as primary)
        const firstStaff = updatedServices[0];
        const uniqueStaffIds = new Set(updatedServices.map(s => s.staffId).filter(Boolean));
        const mainStaffName = uniqueStaffIds.size === 1 ? firstStaff.staffName : "Multiple Staff";

        // Update via Firestore directly
        const { updateDoc, doc: firestoreDoc, serverTimestamp } = await import("firebase/firestore");
        await updateDoc(firestoreDoc(db, "bookings", bookingToConfirm.id), {
          services: updatedServices,
          staffId: firstStaff.staffId,
          staffName: mainStaffName,
          status: "Confirmed",
          updatedAt: serverTimestamp(),
        } as any);
      } else {
        // Single service - use API endpoint
        const selectedStaff = availableStaff.find(s => s.id === selectedStaffId);
        
        const res = await fetch(`/api/bookings/${encodeURIComponent(bookingToConfirm.id)}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ 
            status: "Confirmed",
            staffId: selectedStaffId,
            staffName: selectedStaff?.name || "Staff"
          }),
        });

        const json = await res.json().catch(() => ({})) as any;
        if (!res.ok && !json?.devNoop) {
          throw new Error(json?.error || "Failed to confirm booking");
        }

        // If dev no-op, perform client-side update
        if (json?.devNoop) {
          const { updateDoc, doc: firestoreDoc, serverTimestamp } = await import("firebase/firestore");
          await updateDoc(firestoreDoc(db, "bookings", bookingToConfirm.id), {
            staffId: selectedStaffId,
            staffName: selectedStaff?.name || "Staff",
            status: "Confirmed",
            updatedAt: serverTimestamp(),
          } as any);
        }
      }

      // Close modal
      setStaffAssignModalOpen(false);
      setBookingToConfirm(null);
      setSelectedStaffId("");
      setSelectedStaffPerService({});
    } catch (e: any) {
      console.error("Error confirming booking:", e);
      alert(e?.message || "Failed to confirm booking");
    } finally {
      setUpdatingMap((m) => {
        const { [bookingToConfirm!.id]: _, ...rest } = m;
        return rest;
      });
    }
  };

  const onAction = async (rowId: string, action: "Confirm" | "Cancel" | "Complete") => {
    try {
      setUpdatingMap((m) => ({ ...m, [rowId]: true }));
      const next: BookingStatus =
        action === "Confirm" ? "Confirmed" :
        action === "Cancel" ? "Canceled" :
        "Completed";
      await updateBookingStatus(rowId, next);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(e?.message || "Failed to update status");
    } finally {
      setUpdatingMap((m) => {
        const { [rowId]: _, ...rest } = m;
        return rest;
      });
    }
  };

  const openPreview = (row: Row) => {
    setPreviewRow(row);
    setPreviewOpen(true);
  };
  const closePreview = () => setPreviewOpen(false);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <i className="fas fa-calendar-check" />
                  </div>
                  <h1 className="text-2xl font-bold">{title}</h1>
                </div>
              </div>
            </div>

            {/* Right-side preview slide-over */}
            <div
              className={`fixed inset-0 z-50 ${previewOpen ? "pointer-events-auto" : "pointer-events-none"}`}
              aria-hidden={!previewOpen}
            >
              <div
                onClick={closePreview}
                className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${previewOpen ? "opacity-100" : "opacity-0"}`}
              />
              <aside
                className={`absolute top-0 h-full right-0 w-[92vw] sm:w-[30rem] bg-white shadow-2xl border-l border-slate-200 transform transition-transform duration-200 ${previewOpen ? "translate-x-0" : "translate-x-full"}`}
              >
                <div className="flex h-full flex-col">
                  <div className="p-0 border-b border-slate-200">
                    <div className="bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 p-5 text-white flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                          <i className="fas fa-eye" />
                        </div>
                        <h3 className="text-lg font-semibold">Booking Preview</h3>
                      </div>
                      <button onClick={closePreview} className="text-white/80 hover:text-white">
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 p-5 space-y-4 overflow-y-auto">
                  {!previewRow && <div className="text-slate-500 text-sm">No booking selected.</div>}
                  {previewRow && (
                    <div className="space-y-4 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white flex items-center justify-center text-sm font-bold shadow-md">
                          {(previewRow.client || "?").split(" ").map(s => s[0]).slice(0,2).join("")}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{previewRow.client}</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {previewRow.clientEmail && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"><i className="fas fa-envelope" />{previewRow.clientEmail}</span>}
                            {previewRow.clientPhone && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"><i className="fas fa-phone" />{previewRow.clientPhone}</span>}
                          </div>
                        </div>
                      </div>
                      
                      <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 text-xs uppercase tracking-wide">Booking Code</span>
                          <span className="font-mono font-bold text-slate-800">{previewRow.bookingCode || previewRow.id.substring(0, 8)}</span>
                        </div>
                        {previewRow.bookingSource && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                            <span className="text-slate-500 text-xs uppercase tracking-wide">Source</span>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                              previewRow.bookingSource === "booking_engine" 
                                ? "bg-blue-100 text-blue-700" 
                                : "bg-purple-100 text-purple-700"
                            }`}>
                              {previewRow.bookingSource === "booking_engine" ? "Booking Engine" : "Admin Panel"}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                        <div className="flex items-center gap-2 text-slate-700 font-medium">
                          <i className="fas fa-sparkles text-pink-500" />
                          {previewRow.serviceName || "-"}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-slate-400">Date & Time</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-clock text-slate-400" />
                            {previewRow.date} {previewRow.time}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Duration</p>
                          <p className="font-medium text-slate-700">{previewRow.duration} mins</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-slate-400">Staff</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-user text-slate-400" />
                            {previewRow.staffName || "-"}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Branch</p>
                          <p className="font-medium text-slate-700 flex items-center gap-2">
                            <i className="fas fa-store text-slate-400" />
                            {previewRow.branchName || "-"}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-400">Status</p>
                        <p className="inline-flex items-center gap-2 px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-700">
                          <i className="fas fa-circle text-[8px] text-slate-400" />
                          {previewRow.status || status}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Price</p>
                        <p className="font-semibold text-slate-800 flex items-center gap-1"><i className="fas fa-dollar-sign text-slate-400" />{previewRow.price}</p>
                      </div>
                      {previewRow.notes && (
                        <div>
                          <p className="text-slate-400">Notes</p>
                          <p className="text-slate-700 whitespace-pre-wrap">{previewRow.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                  <div className="shrink-0 border-t border-slate-200 p-4 flex items-center justify-end gap-2 bg-white/90 backdrop-blur">
                    <button
                      onClick={closePreview}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
                    >
                      Close
                    </button>
                    {previewRow && allowedActions.includes("Confirm") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => {
                          closePreview();
                          handleConfirmClick(previewRow);
                        }}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-emerald-300 text-white" : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-check-circle" />}
                        {updatingMap[previewRow.id] ? "Confirming..." : "Confirm"}
                      </button>
                    )}
                    {previewRow && allowedActions.includes("Complete") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => onAction(previewRow.id, "Complete")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-indigo-300 text-white" : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-flag-checkered" />}
                        {updatingMap[previewRow.id] ? "Completing..." : "Complete"}
                      </button>
                    )}
                    {previewRow && allowedActions.includes("Cancel") && (
                      <button
                        disabled={!!updatingMap[previewRow.id]}
                        onClick={() => onAction(previewRow.id, "Cancel")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-2 ${updatingMap[previewRow.id] ? "bg-rose-300 text-white" : "bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-sm"}`}
                        aria-busy={!!updatingMap[previewRow.id]}
                      >
                        {updatingMap[previewRow.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-ban" />}
                        {updatingMap[previewRow.id] ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* Footer now lives inside the aside for correct order */}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="relative overflow-x-auto">
                <table className="min-w-[960px] w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50/90 backdrop-blur text-slate-800 font-semibold border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="p-4 pl-6">Client &amp; Service</th>
                    <th className="p-4">Date &amp; Time</th>
                    <th className="p-4">Staff</th>
                    <th className="p-4">Branch</th>
                    <th className="p-4 text-right pr-6">Price</th>
                    <th className="p-4 text-right pr-6">Actions</th>
                  </tr>
                  </thead>
                  <tbody>
                  {loading && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={5}>Loading...</td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td className="p-6 text-rose-600" colSpan={6}>{error}</td>
                    </tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td className="p-6 text-slate-500" colSpan={6}>No bookings.</td>
                    </tr>
                  )}
                  {!loading &&
                    rows.map((r) => {
                      const initials = r.client
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s) => s[0]?.toUpperCase() || "")
                        .join("");
                      return (
                      <tr key={r.id} className="hover:bg-slate-50 transition">
                        <td className="p-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
                              {initials || <i className="fas fa-user" />}
                            </div>
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-semibold text-slate-800">{r.client}</div>
                                {r.bookingCode && (
                                  <div className="text-xs text-slate-500 font-mono mt-0.5">{r.bookingCode}</div>
                                )}
                              </div>
                              {/* Mobile-first preview trigger (visible before horizontal scroll) */}
                              <button
                                aria-label="Preview"
                                title="Preview"
                                onClick={() => openPreview(r)}
                                className="sm:hidden text-slate-400 hover:text-pink-600 transition transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-full h-7 w-7 inline-flex items-center justify-center"
                              >
                                <i className="fas fa-eye text-[13px]" />
                              </button>
                            </div>
                            {/* Service List Display */}
                            <div className="mt-1">
                              {r.services && r.services.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {r.services.map((svc, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                        <i className="fas fa-sparkles text-[10px] text-pink-500" />
                                        <span className="text-xs font-medium">{svc.name || "Service"}</span>
                                      </span>
                                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                        <i className="fas fa-user-tie text-[9px]" />
                                        {svc.staffName || "Any Staff"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs mt-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                    <i className="fas fa-sparkles text-[10px]" />
                                    {r.serviceName || "Unknown Service"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-medium text-slate-700">{r.date}</div>
                          <div className="text-xs text-slate-500">{r.time}</div>
                        </td>
                        {/* Staff Column - show consolidated or main staff */}
                        <td className="p-4">
                          {r.services && r.services.length > 0 ? (
                             <div className="flex flex-col gap-1">
                               <span className="text-xs font-medium text-slate-700">{r.staffName || "Multiple Staff"}</span>
                             </div>
                          ) : (
                             <span>{r.staffName || "-"}</span>
                          )}
                        </td>
                        <td className="p-4">{r.branchName || "-"}</td>
                        <td className="p-4 text-right pr-6">
                          <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                            <i className="fas fa-dollar-sign text-slate-400" />
                            {r.price}
                          </span>
                        </td>
                        <td className="p-4 text-right pr-6">
                          <div className="inline-flex items-center gap-2 justify-end bg-slate-100/60 rounded-full px-2 py-1">
                            <button
                              aria-label="Preview"
                              title="Preview"
                              onClick={() => openPreview(r)}
                              className="hidden sm:inline-flex text-slate-400 hover:text-pink-600 transition transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-full h-8 w-8 items-center justify-center"
                            >
                              <i className="fas fa-eye" />
                            </button>
                            {allowedActions.length > 0 && (
                              <>
                              {allowedActions.includes("Confirm" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => handleConfirmClick(r)}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-emerald-300 text-white" : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-check-circle" />}
                                  {updatingMap[r.id] ? "Confirming..." : "Confirm"}
                                </button>
                              )}
                              {allowedActions.includes("Complete" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => onAction(r.id, "Complete")}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-indigo-300 text-white" : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-flag-checkered" />}
                                  {updatingMap[r.id] ? "Completing..." : "Complete"}
                                </button>
                              )}
                              {allowedActions.includes("Cancel" as any) && (
                                <button
                                  disabled={!!updatingMap[r.id]}
                                  onClick={() => onAction(r.id, "Cancel")}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition inline-flex items-center gap-1 ${updatingMap[r.id] ? "bg-rose-300 text-white" : "bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-sm"}`}
                                  aria-busy={!!updatingMap[r.id]}
                                >
                                  {updatingMap[r.id] ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-ban" />}
                                  {updatingMap[r.id] ? "Cancelling..." : "Cancel"}
                                </button>
                              )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Staff Assignment Modal */}
      {staffAssignModalOpen && bookingToConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => !updatingMap[bookingToConfirm.id] && setStaffAssignModalOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full animate-scale-in overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <i className="fas fa-user-plus text-white text-xl"></i>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Assign Staff Member</h3>
                  <p className="text-white/80 text-sm">Select a staff member to confirm booking</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Booking Details */}
              <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white flex items-center justify-center text-sm font-bold">
                    {(bookingToConfirm.client || "?").split(" ").map(s => s[0]).slice(0,2).join("")}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{bookingToConfirm.client}</p>
                    <p className="text-xs text-slate-500">{bookingToConfirm.serviceName || "Service"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <span><i className="far fa-calendar mr-1"></i>{bookingToConfirm.date}</span>
                  <span><i className="far fa-clock mr-1"></i>{bookingToConfirm.time}</span>
                  {bookingToConfirm.branchName && <span><i className="fas fa-store mr-1"></i>{bookingToConfirm.branchName}</span>}
                </div>
              </div>

              {/* Staff Selection */}
              <div>
                {loadingStaff ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-8 h-8 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
                    <span className="ml-3 text-slate-600">Loading staff...</span>
                  </div>
                ) : (
                  <>
                    {/* Multiple Services - Show staff selection for each */}
                    {Array.isArray(bookingToConfirm.services) && bookingToConfirm.services.length > 0 ? (
                      <div className="space-y-4 max-h-96 overflow-y-auto">
                        {bookingToConfirm.services
                          .filter(service => !service.staffId || service.staffName === "Any Available" || service.staffName === "Any Staff")
                          .map((service) => {
                            const serviceStaff = availableStaffPerService[String(service.id)] || [];
                            const selectedStaff = selectedStaffPerService[String(service.id)];
                            
                            return (
                              <div key={String(service.id)} className="border-2 border-purple-200 rounded-xl p-4 bg-purple-50/50">
                                <div className="mb-3 flex items-center gap-2">
                                  <i className="fas fa-spa text-purple-600"></i>
                                  <h4 className="font-bold text-slate-800">{service.name}</h4>
                                  <span className="text-xs text-slate-500 ml-auto">{service.duration} min</span>
                                </div>
                                
                                {serviceStaff.length === 0 ? (
                                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                                    <i className="fas fa-exclamation-triangle mr-2"></i>
                                    No qualified staff available for this service
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {serviceStaff.map((staff) => (
                                      <button
                                        key={staff.id}
                                        onClick={() => setSelectedStaffPerService(prev => ({
                                          ...prev,
                                          [String(service.id)]: staff.id
                                        }))}
                                        className={`w-full text-left p-2 rounded-lg border-2 transition-all ${
                                          selectedStaff === staff.id
                                            ? "border-emerald-500 bg-emerald-50 shadow-sm"
                                            : "border-slate-200 hover:border-emerald-300 hover:bg-white"
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 border-2 ${
                                            selectedStaff === staff.id ? "border-emerald-500" : "border-slate-200"
                                          }`}>
                                            <img
                                              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staff.avatar || staff.name)}`}
                                              alt={staff.name}
                                              className="w-full h-full object-cover"
                                            />
                                          </div>
                                          <div className="flex-1">
                                            <p className={`font-semibold text-sm ${
                                              selectedStaff === staff.id ? "text-emerald-900" : "text-slate-800"
                                            }`}>
                                              {staff.name}
                                            </p>
                                          </div>
                                          {selectedStaff === staff.id && (
                                            <i className="fas fa-check-circle text-emerald-500"></i>
                                          )}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      /* Single Service - Original UI */
                      <>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">
                          <i className="fas fa-user-tie text-emerald-600 mr-2"></i>
                          Select Staff Member
                        </label>
                        {availableStaff.length === 0 ? (
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                            <i className="fas fa-exclamation-triangle mr-2"></i>
                            No available staff members found for this branch.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {availableStaff.map((staff) => (
                              <button
                                key={staff.id}
                                onClick={() => setSelectedStaffId(staff.id)}
                                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                                  selectedStaffId === staff.id
                                    ? "border-emerald-500 bg-emerald-50 shadow-sm"
                                    : "border-slate-200 hover:border-emerald-300 hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 ${
                                    selectedStaffId === staff.id
                                      ? "border-emerald-500"
                                      : "border-slate-200"
                                  }`}>
                                    <img
                                      src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staff.avatar || staff.name)}`}
                                      alt={staff.name}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <p className={`font-semibold ${
                                      selectedStaffId === staff.id ? "text-emerald-900" : "text-slate-800"
                                    }`}>
                                      {staff.name}
                                    </p>
                                  </div>
                                  {selectedStaffId === staff.id && (
                                    <i className="fas fa-check-circle text-emerald-500 text-lg"></i>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 px-6 py-4 flex gap-3 justify-end border-t border-slate-200">
              <button
                onClick={() => setStaffAssignModalOpen(false)}
                disabled={updatingMap[bookingToConfirm.id]}
                className="px-4 py-2.5 rounded-lg text-slate-700 hover:bg-slate-200 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmWithStaffAssignment}
                disabled={(() => {
                  if (updatingMap[bookingToConfirm.id]) return true;
                  
                  // Check if multi-service booking
                  const hasMultipleServices = Array.isArray(bookingToConfirm.services) && bookingToConfirm.services.length > 0;
                  
                  if (hasMultipleServices) {
                    // Check if all services needing staff have staff assigned
                    const servicesNeedingStaff = bookingToConfirm.services!.filter(s => 
                      !s.staffId || s.staffName === "Any Available" || s.staffName === "Any Staff"
                    );
                    return !servicesNeedingStaff.every(s => selectedStaffPerService[String(s.id)]);
                  } else {
                    // Single service
                    return !selectedStaffId;
                  }
                })()}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm shadow-lg shadow-emerald-200"
              >
                {updatingMap[bookingToConfirm.id] ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Confirming...</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-check-circle"></i>
                    <span>Confirm Booking</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}


