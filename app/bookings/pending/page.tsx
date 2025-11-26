"use client";
import React from "react";
import BookingsListByStatus from "@/components/bookings/BookingsListByStatus";

export default function PendingBookingsPage() {
  return <BookingsListByStatus status="Pending" title="Booking Requests" />;
}


