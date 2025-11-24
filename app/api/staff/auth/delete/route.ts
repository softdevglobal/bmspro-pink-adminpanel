import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { uid, email } = await req.json();
    const auth = adminAuth();
    let targetUid = uid as string | undefined;
    if (!targetUid && email) {
      const user = await auth.getUserByEmail(String(email).trim().toLowerCase()).catch(() => null);
      targetUid = user?.uid;
    }
    if (!targetUid) {
      return NextResponse.json({ ok: false, message: "No user found" }, { status: 200 });
    }
    await auth.deleteUser(targetUid);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to delete auth user" }, { status: 500 });
  }
}


