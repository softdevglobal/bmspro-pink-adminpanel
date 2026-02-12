import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAdminAuth } from "@/lib/authHelpers";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

/**
 * POST /api/billing/downgrade
 * Schedules downgrade to apply at end of current billing cycle
 * 
 * Input: { newPlanId }
 * 
 * Behavior:
 * - Creates/updates Subscription Schedule
 * - Phase 1: Current price with end_date = current_period_end
 * - Phase 2: New price (last phase, released after)
 * - No immediate charge or change
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(req, ["salon_owner", "super_admin"], true);
    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const { userData } = authResult;
    const body = await req.json();
    const { newPlanId } = body;

    if (!newPlanId) {
      return NextResponse.json(
        { error: "Missing required field: newPlanId" },
        { status: 400 }
      );
    }

    const db = adminDb();
    const userId = userData.uid;

    // Get the new plan details
    const newPlanDoc = await db.collection("subscription_plans").doc(newPlanId).get();
    if (!newPlanDoc.exists) {
      return NextResponse.json(
        { error: "Plan not found" },
        { status: 404 }
      );
    }

    const newPlanData = newPlanDoc.data()!;
    if (!newPlanData.price || newPlanData.price <= 0) {
      return NextResponse.json(
        { error: "Plan does not have a valid price" },
        { status: 400 }
      );
    }

    // Get user's current subscription
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const userData_db = userDoc.data()!;
    const subscriptionId = userData_db.stripeSubscriptionId;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 400 }
      );
    }

    // Get current subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const sub = subscription as any;
    const firstItem = sub.items?.data?.[0];
    const currentPriceId = firstItem?.price?.id;
    // In Stripe API 2025-12-15.clover, current_period_end/start moved to subscription item level
    const currentPeriodEnd = firstItem?.current_period_end || sub.current_period_end;
    const currentPeriodStart = firstItem?.current_period_start || sub.current_period_start;

    console.log(`[BILLING DOWNGRADE] Subscription item current_period_end: ${currentPeriodEnd}, current_period_start: ${currentPeriodStart}`);

    if (!currentPriceId) {
      return NextResponse.json(
        { error: "Subscription price not found" },
        { status: 400 }
      );
    }

    if (!currentPeriodEnd) {
      return NextResponse.json(
        { error: "Cannot determine current billing period" },
        { status: 400 }
      );
    }

    // Create a new price in Stripe for the downgrade plan
    const newPrice = await stripe.prices.create({
      currency: "aud",
      unit_amount: Math.round(newPlanData.price * 100), // Convert to cents
      recurring: {
        interval: "day",
        interval_count: 28, // 28-day billing cycle
      },
      product_data: {
        name: newPlanData.name || "BMS Pro Subscription",
        metadata: {
          planId: newPlanId,
          plan_key: newPlanData.plan_key || "",
        },
      },
      metadata: {
        planId: newPlanId,
        plan_key: newPlanData.plan_key || "",
      },
    });

    // Calculate duration in days for phase 0 (current plan until period end)
    const nowUnix = Math.floor(Date.now() / 1000);
    const durationSeconds = Math.max(currentPeriodEnd - nowUnix, 86400); // At least 1 day
    const durationDays = Math.ceil(durationSeconds / 86400);

    console.log(`[BILLING DOWNGRADE] Current period end: ${new Date(currentPeriodEnd * 1000).toISOString()}, duration: ${durationDays} days`);

    // Check if subscription already has a schedule
    // First check Firestore, then check the Stripe subscription object itself
    let scheduleId = userData_db.stripeScheduleId;

    // Also check if the subscription has a schedule attached in Stripe (may not be in Firestore)
    const stripeAttachedScheduleId = sub.schedule 
      ? (typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id) 
      : null;

    if (!scheduleId && stripeAttachedScheduleId) {
      console.log(`[BILLING DOWNGRADE] Found schedule ${stripeAttachedScheduleId} attached to subscription (not in Firestore)`);
      scheduleId = stripeAttachedScheduleId;
    }

    if (scheduleId) {
      try {
        // Try to update existing schedule
        const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
        
        // Check schedule is still active
        if (schedule.status === "active" || schedule.status === "not_started") {
          console.log(`[BILLING DOWNGRADE] Updating existing schedule ${scheduleId}`);
          await stripe.subscriptionSchedules.update(scheduleId, {
            phases: [
              {
                items: [{ price: currentPriceId, quantity: 1 }],
                start_date: currentPeriodStart, // Anchor point for end_date
                end_date: currentPeriodEnd,
              },
              {
                items: [{ price: newPrice.id, quantity: 1 }],
                start_date: currentPeriodEnd,
                // Last phase with end_behavior: release - no end_date needed
              },
            ],
            end_behavior: "release",
            metadata: {
              ...schedule.metadata,
              downgraded_at: new Date().toISOString(),
              new_plan_id: newPlanId,
            },
          });
        } else {
          // Schedule is completed/canceled — release it first, then create new one
          console.log(`[BILLING DOWNGRADE] Schedule ${scheduleId} status is ${schedule.status}, releasing and creating new`);
          try {
            await stripe.subscriptionSchedules.release(scheduleId);
          } catch (releaseErr) {
            console.log("[BILLING DOWNGRADE] Could not release schedule (may already be released):", releaseErr);
          }
          scheduleId = null;
        }
      } catch (e) {
        console.error("[BILLING DOWNGRADE] Error updating existing schedule:", e);
        // Try to release the stale schedule before creating a new one
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log(`[BILLING DOWNGRADE] Released stale schedule ${scheduleId}`);
        } catch (releaseErr) {
          console.log("[BILLING DOWNGRADE] Could not release stale schedule:", releaseErr);
        }
        scheduleId = null;
      }
    }
    
    if (!scheduleId) {
      console.log(`[BILLING DOWNGRADE] Creating new schedule from subscription ${subscriptionId}`);
      // Create new schedule from the subscription
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscriptionId,
      });

      // Update the schedule with phases
      // Phase 0: keep current price until current_period_end (needs start_date as anchor)
      // Phase 1: switch to new price (last phase, end_behavior=release handles it)
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        phases: [
          {
            items: [{ price: currentPriceId, quantity: 1 }],
            start_date: currentPeriodStart, // Anchor point for end_date
            end_date: currentPeriodEnd,
          },
          {
            items: [{ price: newPrice.id, quantity: 1 }],
            start_date: currentPeriodEnd,
            // Last phase - no end_date needed with end_behavior: release
          },
        ],
        metadata: {
          firebaseUid: userId,
          downgraded_at: new Date().toISOString(),
          new_plan_id: newPlanId,
        },
      });

      scheduleId = schedule.id;
    }

    // Update Firestore - store scheduled downgrade info including future limits
    const effectiveDate = currentPeriodEnd 
      ? new Date(Math.floor(Number(currentPeriodEnd)) * 1000) 
      : new Date();

    const updateData: Record<string, any> = {
      stripeScheduleId: scheduleId,
      downgradeScheduled: true,
      downgradePlanId: newPlanId,
      downgradePriceId: newPrice.id,
      downgradeEffectiveDate: effectiveDate,
      downgradePlanKey: newPlanData.plan_key || newPlanId,
      downgradePlanName: newPlanData.name,
      downgradePlanPrice: newPlanData.priceLabel || `AU$${newPlanData.price}/mo`,
      // Store future limits (will be applied when downgrade takes effect)
      downgradeBranchLimit: newPlanData.branches ?? -1,
      downgradeStaffLimit: newPlanData.staff ?? -1,
      updatedAt: new Date(),
    };

    await db.collection("users").doc(userId).update(updateData);

    // Also update owners collection if exists
    const ownerDoc = await db.collection("owners").doc(userId).get();
    if (ownerDoc.exists) {
      await db.collection("owners").doc(userId).update(updateData);
    }

    console.log(`[BILLING] User ${userId} scheduled downgrade to plan ${newPlanId} at ${effectiveDate.toISOString()}`);

    return NextResponse.json({
      success: true,
      message: "Downgrade scheduled. Plan will change at the end of your current billing cycle.",
      schedule: {
        id: scheduleId,
        effectiveDate: effectiveDate.toISOString(),
        newPlan: newPlanData.name,
      },
    });
  } catch (error: any) {
    console.error("[BILLING DOWNGRADE] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to schedule downgrade" },
      { status: 500 }
    );
  }
}
