import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import type { BookingStatus } from "./bookingTypes";

// Customer-facing notification types
export type CustomerNotificationType = 
  | "booking_confirmed" 
  | "booking_completed" 
  | "booking_canceled" 
  | "booking_status_changed";

// Staff-facing notification types
export type StaffNotificationType = 
  | "staff_assignment"      // Staff receives new booking to review
  | "staff_reassignment";   // Staff receives reassigned booking

// Admin-facing notification types
export type AdminNotificationType = 
  | "staff_accepted"        // Staff accepted a booking
  | "staff_rejected";       // Staff rejected a booking

export type NotificationType = CustomerNotificationType | StaffNotificationType | AdminNotificationType;

// Base notification interface
export interface BaseNotification {
  id?: string;
  bookingId: string;
  bookingCode?: string;
  type: NotificationType;
  title: string;
  message: string;
  status: BookingStatus;
  read: boolean;
  createdAt: any;
  ownerUid: string; // Salon owner UID
  // Additional booking details
  staffName?: string;
  serviceName?: string;
  branchName?: string;
  bookingDate?: string;
  bookingTime?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
}

// Customer notification
export interface CustomerNotification extends BaseNotification {
  customerUid?: string;
  customerEmail?: string;
  customerPhone?: string;
  clientName?: string;
}

// Staff notification
export interface StaffNotification extends BaseNotification {
  staffUid: string;        // The staff member receiving the notification
  staffEmail?: string;
  clientName?: string;
  clientPhone?: string;
  duration?: number;
  price?: number;
}

// Admin notification
export interface AdminNotification extends BaseNotification {
  targetAdminUid?: string;   // Specific admin to notify (optional, if null notify owner)
  rejectionReason?: string;  // For staff_rejected notifications
  rejectedByStaffUid?: string;
  rejectedByStaffName?: string;
  clientName?: string;
}

export type Notification = CustomerNotification | StaffNotification | AdminNotification;

/**
 * Create a notification (generic)
 */
export async function createNotification(data: Omit<Notification, "id" | "createdAt" | "read">): Promise<string> {
  try {
    const db = adminDb();
    
    // Filter out undefined values to avoid Firestore errors
    const cleanData: any = {
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };
    
    // Add all defined values
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    });
    
    const ref = await db.collection("notifications").add(cleanData);
    return ref.id;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Create a notification for staff member when booking is assigned to them
 */
export async function createStaffAssignmentNotification(data: {
  bookingId: string;
  bookingCode?: string;
  staffUid: string;
  staffName?: string;
  clientName: string;
  clientPhone?: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
  duration?: number;
  price?: number;
  ownerUid: string;
  isReassignment?: boolean;
}): Promise<string> {
  const isReassignment = data.isReassignment || false;
  const type: StaffNotificationType = isReassignment ? "staff_reassignment" : "staff_assignment";
  
  const serviceList = data.services && data.services.length > 0
    ? data.services.map(s => s.name).join(", ")
    : data.serviceName || "Service";

  const notificationData: Omit<StaffNotification, "id" | "createdAt" | "read"> = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode,
    type,
    title: isReassignment ? "Booking Reassigned to You" : "New Appointment Request",
    message: isReassignment
      ? `A booking for ${serviceList} with ${data.clientName} on ${data.bookingDate} at ${data.bookingTime} has been reassigned to you. Please review and accept or reject.`
      : `You have a new appointment request from ${data.clientName} for ${serviceList} on ${data.bookingDate} at ${data.bookingTime}. Please accept or reject this booking.`,
    status: "AwaitingStaffApproval",
    ownerUid: data.ownerUid,
    staffUid: data.staffUid,
    staffName: data.staffName,
    clientName: data.clientName,
    clientPhone: data.clientPhone,
    serviceName: data.serviceName,
    services: data.services,
    branchName: data.branchName,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
    duration: data.duration,
    price: data.price,
  };

  return createNotification(notificationData);
}

/**
 * Create a notification for admin when staff rejects a booking
 */
export async function createAdminRejectionNotification(data: {
  bookingId: string;
  bookingCode?: string;
  ownerUid: string;
  targetAdminUid?: string;
  rejectedByStaffUid: string;
  rejectedByStaffName: string;
  rejectionReason: string;
  clientName: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string; staffId?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
}): Promise<string> {
  const serviceList = data.services && data.services.length > 0
    ? data.services.map(s => s.name).join(", ")
    : data.serviceName || "Service";

  const notificationData: Omit<AdminNotification, "id" | "createdAt" | "read"> = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode,
    type: "staff_rejected",
    title: "Booking Rejected by Staff",
    message: `${data.rejectedByStaffName} has rejected the booking for ${data.clientName} (${serviceList} on ${data.bookingDate} at ${data.bookingTime}). Reason: "${data.rejectionReason}". Please reassign to another staff member.`,
    status: "StaffRejected",
    ownerUid: data.ownerUid,
    targetAdminUid: data.targetAdminUid,
    rejectedByStaffUid: data.rejectedByStaffUid,
    rejectedByStaffName: data.rejectedByStaffName,
    rejectionReason: data.rejectionReason,
    clientName: data.clientName,
    serviceName: data.serviceName,
    services: data.services,
    branchName: data.branchName,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
  };

  return createNotification(notificationData);
}

/**
 * Create a customer confirmation notification (only after staff accepts)
 */
export async function createCustomerConfirmationNotification(data: {
  bookingId: string;
  bookingCode?: string;
  customerUid?: string;
  customerEmail?: string;
  customerPhone?: string;
  clientName?: string;
  staffName?: string;
  serviceName?: string;
  services?: Array<{ name: string; staffName?: string }>;
  branchName?: string;
  bookingDate: string;
  bookingTime: string;
  ownerUid: string;
}): Promise<string> {
  const content = getNotificationContent(
    "Confirmed",
    data.bookingCode,
    data.staffName,
    data.serviceName,
    data.bookingDate,
    data.bookingTime,
    data.services
  );

  const notificationData: Omit<CustomerNotification, "id" | "createdAt" | "read"> = {
    bookingId: data.bookingId,
    bookingCode: data.bookingCode,
    type: content.type,
    title: content.title,
    message: content.message,
    status: "Confirmed",
    ownerUid: data.ownerUid,
    customerUid: data.customerUid,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone,
    clientName: data.clientName,
    staffName: data.staffName,
    serviceName: data.serviceName,
    services: data.services,
    branchName: data.branchName,
    bookingDate: data.bookingDate,
    bookingTime: data.bookingTime,
  };

  return createNotification(notificationData);
}

/**
 * Get notification title and message based on status (for customer notifications)
 */
export function getNotificationContent(
  status: BookingStatus, 
  bookingCode?: string,
  staffName?: string,
  serviceName?: string,
  bookingDate?: string,
  bookingTime?: string,
  services?: Array<{ name: string; staffName?: string }>
): { title: string; message: string; type: CustomerNotificationType } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  let serviceAndStaff = "";
  
  // Check if we have multiple services with specific staff
  if (services && services.length > 0) {
    // Format: " for Facial with John, Hair Cut with Jane"
    const parts = services.map(s => {
      const sName = s.name || "Service";
      const stName = s.staffName && s.staffName !== "Any Available" && s.staffName !== "Any Staff" ? ` with ${s.staffName}` : "";
      return `${sName}${stName}`;
    });
    serviceAndStaff = ` for ${parts.join(", ")}`;
  } else {
    // Fallback to single service/staff logic
    const service = serviceName ? ` for ${serviceName}` : "";
    // Don't show staff name in the main message if it's "Multiple Staff" or "Any Available"
    const showStaff = staffName && staffName !== "Multiple Staff" && staffName !== "Any Available" && staffName !== "Any Staff";
    const staff = showStaff ? ` with ${staffName}` : "";
    serviceAndStaff = `${service}${staff}`;
  }
  
  switch (status) {
    case "Pending":
      return {
        title: "Booking Request Received",
        message: `Your booking request${code}${serviceAndStaff} has been received successfully! We'll confirm your appointment soon.`,
        type: "booking_status_changed"
      };
    case "AwaitingStaffApproval":
      // Customer sees this as "processing" - don't reveal internal workflow
      return {
        title: "Booking Being Processed",
        message: `Your booking request${code}${serviceAndStaff}${datetime} is being processed. We'll notify you once it's confirmed.`,
        type: "booking_status_changed"
      };
    case "StaffRejected":
      // Customer sees this as "being rescheduled" - don't reveal staff rejection
      return {
        title: "Booking Being Rescheduled",
        message: `Your booking${code}${serviceAndStaff}${datetime} is being rescheduled. We'll notify you with updated details soon.`,
        type: "booking_status_changed"
      };
    case "Confirmed":
      return {
        title: "Booking Confirmed",
        message: `Your booking${code}${serviceAndStaff}${datetime} has been confirmed. We look forward to seeing you!`,
        type: "booking_confirmed"
      };
    case "Completed":
      return {
        title: "Booking Completed",
        message: `Your booking${code}${serviceAndStaff} has been completed. Thank you for visiting us!`,
        type: "booking_completed"
      };
    case "Canceled":
      return {
        title: "Booking Canceled",
        message: `Your booking${code}${serviceAndStaff}${datetime} has been canceled. Please contact us if you have any questions.`,
        type: "booking_canceled"
      };
    default:
      return {
        title: "Booking Status Updated",
        message: `Your booking${code} status has been updated to ${status}.`,
        type: "booking_status_changed"
      };
  }
}

/**
 * Get staff-facing notification content
 */
export function getStaffNotificationContent(
  type: StaffNotificationType,
  bookingCode?: string,
  clientName?: string,
  serviceName?: string,
  bookingDate?: string,
  bookingTime?: string,
  services?: Array<{ name: string; staffName?: string }>
): { title: string; message: string } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  const serviceList = services && services.length > 0
    ? services.map(s => s.name).join(", ")
    : serviceName || "Service";
  
  switch (type) {
    case "staff_assignment":
      return {
        title: "New Appointment Request",
        message: `You have a new appointment request${code} from ${clientName || "a customer"} for ${serviceList}${datetime}. Please accept or reject.`
      };
    case "staff_reassignment":
      return {
        title: "Booking Reassigned to You",
        message: `A booking${code} for ${serviceList} with ${clientName || "a customer"}${datetime} has been reassigned to you. Please accept or reject.`
      };
    default:
      return {
        title: "Booking Update",
        message: `There's an update to booking${code}.`
      };
  }
}

/**
 * Get admin-facing notification content for staff actions
 */
export function getAdminNotificationContent(
  type: AdminNotificationType,
  staffName: string,
  clientName?: string,
  serviceName?: string,
  bookingCode?: string,
  bookingDate?: string,
  bookingTime?: string,
  rejectionReason?: string
): { title: string; message: string } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  switch (type) {
    case "staff_accepted":
      return {
        title: "Staff Accepted Booking",
        message: `${staffName} has accepted the booking${code} for ${clientName || "customer"}${datetime}. Customer has been notified.`
      };
    case "staff_rejected":
      return {
        title: "Booking Rejected by Staff",
        message: `${staffName} has rejected the booking${code} for ${clientName || "customer"}${datetime}. Reason: "${rejectionReason || "Not specified"}". Please reassign to another staff member.`
      };
    default:
      return {
        title: "Staff Action",
        message: `${staffName} took action on booking${code}.`
      };
  }
}

