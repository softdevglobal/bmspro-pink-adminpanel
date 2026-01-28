import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("[WEBHOOK] Missing stripe-signature header");
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error("[WEBHOOK] Signature verification failed:", err.message);
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${err.message}` },
        { status: 400 }
      );
    }

    const db = adminDb();

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(db, session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(db, subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(db, subscription);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(db, invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(db, invoice);
        break;
      }

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[WEBHOOK] Error:", error);
    return NextResponse.json(
      { error: error.message || "Webhook handler failed" },
      { status: 500 }
    );
  }
}

// Handler functions
async function handleCheckoutCompleted(
  db: FirebaseFirestore.Firestore,
  session: Stripe.Checkout.Session
) {
  console.log("[WEBHOOK] Checkout completed:", session.id);

  const firebaseUid = session.metadata?.firebaseUid;
  const planId = session.metadata?.planId;
  const planName = session.metadata?.planName;

  if (!firebaseUid) {
    console.error("[WEBHOOK] Missing firebaseUid in session metadata");
    return;
  }

  // Get subscription details
  const subscriptionId = session.subscription as string;
  let subscription: Stripe.Subscription | null = null;
  
  if (subscriptionId) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  }

  const updateData: any = {
    stripeSubscriptionId: subscriptionId,
    stripePriceId: subscription?.items.data[0]?.price?.id || null,
    subscriptionStatus: subscription?.status || "active",
    currentPeriodStart: subscription ? new Date(subscription.current_period_start * 1000) : null,
    currentPeriodEnd: subscription ? new Date(subscription.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
    accountStatus: "active",
    suspendedReason: null,
    suspendedAt: null,
    lastPaymentDate: new Date(),
    updatedAt: new Date(),
  };

  if (planId) {
    updateData.planId = planId;
  }
  if (planName) {
    updateData.plan = planName;
  }

  // Update user document
  await db.collection("users").doc(firebaseUid).update(updateData);

  // Also update owners collection if exists
  const ownerDoc = await db.collection("owners").doc(firebaseUid).get();
  if (ownerDoc.exists) {
    await db.collection("owners").doc(firebaseUid).update(updateData);
  }

  console.log(`[WEBHOOK] User ${firebaseUid} subscription activated`);
}

async function handleSubscriptionUpdated(
  db: FirebaseFirestore.Firestore,
  subscription: Stripe.Subscription
) {
  console.log("[WEBHOOK] Subscription updated:", subscription.id);

  const firebaseUid = subscription.metadata?.firebaseUid;

  if (!firebaseUid) {
    // Try to find user by subscription ID
    const usersSnapshot = await db
      .collection("users")
      .where("stripeSubscriptionId", "==", subscription.id)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      console.error("[WEBHOOK] Could not find user for subscription:", subscription.id);
      return;
    }

    const userId = usersSnapshot.docs[0].id;
    await updateUserSubscription(db, userId, subscription);
  } else {
    await updateUserSubscription(db, firebaseUid, subscription);
  }
}

async function updateUserSubscription(
  db: FirebaseFirestore.Firestore,
  userId: string,
  subscription: Stripe.Subscription
) {
  const updateData: any = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price?.id || null,
    subscriptionStatus: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: new Date(),
  };

  // Handle account status based on subscription status
  if (subscription.status === "active" || subscription.status === "trialing") {
    updateData.accountStatus = "active";
    updateData.suspendedReason = null;
    updateData.suspendedAt = null;
  } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
    updateData.accountStatus = "suspended";
    updateData.suspendedReason = `Payment ${subscription.status === "past_due" ? "past due" : "unpaid"}`;
    updateData.suspendedAt = new Date();
  }

  // Update user document
  await db.collection("users").doc(userId).update(updateData);

  // Also update owners collection if exists
  const ownerDoc = await db.collection("owners").doc(userId).get();
  if (ownerDoc.exists) {
    await db.collection("owners").doc(userId).update(updateData);
  }

  console.log(`[WEBHOOK] User ${userId} subscription updated to ${subscription.status}`);
}

async function handleSubscriptionDeleted(
  db: FirebaseFirestore.Firestore,
  subscription: Stripe.Subscription
) {
  console.log("[WEBHOOK] Subscription deleted:", subscription.id);

  // Find user by subscription ID
  const usersSnapshot = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", subscription.id)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.error("[WEBHOOK] Could not find user for deleted subscription:", subscription.id);
    return;
  }

  const userId = usersSnapshot.docs[0].id;

  const updateData = {
    subscriptionStatus: "canceled",
    cancelAtPeriodEnd: true,
    accountStatus: "suspended",
    suspendedReason: "Subscription canceled",
    suspendedAt: new Date(),
    updatedAt: new Date(),
  };

  // Update user document
  await db.collection("users").doc(userId).update(updateData);

  // Also update owners collection if exists
  const ownerDoc = await db.collection("owners").doc(userId).get();
  if (ownerDoc.exists) {
    await db.collection("owners").doc(userId).update(updateData);
  }

  console.log(`[WEBHOOK] User ${userId} subscription canceled`);
}

async function handlePaymentSucceeded(
  db: FirebaseFirestore.Firestore,
  invoice: Stripe.Invoice
) {
  console.log("[WEBHOOK] Payment succeeded:", invoice.id);

  if (!invoice.subscription) return;

  // Find user by subscription ID
  const usersSnapshot = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", invoice.subscription)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.log("[WEBHOOK] Could not find user for invoice:", invoice.id);
    return;
  }

  const userId = usersSnapshot.docs[0].id;

  const updateData = {
    lastPaymentDate: new Date(),
    lastPaymentAmount: invoice.amount_paid / 100, // Convert from cents
    accountStatus: "active",
    suspendedReason: null,
    suspendedAt: null,
    updatedAt: new Date(),
  };

  // Update user document
  await db.collection("users").doc(userId).update(updateData);

  // Also update owners collection if exists
  const ownerDoc = await db.collection("owners").doc(userId).get();
  if (ownerDoc.exists) {
    await db.collection("owners").doc(userId).update(updateData);
  }

  console.log(`[WEBHOOK] User ${userId} payment succeeded`);
}

async function handlePaymentFailed(
  db: FirebaseFirestore.Firestore,
  invoice: Stripe.Invoice
) {
  console.log("[WEBHOOK] Payment failed:", invoice.id);

  if (!invoice.subscription) return;

  // Find user by subscription ID
  const usersSnapshot = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", invoice.subscription)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    console.log("[WEBHOOK] Could not find user for failed invoice:", invoice.id);
    return;
  }

  const userId = usersSnapshot.docs[0].id;

  const updateData = {
    accountStatus: "suspended",
    suspendedReason: "Payment failed",
    suspendedAt: new Date(),
    updatedAt: new Date(),
  };

  // Update user document
  await db.collection("users").doc(userId).update(updateData);

  // Also update owners collection if exists
  const ownerDoc = await db.collection("owners").doc(userId).get();
  if (ownerDoc.exists) {
    await db.collection("owners").doc(userId).update(updateData);
  }

  console.log(`[WEBHOOK] User ${userId} account suspended due to payment failure`);

  // TODO: Send email notification to user about payment failure
}
