import "server-only";

import { adminDb } from "@/lib/firebaseAdmin";
import { parseOwnerSmsFields, type BusinessSmsBalance } from "@/lib/sms/types";
import { sendBulkSms, toE164 } from "@/lib/sms/textbee";

export const MAX_CUSTOM_SMS_LENGTH = 480;

export type ContactKind = "customer" | "staff";

export type SmsContact = {
  id: string;
  fullName: string;
  phone: string;
  kind: ContactKind;
};

export type CustomMessageAudience = "customers" | "staff" | "both";

function customerKey(data: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): string | null {
  const email = data.email?.trim().toLowerCase();
  if (email) return `c:email:${email}`;
  const phone = data.phone?.replace(/\D/g, "");
  if (phone) return `c:phone:${phone}`;
  const name = data.name?.trim().toLowerCase();
  if (name) return `c:name:${name}`;
  return null;
}

function staffKey(uid: string): string {
  return `s:${uid}`;
}

export async function getOwnerSalonName(ownerUid: string): Promise<string> {
  const snap = await adminDb().doc(`users/${ownerUid}`).get();
  if (!snap.exists) return "";
  const data = snap.data() ?? {};
  // Use business/tenant fields only — not displayName (owner's personal name).
  const name =
    (typeof data.salonName === "string" && data.salonName.trim()) ||
    (typeof data.businessName === "string" && data.businessName.trim()) ||
    (typeof data.name === "string" && data.name.trim()) ||
    "";
  return name;
}

export async function getOwnerSmsBalance(
  ownerUid: string,
): Promise<BusinessSmsBalance> {
  const snap = await adminDb().doc(`users/${ownerUid}`).get();
  if (!snap.exists) {
    return parseOwnerSmsFields({});
  }
  return parseOwnerSmsFields(snap.data() ?? {});
}

export async function listCustomerContacts(
  ownerUid: string,
): Promise<SmsContact[]> {
  const map = new Map<string, SmsContact>();

  const [bookingsSnap, customersSnap] = await Promise.all([
    adminDb().collection("bookings").where("ownerUid", "==", ownerUid).get(),
    adminDb().collection("customers").where("ownerUid", "==", ownerUid).get(),
  ]);

  const addCustomer = (input: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  }) => {
    const phone = input.phone?.trim();
    if (!phone || !toE164(phone)) return;
    const key = customerKey({
      name: input.name,
      email: input.email,
      phone,
    });
    if (!key) return;
    const existing = map.get(key);
    const fullName =
      input.name?.trim() || input.email?.trim() || phone || "Customer";
    if (!existing) {
      map.set(key, { id: key, fullName, phone, kind: "customer" });
    } else if (!existing.fullName && fullName) {
      existing.fullName = fullName;
    }
  };

  for (const doc of bookingsSnap.docs) {
    const d = doc.data();
    addCustomer({
      name: typeof d.client === "string" ? d.client : d.customerName,
      email: typeof d.clientEmail === "string" ? d.clientEmail : d.customerEmail,
      phone: typeof d.clientPhone === "string" ? d.clientPhone : d.customerPhone,
    });
  }

  for (const doc of customersSnap.docs) {
    const d = doc.data();
    addCustomer({
      name: d.name || d.fullName || d.client,
      email: d.email || d.clientEmail,
      phone: d.phone || d.clientPhone,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export async function listStaffContacts(
  ownerUid: string,
): Promise<SmsContact[]> {
  const snap = await adminDb()
    .collection("users")
    .where("ownerUid", "==", ownerUid)
    .get();

  const contacts: SmsContact[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const role = String(d.role || d.systemRole || "").toLowerCase();
    if (role !== "salon_staff" && role !== "salon_branch_admin") continue;

    const phone =
      (typeof d.mobile === "string" && d.mobile.trim()) ||
      (typeof d.phone === "string" && d.phone.trim()) ||
      "";
    if (!phone || !toE164(phone)) continue;

    const fullName =
      (typeof d.displayName === "string" && d.displayName.trim()) ||
      (typeof d.name === "string" && d.name.trim()) ||
      "Staff member";

    contacts.push({
      id: staffKey(doc.id),
      fullName,
      phone,
      kind: "staff",
    });
  }

  return contacts.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listContactsForAudience(
  ownerUid: string,
  audience: CustomMessageAudience,
): Promise<SmsContact[]> {
  const [customers, staff] = await Promise.all([
    audience === "staff" ? Promise.resolve([]) : listCustomerContacts(ownerUid),
    audience === "customers" ? Promise.resolve([]) : listStaffContacts(ownerUid),
  ]);
  return [...customers, ...staff];
}

function filterByRecipients(
  contacts: SmsContact[],
  recipients: unknown,
): SmsContact[] {
  if (recipients === "all") return contacts;
  if (!Array.isArray(recipients)) return [];
  const ids = new Set(
    recipients.filter((id): id is string => typeof id === "string"),
  );
  return contacts.filter((contact) => ids.has(contact.id));
}

export async function sendOwnerCustomSms(input: {
  ownerUid: string;
  salonName: string | null;
  message: string;
  audience: CustomMessageAudience;
  recipients: unknown;
}): Promise<{ sentCount: number; requestedCount: number }> {
  const message = input.message.trim();
  const contacts = await listContactsForAudience(input.ownerUid, input.audience);
  const selected = filterByRecipients(contacts, input.recipients);

  if (selected.length === 0) {
    return { sentCount: 0, requestedCount: 0 };
  }

  const result = await sendBulkSms(
    selected.map((c) => c.phone),
    message,
    input.ownerUid,
    "owner_custom_message",
    input.salonName ?? undefined,
  );

  return { sentCount: result.sent, requestedCount: selected.length };
}
