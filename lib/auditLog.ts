import { db, auth } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

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
 * Creates an audit log entry in Firestore
 */
export async function createAuditLog(input: AuditLogInput): Promise<string | null> {
  try {
    const logData = {
      ...input,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    // Remove undefined values
    Object.keys(logData).forEach(key => {
      if ((logData as any)[key] === undefined) {
        delete (logData as any)[key];
      }
    });

    const ref = await addDoc(collection(db, "auditLogs"), logData);
    return ref.id;
  } catch (error) {
    console.error("Failed to create audit log:", error);
    return null;
  }
}

/**
 * Get current user info for audit logging
 */
export async function getCurrentUserForAudit(): Promise<{
  uid: string;
  name: string;
  role: string;
} | null> {
  const user = auth.currentUser;
  if (!user) return null;

  // Try to get name from user object first
  let name = user.displayName || user.email || "Unknown";
  let role = "unknown";

  // Try to get more info from localStorage (cached during auth)
  if (typeof window !== "undefined") {
    const cachedName = localStorage.getItem("userName");
    const cachedRole = localStorage.getItem("role");
    if (cachedName) name = cachedName;
    if (cachedRole) role = cachedRole;
  }

  return {
    uid: user.uid,
    name,
    role,
  };
}

// ==================== BOOKING AUDIT HELPERS ====================

export async function logBookingCreated(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  serviceName: string,
  branchName: string | undefined,
  staffName: string | undefined,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Booking created for ${clientName}`,
    actionType: "create",
    entityType: "booking",
    entityId: bookingId,
    entityName: bookingCode || bookingId,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: `Service: ${serviceName}${staffName ? `, Staff: ${staffName}` : ""}`,
    branchName,
  });
}

export async function logBookingStatusChanged(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  previousStatus: string,
  newStatus: string,
  performer: { uid: string; name: string; role: string },
  details?: string
) {
  return createAuditLog({
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
  });
}

export async function logBookingStaffResponse(
  ownerUid: string,
  bookingId: string,
  bookingCode: string | undefined,
  clientName: string,
  action: "accepted" | "rejected",
  performer: { uid: string; name: string; role: string },
  serviceName?: string,
  rejectionReason?: string
) {
  const actionText = action === "accepted" ? "accepted" : "rejected";
  return createAuditLog({
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
  });
}

// ==================== SERVICE AUDIT HELPERS ====================

export async function logServiceCreated(
  ownerUid: string,
  serviceId: string,
  serviceName: string,
  price: number,
  performer: { uid: string; name: string; role: string },
  branchNames?: string[]
) {
  return createAuditLog({
    ownerUid,
    action: `Service created: ${serviceName}`,
    actionType: "create",
    entityType: "service",
    entityId: serviceId,
    entityName: serviceName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: `Price: $${price}${branchNames?.length ? `, Branches: ${branchNames.join(", ")}` : ""}`,
  });
}

export async function logServiceUpdated(
  ownerUid: string,
  serviceId: string,
  serviceName: string,
  performer: { uid: string; name: string; role: string },
  changes?: string
) {
  return createAuditLog({
    ownerUid,
    action: `Service updated: ${serviceName}`,
    actionType: "update",
    entityType: "service",
    entityId: serviceId,
    entityName: serviceName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: changes,
  });
}

export async function logServiceDeleted(
  ownerUid: string,
  serviceId: string,
  serviceName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Service deleted: ${serviceName}`,
    actionType: "delete",
    entityType: "service",
    entityId: serviceId,
    entityName: serviceName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
  });
}

// ==================== BRANCH AUDIT HELPERS ====================

export async function logBranchCreated(
  ownerUid: string,
  branchId: string,
  branchName: string,
  address: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Branch created: ${branchName}`,
    actionType: "create",
    entityType: "branch",
    entityId: branchId,
    entityName: branchName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: `Address: ${address}`,
    branchId,
    branchName,
  });
}

export async function logBranchUpdated(
  ownerUid: string,
  branchId: string,
  branchName: string,
  performer: { uid: string; name: string; role: string },
  changes?: string
) {
  return createAuditLog({
    ownerUid,
    action: `Branch updated: ${branchName}`,
    actionType: "update",
    entityType: "branch",
    entityId: branchId,
    entityName: branchName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: changes,
    branchId,
    branchName,
  });
}

export async function logBranchDeleted(
  ownerUid: string,
  branchId: string,
  branchName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Branch deleted: ${branchName}`,
    actionType: "delete",
    entityType: "branch",
    entityId: branchId,
    entityName: branchName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
  });
}

export async function logBranchAdminAssigned(
  ownerUid: string,
  branchId: string,
  branchName: string,
  adminId: string,
  adminName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Branch admin assigned: ${adminName} to ${branchName}`,
    actionType: "update",
    entityType: "branch",
    entityId: branchId,
    entityName: branchName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: `Admin: ${adminName} (${adminId})`,
    branchId,
    branchName,
  });
}

// ==================== STAFF AUDIT HELPERS ====================

export async function logStaffCreated(
  ownerUid: string,
  staffId: string,
  staffName: string,
  staffRole: string,
  branchName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
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

export async function logStaffUpdated(
  ownerUid: string,
  staffId: string,
  staffName: string,
  performer: { uid: string; name: string; role: string },
  changes?: string
) {
  return createAuditLog({
    ownerUid,
    action: `Staff member updated: ${staffName}`,
    actionType: "update",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: changes,
  });
}

export async function logStaffDeleted(
  ownerUid: string,
  staffId: string,
  staffName: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
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

export async function logStaffStatusChanged(
  ownerUid: string,
  staffId: string,
  staffName: string,
  previousStatus: string,
  newStatus: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Staff status changed: ${staffName} (${previousStatus} → ${newStatus})`,
    actionType: "status_change",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    previousValue: previousStatus,
    newValue: newStatus,
  });
}

export async function logStaffPromoted(
  ownerUid: string,
  staffId: string,
  staffName: string,
  newRole: string,
  performer: { uid: string; name: string; role: string }
) {
  return createAuditLog({
    ownerUid,
    action: `Staff promoted: ${staffName} to ${newRole}`,
    actionType: "update",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    newValue: newRole,
    details: `Promoted to ${newRole}`,
  });
}

export async function logStaffScheduleUpdated(
  ownerUid: string,
  staffId: string,
  staffName: string,
  performer: { uid: string; name: string; role: string },
  scheduleDetails?: string
) {
  return createAuditLog({
    ownerUid,
    action: `Staff schedule updated: ${staffName}`,
    actionType: "update",
    entityType: "staff",
    entityId: staffId,
    entityName: staffName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: scheduleDetails,
  });
}

// ==================== USER PROFILE AUDIT HELPERS ====================

export async function logUserProfileUpdated(
  ownerUid: string,
  userId: string,
  userName: string,
  performer: { uid: string; name: string; role: string },
  changes?: string
) {
  return createAuditLog({
    ownerUid,
    action: `User profile updated: ${userName}`,
    actionType: "update",
    entityType: "user_profile",
    entityId: userId,
    entityName: userName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    details: changes,
  });
}

// ==================== SETTINGS AUDIT HELPERS ====================

export async function logSettingsUpdated(
  ownerUid: string,
  settingName: string,
  performer: { uid: string; name: string; role: string },
  previousValue?: string,
  newValue?: string
) {
  return createAuditLog({
    ownerUid,
    action: `Settings updated: ${settingName}`,
    actionType: "update",
    entityType: "settings",
    entityName: settingName,
    performedBy: performer.uid,
    performedByName: performer.name,
    performedByRole: performer.role,
    previousValue,
    newValue,
  });
}

// ==================== AUTH AUDIT HELPERS ====================

export async function logUserLogin(
  ownerUid: string,
  userId: string,
  userName: string,
  userRole: string
) {
  return createAuditLog({
    ownerUid,
    action: `User logged in: ${userName}`,
    actionType: "login",
    entityType: "auth",
    entityId: userId,
    entityName: userName,
    performedBy: userId,
    performedByName: userName,
    performedByRole: userRole,
  });
}

export async function logUserLogout(
  ownerUid: string,
  userId: string,
  userName: string,
  userRole: string
) {
  return createAuditLog({
    ownerUid,
    action: `User logged out: ${userName}`,
    actionType: "logout",
    entityType: "auth",
    entityId: userId,
    entityName: userName,
    performedBy: userId,
    performedByName: userName,
    performedByRole: userRole,
  });
}

export async function logPasswordChanged(
  ownerUid: string,
  userId: string,
  userName: string,
  userRole: string
) {
  return createAuditLog({
    ownerUid,
    action: `Password changed: ${userName}`,
    actionType: "update",
    entityType: "auth",
    entityId: userId,
    entityName: userName,
    performedBy: userId,
    performedByName: userName,
    performedByRole: userRole,
    details: "User changed their account password",
  });
}
