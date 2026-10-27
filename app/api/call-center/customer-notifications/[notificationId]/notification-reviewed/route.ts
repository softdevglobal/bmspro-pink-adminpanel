import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/callCenterAuth";
import { handleCustomerNotificationTracking } from "@/lib/callCenterCustomerNotifications";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/customer-notifications/[notificationId]/notification-reviewed
 * Body (optional): `{ "notificationReviewed": true | false }` — default true.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ notificationId: string }> }) {
  return handleCustomerNotificationTracking(req, context, "notificationReviewed");
}
