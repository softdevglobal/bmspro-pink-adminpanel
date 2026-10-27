import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/callCenterAuth";
import { handleCallCenterBookingStatusChange } from "@/lib/callCenterBookingStatus";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/bookings/[id]/confirm
 *
 * `id` = Firestore id or `bookingCode`. Body (optional):
 * {
 *   "staffAssignments": { "<booking.services[].id>": { "staffId": "<uid>", "staffName": "<name>" } },
 *   "staffId": "<uid>", "staffName": "<name>",   // single-service shortcut
 *   "skipStaffValidation": false
 * }
 * Every service must end up with a stylist unless `skipStaffValidation` is true (400 with
 * `missingStaffForServices`). Marks services accepted, notifies assigned staff and the customer,
 * and sends the confirmation email.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleCallCenterBookingStatusChange(req, context, "confirm");
}
