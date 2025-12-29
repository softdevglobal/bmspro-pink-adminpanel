import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export type AuditActionType = 
  | "create" 
  | "update" 
  | "delete" 
  | "status_change" 
  | "login" 
  | "logout" 
  | "other";

export type AuditEntityType = 
  | "booking" 
  | "service" 
  | "staff" 
  | "branch" 
  | "customer" 
  | "settings" 
  | "auth"
  | "user_profile"
  | "staff_check_in";

export interface AuditLogInput {
  ownerUid: string;
  action: string;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId?: string;
  entityName?: string;
  performedBy: string;
  performedByName?: string;
  performedByRole?: string;
  details?: string;
  previousValue?: string;
  newValue?: string;
  branchId?: string;
  branchName?: string;
  metadata?: Record<string, any>;
}

/**
 * Creates an audit log entry in Firestore (server-side version for API routes)
 */
export async function createAuditLogServer(input: AuditLogInput): Promise<string | null> {
  try {
    const db = adminDb();
    
    const logData: Record<string, any> = {
      ...input,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    // Remove undefined values
    Object.keys(logData).forEach(key => {
      if (logData[key] === undefined) {
        delete logData[key];
      }
    });

    const ref = await db.collection("auditLogs").add(logData);
    return ref.id;
  } catch (error) {
    console.error("Failed to create audit log (server):", error);
    return null;
  }
}

// ==================== BOOKING AUDIT HELPERS (SERVER) ====================

export async function logBookingStatusChangedServer(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  previousStatus: string,
  newStatus: string,
  performer: { uid: string; name: string; role: string },
  details?: string,
  branchName?: string
) {
  return createAuditLogServer({
    ownerUid,
    action: `Booking status changed: ${previousStatus} → ${newStatus}`,
    actionType: "status_change",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || `Booking for ${clientName}`,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    previousValue: previousStatus,
    newValue: newStatus,
    details,
    branchName,
  });
}

export async function logBookingStaffResponseServer(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  action: "accepted" | "rejected",
  performer: { uid: string; name: string; role: string },
  serviceName?: string,
  rejectionReason?: string,
  branchName?: string
) {
  const actionText = action === "accepted" ? "accepted" : "rejected";
  return createAuditLogServer({
    ownerUid,
    action: `Staff ${actionText} booking${serviceName ? ` for service: ${serviceName}` : ""}`,
    actionType: "status_change",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || `Booking for ${clientName}`,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: action === "rejected" && rejectionReason ? `Reason: ${rejectionReason}` : undefined,
    branchName,
  });
}

export async function logBookingReassignedServer(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  performer: { uid: string; name: string; role: string },
  newStaffName?: string,
  branchName?: string
) {
  return createAuditLogServer({
    ownerUid,
    action: `Booking reassigned${newStaffName ? ` to ${newStaffName}` : ""}`,
    actionType: "update",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || `Booking for ${clientName}`,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: newStaffName ? `New staff: ${newStaffName}` : undefined,
    branchName,
  });
}

export async function logBookingSentToStaffServer(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  performer: { uid: string; name: string; role: string },
  staffNames: string[],
  branchName?: string
) {
  return createAuditLogServer({
    ownerUid,
    action: `Booking sent to staff for approval`,
    actionType: "status_change",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || `Booking for ${clientName}`,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    previousValue: "Pending",
    newValue: "AwaitingStaffApproval",
    details: `Assigned to: ${staffNames.join(", ")}`,
    branchName,
  });
}

// ==================== STAFF MANAGEMENT AUDIT HELPERS (SERVER) ====================

export async function logStaffCreatedServer(
  ownerUid: string,
  staffId: string,
  staffName: string,
  staffRole: string,
  branchName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLogServer({
    ownerUid,
    action: `Staff member created: ${staffName}`,
    actionType: "create",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: `Role: ${staffRole}, Branch: ${branchName}`,
    branchName,
  });
}

export async function logStaffSuspendedServer(
  ownerUid: string,
  staffId: string,
  staffName: string,
  performer: { uid: string; name: string; role: string },
  suspended: boolean
) {
  return createAuditLogServer({
    ownerUid,
    action: `Staff member ${suspended ? "suspended" : "unsuspended"}: ${staffName}`,
    actionType: "status_change",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    newValue: suspended ? "Suspended" : "Active",
  });
}

export async function logStaffDeletedServer(
  ownerUid: string,
  staffId: string,
  staffName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLogServer({
    ownerUid,
    action: `Staff member deleted: ${staffName}`,
    actionType: "delete",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
  });
}

// ==================== SERVICE COMPLETION AUDIT HELPERS (SERVER) ====================

export async function logBookingServiceCompletedServer(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  performer: { uid: string; name: string; role: string },
  serviceName?: string,
  allServicesCompleted?: boolean,
  branchName?: string
) {
  const actionText = allServicesCompleted 
    ? `Booking completed${serviceName ? `: ${serviceName}` : ""}`
    : `Service completed${serviceName ? `: ${serviceName}` : ""}`;
  
  return createAuditLogServer({
    ownerUid,
    action: actionText,
    actionType: "status_change",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || `Booking for ${clientName}`,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    previousValue: allServicesCompleted ? "Confirmed" : "In Progress",
    newValue: allServicesCompleted ? "Completed" : "Service Completed",
    details: serviceName ? `Service: ${serviceName}` : undefined,
    branchName,
  });
}

