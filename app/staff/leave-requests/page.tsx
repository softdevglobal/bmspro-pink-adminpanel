"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type LeaveRow = {
  id: string;
  requesterName: string;
  /** Raw role from leave document (legacy) */
  requesterRole: string;
  requesterUid?: string;
  /** Shown in UI: "Branch Admin - Name" or "Salon staff" */
  roleDisplay: string;
  avatarImageUrl: string;
  fromLabel: string;
  toLabel: string;
  reason: string;
  status: string;
  isFullDay: boolean;
  startTime?: string;
  endTime?: string;
  createdAt: Date | null;
  attachmentUrl?: string;
  rejectionReason?: string;
  reviewedByName?: string;
  reviewedAt: Date | null;
};

function formatTs(t: Timestamp | null | undefined): string {
  if (!t?.toDate) return "—";
  try {
    return t.toDate().toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatAdded(d: Date | null): string {
  if (!d) return "—";
  try {
    return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function dicebearAvatar(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

function normalizeSystemRole(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function pickPhotoUrl(d: Record<string, unknown>): string {
  const keys = ["photoURL", "photoUrl", "avatarUrl", "avatarURL", "profileImageUrl", "imageUrl"];
  for (const k of keys) {
    const v = d[k];
    if (v != null) {
      const s = String(v).trim();
      if (/^https?:\/\//i.test(s)) return s;
    }
  }
  return "";
}

function MemberAvatar({
  seed,
  imageUrl,
  className,
}: {
  seed: string;
  imageUrl: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = dicebearAvatar(seed || "user");
  const src = failed ? fallback : imageUrl;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      onError={() => {
        if (!failed) setFailed(true);
      }}
    />
  );
}

function roleDisplayFromLeaveDocRole(raw: string): string {
  const r = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (r === "salon_branch_admin") return "Branch Admin";
  if (r === "salon_staff") return "Salon staff";
  if (!raw) return "Staff";
  return raw.replace(/_/g, " ");
}

async function fetchRequesterProfile(uid: string, fallbackName: string): Promise<{
  roleDisplay: string;
  avatarImageUrl: string;
}> {
  try {
    const u = await getDoc(doc(db, "users", uid));
    const d = u.data();
    if (!d) {
      return {
        roleDisplay: "Salon staff",
        avatarImageUrl: dicebearAvatar(fallbackName || uid),
      };
    }
    const rec = d as Record<string, unknown>;
    const roleRaw = String(d.role || d.systemRole || "").trim();
    const role = normalizeSystemRole(roleRaw);
    let roleDisplay: string;
    if (role === "salon_branch_admin") {
      let branchName = String(d.branchName || "").trim();
      if (!branchName && d.branchId) {
        try {
          const b = await getDoc(doc(db, "branches", String(d.branchId)));
          const bd = b.data();
          branchName = String(bd?.name ?? bd?.branchName ?? "").trim();
        } catch {
          branchName = "";
        }
      }
      roleDisplay = branchName ? `Branch Admin - ${branchName}` : "Branch Admin";
    } else if (role === "salon_staff") {
      roleDisplay = "Salon staff";
    } else {
      roleDisplay = roleRaw.replace(/_/g, " ").trim() || "Staff";
    }

    const photo = pickPhotoUrl(rec);
    const avatarImageUrl = photo
      ? photo
      : dicebearAvatar(String(d.avatar || d.displayName || d.name || fallbackName || uid));

    return { roleDisplay, avatarImageUrl };
  } catch {
    return {
      roleDisplay: "Salon staff",
      avatarImageUrl: dicebearAvatar(fallbackName || uid),
    };
  }
}

export default function StaffLeaveRequestsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null);
  const [approvePromptId, setApprovePromptId] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<LeaveRow | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);
      } catch {
        router.replace("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = (snap.data()?.role || "").toString();
        if (role === "salon_branch_admin") {
          router.replace("/branches");
          return;
        }
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }
        setOwnerUid(user.uid);
      } catch {
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!ownerUid) return;
    let cancelled = false;
    const q = query(collection(db, "leaveRequests"), where("ownerUid", "==", ownerUid));
    const profileCache = new Map<string, Promise<{ roleDisplay: string; avatarImageUrl: string }>>();

    const getDisplay = (uid: string, fallbackName: string) => {
      if (!profileCache.has(uid)) {
        profileCache.set(uid, fetchRequesterProfile(uid, fallbackName));
      }
      return profileCache.get(uid)!;
    };

    const unsub = onSnapshot(
      q,
      (snap) => {
        void (async () => {
          type RowBase = Omit<LeaveRow, "roleDisplay" | "avatarImageUrl">;
          const list: RowBase[] = [];
          for (const d of snap.docs) {
            const data = d.data();
            const fromTs = data.fromDate as Timestamp | undefined;
            const toTs = data.toDate as Timestamp | undefined;
            const created = data.createdAt as Timestamp | undefined;
            const reviewed = data.reviewedAt as Timestamp | undefined;
            const att = data.attachmentUrl != null ? String(data.attachmentUrl).trim() : "";
            const rej = data.rejectionReason != null ? String(data.rejectionReason).trim() : "";
            list.push({
              id: d.id,
              requesterName: (data.requesterName || "Team member").toString(),
              requesterRole: (data.requesterRole || "").toString(),
              requesterUid: data.requesterUid != null ? String(data.requesterUid) : undefined,
              fromLabel: formatTs(fromTs),
              toLabel: formatTs(toTs),
              reason: (data.reason || "").toString(),
              status: (data.status || "pending").toString().toLowerCase(),
              isFullDay: data.isFullDay !== false,
              startTime: data.startTime != null ? String(data.startTime) : undefined,
              endTime: data.endTime != null ? String(data.endTime) : undefined,
              createdAt: created?.toDate ? created.toDate() : null,
              attachmentUrl: att.length > 0 ? att : undefined,
              rejectionReason: rej.length > 0 ? rej : undefined,
              reviewedByName: data.reviewedByName != null ? String(data.reviewedByName) : undefined,
              reviewedAt: reviewed?.toDate ? reviewed.toDate() : null,
            });
          }
          list.sort((a, b) => {
            const ta = a.createdAt?.getTime() ?? 0;
            const tb = b.createdAt?.getTime() ?? 0;
            return tb - ta;
          });

          const enriched: LeaveRow[] = await Promise.all(
            list.map(async (row) => {
              if (row.requesterUid) {
                const { roleDisplay, avatarImageUrl } = await getDisplay(
                  row.requesterUid,
                  row.requesterName
                );
                return { ...row, roleDisplay, avatarImageUrl };
              }
              return {
                ...row,
                roleDisplay: roleDisplayFromLeaveDocRole(row.requesterRole),
                avatarImageUrl: dicebearAvatar(row.requesterName || row.id),
              };
            })
          );

          if (!cancelled) {
            setRows(enriched);
            setLoading(false);
          }
        })();
      },
      (err) => {
        console.error(err);
        if (!cancelled) setLoading(false);
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [ownerUid]);

  const approvePromptRow = useMemo(
    () => (approvePromptId ? rows.find((r) => r.id === approvePromptId) ?? null : null),
    [approvePromptId, rows]
  );

  const patchLeave = useCallback(
    async (id: string, action: "approve" | "reject", reason?: string): Promise<boolean> => {
      const user = auth.currentUser;
      if (!user) return false;
      const token = await user.getIdToken();
      setBusyId(id);
      setPatchError(null);
      try {
        const res = await fetch(`/api/leave-requests/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            action === "approve" ? { action: "approve" } : { action: "reject", reason }
          ),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPatchError(typeof j?.error === "string" ? j.error : "Could not update request");
          return false;
        }
        return true;
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const openReject = (id: string) => {
    setRejectTargetId(id);
    setRejectReason("");
    setRejectReasonError(null);
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    const id = rejectTargetId;
    if (!id) return;
    const r = rejectReason.trim();
    if (r.length < 2) {
      setRejectReasonError("Please enter a reason (at least 2 characters).");
      return;
    }
    setRejectReasonError(null);
    setRejectOpen(false);
    const ok = await patchLeave(id, "reject", r);
    setRejectTargetId(null);
    if (ok) setPreviewRow((cur) => (cur?.id === id ? null : cur));
  };

  const confirmApproveFlow = async (id: string) => {
    setApprovePromptId(null);
    const ok = await patchLeave(id, "approve");
    if (ok) setPreviewRow((c) => (c?.id === id ? null : c));
  };

  /** Live row from snapshot while drawer is open (so status updates after approve/reject). */
  const previewLive = useMemo(
    () => (previewRow ? rows.find((r) => r.id === previewRow.id) ?? previewRow : null),
    [previewRow, rows]
  );

  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-inter text-slate-800">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">
          <div className="md:hidden p-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
            <h2 className="font-bold text-lg text-slate-800">Leave Requests</h2>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => setMobileOpen(true)}
            >
              <i className="fas fa-bars" />
            </button>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          {rejectOpen && (
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
              role="presentation"
              onClick={() => {
                setRejectOpen(false);
                setRejectTargetId(null);
                setRejectReasonError(null);
              }}
            >
              <div
                role="dialog"
                aria-labelledby="reject-leave-title"
                aria-modal="true"
                className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden ring-1 ring-slate-200/90"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-gradient-to-r from-rose-50 via-white to-fuchsia-50/80 px-6 py-5 border-b border-slate-100">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-md">
                      <i className="fas fa-ban text-lg" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h3 id="reject-leave-title" className="text-lg font-bold text-slate-900">
                        Decline leave request
                      </h3>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        Your note is sent to the team member’s app — be clear and professional.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <textarea
                    className="w-full min-h-[132px] border border-slate-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400/80 focus:border-pink-300 bg-[#FFF9FC]"
                    placeholder="Reason for declining…"
                    value={rejectReason}
                    onChange={(e) => {
                      setRejectReason(e.target.value);
                      setRejectReasonError(null);
                    }}
                  />
                  {rejectReasonError && (
                    <p className="text-sm font-medium text-rose-700 flex items-center gap-2">
                      <i className="fas fa-circle-exclamation text-xs" aria-hidden />
                      {rejectReasonError}
                    </p>
                  )}
                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      type="button"
                      className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
                      onClick={() => {
                        setRejectOpen(false);
                        setRejectTargetId(null);
                        setRejectReasonError(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 text-white font-semibold shadow-sm hover:from-rose-700 hover:to-rose-800"
                      onClick={() => void confirmReject()}
                    >
                      Decline request
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {approvePromptId && (
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
              role="presentation"
              onClick={() => setApprovePromptId(null)}
            >
              <div
                role="dialog"
                aria-labelledby="approve-leave-title"
                aria-modal="true"
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden ring-1 ring-slate-200/90"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-gradient-to-r from-emerald-50 via-white to-teal-50 border-b border-slate-100 px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
                      <i className="fas fa-circle-check text-lg" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h3 id="approve-leave-title" className="text-lg font-bold text-slate-900">
                        Approve time off?
                      </h3>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                        Confirm you’re happy with this leave for{" "}
                        <strong className="font-semibold text-slate-900">
                          {approvePromptRow?.requesterName ?? "this team member"}
                        </strong>
                        .
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <div className="rounded-xl border border-slate-100 bg-slate-50/90 p-4 text-sm space-y-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 font-medium">Dates</span>
                      <span className="text-slate-900 font-semibold text-right">
                        {approvePromptRow
                          ? approvePromptRow.fromLabel === approvePromptRow.toLabel
                            ? approvePromptRow.fromLabel
                            : `${approvePromptRow.fromLabel} → ${approvePromptRow.toLabel}`
                          : "—"}
                      </span>
                    </div>
                    {approvePromptRow?.reason && (
                      <div className="pt-2 border-t border-slate-200/80">
                        <span className="text-slate-500 font-medium text-xs uppercase tracking-wide">Reason</span>
                        <p className="mt-1 text-slate-800">{approvePromptRow.reason}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50"
                      onClick={() => setApprovePromptId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busyId === approvePromptId}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                      onClick={() => void confirmApproveFlow(approvePromptId)}
                    >
                      Approve leave
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {patchError && (
            <div className="fixed bottom-6 left-1/2 z-[10001] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-lg flex items-start gap-3">
              <i className="fas fa-circle-exclamation text-rose-600 mt-0.5" aria-hidden />
              <p className="flex-1 text-sm text-rose-900 font-medium">{patchError}</p>
              <button
                type="button"
                className="shrink-0 text-rose-700 hover:text-rose-900 p-1 rounded-lg"
                aria-label="Dismiss"
                onClick={() => setPatchError(null)}
              >
                <i className="fas fa-times" />
              </button>
            </div>
          )}

          {previewLive && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-[9980] bg-slate-900/40"
                aria-label="Close preview"
                onClick={() => setPreviewRow(null)}
              />
              <aside
                className="fixed top-0 right-0 z-[9981] flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl motion-safe:transition-transform"
                aria-labelledby="leave-preview-title"
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-pink-50 via-white to-fuchsia-50/80 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-fuchsia-600 text-white shadow-md">
                      <i className="fas fa-umbrella-beach text-lg" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h2 id="leave-preview-title" className="truncate text-lg font-bold text-slate-900">
                        Request details
                      </h2>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
                    onClick={() => setPreviewRow(null)}
                    aria-label="Close"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team member</p>
                    <div className="mt-3 flex items-start gap-3">
                      <MemberAvatar
                        key={`${previewLive.id}-${previewLive.avatarImageUrl}`}
                        seed={previewLive.requesterUid || previewLive.requesterName || previewLive.id}
                        imageUrl={previewLive.avatarImageUrl}
                        className="h-14 w-14 shrink-0 rounded-full border border-slate-200 bg-white object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-slate-900">{previewLive.requesterName}</p>
                        <p className="text-sm text-slate-600">
                          {previewLive.roleDisplay ||
                            roleDisplayFromLeaveDocRole(previewLive.requesterRole) ||
                            "Staff"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Submitted</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{formatAdded(previewLive.createdAt)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-500">Status</p>
                      <p className="mt-1">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                            previewLive.status === "approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : previewLive.status === "rejected"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {previewLive.status}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {previewLive.fromLabel}
                      {previewLive.toLabel !== previewLive.fromLabel && (
                        <span className="font-normal text-slate-600">
                          {" "}
                          → {previewLive.toLabel}
                        </span>
                      )}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      {previewLive.isFullDay ? "Full day" : "Hours"} ·{" "}
                      {!previewLive.isFullDay && previewLive.startTime && previewLive.endTime ? (
                        <span className="font-medium text-slate-800">
                          {previewLive.startTime} – {previewLive.endTime}
                        </span>
                      ) : (
                        <span className="font-medium text-slate-800">All day</span>
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {previewLive.reason || "—"}
                    </p>
                  </div>

                  {previewLive.rejectionReason && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Decline reason</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-rose-900">{previewLive.rejectionReason}</p>
                    </div>
                  )}

                  {(previewLive.reviewedByName || previewLive.reviewedAt) && previewLive.status !== "pending" && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review</p>
                      {previewLive.reviewedByName && (
                        <p className="mt-2 text-sm text-slate-800">By {previewLive.reviewedByName}</p>
                      )}
                      {previewLive.reviewedAt && (
                        <p className="text-xs text-slate-600">{formatAdded(previewLive.reviewedAt)}</p>
                      )}
                    </div>
                  )}

                  {previewLive.attachmentUrl && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Attachment</p>
                      <a
                        href={previewLive.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-block max-w-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewLive.attachmentUrl}
                          alt="Leave attachment"
                          className="max-h-64 w-full rounded-lg border border-slate-200 object-contain shadow-sm transition group-hover:ring-2 group-hover:ring-pink-300"
                        />
                        <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-pink-600 group-hover:text-pink-700">
                          <i className="fas fa-arrow-up-right-from-square text-xs" />
                          Open original
                        </span>
                      </a>
                    </div>
                  )}
                </div>

                {previewLive.status === "pending" && (
                  <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        disabled={busyId === previewLive.id}
                        className="inline-flex justify-center rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        onClick={() => openReject(previewLive.id)}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busyId === previewLive.id}
                        className="inline-flex justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                        onClick={() => setApprovePromptId(previewLive.id)}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            </>
          )}

          <div className="p-4 sm:p-6 lg:p-8">
            <div className="mb-6">
              <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shadow-inner">
                    <i className="fas fa-umbrella-beach text-xl text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">Staff Leave Requests</h1>
                    <p className="text-sm text-white/80 mt-1">
                      Review time off from staff and branch admins
                      {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Team member</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Added</th>
                      <th className="px-4 py-3 font-semibold">Dates</th>
                      <th className="px-4 py-3 font-semibold">Reason</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      <th className="px-2 py-3 font-semibold text-center w-[4.5rem]">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-16 text-center text-slate-500">
                          Loading…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-16 text-center text-slate-500">
                          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-pink-50 flex items-center justify-center">
                            <i className="fas fa-umbrella-beach text-2xl text-pink-500" />
                          </div>
                          <p className="font-semibold text-slate-700">No leave requests yet</p>
                          <p className="text-sm mt-2 max-w-md mx-auto">
                            When staff submit time off, you will see them here to approve or decline.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const st = row.status;
                        const pending = st === "pending";
                        const badgeClass =
                          st === "approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : st === "rejected"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-900";
                        return (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-4 py-3 align-top">
                              <div className="flex items-start gap-3">
                                <MemberAvatar
                                  key={`${row.id}-${row.avatarImageUrl}`}
                                  seed={row.requesterUid || row.requesterName || row.id}
                                  imageUrl={row.avatarImageUrl}
                                  className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover"
                                />
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">{row.requesterName}</div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    {row.roleDisplay ||
                                      roleDisplayFromLeaveDocRole(row.requesterRole) ||
                                      "Staff"}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top text-xs text-slate-600 whitespace-nowrap">
                              {formatAdded(row.createdAt)}
                            </td>
                            <td className="px-4 py-3 align-top whitespace-nowrap">
                              <div>
                                {row.fromLabel}
                                {row.toLabel !== row.fromLabel && (
                                  <>
                                    <br />
                                    <span className="text-slate-500 text-xs">to </span>
                                    {row.toLabel}
                                  </>
                                )}
                              </div>
                              {!row.isFullDay && row.startTime && row.endTime && (
                                <div className="text-xs text-slate-500 mt-1">
                                  {row.startTime} – {row.endTime}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top max-w-[14rem] sm:max-w-xs">
                              <div className="min-w-0 max-w-full">
                                <p
                                  className="truncate text-slate-700"
                                  title={(row.reason && row.reason.trim()) || undefined}
                                >
                                  {row.reason || "—"}
                                </p>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span
                                className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold capitalize ${badgeClass}`}
                              >
                                {st}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top text-right">
                              {pending ? (
                                <div className="inline-flex flex-col sm:flex-row gap-2 justify-end">
                                  <button
                                    type="button"
                                    disabled={busyId === row.id}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                                    onClick={() => setApprovePromptId(row.id)}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === row.id}
                                    className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-60"
                                    onClick={() => openReject(row.id)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-2 py-3 align-top text-center">
                              <button
                                type="button"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-pink-600 hover:border-pink-300 hover:bg-pink-50 transition-colors"
                                title="Preview details"
                                aria-label={`Preview leave request for ${row.requesterName}`}
                                onClick={() => setPreviewRow(row)}
                              >
                                <i className="fas fa-eye text-sm" aria-hidden />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
