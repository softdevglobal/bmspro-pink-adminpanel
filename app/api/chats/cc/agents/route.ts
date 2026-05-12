import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/authHelpers";
import { listAgentsForWorkshopChat } from "@/lib/ccDirectChat";

export const runtime = "nodejs";

const WORKSHOP_CHAT_ROLES = ["salon_owner", "salon_branch_admin", "salon_staff"] as const;

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuth(req, [...WORKSHOP_CHAT_ROLES]);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }
  if (!auth.userData) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agents = await listAgentsForWorkshopChat(auth.userData.ownerUid);
    return NextResponse.json({ agents });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
