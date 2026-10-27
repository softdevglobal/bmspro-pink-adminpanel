import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/callCenterAuth";
import { handleCallCenterBookingStatusChange } from "@/lib/callCenterBookingStatus";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/bookings/[id]/cancel
 *
 * `id` = Firestore id or `bookingCode`. Body (optional): `{ "reason": "Customer no longer needs it" }`.
 * Stores the reason, logs activity + audit, notifies the customer and sends the cancellation email.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleCallCenterBookingStatusChange(req, context, "cancel");
}
