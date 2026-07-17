import { verifyAdminAuth } from "@/lib/authHelpers";
import {
  getOwnerSalonName,
  getOwnerSmsBalance,
  listCustomerContacts,
  listStaffContacts,
  MAX_CUSTOM_SMS_LENGTH,
  sendOwnerCustomSms,
  type CustomMessageAudience,
} from "@/lib/owner-custom-messages/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isValidAudience(value: unknown): value is CustomMessageAudience {
  return value === "customers" || value === "staff" || value === "both";
}

async function requireSalonOwner(req: NextRequest) {
  const auth = await verifyAdminAuth(req, ["salon_owner"]);
  if (!auth.success) {
    return {
      ok: false as const,
      status: auth.status,
      error: auth.error,
    };
  }
  return {
    ok: true as const,
    uid: auth.userData.uid,
    name: auth.userData.name ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSalonOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const [customers, staff, balance, salonName] = await Promise.all([
    listCustomerContacts(auth.uid),
    listStaffContacts(auth.uid),
    getOwnerSmsBalance(auth.uid),
    getOwnerSalonName(auth.uid),
  ]);

  return NextResponse.json({
    ok: true,
    customers,
    staff,
    balance,
    salonName,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalonOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    message?: unknown;
    audience?: unknown;
    recipients?: unknown;
  };

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  const audience = payload.audience;

  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Write a message to send." },
      { status: 400 },
    );
  }
  if (message.length > MAX_CUSTOM_SMS_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `Message is too long (max ${MAX_CUSTOM_SMS_LENGTH} characters).`,
      },
      { status: 400 },
    );
  }
  if (!isValidAudience(audience)) {
    return NextResponse.json(
      { ok: false, error: "Select who to message: customers, staff, or both." },
      { status: 400 },
    );
  }
  if (
    payload.recipients !== "all" &&
    (!Array.isArray(payload.recipients) || payload.recipients.length === 0)
  ) {
    return NextResponse.json(
      { ok: false, error: 'Choose "all" or select recipients to message.' },
      { status: 400 },
    );
  }

  const result = await sendOwnerCustomSms({
    ownerUid: auth.uid,
    salonName: await getOwnerSalonName(auth.uid),
    message,
    audience,
    recipients: payload.recipients ?? "all",
  });

  if (result.sentCount === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.requestedCount === 0
            ? "No recipients with a valid phone number selected."
            : "Could not send messages. Check your SMS balance and TextBee configuration.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    sentCount: result.sentCount,
    requestedCount: result.requestedCount,
  });
}
