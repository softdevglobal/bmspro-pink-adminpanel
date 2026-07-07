"use client";

import { auth } from "@/lib/firebase";
import {
  BROADCAST_AUDIENCE_LABELS,
  type BroadcastAudience,
  type BroadcastRecord,
} from "@/lib/broadcasts/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function platformLabel(record: BroadcastRecord): string {
  const parts: string[] = [];
  if (record.platforms.admin) parts.push("Admin panel");
  if (record.platforms.mobile) parts.push("Mobile app");
  return parts.length ? parts.join(" + ") : "—";
}

export function CustomMessagesBoard() {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetAdmin, setTargetAdmin] = useState(true);
  const [targetMobile, setTargetMobile] = useState(true);
  const [audience, setAudience] = useState<BroadcastAudience>("owners");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BroadcastRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await authFetch<{ broadcasts: BroadcastRecord[] }>(
      "/api/admin/broadcasts",
    );
    if (result.ok) {
      setBroadcasts(result.data.broadcasts ?? []);
      setListError(null);
    } else {
      setListError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = useMemo(
    () =>
      title.trim().length > 0 &&
      body.trim().length > 0 &&
      (targetAdmin || targetMobile) &&
      !sending,
    [title, body, targetAdmin, targetMobile, sending],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!title.trim() || !body.trim()) {
      setFormError("Add a title and a message.");
      return;
    }
    if (!targetAdmin && !targetMobile) {
      setFormError("Choose at least one platform.");
      return;
    }

    setSending(true);
    const result = await authFetch<{ mobilePushCount: number }>(
      "/api/admin/broadcasts",
      {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          platforms: { admin: targetAdmin, mobile: targetMobile },
          audience,
        }),
      },
    );
    setSending(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    const pushCount = result.data.mobilePushCount ?? 0;
    setSuccessMessage(
      targetMobile
        ? `Message sent. Push notification delivered to ${pushCount} device${
            pushCount === 1 ? "" : "s"
          }.`
        : "Message sent.",
    );
    setTitle("");
    setBody("");
    void load();
  }

  async function toggleActive(record: BroadcastRecord) {
    setBusyId(record.id);
    const result = await authFetch(`/api/admin/broadcasts/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !record.active }),
    });
    setBusyId(null);
    if (result.ok) {
      setBroadcasts((current) =>
        current.map((item) =>
          item.id === record.id ? { ...item, active: !item.active } : item,
        ),
      );
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await authFetch(`/api/admin/broadcasts/${pendingDelete.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (result.ok) {
      setBroadcasts((current) =>
        current.filter((item) => item.id !== pendingDelete.id),
      );
    }
    setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <i className="fas fa-edit text-pink-500" />
          <h3 className="text-lg font-bold text-slate-900">New message</h3>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              Title
            </label>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Scheduled maintenance tonight"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              Message
            </label>
            <textarea
              value={body}
              maxLength={MAX_BODY_LENGTH}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              placeholder="Write the announcement recipients will see as a notification."
              className={`${INPUT_CLASS} resize-y`}
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {body.length}/{MAX_BODY_LENGTH}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-500">
                Show on
              </legend>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={targetAdmin}
                  onChange={(event) => setTargetAdmin(event.target.checked)}
                  className="h-4 w-4 accent-pink-500"
                />
                Admin panel (web)
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={targetMobile}
                  onChange={(event) => setTargetMobile(event.target.checked)}
                  className="h-4 w-4 accent-pink-500"
                />
                Mobile app (push + in-app)
              </label>
            </fieldset>

            <fieldset className="rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-500">
                Send to
              </legend>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === "owners"}
                  onChange={() => setAudience("owners")}
                  className="h-4 w-4 accent-pink-500"
                />
                {BROADCAST_AUDIENCE_LABELS.owners}
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-700">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === "all"}
                  onChange={() => setAudience("all")}
                  className="h-4 w-4 accent-pink-500"
                />
                {BROADCAST_AUDIENCE_LABELS.all}
              </label>
            </fieldset>
          </div>

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

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-fuchsia-600 px-5 text-sm font-semibold text-white transition hover:from-pink-600 hover:to-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className={`fas ${sending ? "fa-spinner fa-spin" : "fa-paper-plane"}`} />
              {sending ? "Sending..." : "Send message"}
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="fas fa-history text-pink-500" />
            <h3 className="text-lg font-bold text-slate-900">Sent messages</h3>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
          >
            <i className="fas fa-sync-alt" />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <i className="fas fa-spinner fa-spin text-xl text-pink-500" />
          </div>
        ) : listError ? (
          <p className="py-6 text-center text-sm text-red-600">{listError}</p>
        ) : broadcasts.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No messages sent yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {broadcasts.map((record) => (
              <li
                key={record.id}
                className={`rounded-xl border border-slate-200 p-4 ${
                  record.active ? "bg-white" : "bg-slate-50 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">
                        {record.title}
                      </p>
                      {!record.active ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          Recalled
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-slate-600">
                      {record.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <i className="fas fa-desktop" />
                        {platformLabel(record)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <i className="fas fa-users" />
                        {BROADCAST_AUDIENCE_LABELS[record.audience]}
                      </span>
                      {record.platforms.mobile && record.mobilePushCount != null ? (
                        <span className="inline-flex items-center gap-1">
                          <i className="fas fa-bell" />
                          {record.mobilePushCount} push
                        </span>
                      ) : null}
                      <span>{relativeTime(record.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleActive(record)}
                      disabled={busyId === record.id}
                      title={record.active ? "Recall (hide from recipients)" : "Re-activate"}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      <i
                        className={`fas ${
                          busyId === record.id
                            ? "fa-spinner fa-spin"
                            : record.active
                              ? "fa-eye-slash"
                              : "fa-eye"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(record)}
                      title="Delete permanently"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <i className="fas fa-trash" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingDelete != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <i className="fas fa-exclamation-triangle text-xl text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Delete message?</h3>
                  <p className="mt-0.5 text-sm text-slate-500">This action cannot be undone</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-700">
                This permanently removes the message. Recipients who already saw it keep their copy,
                but it will no longer be delivered to anyone new.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-70"
              >
                {deleting ? (
                  <>
                    <i className="fas fa-spinner fa-spin" />
                    Deleting...
                  </>
                ) : (
                  "Yes, delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
