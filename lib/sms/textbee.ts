import "server-only";

import { releaseSmsCredits, tryConsumeSmsCredits } from "@/lib/sms/usage";

const DEFAULT_API_BASE = "https://api.textbee.dev/api/v1";

function readServerEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config() {
  return {
    apiKey: readServerEnv("TEXTBEE_API_KEY"),
    deviceId: readServerEnv("TEXTBEE_DEVICE_ID"),
    apiBase: (readServerEnv("TEXTBEE_API_BASE") || DEFAULT_API_BASE).replace(
      /\/+$/,
      "",
    ),
    defaultCountryCode: readServerEnv("TEXTBEE_DEFAULT_COUNTRY_CODE") || "+61",
    simSubscriptionId: readServerEnv("TEXTBEE_SIM_SUBSCRIPTION_ID") || null,
  };
}

export function toE164(
  raw: string | null | undefined,
  defaultCountryCode = "+61",
): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  if (value.startsWith("+")) {
    const digits = value.slice(1).replace(/\D/g, "");
    return digits.length >= 6 ? `+${digits}` : null;
  }

  if (value.startsWith("00")) {
    const digits = value.slice(2).replace(/\D/g, "");
    return digits.length >= 6 ? `+${digits}` : null;
  }

  const cc = defaultCountryCode.startsWith("+")
    ? defaultCountryCode
    : `+${defaultCountryCode}`;
  const ccDigits = cc.slice(1).replace(/\D/g, "");
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("0")) {
    const local = digits.replace(/^0+/, "");
    if (local.length < 6) return null;
    return `+${ccDigits}${local}`;
  }

  if (digits.startsWith(ccDigits)) {
    return `+${digits}`;
  }

  if (digits.length < 6) return null;
  return `+${ccDigits}${digits}`;
}

type SmsLogContext = {
  ownerUid: string | null;
  senderName: string | null;
  receiverName: string | null;
  source: string | null;
  message: string;
  rawTo: string | null | undefined;
};

async function recordSmsLog(
  ctx: SmsLogContext,
  receiverPhone: string,
  status: "sent" | "failed" | "skipped",
  statusDetail: string,
): Promise<void> {
  const { appendSmsLog } = await import("@/lib/sms/sms-log-server");
  await appendSmsLog({
    ownerUid: ctx.ownerUid,
    senderName: ctx.senderName,
    receiverPhone,
    receiverName: ctx.receiverName,
    message: ctx.message,
    status,
    statusDetail,
    source: ctx.source,
  });
}

async function postSmsToGateway(
  recipients: string[],
  message: string,
): Promise<boolean> {
  const cfg = config();
  if (!cfg.apiKey || !cfg.deviceId || recipients.length === 0) {
    return false;
  }

  const url = `${cfg.apiBase}/gateway/devices/${encodeURIComponent(
    cfg.deviceId,
  )}/send-sms`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
    },
    body: JSON.stringify({
      recipients,
      message,
      ...(cfg.simSubscriptionId
        ? { simSubscriptionId: Number(cfg.simSubscriptionId) }
        : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[sms] send FAILED", {
      count: recipients.length,
      status: response.status,
      detail: detail.slice(0, 300),
    });
    return false;
  }

  return true;
}

export async function sendBulkSms(
  recipients: Array<string | null | undefined>,
  message: string,
  ownerUid?: string | null,
  meta?: {
    senderName?: string | null;
    source?: string | null;
    receiverNamesByPhone?: Map<string, string>;
  },
): Promise<number> {
  const cfg = config();
  const text = message?.trim() ?? "";
  const tenantId = ownerUid?.trim() || null;
  const logBase = {
    ownerUid: tenantId,
    senderName: meta?.senderName ?? null,
    receiverName: null as string | null,
    source: meta?.source ?? "custom_message",
    message: text,
  };

  if (!cfg.apiKey || !cfg.deviceId) {
    console.warn("[sms] bulk skipped — TEXTBEE not configured.");
    for (const raw of recipients) {
      await recordSmsLog(
        { ...logBase, rawTo: raw },
        raw?.trim() || "—",
        "skipped",
        "gateway_not_configured",
      );
    }
    return 0;
  }
  if (!text) return 0;

  const normalized = Array.from(
    new Set(
      recipients
        .map((r) => toE164(r, cfg.defaultCountryCode))
        .filter((r): r is string => !!r),
    ),
  );
  if (normalized.length === 0) {
    for (const raw of recipients) {
      await recordSmsLog(
        { ...logBase, rawTo: raw },
        raw?.trim() || "—",
        "skipped",
        "invalid_recipient",
      );
    }
    return 0;
  }

  if (tenantId) {
    const reserved = await tryConsumeSmsCredits(tenantId, normalized.length);
    if (!reserved) {
      for (const phone of normalized) {
        await recordSmsLog(
          { ...logBase, rawTo: phone },
          phone,
          "skipped",
          "quota_exceeded",
        );
      }
      return 0;
    }
  }

  try {
    const sent = await postSmsToGateway(normalized, text);
    if (!sent) {
      if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
      for (const phone of normalized) {
        await recordSmsLog(
          { ...logBase, rawTo: phone },
          phone,
          "failed",
          "gateway_rejected",
        );
      }
      return 0;
    }

    for (const phone of normalized) {
      await recordSmsLog(
        {
          ...logBase,
          rawTo: phone,
          receiverName: meta?.receiverNamesByPhone?.get(phone) ?? null,
        },
        phone,
        "sent",
        "delivered",
      );
    }
    return normalized.length;
  } catch (error) {
    if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
    console.error("[sms] bulk send FAILED", { error });
    for (const phone of normalized) {
      await recordSmsLog(
        { ...logBase, rawTo: phone },
        phone,
        "failed",
        "gateway_error",
      );
    }
    return 0;
  }
}
