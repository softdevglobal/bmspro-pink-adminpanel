"use client";
import React from "react";
import BookingsListByStatus from "@/components/bookings/BookingsListByStatus";

export default function PendingBookingsPage() {
  // Show all bookings that need admin action: Pending, AwaitingStaffApproval, and StaffRejected
  return <BookingsListByStatus status={["Pending", "AwaitingStaffApproval", "StaffRejected"]} title="Booking Requests" />;
}


