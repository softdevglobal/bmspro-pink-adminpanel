export const SMS_LOGS_COLLECTION = "sms_logs";

export const SMS_LOW_BALANCE_THRESHOLD = 10;

export type BusinessSmsBalance = {
  limit: number;
  used: number;
  remaining: number | null;
  isUnlimited: boolean;
  isLow: boolean;
};

export type SmsLogStatus = "sent" | "failed" | "skipped";

export type AppendSmsLogInput = {
  ownerUid?: string | null;
  senderName?: string | null;
  receiverPhone: string;
  receiverName?: string | null;
  message: string;
  status: SmsLogStatus;
  statusDetail?: string | null;
  source?: string | null;
};

export function parseOwnerSmsFields(
  data: Record<string, unknown>,
): BusinessSmsBalance {
  const hasLimitField =
    typeof data.smsMessageLimit === "number" &&
    Number.isFinite(data.smsMessageLimit);
  const limit = hasLimitField ? (data.smsMessageLimit as number) : -1;
  const used =
    typeof data.smsMessagesUsed === "number" && Number.isFinite(data.smsMessagesUsed)
      ? Math.max(0, data.smsMessagesUsed)
      : 0;

  const isUnlimited = !hasLimitField || limit < 0;
  const remaining = isUnlimited ? null : Math.max(0, limit - used);
  const isLow = remaining !== null && remaining < SMS_LOW_BALANCE_THRESHOLD;

  return { limit: hasLimitField ? limit : -1, used, remaining, isUnlimited, isLow };
}
