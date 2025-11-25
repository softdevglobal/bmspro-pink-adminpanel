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

export default function BookingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  // Booking wizard state
  const [bkStep, setBkStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [bkBranchId, setBkBranchId] = useState<string | null>(null);
  const [bkServiceId, setBkServiceId] = useState<number | null>(null);
  const [bkStaffId, setBkStaffId] = useState<string | null>(null);
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkTime, setBkTime] = useState<string | null>(null);
  const [bkClientName, setBkClientName] = useState<string>("");
  const [bkClientEmail, setBkClientEmail] = useState<string>("");
  const [bkClientPhone, setBkClientPhone] = useState<string>("");
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);

  // Real data from Firestore
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string | number; name: string; price?: number; duration?: number; icon?: string; branches?: string[] }>>([]);
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
        } catch {
          router.replace("/login");
        }
        // use authenticated user id as ownerUid
        try {
          setOwnerUid(user?.uid || null);
        } catch {}
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
        const todayBookings = this.data.bookings.filter((b: any) => b.date === today);
        if (todayBookings.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">No bookings scheduled for today.</td></tr>';
          return;
        }
        todayBookings.sort((a: any, b: any) => (a.time > b.time ? 1 : -1));
        todayBookings.forEach((b: any) => {
          const service = this.data.services.find((s: any) => s.id === b.serviceId);
          const staff = this.data.staff.find((s: any) => s.id === b.staffId);
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
                <span class="block text-xs text-slate-500">${service ? service.name : "Unknown Service"}</span>
              </td>
              <td class="p-4">
                <span class="font-medium text-slate-700">${b.time} - ${endTime}</span>
                <span class="block text-xs text-slate-500">w/ ${staff ? staff.name : "Unassigned"}</span>
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
          icon: String((s as any).icon || "fa-solid fa-star"),
          branches: Array.isArray((s as any).branches) ? (s as any).branches.map(String) : undefined,
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
    setBkServiceId(null);
    setBkStaffId(null);
    const t = new Date();
    setBkMonthYear({ month: t.getMonth(), year: t.getFullYear() });
    setBkDate(null);
    setBkTime(null);
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
  const timeToMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const computeSlots = () => {
    const app = appRef();
    if (!bkServiceId || !bkStaffId || !bkDate) return [];
    const service =
      servicesList.find((s) => String(s.id) === String(bkServiceId)) ||
      (app ? app.data.services.find((s: any) => String(s.id) === String(bkServiceId)) : null);
    // If service not found or has no duration, fall back to 60 mins so slots still show
    const duration = Number((service as any)?.duration) || 60;
    const occupied = app
      ? app.data.bookings
          .filter((b: any) => b.staffId === bkStaffId && b.date === bkDate.toISOString().slice(0, 10) && b.status !== "Canceled")
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
      const end = calculateEndTime(start, duration);
      const ok = occupied.every((o: any) => !(timeToMinutes(o.start) < timeToMinutes(end) && timeToMinutes(o.end) > timeToMinutes(start)));
      if (ok && timeToMinutes(end) <= max) slots.push(start);
      current += interval;
    }
    return slots;
  };
  const handleConfirmBooking = () => {
    const app = appRef();
    if (!bkServiceId || !bkStaffId || !bkBranchId || !bkDate || !bkTime) return;
    setSubmittingBooking(true);
    const service =
      servicesList.find((s) => String(s.id) === String(bkServiceId)) ||
      (app ? app.data.services.find((s: any) => String(s.id) === String(bkServiceId)) : null);
    const serviceName =
      servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.name ||
      (service as any)?.name ||
      "";
    const branchName = branches.find((b: any) => String(b.id) === String(bkBranchId))?.name || "";
    const staffName = staffList.find((s: any) => String(s.id) === String(bkStaffId))?.name || "";
    const client = bkClientName?.trim() || "Walk-in";
    const newBooking = {
      id: Date.now(),
      client,
      serviceId: bkServiceId as any,
      serviceName,
      staffId: bkStaffId,
      staffName,
      branchId: bkBranchId,
      branchName,
      date: bkDate.toISOString().slice(0, 10),
      time: bkTime,
      duration: (service as any)?.duration || 60,
      status: "Confirmed",
      price: (service as any)?.price || 0,
      clientEmail: bkClientEmail?.trim() || undefined,
      clientPhone: bkClientPhone?.trim() || undefined,
      notes: bkNotes?.trim() || undefined,
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
        });
      } catch {
        // continue with local persistence
      } finally {
        if (app) {
          app.data.bookings.push(newBooking);
          app.saveData();
          app.closeModal("booking");
          app.showToast("New Booking Confirmed!");
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
                        <h1 className="text-2xl font-bold">Bookings</h1>
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 sm:mx-0 max-h-[92vh] overflow-y-auto">
          <div className="bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white p-5 flex justify-between items-center rounded-t-2xl">
            <h3 className="font-bold">Book an Appointment</h3>
            <button onClick={() => appRef()?.closeModal("booking")} className="text-white/80 hover:text-white">
              <i className="fas fa-xmark" />
            </button>
          </div>

          {/* Stepper */}
          <div className="px-6 pt-5">
            <div className="flex items-center justify-between max-w-xl mx-auto mb-4">
              {[1, 2, 3, 4, 5].map((n, i) => (
                <div key={n} className="flex-1 flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${bkStep >= (n as any) ? "bg-pink-600 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</div>
                  {i < 4 && <div className={`h-1 flex-1 mx-2 rounded ${bkStep > (n as any) ? "bg-pink-500" : "bg-slate-200"}`} />}
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 pt-2">
            {/* Step 1 - Branch */}
            {bkStep === 1 && (
              <div>
                <div className="font-bold text-slate-700 mb-3">Select Location</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {branches.map((b: any) => {
                    const selected = bkBranchId === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setBkBranchId(b.id)}
                        className={`text-left border rounded-2xl p-4 hover:shadow transition ${selected ? "border-pink-400 bg-pink-50" : "border-slate-200 bg-white"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                            <i className="fas fa-location-dot" />
                          </div>
                          <div className="font-semibold text-slate-800">{b.name}</div>
                        </div>
                        {b.address && <div className="text-xs text-slate-500 mt-2">{b.address}</div>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    disabled={!bkBranchId}
                    onClick={() => setBkStep(2)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue to Services
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 - Services */}
            {bkStep === 2 && (
              <div>
                <div className="font-bold text-slate-700 mb-3">Select Service</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {servicesList
                    .filter((s: any) => s && (!bkBranchId || !s.branches || s.branches.includes(bkBranchId)))
                    .map((s: any) => {
                      const selected = bkServiceId === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setBkServiceId(s.id)}
                          className={`text-left border rounded-2xl p-4 hover:shadow transition ${selected ? "border-pink-400 bg-pink-50" : "border-slate-200 bg-white"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center">
                                <i className={s.icon || "fa-solid fa-star"} />
                              </div>
                              <div>
                                <div className="font-semibold text-slate-800">{s.name}</div>
                                <div className="text-xs text-slate-500">{s.duration} mins</div>
                              </div>
                            </div>
                            <div className="text-pink-600 font-bold">${s.price}</div>
                          </div>
                        </button>
                      );
                    })}
                </div>
                <div className="mt-5 flex justify-between">
                  <button onClick={() => setBkStep(1)} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                    Back
                  </button>
                  <button
                    disabled={!bkServiceId}
                    onClick={() => setBkStep(3)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkServiceId ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 - Staff */}
            {bkStep === 3 && (
              <div>
                <div className="font-bold text-slate-700 mb-3">Choose Your Stylist (Optional)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {staffList
                    .filter(
                      (st: any) =>
                        st.status === "Active" &&
                        (!bkBranchId ||
                          st.branchId === bkBranchId ||
                          st.branch === branches.find((b: any) => b.id === bkBranchId)?.name)
                    )
                    .map((st: any) => {
                      const selected = bkStaffId === st.id;
                      return (
                        <button
                          key={st.id}
                          onClick={() => setBkStaffId(st.id)}
                          className={`text-left border rounded-2xl p-4 hover:shadow transition flex items-center gap-3 ${selected ? "border-pink-400 bg-pink-50" : "border-slate-200 bg-white"}`}
                        >
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(st.avatar || st.name)}`} className="w-10 h-10 rounded-full bg-slate-100" alt="" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 truncate">{st.name}</div>
                            <div className="text-xs text-slate-500 truncate">{st.role}</div>
                          </div>
                          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Available</span>
                        </button>
                      );
                    })}
                </div>
                <div className="mt-5 flex justify-between">
                  <button onClick={() => setBkStep(2)} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                    Back
                  </button>
                  <button
                    disabled={!bkStaffId}
                    onClick={() => setBkStep(4)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkStaffId ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 4 - Calendar & Time */}
            {bkStep === 4 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-slate-700">Pick a Date</div>
                    <div className="flex items-center gap-2">
                      <button onClick={goPrevMonth} className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
                        <i className="fas fa-chevron-left" />
                      </button>
                      <div className="text-sm font-semibold text-slate-800 px-2">{monthName}</div>
                      <button onClick={goNextMonth} className="w-8 h-8 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
                        <i className="fas fa-chevron-right" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="grid grid-cols-7 text-xs font-semibold bg-slate-50 text-slate-600">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                        <div key={d} className="px-2 py-2 text-center">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7">
                      {buildMonthCells().map((c, idx) => {
                        const isSelected =
                          c.date && bkDate && bkDate.getFullYear() === c.date.getFullYear() && bkDate.getMonth() === c.date.getMonth() && bkDate.getDate() === c.date.getDate();
                        return (
                          <div
                            key={idx}
                            className={`h-16 border border-slate-100 p-2 text-sm ${c.date ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/40"} ${isSelected ? "bg-pink-50 ring-2 ring-pink-500" : ""}`}
                            onClick={() => c.date && (setBkDate(c.date), setBkTime(null))}
                          >
                            <div className="flex items-start justify-between">
                              <span className={`text-slate-700 ${!c.date ? "opacity-0" : ""}`}>{c.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-700 mb-2">Select a Time</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
                    {computeSlots().length === 0 ? (
                      <p className="col-span-3 text-center text-slate-400 text-xs py-2">Select date, service and staff to see available slots.</p>
                    ) : (
                      computeSlots().map((t) => (
                        <button
                          key={t}
                          onClick={() => setBkTime(t)}
                          className={`time-slot text-sm ${bkTime === t ? "selected" : ""}`}
                          style={{ padding: "0.5rem" }}
                        >
                          {t}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="mt-5 flex justify-between">
                    <button onClick={() => setBkStep(3)} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                      Back
                    </button>
                    <button
                      disabled={!bkDate || !bkTime}
                      onClick={() => setBkStep(5)}
                      className={`px-5 py-2 rounded-lg text-white font-semibold ${bkDate && bkTime ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5 - Customer Details + Summary */}
            {bkStep === 5 && (
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
                    <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-semibold text-slate-800">{servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.name || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Staff</span><span className="font-semibold text-slate-800">{staffList.find((s: any) => s.id === bkStaffId)?.name || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-semibold text-slate-800">{bkDate ? bkDate.toLocaleDateString() : "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Time</span><span className="font-semibold text-slate-800">{bkTime || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Price</span><span className="font-bold text-pink-600">${servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.price || 0}</span></div>
                  </div>
                </div>

                <div className="lg:col-span-2 mt-1 flex justify-between">
                  <button disabled={submittingBooking} onClick={() => setBkStep(4)} className={`px-5 py-2 rounded-lg border border-slate-300 ${submittingBooking ? "text-slate-400 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"}`}>
                    Back
                  </button>
                  <button
                    disabled={!bkBranchId || !bkServiceId || !bkStaffId || !bkDate || !bkTime || submittingBooking}
                    onClick={handleConfirmBooking}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId && bkServiceId && bkStaffId && bkDate && bkTime && !submittingBooking ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
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
        .time-slot { background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.5rem; cursor: pointer; text-align: center; color: #0f172a; }
        .time-slot:hover { background-color: #e2e8f0; }
        .time-slot.selected { background-color: #ec4899; color: #fff; border-color: #db2777; }
      `}</style>
    </>
  );
}


