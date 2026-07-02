import { NextRequest, NextResponse } from "next/server";
import { dispatchMail, isZeptoMailConfigured } from "@/lib/zeptomail";

const FROM_EMAIL = process.env.FROM_EMAIL || "booking@bmspros.com.au";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to } = body;

    if (!to) {
      return NextResponse.json({ error: "Missing 'to' email address" }, { status: 400 });
    }

    if (!isZeptoMailConfigured()) {
      return NextResponse.json(
        { error: "ZeptoMail is not configured" },
        { status: 500 }
      );
    }

    const msg = {
      to: to,
      from: FROM_EMAIL,
      subject: "Test Email from BMS Pro",
      html: `
        <h1>Test Email</h1>
        <p>This is a test email to verify ZeptoMail is working correctly.</p>
        <p>If you received this, your email configuration is working!</p>
        <p><strong>From:</strong> ${FROM_EMAIL}</p>
        <p><strong>ZeptoMail configured:</strong> Yes</p>
      `,
    };

    console.log(`[TEST EMAIL] Sending test email to ${to} from ${FROM_EMAIL}`);

    await dispatchMail(msg);

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${to}`,
      from: FROM_EMAIL,
    });
  } catch (error: unknown) {
    console.error("[TEST EMAIL] Error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Send POST request with { to: 'email@example.com' } to test email",
    fromEmail: FROM_EMAIL,
    zeptoMailConfigured: isZeptoMailConfigured(),
  });
}
