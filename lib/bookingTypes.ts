export type BookingStatus = 
  | "Pending" 
  | "AwaitingStaffApproval" 
  | "StaffRejected" 
  | "Confirmed" 
  | "Completed" 
  | "Canceled";

export const BOOKING_STATUSES: BookingStatus[] = [
  "Pending", 
  "AwaitingStaffApproval", 
  "StaffRejected", 
  "Confirmed", 
  "Completed", 
  "Canceled"
];

export function normalizeBookingStatus(value: string | null | undefined): BookingStatus {
  const v = String(value || "").toLowerCase().replace(/[_\s-]/g, "");
  if (v === "pending") return "Pending";
  if (v === "awaitingstaffapproval") return "AwaitingStaffApproval";
  if (v === "staffrejected") return "StaffRejected";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed") return "Completed";
  // Accept both spellings, store as single-L "Canceled" for consistency with existing data
  if (v === "canceled" || v === "cancelled") return "Canceled";
  return "Pending";
}

export function canTransitionStatus(current: BookingStatus, next: BookingStatus): boolean {
  // New workflow:
  // Pending -> AwaitingStaffApproval (admin confirms, sends to staff for review)
  // Pending -> Canceled (admin cancels)
  // AwaitingStaffApproval -> Confirmed (staff accepts)
  // AwaitingStaffApproval -> StaffRejected (staff rejects)
  // StaffRejected -> AwaitingStaffApproval (admin reassigns to new staff)
  // StaffRejected -> Canceled (admin cancels after rejection)
  // Confirmed -> Completed (booking completed)
  // Confirmed -> Canceled (admin cancels confirmed booking)
  
  if (current === "Pending" && next === "AwaitingStaffApproval") return true;
  if (current === "Pending" && next === "Canceled") return true;
  if (current === "AwaitingStaffApproval" && next === "Confirmed") return true;
  if (current === "AwaitingStaffApproval" && next === "StaffRejected") return true;
  if (current === "StaffRejected" && next === "AwaitingStaffApproval") return true;
  if (current === "StaffRejected" && next === "Canceled") return true;
  if (current === "Confirmed" && next === "Completed") return true;
  if (current === "Confirmed" && next === "Canceled") return true;
  return false;
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "Pending": return "Pending";
    case "AwaitingStaffApproval": return "Awaiting Staff";
    case "StaffRejected": return "Staff Rejected";
    case "Confirmed": return "Confirmed";
    case "Completed": return "Completed";
    case "Canceled": return "Canceled";
    default: return status;
  }
}

/**
 * Get status color classes for UI
 */
export function getStatusColor(status: BookingStatus): { bg: string; text: string; border: string } {
  switch (status) {
    case "Pending":
      return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
    case "AwaitingStaffApproval":
      return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "StaffRejected":
      return { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" };
    case "Confirmed":
      return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "Completed":
      return { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" };
    case "Canceled":
      return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    default:
      return { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };
  }
}


