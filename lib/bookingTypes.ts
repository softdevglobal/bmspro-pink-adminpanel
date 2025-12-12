export type BookingStatus = 
  | "Pending" 
  | "AwaitingStaffApproval" 
  | "PartiallyApproved"  // Some services accepted, waiting for others
  | "StaffRejected" 
  | "Confirmed" 
  | "Completed" 
  | "Canceled";

export const BOOKING_STATUSES: BookingStatus[] = [
  "Pending", 
  "AwaitingStaffApproval", 
  "PartiallyApproved",
  "StaffRejected", 
  "Confirmed", 
  "Completed", 
  "Canceled"
];

// Per-service approval status for multi-service bookings
export type ServiceApprovalStatus = "pending" | "accepted" | "rejected";

// Service structure with approval tracking
export interface BookingService {
  id: string | number;
  name?: string;
  price?: number;
  duration?: number;
  time?: string;
  staffId?: string | null;
  staffName?: string | null;
  // Per-service approval tracking
  approvalStatus?: ServiceApprovalStatus;
  acceptedAt?: any; // Firestore timestamp
  rejectedAt?: any; // Firestore timestamp
  rejectionReason?: string;
  respondedByStaffUid?: string;
  respondedByStaffName?: string;
}

export function normalizeBookingStatus(value: string | null | undefined): BookingStatus {
  const v = String(value || "").toLowerCase().replace(/[_\s-]/g, "");
  if (v === "pending") return "Pending";
  if (v === "awaitingstaffapproval") return "AwaitingStaffApproval";
  if (v === "partiallyapproved") return "PartiallyApproved";
  if (v === "staffrejected") return "StaffRejected";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed") return "Completed";
  // Accept both spellings, store as single-L "Canceled" for consistency with existing data
  if (v === "canceled" || v === "cancelled") return "Canceled";
  return "Pending";
}

export function canTransitionStatus(current: BookingStatus, next: BookingStatus): boolean {
  // Multi-service workflow:
  // Pending -> AwaitingStaffApproval (admin confirms, sends to staff for review)
  // Pending -> Canceled (admin cancels)
  // AwaitingStaffApproval -> PartiallyApproved (some staff accept, waiting for others)
  // AwaitingStaffApproval -> Confirmed (all staff accept - single service or all services)
  // AwaitingStaffApproval -> StaffRejected (any staff rejects when there's a rejected service to handle)
  // PartiallyApproved -> Confirmed (remaining staff accept)
  // PartiallyApproved -> StaffRejected (any staff rejects - needs admin reassignment)
  // PartiallyApproved -> Canceled (admin cancels)
  // StaffRejected -> AwaitingStaffApproval (admin reassigns rejected service to new staff)
  // StaffRejected -> PartiallyApproved (admin reassigns and some are still accepted)
  // StaffRejected -> Canceled (admin cancels after rejection)
  // Confirmed -> Completed (booking completed)
  // Confirmed -> Canceled (admin cancels confirmed booking)
  
  if (current === "Pending" && next === "AwaitingStaffApproval") return true;
  if (current === "Pending" && next === "Canceled") return true;
  if (current === "AwaitingStaffApproval" && next === "PartiallyApproved") return true;
  if (current === "AwaitingStaffApproval" && next === "Confirmed") return true;
  if (current === "AwaitingStaffApproval" && next === "StaffRejected") return true;
  if (current === "AwaitingStaffApproval" && next === "Canceled") return true;
  if (current === "PartiallyApproved" && next === "Confirmed") return true;
  if (current === "PartiallyApproved" && next === "StaffRejected") return true;
  if (current === "PartiallyApproved" && next === "Canceled") return true;
  if (current === "StaffRejected" && next === "AwaitingStaffApproval") return true;
  if (current === "StaffRejected" && next === "PartiallyApproved") return true;
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
    case "PartiallyApproved": return "Partially Approved";
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
    case "PartiallyApproved":
      return { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" };
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

/**
 * Get color for service approval status
 */
export function getServiceApprovalColor(status: ServiceApprovalStatus): { bg: string; text: string; border: string } {
  switch (status) {
    case "pending":
      return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
    case "accepted":
      return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "rejected":
      return { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" };
    default:
      return { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" };
  }
}

/**
 * Helper to determine booking status based on service approvals
 */
export function calculateBookingStatusFromServices(services: BookingService[]): BookingStatus {
  if (!services || services.length === 0) return "AwaitingStaffApproval";
  
  const statuses = services.map(s => s.approvalStatus || "pending");
  const allAccepted = statuses.every(s => s === "accepted");
  const anyRejected = statuses.some(s => s === "rejected");
  const anyAccepted = statuses.some(s => s === "accepted");
  const allPending = statuses.every(s => s === "pending");
  
  if (allAccepted) return "Confirmed";
  if (anyRejected) return "StaffRejected";
  if (anyAccepted && !allPending) return "PartiallyApproved";
  return "AwaitingStaffApproval";
}


