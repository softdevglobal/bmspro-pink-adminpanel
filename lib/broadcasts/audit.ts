import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";

type CustomNotificationActor = {
  uid: string;
  email: string | null;
  name: string | null;
};

function platformSummary(platforms: { admin: boolean; mobile: boolean }): string {
  const parts: string[] = [];
  if (platforms.admin) parts.push("admin panel");
  if (platforms.mobile) parts.push("mobile app");
  return parts.length ? parts.join(" + ") : "no platform";
}

function audienceSummary(audience: "owners" | "all"): string {
  return audience === "all" ? "owners and staff" : "owners only";
}

async function writeCustomNotificationAuditLog(input: {
  action: string;
  actionType: "create" | "update" | "delete" | "other";
  summary: string;
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const who = input.actor.name?.trim() || input.actor.email?.trim() || "Super admin";
    await adminDb().collection("superAdminAuditLogs").add({
      action: input.summary,
      actionType: input.actionType,
      entityType: "system",
      entityId: input.broadcastId,
      entityName: input.title,
      performedBy: input.actor.uid,
      performedByName: who,
      performedByRole: "super_admin",
      details: input.summary,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      metadata: {
        category: "custom_notification",
        categoryLabel: "Platform messages",
        auditAction: input.action,
        broadcastId: input.broadcastId,
        title: input.title,
        ...input.metadata,
      },
    });
  } catch (error) {
    console.error("[broadcast audit] Failed to write audit log:", error);
  }
}

export async function resolveAuditIdentityForUid(uid: string): Promise<{
  email: string | null;
  name: string | null;
}> {
  const superAdminSnap = await adminDb().doc(`super_admins/${uid}`).get();
  if (superAdminSnap.exists) {
    const data = superAdminSnap.data() ?? {};
    return {
      email: typeof data.email === "string" ? data.email : null,
      name:
        typeof data.displayName === "string"
          ? data.displayName
          : typeof data.name === "string"
            ? data.name
            : null,
    };
  }

  const userSnap = await adminDb().doc(`users/${uid}`).get();
  if (userSnap.exists) {
    const data = userSnap.data() ?? {};
    return {
      email: typeof data.email === "string" ? data.email : null,
      name:
        typeof data.displayName === "string"
          ? data.displayName
          : typeof data.name === "string"
            ? data.name
            : null,
    };
  }

  return { email: null, name: null };
}

export async function logCustomNotificationSent(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
  audience: "owners" | "all";
  platforms: { admin: boolean; mobile: boolean };
  mobilePushCount: number;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await writeCustomNotificationAuditLog({
    action: "custom_notification.sent",
    actionType: "create",
    summary: `${who} sent custom notification "${params.title}" to ${audienceSummary(params.audience)} via ${platformSummary(params.platforms)}`,
    actor: params.actor,
    broadcastId: params.broadcastId,
    title: params.title,
    metadata: {
      audience: params.audience,
      platforms: params.platforms,
      mobilePushCount: params.mobilePushCount,
      collection: "admin_broadcasts",
    },
  });
}

export async function logCustomNotificationActiveChanged(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
  active: boolean;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await writeCustomNotificationAuditLog({
    action: params.active
      ? "custom_notification.reactivated"
      : "custom_notification.recalled",
    actionType: "update",
    summary: params.active
      ? `${who} re-activated custom notification "${params.title}"`
      : `${who} recalled custom notification "${params.title}"`,
    actor: params.actor,
    broadcastId: params.broadcastId,
    title: params.title,
    metadata: { active: params.active, collection: "admin_broadcasts" },
  });
}

export async function logCustomNotificationDeleted(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await writeCustomNotificationAuditLog({
    action: "custom_notification.deleted",
    actionType: "delete",
    summary: `${who} deleted custom notification "${params.title}"`,
    actor: params.actor,
    broadcastId: params.broadcastId,
    title: params.title,
    metadata: { collection: "admin_broadcasts" },
  });
}
