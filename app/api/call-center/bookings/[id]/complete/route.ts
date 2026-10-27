import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/callCenterAuth";
import { handleCallCenterBookingStatusChange } from "@/lib/callCenterBookingStatus";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/bookings/[id]/complete
 *
 * Marks a `Confirmed` booking `Completed`, notifies the customer and sends the completion email.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleCallCenterBookingStatusChange(req, context, "complete");
}
