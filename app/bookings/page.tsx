"use client";
import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Script from "next/script";
import { subscribeServicesForOwner } from "@/lib/services";
import { subscribeSalonStaffForOwner } from "@/lib/salonStaff";
import { subscribeBranchesForOwner } from "@/lib/branches";
import { createBooking } from "@/lib/bookings";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function BookingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  // Booking wizard state
  const [bkStep, setBkStep] = useState<1 | 2 | 3>(1);
  const [bkBranchId, setBkBranchId] = useState<string | null>(null);
  const [bkSelectedServices, setBkSelectedServices] = useState<Array<number | string>>([]);
  const [bkServiceTimes, setBkServiceTimes] = useState<Record<string, string>>({});
  const [bkServiceStaff, setBkServiceStaff] = useState<Record<string, string>>({});
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkClientName, setBkClientName] = useState<string>("");
  const [bkClientEmail, setBkClientEmail] = useState<string>("");
  const [bkClientPhone, setBkClientPhone] = useState<string>("");
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);

  // Real data from Firestore
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string | number; name: string; price?: number; duration?: number; icon?: string; branches?: string[]; staffIds?: string[]; imageUrl?: string }>>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role?: string; status?: string; avatar?: string; branchId?: string; branch?: string }>>([]);

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
          
          // Resolve ownerUid based on role
          const { getDoc, doc } = await import("firebase/firestore");
          const snap = await getDoc(doc(db, "users", user.uid));
          const userData = snap.data();
          const role = (userData?.role || "").toString();

          if (role === "salon_owner") {
            setOwnerUid(user.uid);
          } else if (role === "salon_branch_admin") {
            // Redirect branch admin to their management page
            router.replace("/branches");
            return;
          } else {
            setOwnerUid(user.uid);
          }

        } catch {
          router.replace("/login");
        }
        // use authenticated user id as ownerUid
      });
      return () => unsub();
    })();
  }, [router]);

  // Expose the booking app logic to window so JSX handlers can call it
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as any;

    // Guard multiple registrations
    if (w.app && w.app.__initialized) return;

    const app = {
      __initialized: false,
      defaults: {
        bookings: [
          { id: 101, client: "Alice Johnson", serviceId: 1, staffId: "st1", branchId: "br1", date: "2025-11-21", time: "10:00", duration: 60, status: "Confirmed", price: 120 },
          { id: 102, client: "Bob Smith", serviceId: 2, staffId: "st2", branchId: "br2", date: "2025-11-21", time: "11:30", duration: 30, status: "Pending", price: 60 },
          { id: 103, client: "Charlie Brown", serviceId: 1, staffId: "st1", branchId: "br1", date: "2025-11-22", time: "14:00", duration: 60, status: "Confirmed", price: 120 }
        ],
        services: [
          { id: 1, name: "Full Body Massage", price: 120, cost: 40, duration: 60, icon: "fa-solid fa-spa", reviews: 124, qualifiedStaff: ["st1", "st2"], branches: ["br1", "br2"] },
          { id: 2, name: "Express Facial", price: 60, cost: 15, duration: 30, icon: "fa-solid fa-spray-can-sparkles", reviews: 85, qualifiedStaff: ["st1"], branches: ["br1"] }
        ],
        staff: [
          { id: "st1", name: "Sarah Jenkins", role: "Senior Therapist", branch: "Downtown HQ", status: "Active", avatar: "Sarah", training: {} },
          { id: "st2", name: "Mike Ross", role: "Junior Associate", branch: "North Branch", status: "Active", avatar: "Mike", training: {} }
        ],
        branches: [
          { id: "br1", name: "Downtown HQ", address: "123 Main St, Melbourne", revenue: 45200 },
          { id: "br2", name: "North Branch", address: "88 North Rd, Brunswick", revenue: 12800 }
        ]
      },
      data: {} as any,
      charts: {} as any,
      init: function () {
        if (this.__initialized) return;
        this.__initialized = true;
        const today = new Date().toISOString().split("T")[0];
        this.defaults.bookings[0].date = today;
        this.defaults.bookings[1].date = today;
        this.loadData();
        // If realtime cache exists (from Firestore listener), seed with it so we show real data immediately
        try {
          const cached = (window as any).__todayBookingsCache;
          if (Array.isArray(cached)) {
            this.data.bookings = cached;
          }
        } catch {}
        const dateInput = document.getElementById("booking-date-input") as HTMLInputElement | null;
        if (dateInput) dateInput.value = today;
        this.renderBookings();
        this.initCharts();
        this.updateAnalytics();
        this.populateSelects();
        const serviceSel = document.getElementById("booking-service-select");
        const staffSel = document.getElementById("booking-staff-select");
        const dateSel = document.getElementById("booking-date-input");
        serviceSel?.addEventListener("change", () => this.generateTimeSlots());
        staffSel?.addEventListener("change", () => this.generateTimeSlots());
        dateSel?.addEventListener("change", () => this.generateTimeSlots());
      },
      loadData: function () {
        const stored = localStorage.getItem("bms_bookings_data");
        if (stored) {
          this.data = JSON.parse(stored);
        } else {
          this.data = JSON.parse(JSON.stringify(this.defaults));
          this.saveData();
        }
      },
      saveData: function () {
        localStorage.setItem("bms_bookings_data", JSON.stringify(this.data));
        this.renderBookings();
        this.updateAnalytics();
        this.updateCharts();
      },
      resetData: function () {
        if (confirm("Are you sure you want to reset all bookings and base data to default? This cannot be undone.")) {
          localStorage.removeItem("bms_bookings_data");
          location.reload();
        }
      },
      router: function (_viewId: string) {},
      updateAnalytics: function () {
        const today = new Date().toISOString().split("T")[0];
        const todayBookings = this.data.bookings.filter((b: any) => b.date === today);
        const confirmedBookings = todayBookings.filter((b: any) => b.status === "Confirmed");
        const totalRevenue = confirmedBookings.reduce((sum: number, b: any) => sum + b.price, 0);
        const totalDuration = todayBookings.reduce((sum: number, b: any) => sum + b.duration, 0);
        const avgDuration = todayBookings.length > 0 ? Math.round(totalDuration / todayBookings.length) : 0;
        const revEl = document.getElementById("analytics-revenue");
        const cntEl = document.getElementById("analytics-confirmed-count");
        const avgEl = document.getElementById("analytics-avg-duration");
        if (revEl) revEl.textContent = `$${totalRevenue.toLocaleString()}`;
        if (cntEl) cntEl.textContent = String(confirmedBookings.length);
        if (avgEl) avgEl.textContent = `${avgDuration} mins`;
      },
      renderBookings: function () {
        const tbody = document.getElementById("bookings-table-body");
        if (!tbody) return;
        tbody.innerHTML = "";
        const today = new Date().toISOString().split("T")[0];
        let rows = this.data.bookings.filter((b: any) => b.date === today);

        // If there are no bookings for today, fall back to upcoming (any status)
        if (rows.length === 0) {
          const now = new Date(today).getTime();
          rows = this.data.bookings
            .filter((b: any) => {
              const t = new Date(String(b.date || today)).getTime();
              return isFinite(t) && t >= now;
            })
            .sort((a: any, b: any) => {
              const ad = new Date(a.date).getTime();
              const bd = new Date(b.date).getTime();
              if (ad === bd) return a.time > b.time ? 1 : -1;
              return ad > bd ? 1 : -1;
            })
            .slice(0, 10);
        }

        if (rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">No bookings found.</td></tr>';
          return;
        }

        rows.sort((a: any, b: any) => (a.time > b.time ? 1 : -1));
        rows.forEach((b: any) => {
          const service = this.data.services.find((s: any) => s.id === b.serviceId);
          const staff = this.data.staff.find((s: any) => s.id === b.staffId);
          const serviceName = String(b.serviceName || (service ? service.name : "Unknown Service"));
          const staffName = String(b.staffName || (staff ? staff.name : "Unassigned"));
          const endTime = this.calculateEndTime(b.time, b.duration);
          const statusClass = `status-${b.status}`;
          const statusActions =
            b.status === "Confirmed"
              ? `<button onclick="app.updateBookingStatus(${b.id}, 'Completed')" class="text-xs text-blue-500 hover:underline">Complete</button> / <button onclick="app.updateBookingStatus(${b.id}, 'Canceled')" class="text-xs text-red-500 hover:underline">Cancel</button>`
              : b.status === "Pending"
              ? `<button onclick="app.updateBookingStatus(${b.id}, 'Confirmed')" class="text-xs text-green-500 hover:underline">Confirm</button> / <button onclick="app.updateBookingStatus(${b.id}, 'Canceled')" class="text-xs text-red-500 hover:underline">Cancel</button>`
              : "";
          tbody.innerHTML += `
            <tr class="hover:bg-slate-50 transition">
              <td class="p-4 pl-6">
                <span class="font-bold text-slate-800">${b.client}</span>
                <span class="block text-xs text-slate-500">${serviceName}</span>
              </td>
              <td class="p-4">
                <span class="font-medium text-slate-700">${b.time} - ${endTime}</span>
                <span class="block text-xs text-slate-500">w/ ${staffName}</span>
              </td>
              <td class="p-4 text-center">
                <span class="inline-block px-3 py-1 text-xs font-semibold rounded-full ${statusClass}">
                  ${b.status}
                </span>
                <div class="mt-1">${statusActions}</div>
              </td>
              <td class="p-4 text-right pr-6 font-bold text-slate-800">$${b.price}</td>
            </tr>
          `;
        });
      },
      updateBookingStatus: function (id: number, newStatus: string) {
        const booking = this.data.bookings.find((b: any) => b.id === id);
        if (booking) {
          booking.status = newStatus;
          this.saveData();
          this.showToast(`Booking ${id} status updated to ${newStatus}.`);
        }
      },
      calculateEndTime: function (startTime: string, duration: number) {
        const [startH, startM] = startTime.split(":").map(Number);
        const totalMinutes = startH * 60 + startM + duration;
        const endH = Math.floor(totalMinutes / 60) % 24;
        const endM = totalMinutes % 60;
        const pad = (num: number) => num.toString().padStart(2, "0");
        return `${pad(endH)}:${pad(endM)}`;
      },
      populateSelects: function () {
        const serviceSelect = document.getElementById("booking-service-select") as HTMLSelectElement | null;
        const staffSelect = document.getElementById("booking-staff-select") as HTMLSelectElement | null;
        const branchSelect = document.getElementById("booking-branch-select") as HTMLSelectElement | null;
        if (!serviceSelect || !staffSelect || !branchSelect) return;
        serviceSelect.innerHTML = '<option value="" disabled selected>Select Service</option>';
        this.data.services.forEach((s: any) => {
          serviceSelect.innerHTML += `<option value="${s.id}" data-duration="${s.duration}" data-price="${s.price}">${s.name} ($${s.price})</option>`;
        });
        staffSelect.innerHTML = '<option value="" disabled selected>Select Staff</option>';
        this.data.staff.filter((s: any) => s.status === "Active").forEach((s: any) => {
          staffSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.role})</option>`;
        });
        branchSelect.innerHTML = '<option value="" disabled selected>Select Branch</option>';
        this.data.branches.forEach((b: any) => {
          branchSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        });
      },
      generateTimeSlots: function () {
        const staffId = (document.getElementById("booking-staff-select") as HTMLSelectElement | null)?.value || "";
        const serviceSelect = document.getElementById("booking-service-select") as HTMLSelectElement | null;
        const selectedOption = serviceSelect && serviceSelect.options[serviceSelect.selectedIndex];
        const date = (document.getElementById("booking-date-input") as HTMLInputElement | null)?.value || "";
        const duration = selectedOption ? parseInt(selectedOption.getAttribute("data-duration") || "0") : 0;
        const slotsContainer = document.getElementById("time-slots-container") as HTMLDivElement | null;
        const timeInput = document.getElementById("booking-time-input") as HTMLInputElement | null;
        const durationLabel = document.getElementById("service-duration-label") as HTMLSpanElement | null;
        if (!slotsContainer || !timeInput || !durationLabel) return;
        slotsContainer.innerHTML = "";
        timeInput.value = "";
        durationLabel.innerText = String(duration);
        if (!staffId || duration === 0 || !date) {
          slotsContainer.innerHTML = '<p class="col-span-4 text-center text-slate-400 text-xs py-2">Select Service, Staff, and a valid Date to see available slots.</p>';
          const eet = document.getElementById("estimated-end-time");
          if (eet) eet.textContent = "--";
          return;
        }
        const startHour = 9;
        const endHour = 17;
        const interval = 30;
        let currentTime = startHour * 60;
        const maxTime = endHour * 60;
        const occupiedSlots = this.data.bookings
          .filter((b: any) => b.staffId === staffId && b.date === date && b.status !== "Canceled")
          .map((b: any) => ({ start: b.time, end: this.calculateEndTime(b.time, b.duration) }));
        const formatTime = (minutes: number) => {
          const h = Math.floor(minutes / 60) % 24;
          const m = minutes % 60;
          return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        };
        while (currentTime < maxTime) {
          const slotStartTime = formatTime(currentTime);
          const slotEndTime = this.calculateEndTime(slotStartTime, duration);
          const isAvailable = occupiedSlots.every((o: any) => !((this.timeToMinutes(o.start) < this.timeToMinutes(slotEndTime)) && (this.timeToMinutes(o.end) > this.timeToMinutes(slotStartTime))));
          if (isAvailable && this.timeToMinutes(slotEndTime) <= maxTime) {
            const slotElement = document.createElement("div");
            slotElement.className = "time-slot text-sm";
            (slotElement as any).dataset.time = slotStartTime;
            slotElement.innerText = `${slotStartTime}`;
            slotElement.onclick = (e: any) => {
              document.querySelectorAll(".time-slot").forEach((s) => s.classList.remove("selected"));
              e.target.classList.add("selected");
              timeInput.value = e.target.dataset.time;
              const eet = document.getElementById("estimated-end-time");
              if (eet) eet.textContent = this.calculateEndTime(e.target.dataset.time, duration);
            };
            slotsContainer.appendChild(slotElement);
          }
          currentTime += interval;
        }
        if (slotsContainer.innerHTML === "") {
          slotsContainer.innerHTML = '<p class="col-span-4 text-center text-red-500 text-xs py-2">No available slots for this combination.</p>';
        }
      },
      timeToMinutes: function (time: string) {
        const [h, m] = time.split(":").map(Number);
        return h * 60 + m;
      },
      handleBookingSubmit: function (e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        const serviceId = parseInt(String(formData.get("serviceId")));
        const service = this.data.services.find((s: any) => s.id === serviceId);
        if (!service) {
          this.showToast("Invalid service selected!", "error");
          return;
        }
        if (!formData.get("time")) {
          this.showToast("Please select an available time slot.", "error");
          return;
        }
        const newBooking = {
          id: Date.now(),
          client: String(formData.get("client")),
          serviceId: serviceId,
          staffId: String(formData.get("staffId")),
          branchId: String(formData.get("branchId")),
          date: String(formData.get("date")),
          time: String(formData.get("time")),
          duration: service.duration,
          status: "Confirmed",
          price: service.price
        };
        this.data.bookings.push(newBooking);
        this.saveData();
        this.closeModal("booking");
        (e.target as HTMLFormElement).reset();
        this.showToast("New Booking Confirmed!");
      },
      initCharts: function () {
        const ctx = document.getElementById("statusChart") as HTMLCanvasElement | null;
        // Guard when Chart is not loaded or canvas missing
        if (!ctx || !(window as any).Chart) return;
        const confirmed = this.data.bookings.filter((b: any) => b.status === "Confirmed").length;
        const pending = this.data.bookings.filter((b: any) => b.status === "Pending").length;
        const canceled = this.data.bookings.filter((b: any) => b.status === "Canceled").length;
        const completed = this.data.bookings.filter((b: any) => b.status === "Completed").length;
        this.charts.status = new (window as any).Chart(ctx, {
          type: "doughnut",
          data: {
            labels: ["Confirmed", "Pending", "Canceled", "Completed"],
            datasets: [
              {
                data: [confirmed, pending, canceled, completed],
                backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#3b82f6"],
                hoverBackgroundColor: ["#059669", "#d97706", "#dc2626", "#2563eb"],
                borderWidth: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "70%",
            plugins: {
              legend: {
                position: "right",
                labels: { font: { family: "Inter, sans-serif", size: 10 } }
              }
            }
          }
        });
      },
      updateCharts: function () {
        if (this.charts.status) {
          const confirmed = this.data.bookings.filter((b: any) => b.status === "Confirmed").length;
          const pending = this.data.bookings.filter((b: any) => b.status === "Pending").length;
          const canceled = this.data.bookings.filter((b: any) => b.status === "Canceled").length;
          const completed = this.data.bookings.filter((b: any) => b.status === "Completed").length;
          this.charts.status.data.datasets[0].data = [confirmed, pending, canceled, completed];
          this.charts.status.update();
        }
      },
      showToast: function (msg: string, type: "success" | "error" = "success") {
        const container = document.getElementById("toast-container");
        if (!container) return;
        const color = type === "error" ? "border-red-500" : "border-pink-500";
        const icon = type === "error" ? "fa-solid fa-circle-xmark text-red-500" : "fa-solid fa-circle-check text-pink-500";
        const toast = document.createElement("div");
        toast.className = `toast border-l-4 ${color}`;
        toast.innerHTML = `<i class="${icon}"></i> <span>${msg}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
      },
      openModal: function (type: string) {
        const el = document.getElementById(`modal-${type}`);
        el?.classList.add("open");
        if (type === "booking") {
          const timeInput = document.getElementById("booking-time-input") as HTMLInputElement | null;
          const slots = document.getElementById("time-slots-container");
          const eet = document.getElementById("estimated-end-time");
          if (timeInput) timeInput.value = "";
          if (slots) slots.innerHTML = '<p class="col-span-4 text-center text-slate-400 text-xs py-2">Select Service and Staff to see available slots.</p>';
          if (eet) eet.textContent = "--";
        }
      },
      closeModal: function (type: string) {
        const el = document.getElementById(`modal-${type}`);
        el?.classList.remove("open");
      }
    };

    w.app = app;

    // Initialize as soon as mounted; charts will be skipped until chartReady
    app.init();
  }, []);

  // Once Chart.js loads, initialize charts if app is ready
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!chartReady) return;
    const w = window as any;
    if (w.app && typeof w.app.initCharts === "function") {
      w.app.initCharts();
      w.app.updateCharts();
    }
  }, [chartReady]);

  // Helpers for wizard
  const appRef = () => (typeof window !== "undefined" ? (window as any).app : null);

  // Subscribe to today's bookings from Firestore and feed the booking table
  useEffect(() => {
    if (!ownerUid) return;
    const todayStr = new Date().toISOString().split("T")[0];
    const q = query(
      collection(db, "bookings"),
      where("ownerUid", "==", ownerUid),
      where("date", "==", todayStr)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const b = d.data() as any;
          list.push({
            id: d.id,
            client: String(b.client || ""),
            serviceId: b.serviceId,
            serviceName: String(b.serviceName || ""),
            staffId: String(b.staffId || ""),
            staffName: String(b.staffName || ""),
            branchId: String(b.branchId || ""),
            date: String(b.date || todayStr),
            time: String(b.time || ""),
            duration: Number(b.duration || 0),
            status: String(b.status || "Confirmed"),
            price: Number(b.price || 0),
          });
        });
        try {
          const wapp = appRef();
          // cache latest list so init can seed even if app isn't ready yet
          (window as any).__todayBookingsCache = list;
          if (!wapp) return; // will update on next callback tick when app is ready
          wapp.data = wapp.data || {};
          wapp.data.bookings = list;
          // refresh UI pieces
          if (typeof wapp.updateAnalytics === "function") wapp.updateAnalytics();
          if (typeof wapp.updateCharts === "function") wapp.updateCharts();
          if (typeof wapp.renderBookings === "function") wapp.renderBookings();
        } catch {}
      },
      (error) => {
        // Handle permission errors properly instead of silently ignoring
        if (error.code === "permission-denied") {
          console.warn("Permission denied for bookings query. User may not be authenticated.");
          // Optionally redirect to login if not authenticated
          const { auth } = require("@/lib/firebase");
          if (!auth.currentUser) {
            router.replace("/login");
          }
        } else {
          console.error("Error in bookings snapshot:", error);
        }
        // Don't crash the app, just log the error
      }
    );
    return () => unsub();
  }, [ownerUid]);

  // Subscribe to Firestore data for wizard choices
  useEffect(() => {
    if (!ownerUid) return;
    const unsubBranches = subscribeBranchesForOwner(ownerUid, (rows) => {
      setBranches(rows.map((r) => ({ id: String(r.id), name: String(r.name || ""), address: (r as any).address })));
    });
    const unsubServices = subscribeServicesForOwner(ownerUid, (rows) => {
      setServicesList(
        rows
          .filter(Boolean)
          .map((s) => ({
          id: (s as any).id,
          name: String((s as any).name || "Service"),
          price: typeof (s as any).price === "number" ? (s as any).price : undefined,
          duration: typeof (s as any).duration === "number" ? (s as any).duration : undefined,
          imageUrl: (s as any).imageUrl || (s as any).image || undefined,
          icon: String((s as any).icon || "fa-solid fa-star"),
          branches: Array.isArray((s as any).branches) ? (s as any).branches.map(String) : undefined,
          staffIds: Array.isArray((s as any).staffIds) ? (s as any).staffIds.map(String) : undefined,
        }))
      );
    });
    const unsubStaff = subscribeSalonStaffForOwner(ownerUid, (rows) => {
      setStaffList(
        rows.map((r: any) => ({
          id: String(r.id),
          name: String(r.name || ""),
          role: r.role,
          status: r.status,
          avatar: r.avatar || r.name,
          branchId: r.branchId,
          branch: r.branchName,
        }))
      );
    });
    return () => {
      unsubBranches();
      unsubServices();
      unsubStaff();
    };
  }, [ownerUid]);

  const resetWizard = () => {
    setBkStep(1);
    setBkBranchId(null);
    setBkSelectedServices([]);
    setBkServiceTimes({});
    setBkServiceStaff({});
    const t = new Date();
    setBkMonthYear({ month: t.getMonth(), year: t.getFullYear() });
    setBkDate(null);
    setBkClientName("");
    setBkClientEmail("");
    setBkClientPhone("");
    setBkNotes("");
  };
  const openBookingWizard = () => {
    resetWizard();
    appRef()?.openModal("booking");
  };
  const monthName = new Date(bkMonthYear.year, bkMonthYear.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const goPrevMonth = () =>
    setBkMonthYear(({ month, year }) => {
      const nm = month - 1;
      return nm < 0 ? { month: 11, year: year - 1 } : { month: nm, year };
    });
  const goNextMonth = () =>
    setBkMonthYear(({ month, year }) => {
      const nm = month + 1;
      return nm > 11 ? { month: 0, year: year + 1 } : { month: nm, year };
    });
  const buildMonthCells = () => {
    const firstDayWeekIdx = new Date(bkMonthYear.year, bkMonthYear.month, 1).getDay();
    const numDays = new Date(bkMonthYear.year, bkMonthYear.month + 1, 0).getDate();
    const cells: Array<{ label?: number; date?: Date }> = [];
    for (let i = 0; i < firstDayWeekIdx; i++) cells.push({});
    for (let d = 1; d <= numDays; d++) cells.push({ label: d, date: new Date(bkMonthYear.year, bkMonthYear.month, d) });
    while (cells.length % 7 !== 0) cells.push({});
    return cells;
  };
  const calculateEndTime = (startTime: string, duration: number) => {
    const [startH, startM] = startTime.split(":").map(Number);
    const totalMinutes = startH * 60 + startM + duration;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    const pad = (num: number) => num.toString().padStart(2, "0");
    return `${pad(endH)}:${pad(endM)}`;
  };
  const formatLocalYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const timeToMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const computeSlots = (forServiceId?: number | string) => {
    const app = appRef();
    // Only need date to show time slots
    if (!bkDate) return [];
    
    // Get duration of the service we're scheduling
    let serviceDuration = 60;
    if (forServiceId) {
      const service = servicesList.find((s) => String(s.id) === String(forServiceId)) ||
        (app ? app.data.services.find((s: any) => String(s.id) === String(forServiceId)) : null);
      serviceDuration = Number((service as any)?.duration) || 60;
    }
    
    // If staff is selected for this service, filter out occupied slots for that staff
    const staffIdForService = forServiceId ? bkServiceStaff[String(forServiceId)] : null;
    
    const occupied = app && staffIdForService
      ? app.data.bookings
          .filter((b: any) => b.staffId === staffIdForService && b.date === formatLocalYmd(bkDate) && b.status !== "Canceled")
          .map((b: any) => ({ start: b.time, end: calculateEndTime(b.time, b.duration) }))
      : [];
    
    const startHour = 9;
    const endHour = 17;
    const interval = 30;
    const slots: string[] = [];
    let current = startHour * 60;
    const max = endHour * 60;
    const format = (minutes: number) => {
      const h = Math.floor(minutes / 60) % 24;
      const m = minutes % 60;
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    };
    while (current < max) {
      const start = format(current);
      const end = calculateEndTime(start, serviceDuration);
      const ok = occupied.every((o: any) => !(timeToMinutes(o.start) < timeToMinutes(end) && timeToMinutes(o.end) > timeToMinutes(start)));
      if (ok && timeToMinutes(end) <= max) slots.push(start);
      current += interval;
    }
    return slots;
  };
  const handleConfirmBooking = () => {
    const app = appRef();
    if (bkSelectedServices.length === 0 || !bkBranchId || !bkDate) return;
    
    // Validate all services have times
    if (Object.keys(bkServiceTimes).length !== bkSelectedServices.length) {
      app?.showToast("Please select a time for each service.", "error");
      return;
    }

    setSubmittingBooking(true);
    
    const selectedServiceObjects = bkSelectedServices.map(id => 
      servicesList.find((s) => String(s.id) === String(id)) ||
      (app ? app.data.services.find((s: any) => String(s.id) === String(id)) : null)
    ).filter(Boolean);

    const serviceName = selectedServiceObjects.map(s => s?.name || "").join(", ");
    const serviceIds = selectedServiceObjects.map(s => s?.id).join(",");
    const totalPrice = selectedServiceObjects.reduce((sum, s) => sum + (Number(s?.price) || 0), 0);
    const totalDuration = selectedServiceObjects.reduce((sum, s) => sum + (Number(s?.duration) || 0), 0);
    
    // Use first service time as main booking time
    const firstServiceId = bkSelectedServices[0];
    const mainTime = bkServiceTimes[String(firstServiceId)];
    
    const branchName = branches.find((b: any) => String(b.id) === String(bkBranchId))?.name || "";
    
    // Determine main staff info
    const uniqueStaffIds = new Set(Object.values(bkServiceStaff).filter(Boolean));
    let mainStaffId: string | null = null;
    let mainStaffName = "Any Available";
    
    if (uniqueStaffIds.size === 1) {
      const sid = Array.from(uniqueStaffIds)[0];
      mainStaffId = sid;
      mainStaffName = staffList.find(st => st.id === sid)?.name || "Any Available";
    } else if (uniqueStaffIds.size > 1) {
      mainStaffName = "Multiple Staff";
    }

    const client = bkClientName?.trim() || "Walk-in";
    
    const newBooking = {
      id: Date.now(),
      client,
      serviceId: serviceIds, // Comma separated IDs
      serviceName,
      staffId: mainStaffId,
      staffName: mainStaffName,
      branchId: bkBranchId,
      branchName,
      date: formatLocalYmd(bkDate),
      time: mainTime,
      duration: totalDuration,
      status: "Pending",
      price: totalPrice,
      clientEmail: bkClientEmail?.trim() || undefined,
      clientPhone: bkClientPhone?.trim() || undefined,
      notes: bkNotes?.trim() || undefined,
      services: selectedServiceObjects.map(s => {
        const sId = String(s?.id);
        const stId = bkServiceStaff[sId];
        const stName = stId ? staffList.find(st => st.id === stId)?.name : "Any Available";
        return {
          id: s?.id,
          name: s?.name,
          price: s?.price,
          duration: s?.duration,
          time: bkServiceTimes[sId],
          staffId: stId || null,
          staffName: stName
        };
      })
    };
    
    // Persist to backend; fallback to local store on error for smooth UX
    (async () => {
      try {
        await createBooking({
          client: newBooking.client,
          clientEmail: newBooking.clientEmail,
          clientPhone: newBooking.clientPhone,
          notes: newBooking.notes,
          serviceId: newBooking.serviceId,
          serviceName: newBooking.serviceName,
          staffId: newBooking.staffId,
          staffName: newBooking.staffName,
          branchId: newBooking.branchId,
          branchName: newBooking.branchName,
          date: newBooking.date,
          time: newBooking.time,
          duration: newBooking.duration,
          status: newBooking.status as any,
          price: newBooking.price,
          services: newBooking.services, // Pass detailed services array
        } as any); // Type assertion needed until we update lib
      } catch {
        // continue with local persistence
      } finally {
        if (app) {
          app.data.bookings.push(newBooking);
          app.saveData();
          app.closeModal("booking");
          app.showToast("New Booking Created!");
        }
        setSubmittingBooking(false);
        resetWizard();
      }
    })();
  };

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js"
        strategy="afterInteractive"
        onLoad={() => setChartReady(true)}
      />
      <div id="app" className="flex h-screen overflow-hidden bg-white">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
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

            <div className="max-w-7xl mx-auto">
              <div className="mb-8">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                          <i className="fas fa-calendar-check" />
                        </div>
                        <h1 className="text-2xl font-bold">All Bookings</h1>
                      </div>
                      <p className="text-sm text-white/80 mt-2">
                        Today’s schedule, availability, and status.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <section id="view-bookings" className="view-section active">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Today&apos;s Bookings</h2>
                  <button
                    onClick={openBookingWizard}
                    className="w-full sm:w-auto px-4 py-2 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-700 font-medium shadow-md shadow-pink-200 transition"
                  >
                    <i className="fas fa-plus mr-2" /> New Booking
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm text-slate-600">
                      <thead className="bg-slate-50 text-slate-800 font-semibold border-b border-slate-100">
                        <tr>
                          <th className="p-4 pl-6">Client &amp; Service</th>
                          <th className="p-4">Time &amp; Staff</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4 text-right pr-6">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100" id="bookings-table-body" />
                    </table>
                  </div>
                  <div className="space-y-6">
                    <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-6">
                      <h3 className="font-bold mb-4 flex justify-between items-center">
                        Today&apos;s Summary
                        <i className="fas fa-chart-line text-pink-500" />
                      </h3>
                      <div className="space-y-4">
                        <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                          <span>Confirmed Value</span>
                          <span className="font-bold text-green-400" id="analytics-revenue">$0</span>
                        </div>
                        <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                          <span>Confirmed Bookings</span>
                          <span className="font-bold" id="analytics-confirmed-count">0</span>
                        </div>
                        <div className="bg-white/10 p-3 rounded-lg flex justify-between">
                          <span>Avg Service Duration</span>
                          <span className="font-bold" id="analytics-avg-duration">0 mins</span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                      <h3 className="font-bold mb-4 text-slate-800">Booking Status Mix</h3>
                      <div className="h-40">
                        <canvas id="statusChart" />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>

      {/* Toasts */}
      <div id="toast-container" className="fixed bottom-5 right-5 z-50" />

      {/* Booking Modal - New Multi-step Wizard */}
      <div id="modal-booking" className="modal-backdrop">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 sm:mx-0 max-h-[92vh] flex flex-col">
          {/* Fixed Header */}
          <div className="bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white p-4 sm:p-5 flex justify-between items-center rounded-t-2xl shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                <i className="fas fa-calendar-check" />
              </div>
              <h3 className="font-bold text-lg">Book an Appointment</h3>
            </div>
            <button onClick={() => appRef()?.closeModal("booking")} className="text-white/80 hover:text-white transition w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center">
              <i className="fas fa-xmark text-xl" />
            </button>
          </div>

          {/* Fixed Stepper */}
          <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 bg-slate-50 border-b border-slate-200 shrink-0">
            <div className="flex items-center justify-between max-w-xl mx-auto">
              {[
                { num: 1, label: "Branch & Service" },
                { num: 2, label: "Date, Time & Staff" },
                { num: 3, label: "Confirm Details" }
              ].map((step, i) => (
                <div key={step.num} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all ${bkStep >= step.num ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg" : "bg-white border-2 border-slate-300 text-slate-500"}`}>
                      {bkStep > step.num ? <i className="fas fa-check" /> : step.num}
                    </div>
                    <span className="text-[10px] text-slate-600 font-semibold hidden sm:block text-center whitespace-nowrap">{step.label}</span>
                  </div>
                  {i < 2 && <div className={`h-1 flex-1 mx-1 sm:mx-2 rounded transition-all ${bkStep > step.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : "bg-slate-300"}`} />}
                </div>
              ))}
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
            {/* Step 1 - Branch & Service (Combined) */}
            {bkStep === 1 && (
              <div className="space-y-6">
                {/* Branch Selection */}
                <div>
                  <div className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <i className="fas fa-map-marker-alt text-pink-600" />
                    Select Location
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {branches.map((br: any) => {
                      const selected = bkBranchId === br.id;
                      return (
                        <button
                          key={br.id}
                          onClick={() => (setBkBranchId(br.id), setBkSelectedServices([]), setBkServiceStaff({}), setBkDate(null), setBkServiceTimes({}))}
                          className={`text-left border rounded-lg p-3 hover:shadow-md transition ${selected ? "border-pink-400 bg-pink-50 shadow-md" : "border-slate-200 bg-white"}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`w-10 h-10 rounded-lg ${selected ? "bg-pink-100" : "bg-slate-100"} flex items-center justify-center shrink-0`}>
                              <i className={`fas fa-store ${selected ? "text-pink-600" : "text-slate-400"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-800 truncate text-sm">{br.name}</div>
                              <div className="text-xs text-slate-500 truncate">{br.address}</div>
                            </div>
                            {selected && <i className="fas fa-check-circle text-pink-600 shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Service Selection */}
                <div className={!bkBranchId ? "opacity-50 pointer-events-none" : ""}>
                  <div className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <i className="fas fa-concierge-bell text-purple-600" />
                    Select Service {!bkBranchId && <span className="text-xs font-normal text-slate-500">(Select branch first)</span>}
                  </div>
                  {!bkBranchId ? (
                    <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                      <i className="fas fa-map-marker-alt text-4xl text-slate-300 mb-2 block" />
                      <p className="text-slate-500 font-medium text-sm">Select a branch first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {servicesList.map((srv: any) => {
                        const isSelected = bkSelectedServices.includes(srv.id);
                        return (
                          <button
                            key={srv.id}
                            onClick={() => {
                              if (isSelected) {
                                setBkSelectedServices(bkSelectedServices.filter(id => id !== srv.id));
                                const newTimes = { ...bkServiceTimes };
                                delete newTimes[String(srv.id)];
                                setBkServiceTimes(newTimes);
                              } else {
                                setBkSelectedServices([...bkSelectedServices, srv.id]);
                              }
                              setBkDate(null);
                            }}
                            className={`text-left border rounded-lg p-3 hover:shadow-md transition ${isSelected ? "border-purple-400 bg-purple-50 shadow-md" : "border-slate-200 bg-white"}`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className={`w-10 h-10 rounded-lg ${isSelected ? "bg-purple-100" : "bg-slate-100"} flex items-center justify-center shrink-0 overflow-hidden`}>
                                {srv.imageUrl ? (
                                  <img src={srv.imageUrl} alt={srv.name} className="w-full h-full object-cover" />
                                ) : (
                                  <i className={`fas fa-cut ${isSelected ? "text-purple-600" : "text-slate-400"}`} />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-800 truncate text-sm">{srv.name}</div>
                                <div className="text-xs text-slate-500">{srv.duration} min • ${srv.price}</div>
                              </div>
                              {isSelected && <i className="fas fa-check-circle text-purple-600 shrink-0" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex justify-end pt-2 border-t border-slate-200">
                  <button
                    disabled={!bkBranchId || bkSelectedServices.length === 0}
                    onClick={() => setBkStep(2)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId && bkSelectedServices.length > 0 ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-lg" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue to Date & Time
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 - Date, Time & Staff */}
            {bkStep === 2 && (
              <div className="space-y-6">
                {/* Date Selection */}
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-bold text-slate-700 text-sm flex items-center gap-2">
                      <i className="fas fa-calendar text-pink-600"></i>
                      Select Date
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={goPrevMonth} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs">
                        <i className="fas fa-chevron-left" />
                      </button>
                      <div className="text-xs font-semibold text-slate-800 px-2">{monthName}</div>
                      <button onClick={goNextMonth} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs">
                        <i className="fas fa-chevron-right" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="grid grid-cols-7 text-[10px] font-semibold bg-slate-50 text-slate-600">
                      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                        <div key={i} className="px-1 py-1.5 text-center">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7">
                      {buildMonthCells().map((c, idx) => {
                        const isSelected =
                          c.date && bkDate && bkDate.getFullYear() === c.date.getFullYear() && bkDate.getMonth() === c.date.getMonth() && bkDate.getDate() === c.date.getDate();
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const isPast = !!(c.date && c.date.getTime() < today.getTime());
                        const baseClickable = c.date && !isPast ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/40 cursor-not-allowed opacity-60";
                        return (
                          <div
                            key={idx}
                            className={`h-10 border border-slate-100 p-1 text-xs flex items-center justify-center ${baseClickable} ${isSelected ? "bg-pink-50 ring-2 ring-pink-500 font-bold" : ""}`}
                            onClick={() => c.date && !isPast && (setBkDate(c.date), setBkServiceTimes({}))}
                          >
                            <span className={`text-slate-700 ${!c.date ? "opacity-0" : ""}`}>{c.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Services Configuration */}
                <div className={!bkDate ? "opacity-50 pointer-events-none" : ""}>
                  <div className="font-bold text-slate-700 mb-3 flex items-center gap-2 text-sm">
                    <i className="fas fa-clock text-purple-600" />
                    Select Staff & Time for Each Service
                  </div>
                  
                  {!bkDate ? (
                    <div className="text-center text-slate-400 text-xs py-8 bg-slate-50 rounded-lg border border-slate-200 border-dashed">
                      <i className="fas fa-calendar-day text-2xl mb-2 block text-slate-300" />
                      Select a date above to continue
                    </div>
                  ) : bkSelectedServices.length === 0 ? (
                    <div className="text-center text-slate-400 text-xs py-8 bg-slate-50 rounded-lg border border-slate-200 border-dashed">
                      Select services in previous step
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {bkSelectedServices.map((serviceId) => {
                        const service = servicesList.find((s) => String(s.id) === String(serviceId));
                        if (!service) return null;
                        
                        const slots = computeSlots(serviceId);
                        const selectedTime = bkServiceTimes[String(serviceId)];
                        const selectedStaffId = bkServiceStaff[String(serviceId)];
                        
                        // Inline staff filtering
                        const availableStaffForService = staffList.filter(st => {
                           if (st.status !== "Active") return false;
                           // Basic branch check - staff must be in selected branch
                           if (bkBranchId && st.branchId !== bkBranchId && st.branch !== branches.find((b: any) => b.id === bkBranchId)?.name) return false;
                           // Service check
                           if (service?.staffIds && service.staffIds.length > 0) {
                              const sIds = service.staffIds.map(String);
                              if (!sIds.includes(String(st.id))) return false;
                           }
                           return true;
                        });
                        
                        return (
                          <div key={String(serviceId)} className="bg-white rounded-xl border border-purple-100 shadow-sm p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-xs">
                                  <i className="fas fa-cut"></i>
                                </div>
                                {service.name}
                              </div>
                              <span className="text-[10px] bg-purple-50 px-2 py-1 rounded text-purple-700 font-medium">
                                {service.duration} min
                              </span>
                            </div>

                            {/* Staff Selector */}
                            <div className="mb-3">
                              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Stylist</label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => {
                                    const newStaff = { ...bkServiceStaff };
                                    delete newStaff[String(serviceId)];
                                    setBkServiceStaff(newStaff);
                                    // Reset time
                                    const newTimes = { ...bkServiceTimes };
                                    delete newTimes[String(serviceId)];
                                    setBkServiceTimes(newTimes);
                                  }}
                                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                                    !selectedStaffId 
                                      ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                                      : "bg-white border-slate-200 text-slate-600 hover:border-indigo-200"
                                  }`}
                                >
                                  <i className="fas fa-random flex-shrink-0"></i> <span>Any</span>
                                </button>
                                {availableStaffForService.map(st => (
                                  <button
                                    key={st.id}
                                    onClick={() => {
                                      setBkServiceStaff({ ...bkServiceStaff, [String(serviceId)]: st.id });
                                      // Reset time
                                      const newTimes = { ...bkServiceTimes };
                                      delete newTimes[String(serviceId)];
                                      setBkServiceTimes(newTimes);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                                      selectedStaffId === st.id
                                        ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                                        : "bg-white border-slate-200 text-slate-600 hover:border-indigo-200"
                                    }`}
                                  >
                                    {/* Avatar */}
                                    <div className="w-4 h-4 rounded-full bg-slate-200 overflow-hidden flex-shrink-0">
                                       {st.avatar ? <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(st.avatar)}`} className="w-full h-full object-cover" alt="" /> : null}
                                    </div>
                                    <span>{st.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Time Selector */}
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Time Slot</label>
                              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                                {slots.length === 0 ? (
                                  <div className="col-span-full text-center text-slate-400 text-[10px] py-2 italic">
                                    No slots available
                                  </div>
                                ) : (
                                  slots.map((t) => (
                                    <button
                                      key={t}
                                      onClick={() => setBkServiceTimes({ ...bkServiceTimes, [String(serviceId)]: t })}
                                      className={`py-1.5 rounded text-[10px] font-bold transition-all ${
                                        selectedTime === t 
                                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm" 
                                          : "bg-white text-slate-700 border border-purple-100 hover:border-pink-300"
                                      }`}
                                    >
                                      {t}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex justify-between pt-3 border-t border-slate-200">
                  <button onClick={() => setBkStep(1)} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium">
                    Back
                  </button>
                  <button
                    disabled={!bkDate || Object.keys(bkServiceTimes).length !== bkSelectedServices.length}
                    onClick={() => setBkStep(3)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkDate && Object.keys(bkServiceTimes).length === bkSelectedServices.length ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue to Details
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 - Customer Details + Summary */}
            {bkStep === 3 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Customer Details Form */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="font-bold text-slate-700 mb-4">Your Details</div>
                  <div className="space-y-4">
              <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={bkClientName}
                        onChange={(e) => setBkClientName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="John Doe"
                      />
                </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
                      <input
                        type="email"
                        value={bkClientEmail}
                        onChange={(e) => setBkClientEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="john@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        value={bkClientPhone}
                        onChange={(e) => setBkClientPhone(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="+1 555 000 1111"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Additional Notes (Optional)</label>
                      <textarea
                        value={bkNotes}
                        onChange={(e) => setBkNotes(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="Any special requests or information…"
                        rows={4}
                      />
                    </div>
                  </div>
                </div>

                {/* Booking Summary */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="font-bold text-slate-700 mb-4">Booking Summary</div>
                  <div className="bg-pink-50 rounded-xl border border-pink-100 p-4 space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Branch</span><span className="font-semibold text-slate-800">{branches.find((b: any) => b.id === bkBranchId)?.name || "-"}</span></div>
                    
                    <div className="border-t border-pink-100 pt-2 mt-2">
                      <span className="text-slate-500 block mb-2">Services ({bkSelectedServices.length})</span>
                      <div className="space-y-2">
                        {bkSelectedServices.map(id => {
                          const s = servicesList.find((srv: any) => String(srv.id) === String(id));
                          const stId = bkServiceStaff[String(id)];
                          const stName = stId ? staffList.find(st => st.id === stId)?.name : "Any Staff";
                          return (
                            <div key={id} className="bg-white/60 p-2 rounded border border-pink-100">
                              <div className="flex justify-between">
                                <span className="font-semibold text-slate-800">{s?.name || "-"}</span>
                                <span className="font-bold text-pink-600">${s?.price || 0}</span>
                              </div>
                              <div className="flex justify-between text-xs text-slate-500 mt-1">
                                <span className="flex items-center gap-2">
                                   <span>{bkServiceTimes[String(id)]}</span>
                                   <span className="text-slate-400">•</span>
                                   <span><i className="fas fa-user mr-1"></i> {stName}</span>
                                </span>
                                <span>{s?.duration} min</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-semibold text-slate-800">{bkDate ? bkDate.toLocaleDateString() : "-"}</span></div>
                    
                    <div className="flex justify-between border-t-2 border-pink-200 pt-2 mt-2">
                      <span className="text-slate-700 font-bold">Total Price</span>
                      <span className="font-black text-pink-600 text-lg">
                        ${bkSelectedServices.reduce((sum: number, id) => {
                          const s = servicesList.find((srv: any) => String(srv.id) === String(id));
                          return sum + (Number(s?.price) || 0);
                        }, 0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 mt-1 flex justify-between">
                  <button disabled={submittingBooking} onClick={() => setBkStep(2)} className={`px-5 py-2 rounded-lg border border-slate-300 ${submittingBooking ? "text-slate-400 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"} font-medium`}>
                    Back
                  </button>
                  <button
                    disabled={!bkBranchId || bkSelectedServices.length === 0 || !bkDate || Object.keys(bkServiceTimes).length !== bkSelectedServices.length || submittingBooking}
                    onClick={handleConfirmBooking}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId && bkSelectedServices.length > 0 && bkDate && Object.keys(bkServiceTimes).length === bkSelectedServices.length && !submittingBooking ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    {submittingBooking ? <span className="inline-flex items-center"><i className="fas fa-spinner animate-spin mr-2" /> Confirming…</span> : "Confirm Booking"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Minimal CSS for modal, toasts, status badges, and time slots */}
      <style>{`
        .view-section.active { display: block; }
        .modal-backdrop { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15,23,42,0.6); backdrop-filter: blur(4px); z-index: 50; align-items: center; justify-content: center; }
        .modal-backdrop.open { display: flex; }
        .toast { background: #1e293b; color: white; padding: 12px 24px; border-radius: 8px; margin-top: 10px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 12px; border-left: 4px solid #ec4899; }
        .status-Confirmed { background-color: #dcfce7; color: #15803d; }
        .status-Pending { background-color: #fef9c3; color: #a16207; }
        .status-Canceled { background-color: #fee2e2; color: #b91c1c; }
        .status-Completed { background-color: #e0f2fe; color: #075985; }
      `}</style>
    </>
  );
}


