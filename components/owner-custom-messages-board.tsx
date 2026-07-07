"use client";

import { auth } from "@/lib/firebase";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import type { BusinessSmsBalance } from "@/lib/sms/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500";

const MAX_MESSAGE_LENGTH = 480;

const QUICK_TEMPLATES: Array<{ label: string; text: string }> = [
  {
    label: "Season's greetings",
    text: "Season's greetings from {salon}! Thank you for your support this year. We wish you a safe and happy holiday season.",
  },
  {
    label: "Merry Christmas",
    text: "Merry Christmas from {salon}! We appreciate your business and look forward to seeing you again soon.",
  },
  {
    label: "Happy New Year",
    text: "Happy New Year from {salon}! Thank you for trusting us this year. Wishing you health and happiness in the year ahead.",
  },
  {
    label: "Easter wishes",
    text: "Wishing you a wonderful Easter from everyone at {salon}. We hope you enjoy a relaxing break with family and friends.",
  },
];

function personalizeWithSalonName(text: string, salonName: string): string {
  const name = salonName.trim();
  if (!name) return text.replace(/\{salon\}/g, "our salon");
  return text.replace(/\{salon\}/g, name);
}

type ContactKind = "customer" | "staff";

type SmsContact = {
  id: string;
  fullName: string;
  phone: string;
  kind: ContactKind;
};

type Audience = "customers" | "staff" | "both";

type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<FetchResult<T>> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: (T & { ok?: boolean; error?: string }) | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as T & { ok?: boolean; error?: string };
    } catch {
      return { ok: false, error: "Invalid response from server." };
    }
  }
  if (!response.ok || !body || body.ok === false) {
    return { ok: false, error: body?.error ?? "Request failed." };
  }
  return { ok: true, data: body };
}

function audienceLabel(audience: Audience): string {
  if (audience === "customers") return "customers";
  if (audience === "staff") return "staff";
  return "recipients";
}

export function OwnerCustomMessagesBoard() {
  const [customers, setCustomers] = useState<SmsContact[]>([]);
  const [staff, setStaff] = useState<SmsContact[]>([]);
  const [balance, setBalance] = useState<BusinessSmsBalance | null>(null);
  const [salonName, setSalonName] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("customers");
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await authFetch<{
      customers: SmsContact[];
      staff: SmsContact[];
      balance: BusinessSmsBalance | null;
      salonName?: string;
    }>("/api/business/custom-messages");
    if (result.ok) {
      setCustomers(result.data.customers ?? []);
      setStaff(result.data.staff ?? []);
      setBalance(result.data.balance ?? null);
      setSalonName(result.data.salonName?.trim() ?? "");
      setListError(null);
    } else {
      setListError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const contacts = useMemo(() => {
    if (audience === "customers") return customers;
    if (audience === "staff") return staff;
    return [...customers, ...staff];
  }, [audience, customers, staff]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((contact) => {
      const displayPhone = formatAuPhoneDisplay(contact.phone).toLowerCase();
      return (
        contact.fullName.toLowerCase().includes(q) ||
        contact.phone.includes(q) ||
        displayPhone.includes(q)
      );
    });
  }, [contacts, query]);

  const recipientCount = useMemo(() => {
    if (mode === "all") return contacts.length;
    return contacts.filter((contact) => selectedIds.has(contact.id)).length;
  }, [mode, contacts, selectedIds]);

  const remaining =
    balance && !balance.isUnlimited ? (balance.remaining ?? 0) : null;
  const insufficientCredits =
    remaining !== null && recipientCount > remaining;

  const canSubmit =
    message.trim().length > 0 &&
    recipientCount > 0 &&
    !insufficientCredits &&
    !sending;

  function handleAudienceChange(next: Audience) {
    setAudience(next);
    setSelectedIds(new Set());
    setQuery("");
    setFormError(null);
    setSuccessMessage(null);
  }

  function toggleContact(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const contact of filtered) next.add(contact.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!message.trim()) {
      setFormError("Write a message to send.");
      return;
    }
    if (recipientCount === 0) {
      setFormError(`Select at least one ${audienceLabel(audience)} to message.`);
      return;
    }
    if (insufficientCredits) {
      setFormError("Not enough SMS credits for this many recipients.");
      return;
    }

    setSending(true);
    const result = await authFetch<{ sentCount: number; requestedCount: number }>(
      "/api/business/custom-messages",
      {
        method: "POST",
        body: JSON.stringify({
          message: message.trim(),
          audience,
          recipients: mode === "all" ? "all" : Array.from(selectedIds),
        }),
      },
    );
    setSending(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    const sent = result.data.sentCount ?? 0;
    setSuccessMessage(
      `Message sent to ${sent} ${sent === 1 ? "recipient" : "recipients"}.`,
    );
    setMessage("");
    setSelectedIds(new Set());
    void load();
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <i className="fas fa-spinner fa-spin text-2xl text-pink-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50">
          <i className="fas fa-sms text-pink-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">SMS balance</p>
          <p className="text-xs text-slate-500">
            {balance == null
              ? "Unavailable"
              : balance.isUnlimited
                ? "Unlimited messages"
                : `${remaining ?? 0} messages remaining`}
          </p>
        </div>
        <div className="ml-auto text-right text-xs text-slate-500">
          {salonName ? (
            <p className="mb-1 font-semibold text-slate-700">
              <i className="fas fa-store mr-1 text-pink-500" />
              {salonName}
            </p>
          ) : null}
          <p>
            {customers.length} customer{customers.length === 1 ? "" : "s"} ·{" "}
            {staff.length} staff member{staff.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <i className="fas fa-edit text-pink-500" />
          <h3 className="text-lg font-bold text-slate-900">New SMS message</h3>
        </div>

        <div className="flex flex-col gap-4">
          {salonName ? (
            <div className="flex items-center gap-2 rounded-xl border border-pink-100 bg-pink-50 px-3 py-2.5 text-sm text-pink-800">
              <i className="fas fa-store text-pink-500" />
              <span>
                Messages will be sent from{" "}
                <span className="font-semibold">{salonName}</span>
              </span>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              Message
            </label>
            <textarea
              value={message}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="Write the SMS your recipients will receive."
              className={`${INPUT_CLASS} resize-y`}
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="w-full text-xs font-semibold text-slate-500">
                Seasonal greetings
                {salonName ? (
                  <span className="font-normal text-slate-400">
                    {" "}
                    — includes your salon name ({salonName})
                  </span>
                ) : null}
              </span>
              {QUICK_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() =>
                    setMessage(personalizeWithSalonName(template.text, salonName))
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700"
                >
                  <i className="fas fa-star text-[10px] text-pink-400" />
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-500">
              Send to
            </legend>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="audience"
                checked={audience === "customers"}
                onChange={() => handleAudienceChange("customers")}
                className="h-4 w-4 accent-pink-500"
              />
              Customers only ({customers.length})
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="audience"
                checked={audience === "staff"}
                onChange={() => handleAudienceChange("staff")}
                className="h-4 w-4 accent-pink-500"
              />
              Staff members only ({staff.length})
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="audience"
                checked={audience === "both"}
                onChange={() => handleAudienceChange("both")}
                className="h-4 w-4 accent-pink-500"
              />
              Customers & staff ({customers.length + staff.length})
            </label>
          </fieldset>

          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-500">
              Recipients
            </legend>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="recipients"
                checked={mode === "all"}
                onChange={() => setMode("all")}
                className="h-4 w-4 accent-pink-500"
              />
              All {audienceLabel(audience)} ({contacts.length})
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="recipients"
                checked={mode === "select"}
                onChange={() => setMode("select")}
                className="h-4 w-4 accent-pink-500"
              />
              Select {audienceLabel(audience)}
            </label>

            {mode === "select" ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or phone"
                    className={`${INPUT_CLASS} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-slate-500">
                      {contacts.length === 0
                        ? `No ${audienceLabel(audience)} with a phone number yet.`
                        : "No matches for your search."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filtered.map((contact) => (
                        <li key={contact.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(contact.id)}
                              onChange={() => toggleContact(contact.id)}
                              className="h-4 w-4 accent-pink-500"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="block truncate text-sm font-medium text-slate-900">
                                  {contact.fullName}
                                </span>
                                {audience === "both" ? (
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                      contact.kind === "staff"
                                        ? "bg-purple-100 text-purple-700"
                                        : "bg-blue-100 text-blue-700"
                                    }`}
                                  >
                                    {contact.kind}
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                {formatAuPhoneDisplay(contact.phone) ||
                                  contact.phone}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </fieldset>

          {listError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {listError}
            </p>
          ) : null}
          {insufficientCredits ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              You need {recipientCount} credits but only {remaining ?? 0} remain.
              Select fewer recipients or contact support to add SMS credits.
            </p>
          ) : null}
          {formError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rounded-lg bg-pink-50 px-3 py-2 text-sm text-pink-700">
              {successMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
              {recipientCount > 0
                ? ` · ${recipientCount} SMS credit${recipientCount === 1 ? "" : "s"}`
                : ""}
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-fuchsia-600 px-5 text-sm font-semibold text-white transition hover:from-pink-600 hover:to-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className={`fas ${sending ? "fa-spinner fa-spin" : "fa-paper-plane"}`} />
              {sending ? "Sending..." : "Send SMS"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
