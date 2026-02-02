import { NextRequest, NextResponse } from "next/server";
import { sendSalonOwnerWelcomeEmail } from "@/lib/emailService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, businessName, planName, planPrice, paymentUrl, trialDays } = body;
    
    if (!email || !password || !businessName) {
      return NextResponse.json(
        { error: "Missing required fields: email, password, and businessName are required" },
        { status: 400 }
      );
    }
    
    console.log(`[API] Sending welcome email to salon owner: ${email}`, { trialDays });
    
    const result = await sendSalonOwnerWelcomeEmail(
      email, 
      password, 
      businessName,
      planName,
      planPrice,
      paymentUrl,
      trialDays
    );
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send welcome email" },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: `Welcome email sent successfully to ${email}`,
    });
  } catch (error: any) {
    console.error("[API] Error sending welcome email:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
