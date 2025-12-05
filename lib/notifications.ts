import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import type { BookingStatus } from "./bookingTypes";

export type NotificationType = "booking_confirmed" | "booking_completed" | "booking_canceled" | "booking_status_changed";

export interface Notification {
  id?: string;
  customerUid?: string; // Customer account UID (if authenticated)
  customerEmail?: string; // Customer email (fallback)
  customerPhone?: string; // Customer phone (fallback)
  bookingId: string;
  bookingCode?: string;
  type: NotificationType;
  title: string;
  message: string;
  status: BookingStatus;
  read: boolean;
  createdAt: any;
  ownerUid: string; // Salon owner UID
  // Additional booking details for richer notifications
  staffName?: string;
  serviceName?: string;
  branchName?: string;
  bookingDate?: string;
  bookingTime?: string;
}

/**
 * Create a notification for a booking status change
 */
export async function createNotification(data: Omit<Notification, "id" | "createdAt" | "read">): Promise<string> {
  try {
    const db = adminDb();
    
    // Filter out undefined values to avoid Firestore errors
    const cleanData: any = {
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };
    
    // Only add defined values
    if (data.customerUid !== undefined) cleanData.customerUid = data.customerUid;
    if (data.customerEmail !== undefined) cleanData.customerEmail = data.customerEmail;
    if (data.customerPhone !== undefined) cleanData.customerPhone = data.customerPhone;
    if (data.bookingId !== undefined) cleanData.bookingId = data.bookingId;
    if (data.bookingCode !== undefined) cleanData.bookingCode = data.bookingCode;
    if (data.type !== undefined) cleanData.type = data.type;
    if (data.title !== undefined) cleanData.title = data.title;
    if (data.message !== undefined) cleanData.message = data.message;
    if (data.status !== undefined) cleanData.status = data.status;
    if (data.ownerUid !== undefined) cleanData.ownerUid = data.ownerUid;
    // Add new booking detail fields
    if ((data as any).staffName !== undefined) cleanData.staffName = (data as any).staffName;
    if ((data as any).serviceName !== undefined) cleanData.serviceName = (data as any).serviceName;
    if ((data as any).branchName !== undefined) cleanData.branchName = (data as any).branchName;
    if ((data as any).bookingDate !== undefined) cleanData.bookingDate = (data as any).bookingDate;
    if ((data as any).bookingTime !== undefined) cleanData.bookingTime = (data as any).bookingTime;
    
    const ref = await db.collection("notifications").add(cleanData);
    return ref.id;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Get notification title and message based on status
 */
export function getNotificationContent(
  status: BookingStatus, 
  bookingCode?: string,
  staffName?: string,
  serviceName?: string,
  bookingDate?: string,
  bookingTime?: string
): { title: string; message: string; type: NotificationType } {
  const code = bookingCode ? ` (${bookingCode})` : "";
  const service = serviceName ? ` for ${serviceName}` : "";
  // Don't show staff name in the main message if it's "Multiple Staff" or "Any Available"
  const showStaff = staffName && staffName !== "Multiple Staff" && staffName !== "Any Available" && staffName !== "Any Staff";
  const staff = showStaff ? ` with ${staffName}` : "";
  const datetime = bookingDate && bookingTime ? ` on ${bookingDate} at ${bookingTime}` : "";
  
  switch (status) {
    case "Pending":
      return {
        title: "Booking Request Received",
        message: `Your booking request${code}${service} has been received successfully! We'll confirm your appointment soon.`,
        type: "booking_status_changed"
      };
    case "Confirmed":
      return {
        title: "Booking Confirmed",
        message: `Your booking${code}${service}${staff}${datetime} has been confirmed. We look forward to seeing you!`,
        type: "booking_confirmed"
      };
    case "Completed":
      return {
        title: "Booking Completed",
        message: `Your booking${code}${service}${staff} has been completed. Thank you for visiting us!`,
        type: "booking_completed"
      };
    case "Canceled":
      return {
        title: "Booking Canceled",
        message: `Your booking${code}${service}${datetime} has been canceled. Please contact us if you have any questions.`,
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

