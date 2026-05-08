/** Stripe recurring interval in days for salon subscriptions */
export const BILLING_WEEKLY_DAYS = 7;
export const BILLING_MONTHLY_DAYS = 28;

export type BillingIntervalDays = typeof BILLING_WEEKLY_DAYS | typeof BILLING_MONTHLY_DAYS;

export function normalizeBillingIntervalDays(value: unknown): BillingIntervalDays {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseInt(value, 10)
        : NaN;
  if (n === BILLING_WEEKLY_DAYS) return BILLING_WEEKLY_DAYS;
  return BILLING_MONTHLY_DAYS;
}

export function billingCycleLabel(days: BillingIntervalDays): "Weekly" | "Monthly" {
  return days === BILLING_WEEKLY_DAYS ? "Weekly" : "Monthly";
}

/** Writes billingIntervalDays + billingCycle for Flutter / billing UI */
export function mergeBillingFieldsFromPlan(
  target: Record<string, unknown>,
  planData: { billingIntervalDays?: unknown } | null | undefined
): void {
  if (!planData) return;
  const days = normalizeBillingIntervalDays(planData.billingIntervalDays);
  target.billingIntervalDays = days;
  target.billingCycle = billingCycleLabel(days);
}
