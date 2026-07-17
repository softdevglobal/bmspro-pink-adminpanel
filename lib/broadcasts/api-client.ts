import {
  BROADCAST_NOTIFICATION_PREFIX,
  type BroadcastForUser,
} from "@/lib/broadcasts/types";

export function isBroadcastNotificationId(id: string): boolean {
  return id.startsWith(BROADCAST_NOTIFICATION_PREFIX);
}

export function broadcastIdFromNotificationId(id: string): string {
  return id.startsWith(BROADCAST_NOTIFICATION_PREFIX)
    ? id.slice(BROADCAST_NOTIFICATION_PREFIX.length)
    : id;
}

export type BroadcastNotification = {
  id: string;
  bookingId: string;
  type: "system_message";
  title: string;
  message: string;
  createdAt: Date;
  read: boolean;
};

function broadcastToNotification(item: BroadcastForUser): BroadcastNotification {
  return {
    id: `${BROADCAST_NOTIFICATION_PREFIX}${item.id}`,
    bookingId: "",
    type: "system_message",
    title: item.title,
    message: item.body,
    createdAt: new Date(item.createdAt),
    read: item.read,
  };
}

export async function fetchBroadcastNotifications(
  idToken: string,
): Promise<BroadcastNotification[]> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as {
    ok?: boolean;
    broadcasts?: BroadcastForUser[];
    error?: string;
  };
  if (!response.ok || !body.ok || !body.broadcasts) {
    throw new Error(body.error ?? "Could not load messages.");
  }
  return body.broadcasts.map(broadcastToNotification);
}

export async function markBroadcastReadApi(
  idToken: string,
  broadcastId: string,
): Promise<void> {
  const response = await fetch(`/api/broadcasts/${broadcastId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not mark message read.");
  }
}

export async function markAllBroadcastsReadApi(idToken: string): Promise<void> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not mark messages read.");
  }
}

export async function dismissBroadcastApi(
  idToken: string,
  broadcastId: string,
): Promise<void> {
  const response = await fetch(`/api/broadcasts/${broadcastId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not dismiss message.");
  }
}

export async function dismissAllBroadcastsApi(idToken: string): Promise<void> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not clear messages.");
  }
}
