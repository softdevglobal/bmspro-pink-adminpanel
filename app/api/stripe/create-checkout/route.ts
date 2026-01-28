import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

export async function POST(req: NextRequest) {
  try {
    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split("Bearer ")[1];
    const auth = adminAuth();
    
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (authError) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = decodedToken.uid;
    const body = await req.json();
    const { planId, successUrl, cancelUrl } = body;

    if (!planId) {
      return NextResponse.json(
        { error: "Missing required field: planId" },
        { status: 400 }
      );
    }

    const db = adminDb();

    // Get the subscription plan
    const planDoc = await db.collection("subscription_plans").doc(planId).get();
    if (!planDoc.exists) {
      return NextResponse.json(
        { error: "Subscription plan not found" },
        { status: 404 }
      );
    }

    const planData = planDoc.data();
    if (!planData?.stripePriceId) {
      return NextResponse.json(
        { error: "Subscription plan does not have a Stripe Price ID configured" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    
    let stripeCustomerId = userData?.stripeCustomerId;

    if (!stripeCustomerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: userData?.email || decodedToken.email,
        name: userData?.name || userData?.displayName || "",
        metadata: {
          firebaseUid: userId,
        },
      });
      stripeCustomerId = customer.id;

      // Save the Stripe customer ID to Firestore
      await db.collection("users").doc(userId).update({
        stripeCustomerId: customer.id,
      });

      // Also update owners collection if exists
      const ownerDoc = await db.collection("owners").doc(userId).get();
      if (ownerDoc.exists) {
        await db.collection("owners").doc(userId).update({
          stripeCustomerId: customer.id,
        });
      }
    }

    // Create Stripe Checkout Session
    const baseUrl = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: planData.stripePriceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${baseUrl}/subscription/cancel`,
      metadata: {
        firebaseUid: userId,
        planId: planId,
        planName: planData.name,
      },
      subscription_data: {
        metadata: {
          firebaseUid: userId,
          planId: planId,
          planName: planData.name,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: any) {
    console.error("[CREATE CHECKOUT] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
