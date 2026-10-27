# Call Center — Full API Reference (BMS Pink)

Covers **every** call-center route in the Pink admin panel:
- `app/api/call-center/*` — agent registration bridge, workshops (salons), branches, staff, services, bookings, customer notifications, agent activities, direct chat.
- `app/api/chats/cc/*` — the salon side of direct chat (agent directory + rooms).
- `app/api/support-chat/agent/*` — the support chat inbox for agents.

All routes are Next.js App Router handlers (`export const runtime = "nodejs"`), backed by Firebase Auth + Firestore (project **bmspro-pink**).

- **Part A (sections 1–6):** route map, core rules, agent registration bridge, agent activities, agent directory.
- **Part B (sections 7–13):** workshops, branches, staff, services, bookings, customer notifications, direct chat, support chat.
- Section 14 is the who-can-call-what summary.
- **Part C:** the Command Center backend proxy (`/api/bms-pink/*`) and how each route maps to Pink.
- **Part D:** real request / response bodies for every proxy route, captured by running them against the test salon.

> Reference: the BMS Black equivalent is `bmspro-black-adminpanel/docs/CALL_CENTER_AGENT_API.md`. Section 15 lists every difference between the two.

---

## 1. Route map and folder structure

```
app/api/
├── call-center/
│   ├── supabase/
│   │   ├── register-agent/route.ts        POST  (create agent in Supabase + Firebase Pink [+ Black])
│   │   └── firebase-token/route.ts        POST  (Supabase session → Firebase Pink custom token)
│   ├── agent-activities/route.ts          POST (log a call), GET (list logs)
│   ├── workshops/route.ts                 GET
│   ├── branches/route.ts                  GET
│   ├── branches/[branchId]/route.ts       GET
│   ├── staff/route.ts                     GET
│   ├── services/route.ts                  GET
│   ├── services/[serviceId]/route.ts      GET
│   ├── services/[serviceId]/staff/route.ts GET
│   ├── bookings/route.ts                  GET (list), POST (create)
│   ├── bookings/availability/route.ts     GET
│   ├── bookings/[id]/route.ts             GET, PATCH, PUT
│   ├── bookings/[id]/confirm|cancel|complete/route.ts   POST
│   ├── bookings/[id]/reschedule/route.ts  PATCH
│   ├── customer-notifications/route.ts    GET
│   ├── customer-notifications/[notificationId]/called-customer/route.ts        POST
│   ├── customer-notifications/[notificationId]/notification-reviewed/route.ts  POST
│   └── chats/                             direct chat (agent side, §12)
│       ├── route.ts, workshop-owners/route.ts, start-with-owner/route.ts
│       └── [chatId]/route.ts, messages, claim, close, read, reviewed
├── chats/cc/                              direct chat (salon side, §12.3)
│   ├── agents/route.ts                    GET (agent directory)
│   └── rooms/route.ts, [chatId]/messages, read, close
└── support-chat/agent/                    support inbox (§13)
    ├── conversations/route.ts
    ├── conversations/[conversationId]/messages, claim, read, close, transfer
    ├── presence/route.ts
    └── fcm-token/route.ts

lib/                                       (business logic used by the routes)
├── callCenterAuth.ts                      token verification, roles, workshop access rules, CORS
├── callCenterActorFromAuth.ts             resolves "who did this" for activity / tracking records
├── callCenterBranchForBooking.ts          branch hours → daySchedules / daySchedule
├── callCenterBookings.ts                  booking lookup, slot + staff rules, list-row serializer
├── callCenterBookingStatus.ts             confirm / cancel / complete handler
├── callCenterServices.ts                  service + staff summaries
├── callCenterCustomerNotifications.ts     customer inbox filter + tracking handler
├── callCenterSalonDetail.ts               workshop full bundle
├── callCenterWorkshopOwnersQuery.ts       active salon owners in scope
├── ccDirectChat.ts                        direct chat rooms / messages
├── supportChat.ts                         support chat conversations / messages
└── registerCommandCenterAgentInSupabase.ts  Supabase + Firebase agent provisioning
```

All `call-center/*` and `support-chat/agent/*` routes export `OPTIONS` and send `CORS_HEADERS` (`Access-Control-Allow-Origin: *`, methods `GET, POST, PATCH, DELETE, OPTIONS`, headers `Content-Type, Authorization, X-Tenant-Id`). The `chats/cc/*` routes do **not** send CORS headers.

Auth header for every Firebase-authenticated route: `Authorization: Bearer <Firebase Pink ID token>`. In `NODE_ENV=development` only, `?access_token=<token>` (or `?token=`) is also accepted.

---

## 2. Core concepts and business rules

### 2.1 Data stores (Firestore, bmspro-pink)
| Store | Purpose |
|-------|---------|
| Firebase Auth | The login account (email, password, displayName). |
| `call_center_agents/{uid}` | The agent profile. Document id = Firebase UID. Written by the Command Center backend when an agent is registered. |
| `users/{uid}` | Salon owners, branch admins and stylists (`role`: `salon_owner`, `salon_branch_admin`, `salon_staff`); fallback source for call-center roles. |
| `branches/{id}`, `services/{id}` | Salon catalogue (`ownerUid` = salon owner). |
| `bookings/{id}`, `bookingRequests/{id}` | Bookings. Call-center bookings are written to `bookings`. |
| `bookingActivities/{id}` | Per-booking activity log. |
| `leaveRequests/{id}` | Stylist leave; approved leave blocks booking slots. |
| `notifications/{id}` | All in-app notifications, including the customer-facing ones (§11). |
| `agent_activities/{id}` | One record per call logged by an agent. |
| `cc_direct_chats/{chatId}` (+ `messages`) | Agent ↔ salon direct chat. |
| `conversations/{id}` (+ `messages`) | Support chat. |

### 2.2 Roles
`CALL_CENTER_ROLES = ["agent", "call_center_agent", "call_center_admin"]`
- `agent` is canonical; `call_center_agent` is kept for legacy documents.
- `call_center_admin` ⇒ `isCCAdmin = true`; can access **every** salon.

BMS staff roles accepted as "tenant admin" on call-center routes: `super_admin`, `salon_owner`, `salon_branch_admin`.

### 2.3 Workshop (salon) access
For an **agent** (`canAccessWorkshop`):
1. `call_center_admin` → all salons.
2. `assignedWorkshops` **empty** → all salons (unscoped agent).
3. Otherwise the salon `ownerUid` must be in `assignedWorkshops` (`assigned_workshops` and `{ ownerUid }` items are also read).

For **BMS staff** (`canAccessWorkshopForAuth`): super admin → all; `salon_owner` → own uid only; `salon_branch_admin` → the owner they belong to (`ownerUid`).

### 2.4 Agent authentication resolution (`verifyCallCenterAuth`)
1. Read the Bearer token → `401` if missing or invalid/expired.
2. Look up `call_center_agents/{uid}`:
   - `suspended` → `403 Agent account suspended`
   - role not in `CALL_CENTER_ROLES` → `403 Invalid call center role`
3. If no agent doc, fall back to `users/{uid}` with a call-center `role` / `systemRole`.
4. Otherwise `403 Not a registered call center agent`.

`verifyCallCenterOrTenantAdminAuth` tries the agent check first, then BMS staff (`super_admin`, `salon_owner`, `salon_branch_admin`). The result is tagged `kind: "agent"` or `kind: "tenant_admin"`.

### 2.5 Tenant
The salon = `ownerUid` (salon owner's Firebase UID). Pass it as header `X-Tenant-Id: <ownerUid>` or query `?ownerUid=…` / `?tenantId=…` (`getTenantId`).

### 2.6 Actor attribution
Writes record who did it from the **token**, never from the body (`resolveNotificationActorSnapshot`): the latest `displayName` / email / role from `call_center_agents` (agents) or `users` (staff; `super_admin` for super admins), tagged `recordedByKind: "agent" | "tenant_admin"`.

### 2.7 Common error shape
```json
{ "error": "message" }
```
Typical statuses: `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict, `422` incomplete data, `500` server error, `503` Firestore index missing.

---

## 3. Agent registration bridge (Supabase)

Pink has **no** agent CRUD or email/password agent login routes (Black's `/agents` and `/auth/*`). Agents are created by the Command Center; Pink exposes these two Supabase-authenticated helpers.

### 3.1 `POST /api/call-center/supabase/register-agent`
**File:** `app/api/call-center/supabase/register-agent/route.ts` → `registerCommandCenterAgentInSupabase`

**Auth:** `Authorization: Bearer <Supabase access_token>`. The caller must have a `user_roles.role` of `SUPABASE_SUPER_ADMIN_ROLE` (or `APP_ROLE_SUPER_ADMIN`), or one of `super_admin`, `super-admin`, `superadmin`, `admin`.

**What it does:** Same contract as the Command Center `POST /api/agents/register`:
1. Creates the Supabase Auth user (`email_confirm: true`), a `user_roles` row (`agent`) and an `agents` row (`id = agent-<timestamp>`, `status: offline`).
2. Creates or updates the **Firebase Pink** Auth user with the same email/password.
3. If `FIREBASE_BLACK_SERVICE_ACCOUNT` is set on Pink, also creates/updates the **Firebase Black** user and stores `firebase_black_uid` on the agent row.

It does **not** write `call_center_agents/{uid}` in Pink Firestore; the Command Center registration flow does that.

**Request body:**
```json
{
  "name": "Jane Agent",
  "email": "jane@callcenter.com",
  "phone": "+61400000000",
  "password": "Agent@1234",
  "extension": "1001",
  "notes": "optional",
  "agentType": "workshop",
  "tenantId": "optional Supabase tenant id",
  "workshopOwnerUid": "<salon owner uid>",
  "workshopBranchId": "<branch id>",
  "workshopUserRole": "owner"
}
```
| Field | Required | Notes |
|-------|----------|-------|
| `name`, `email`, `password`, `phone` | yes | `phone` may be an empty string but must be present |
| `extension` | yes | Yeastar extension number |
| `agentType` | no | `workshop` (default) or `command-centre` |
| `workshopOwnerUid`, `workshopBranchId` | yes for `workshop` | |
| `workshopUserRole` | yes for `workshop` | `owner`, `branch_admin` or `staff` |
| `tenantId` | no | must exist in Supabase `tenants` |
| `notes` | no | |

**Response `200`:**
```json
{
  "success": true,
  "authenticatedAs": { "uid": "<supabase uid>", "email": "admin@example.com", "roles": ["super_admin"] },
  "supabase": { "userId": "<supabase auth uid>", "agentId": "agent-1730000000000" },
  "firebasePink": { "uid": "<firebase pink uid>" },
  "firebaseBlack": { "uid": "<firebase black uid>" }
}
```
`firebaseBlack` is `null` when Black is not configured on Pink.

**Errors:** `401` missing/invalid Supabase token; `403 Only super admins can register agents…`; `400` invalid JSON, missing fields, or any provisioning failure (`{ "success": false, "error": "…" }`, e.g. `extension is required…`, `workshopUserRole is required…`, `Invalid tenantId…`); `500 Missing Supabase env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY`.

### 3.2 `POST /api/call-center/supabase/firebase-token`
**File:** `app/api/call-center/supabase/firebase-token/route.ts`

**Auth:** `Authorization: Bearer <Supabase access_token>` (any Supabase user).

**What it does:** Finds the Firebase Pink user with the same email as the Supabase user and mints a Firebase **custom token**. The client exchanges it with `signInWithCustomToken` for a Firebase ID token, which is then the Bearer for every other Pink route.

Custom claims: `supabaseUserId`, `roles`, `agentType` (`workshop` when the `agents` row has `workshop_user_role`, else `command-centre`), `workshopOwnerUid`, `workshopBranchId`, `workshopUserRole`, `source: "command-center"`.

**Request:** headers only, no body.

**Response `200`:**
```json
{ "success": true, "firebaseCustomToken": "<JWT>", "uid": "<firebase pink uid>", "expiresIn": 3600 }
```
**Errors:** `401` missing/invalid Supabase token; `400 Supabase user has no email…`; `404 No Firebase Pink user for this email. Register the agent first…`; `500`.

---

## 4. Agent activities (call logs)

Collection `agent_activities`, same document shape as BMS Black.

### 4.1 `POST /api/call-center/agent-activities` — log a call
**File:** `app/api/call-center/agent-activities/route.ts`

**Auth:** agent or tenant admin; salon access check on `ownerId`.

**Business logic:**
1. `ownerId` required (`ownerUid` accepted as alias) → `400 Missing ownerId (salon owner Firebase UID)`.
2. Salon access → `403 Access denied for this workshop`.
3. `callId` and `callerNumber` required (`400 Missing callId` / `400 Missing callerNumber`).
4. Recording: the first of `recordingUrl`, `recordingFileUrl`, `recording_file_url`, `recordingPath`, `recording_path`, `recordingFile`, `recording_file` that looks like a storage reference (`http…`, `gs://`, or a path / filename with an extension) becomes `recordingUrl`. `recordingFileName` comes from `recordingFileName` / `recording_file_name`, or `recordingFile` when that is a bare filename.
5. `ownerName` and `ownerTimezone` (default `Australia/Sydney`) are read from `users/{ownerId}`; lookup errors are ignored.
6. Agent fields come from the token (§2.6).

**Request body:**
```json
{
  "ownerId": "<salonOwnerUid>",
  "callId": "call-123",
  "callerNumber": "+61400000000",
  "callerName": "Caller Name",
  "agentNote": "Wants a colour appointment",
  "didNumber": "0390000000",
  "branchId": "<branchId>",
  "branchName": "Main Branch",
  "queueId": "<queueId>",
  "queueName": "Pink Queue",
  "recordingUrl": "https://example.com/call.wav",
  "recordingFileName": "call-123.wav"
}
```
| Field | Required |
|-------|----------|
| `ownerId` (or `ownerUid`) | yes |
| `callId` | yes |
| `callerNumber` | yes |
| everything else | no (stored as `""`) |

**Response `201`:**
```json
{
  "success": true,
  "id": "<activity doc id>",
  "activity": {
    "id": "<activity doc id>",
    "callId": "call-123",
    "agentName": "Jane Agent",
    "agentUserId": "<uid>",
    "agentEmail": "jane@callcenter.com",
    "agentRole": "agent",
    "recordedByKind": "agent",
    "callerNumber": "+61400000000",
    "callerName": "Caller Name",
    "agentNote": "Wants a colour appointment",
    "didNumber": "0390000000",
    "ownerId": "<salonOwnerUid>",
    "ownerName": "Salon Name",
    "ownerTimezone": "Australia/Sydney",
    "branchId": "<branchId>",
    "branchName": "Main Branch",
    "queueId": "<queueId>",
    "queueName": "Pink Queue",
    "recordingUrl": "https://example.com/call.wav",
    "recordingFileName": "call-123.wav",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```
**Errors:** `400` (including `Invalid JSON body`), `401`, `403`, `500 Internal server error`.

### 4.2 `GET /api/call-center/agent-activities` — list activities
**Query parameters:**
| Param | Required | Notes |
|-------|----------|-------|
| `ownerId` (or `ownerUid`) | yes | salon owner UID |
| `agentUserId` | no | filter by agent UID |
| `agentEmail` | no | case-insensitive, applied in memory |
| `branchId` | no | |
| `callId` | no | |
| `limit` | no | default `25`, range 1–100 |

**Business logic:** `ownerId ==` plus optional equality filters, `orderBy createdAt desc`. If the composite index is missing, reads up to `min(max(limit*5, 100), 500)` rows for the salon and filters/sorts in memory. An index error that still escapes returns `503`.

**Response `200`:**
```json
{ "success": true, "activities": [ { "...same shape as 'activity' in 4.1" } ], "total": 1 }
```
`total` = rows returned. **Errors:** `400 Missing ownerId query parameter`, `401`, `403`, `503`, `500`.

> Black's `GET …/agent-activities/{id}/recording` (audio streaming) is **not** available on Pink; use `recordingUrl` directly.

---

## 5. Workshops (salons)

### 5.1 `GET /api/call-center/workshops`
**File:** `app/api/call-center/workshops/route.ts`

**What it does:** Lists the salons the caller may work with. Default = full bundle per salon; `?summary=1` = light list.

**Business logic:**
- Scope (`workshopListScopeForAuth`): CC admin / unscoped agent / super admin → all `salon_owner` users; scoped agent → `assignedWorkshops`; salon owner → self; branch admin → their owner. Empty scope → `{ "workshops": [] }`.
- Suspended / inactive owners (`accountStatus` or `status`) are excluded.
- **Dev bypass:** in `NODE_ENV=development`, unless `CALL_CENTER_DEV_LIST_ALL_WORKSHOPS=false`, all salons are returned without a token (header `X-Dev-Auth-Bypass: development-default`).

**Response `200` (`summary=1`):**
```json
{ "workshops": [ { "ownerUid": "", "name": "", "slug": "", "logoUrl": "", "contactPhone": "", "email": "", "timezone": "Australia/Sydney", "state": "", "accountStatus": "active" } ] }
```
**Response `200` (full bundle):**
```json
{
  "workshops": [
    {
      "workshop": { "ownerUid": "", "name": "", "slug": "", "logoUrl": "", "contactPhone": "", "email": "", "timezone": "Australia/Sydney", "state": "", "bookingEngineUrl": "", "accountStatus": "active" },
      "branches": [ { "id": "", "name": "", "address": "", "phone": "", "email": "", "timezone": "Australia/Sydney", "hours": {}, "bookingLimitPerDay": null, "status": "Active" } ],
      "services": [ { "id": "", "name": "", "description": "", "price": 0, "duration": 0, "branches": ["<branchId>"], "checklist": [] } ],
      "staff": [ { "id": "", "name": "", "role": "salon_staff", "branchId": null } ]
    }
  ]
}
```
**Errors:** `401/403` (dev adds a `hint`), `500 Internal server error`.

> Pink has no `GET /api/call-center/workshops/{ownerUid}`; use the list.

---

## 6. Agent directory for salon chat

### 6.1 `GET /api/chats/cc/agents`
**File:** `app/api/chats/cc/agents/route.ts` → `listAgentsForWorkshopChat`

**Auth:** `verifyAdminAuth` with roles `salon_owner`, `salon_branch_admin`, `salon_staff`.

**What it does:** Returns **all** non-suspended `call_center_agents` (no salon filter), for the salon user to pick someone to message.

**Response `200`:**
```json
{
  "agents": [
    {
      "agent_id": "<uid>", "uid": "<uid>", "email": "jane@callcenter.com", "name": "Jane Agent", "displayName": "Jane Agent",
      "role": "agent", "suspended": false, "assignedWorkshops": ["<ownerUid>"],
      "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "createdBy": null, "createdByRole": null
    }
  ]
}
```
**Errors:** `401/403`, `500 { "error": "<message>" }`. No CORS headers.

---

# Part B — Salon data, bookings, notifications, chat

Conventions for Part B (unless noted):
- **Auth:** `verifyCallCenterOrTenantAdminAuth` (agent **or** `super_admin` / `salon_owner` / `salon_branch_admin`).
- **Tenant:** `X-Tenant-Id` / `?ownerUid=` / `?tenantId=`, then the salon access check (§2.3).
- **Dates** are `YYYY-MM-DD`, **times** `HH:mm`, both in the branch's local time.

### Branch object (used by §7 and §9.3)
```json
{
  "id": "<branchId>",
  "name": "Main Branch",
  "address": "1 Example St",
  "phone": "",
  "email": "",
  "timezone": "Australia/Sydney",
  "status": "Active",
  "hours": { "Monday": { "open": "09:00", "close": "17:00" }, "Sunday": { "closed": true } },
  "daySchedules": {
    "Sunday": { "dayOfWeek": "Sunday", "closed": true, "open": null, "close": null },
    "Monday": { "dayOfWeek": "Monday", "closed": false, "open": "09:00", "close": "17:00" }
  },
  "daySchedule": null,
  "bookingLimitPerDay": null
}
```
`daySchedules` has all seven weekdays. A day missing from `hours` (or `closed: true`) is closed; an open day without times defaults to `09:00`–`17:00`. `daySchedule` is that weekday's entry when `?date=` is passed, otherwise `null`. `address` falls back to `locationText`.

---

## 7. Branches

### 7.1 `GET /api/call-center/branches`
**File:** `app/api/call-center/branches/route.ts`

**Request:** tenant **required** (`400 Missing ownerUid (query or X-Tenant-Id)`), salon access (`403 Access denied`); optional `date=YYYY-MM-DD` fills `daySchedule`. Sorted by name.

**Response `200`:**
```json
{ "ownerUid": "<ownerUid>", "total": 2, "branches": [ { "...branch object" } ] }
```

### 7.2 `GET /api/call-center/branches/{branchId}`
**File:** `app/api/call-center/branches/[branchId]/route.ts`

**Business logic:** branch must exist and have an `ownerUid` (`404 Branch not found`). **Agents may read any branch** (tenant ignored). **BMS staff:** a supplied tenant must equal the branch owner (`400 ownerUid does not match this branch`) and they need salon access (`403 Access denied`). Optional `date`.

**Response `200`:** `{ "branch": { "...branch object" } }`
**Errors:** `400 Missing branchId`, `401`, `403`, `404`, `500`.

---

## 8. Staff and services

Stylist roles on Pink are `salon_staff` and `salon_branch_admin` (users with `ownerUid` = the salon).

**Works at a branch** (`staffWorksAtBranch`): with a date, the stylist's `weeklySchedule[weekday].branchId` decides (a missing/null day = not working); without a date, any `weeklySchedule` day or the primary `branchId` counts.

### 8.1 `GET /api/call-center/staff`
**File:** `app/api/call-center/staff/route.ts`

**Query:**
| Param | Required | Notes |
|-------|----------|-------|
| tenant | yes | `400 Missing ownerUid (X-Tenant-Id header or ?ownerUid=)` |
| `branchId` | no | home branch **or** any weekly-schedule day at this branch |
| `role` | no | `staff` / `branch_admin` (or `salon_staff` / `salon_branch_admin`); anything else → `400` |
| `status` | no | `Active` / `Suspended` |

Reads up to 500 users (falls back to an unindexed read if the `ownerUid + role` index is missing). Sorted by name.

**Response `200`:**
```json
{
  "staff": [
    {
      "id": "<uid>", "uid": "<uid>", "name": "Sam Stylist", "email": "sam@salon.com", "mobile": "",
      "role": "salon_staff", "staffRole": "", "branchId": "<branchId>", "branchName": "Main Branch",
      "status": "Active", "avatar": null, "timezone": null,
      "weeklySchedule": { "Monday": { "branchId": "<branchId>", "branchName": "Main Branch" }, "Sunday": null },
      "training": null, "createdAt": null, "updatedAt": null
    }
  ],
  "total": 1
}
```
`mobile` falls back to `phone`. `createdAt` / `updatedAt` are passed through as stored.

### 8.2 `GET /api/call-center/services`
**File:** `app/api/call-center/services/route.ts`

**Request:** tenant required (`400 Missing ownerUid`), salon access (`403`); optional `branchId` keeps only services whose `branches` contains it.

`staff[]` is the service's `staffIds` allow-list resolved from `users` (batches of 30). An **empty** `staff[]` means any stylist working at the branch may take it.

**Response `200`:**
```json
{
  "services": [
    {
      "id": "<serviceId>", "name": "Cut & Blow Dry", "description": "", "price": 85, "duration": 60,
      "icon": "", "imageUrl": "",
      "branches": ["<branchId>"],
      "staff": [ { "id": "<uid>", "name": "Sam Stylist", "role": "salon_staff", "branchId": "<branchId>" } ]
    }
  ],
  "total": 1
}
```

### 8.3 `GET /api/call-center/services/{serviceId}`
**File:** `app/api/call-center/services/[serviceId]/route.ts`

No tenant needed: access is checked against the service's own `ownerUid` (`403 Access denied`, `404 Service not found`). Branch ids are resolved to names.

**Response `200`:**
```json
{
  "service": {
    "id": "<serviceId>", "name": "Cut & Blow Dry", "description": "", "price": 85, "duration": 60,
    "icon": "", "imageUrl": "",
    "branches": [ { "id": "<branchId>", "name": "Main Branch" } ],
    "staff": [ { "id": "<uid>", "name": "Sam Stylist", "role": "salon_staff", "branchId": "<branchId>" } ]
  }
}
```

### 8.4 `GET /api/call-center/services/{serviceId}/staff`
**File:** `app/api/call-center/services/[serviceId]/staff/route.ts`

**What it does:** The shortlist of stylists who can take this service.

**Query:** `branchId` (optional), `date=YYYY-MM-DD` (optional; `400 date must be YYYY-MM-DD`).

**Filters:** role `salon_staff` / `salon_branch_admin`; not `Suspended`; on the `staffIds` allow-list when it is set; works at `branchId` (on `date`'s weekday when given); not on **full-day** approved leave on `date` (in the branch timezone). Home-branch stylists first, then by name.

**Response `200`:**
```json
{
  "service": { "id": "<serviceId>", "name": "Cut & Blow Dry", "hasStaffAllowList": true, "staffIds": ["<uid>"], "price": 85, "duration": 60 },
  "filter": { "branchId": "<branchId>", "branchName": "Main Branch", "date": "2026-11-03", "dayName": "Tuesday" },
  "staff": [
    {
      "id": "<uid>", "uid": "<uid>", "name": "Sam Stylist", "email": "", "role": "salon_staff", "staffRole": "",
      "branchId": "<branchId>", "branchName": "Main Branch", "status": "Active", "avatar": null, "inServiceAllowList": true
    }
  ],
  "total": 1
}
```
**Errors:** `400 Missing serviceId`, `403`, `404 Service not found`, `422 Service is missing owner information`, `500`.

---

## 9. Bookings

Files under `app/api/call-center/bookings/`. Status values: `Pending`, `AwaitingStaffApproval`, `PartiallyApproved`, `StaffRejected`, `Confirmed`, `Completed`, `Canceled`.
Routes that take `{id}` accept the Firestore document id **or** the human `bookingCode` (`BK-YYYY-MMDDHH-NNNN`). A code matching several bookings → `409 Multiple bookings match this booking code`.

### Slot rules (create, reschedule, availability)
Same rules as the Pink admin panel booking path (`POST /api/bookings`), using all active bookings and booking requests of the salon on that date (`Canceled`, `Completed`, `StaffRejected` do not block):
- **Specific stylist:** blocked by approved leave overlapping the slot (`Staff on leave`), and by any overlapping booking for that stylist **or** any overlapping "Any Staff" booking (`Time slot already booked`).
- **Any Staff:** eligible stylists = active, on the service allow-list, working at the branch that day, not on leave. None → `No staff available`. If eligible − busy stylists − overlapping "Any Staff" bookings ≤ 0 → `Time slot fully booked`.
- Services of the same booking are checked against each other too.

### Booking list row (`serializeCallCenterBooking`)
```json
{
  "id": "<bookingId>",
  "bookingCode": "BK-2026-110309-1234",
  "ownerUid": "<ownerUid>",
  "status": "AwaitingStaffApproval",
  "date": "2026-11-03",
  "time": "09:30",
  "duration": 90,
  "clientName": "Sarah Mendis",
  "clientEmail": "sarah@example.com",
  "clientPhone": "+61400111222",
  "customerUid": null,
  "branchId": "<branchId>",
  "branchName": "Main Branch",
  "services": [
    {
      "id": "<serviceId>", "name": "Cut & Blow Dry", "price": 85, "duration": 60, "time": "09:30",
      "staffId": "<uid>", "staffName": "Sam Stylist", "approvalStatus": "pending", "completionStatus": "pending"
    }
  ],
  "staffId": "<uid>",
  "staffName": "Sam Stylist",
  "totalPrice": 85,
  "notes": "",
  "source": "Call Center",
  "createdAt": "2026-11-01T02:00:00.000Z",
  "updatedAt": "2026-11-01T02:00:00.000Z"
}
```
`services[].id` is the key to use in `staffAssignments` (§9.5, §9.8).

### 9.1 `GET /api/call-center/bookings` — list
**Query:** tenant (optional, see scope), `status`, `date=YYYY-MM-DD`, `branchId`, `customerUid`, `limit` (default `100`, max `1000`), `all=1|true` or `limit=all` (= 1000).

**Scope:**
- With a tenant → that salon (`403 Access denied for this workshop` if not allowed).
- Without a tenant: salon owners / branch admins → `400 Missing ownerUid (query or X-Tenant-Id)`; CC admin / unscoped agent / super admin → every salon; scoped agent → their `assignedWorkshops` (chunked `in` queries).
- Newest first (`createdAt desc`); without the composite index, a larger unordered read is sorted in memory. `status`, `branchId`, `customerUid` are filtered in memory.

**Response `200`:**
```json
{ "bookings": [ { "...booking list row" } ], "total": 1 }
```
**Errors:** `400` (also `date must be YYYY-MM-DD`), `401`, `403`, `500`.

### 9.2 `POST /api/call-center/bookings` — create booking
**What it does:** The agent books on behalf of a customer. Writes a normal Pink `bookings` doc (visible in the admin panel and staff app) with `bookingSource: "Call Center"` and `source: "call_center"`.

**Headers:** `Authorization: Bearer <Firebase Pink idToken>`, `Content-Type: application/json`, optional `X-Tenant-Id`.

**Minimal request body:**
```json
{
  "ownerUid": "SALON_OWNER_FIREBASE_UID",
  "branchId": "BRANCH_DOC_ID",
  "date": "2026-11-03",
  "time": "09:30",
  "client": "Sarah Mendis",
  "clientPhone": "+61400111222",
  "services": [ { "serviceId": "SERVICE_DOC_ID" } ]
}
```

**Full request body:**
```json
{
  "ownerUid": "<ownerUid>",
  "branchId": "<branchId>",
  "date": "YYYY-MM-DD",
  "time": "HH:mm",
  "client": "Sarah Mendis",
  "clientPhone": "+61400111222",
  "clientEmail": "sarah@example.com",
  "customerUid": "optional booking-app customer uid",
  "notes": "optional",
  "services": [
    { "serviceId": "<id>", "staffId": "optional <uid>", "staffName": "optional", "time": "optional HH:mm", "price": 0, "duration": 0 }
  ]
}
```
| Field | Required | Notes |
|-------|----------|-------|
| `ownerUid` | yes | or `X-Tenant-Id` |
| `branchId` | yes | must belong to the salon |
| `date`, `time` | yes | `YYYY-MM-DD`, `HH:mm` |
| `client` | yes | |
| `clientPhone` | yes | at least 6 digits (`field: "clientPhone"`) |
| `clientEmail` | no | validated when present (`field: "clientEmail"`); used for the booking email |
| `services` | yes | at least one; each needs `serviceId` (or `id`) |
| `services[].staffId` | no | omitted / `null` / "any…" = Any Staff |
| `services[].time` | no | default: back-to-back from `time` |
| `services[].price`, `duration` | no | default: catalogue value (duration fallback 60) |

**Business logic:**
1. Validation (`400`), salon access (`403`), branch belongs to the salon (`404 Branch not found for this salon`).
2. Branch must be open that weekday (`400 Branch is closed on <Day>`), and every service line must fit inside opening hours (`400 Service "<name>" at <time> is outside branch hours (09:00–17:00)`).
3. Every service must be a catalogue service of this salon (`400 Unknown service: <id>`) and offered at the branch when the service lists branches (`400 Service "<name>" is not offered at <branch>`).
4. A given `staffId` must be an eligible stylist for that service, branch and day (`400 Staff <id> cannot take "<name>" at <branch> on <date>`); `staffName` defaults to the stylist's name.
5. Slot rules → `409` (body below).
6. **Status:** any stylist assigned → `AwaitingStaffApproval` (assigned lines `approvalStatus: "pending"`); none assigned → `Pending` (`"needs_assignment"`).
7. Stored like admin-panel bookings: `serviceId` = comma-joined ids, `serviceName` = comma-joined names, top-level `staffId`/`staffName` = the single stylist, `"Multiple Staff"` or `"Any Available"`; `price`/`duration` = totals; `branchTimezone`, `dateTimeUtc`; `createdBy` / `createdByName` / `createdByRole` from the token.
8. Side effects (failures are logged, not returned): `bookingActivities` entry `booking_created`; audit log; "request received" email when `clientEmail` is set; staff assignment notification per assigned stylist; when any line has no stylist, an owner notification and branch-admin notifications of type `booking_needs_assignment`.

**Response `201`:**
```json
{
  "success": true,
  "bookingId": "<bookingId>",
  "bookingCode": "BK-2026-110309-1234",
  "status": "AwaitingStaffApproval",
  "totalPrice": 85,
  "totalDuration": 60,
  "services": [
    {
      "id": "<serviceId>", "name": "Cut & Blow Dry", "price": 85, "duration": 60, "time": "09:30",
      "staffId": "<uid>", "staffName": "Sam Stylist", "approvalStatus": "pending", "completionStatus": "pending"
    }
  ]
}
```
**Slot conflict `409`:**
```json
{
  "error": "Time slot already booked",
  "details": "The selected time 09:30 conflicts with an existing booking. Please choose a different time.",
  "service": "Cut & Blow Dry",
  "time": "09:30"
}
```
`error` is one of `Staff on leave`, `Time slot already booked`, `No staff available`, `Time slot fully booked`.

### 9.3 `GET /api/call-center/bookings/availability`
**Query:**
| Param | Required | Notes |
|-------|----------|-------|
| tenant | yes | |
| `branchId` | yes | |
| `date` | yes | `YYYY-MM-DD` |
| `serviceIds` | no | comma separated; booked back-to-back. Omitted = one 60-min Any Staff appointment |
| `staffId` | no | check one specific stylist |
| `interval` | no | `10`, `15`, `20`, `30` (default) or `60` minutes |

Missing params → `400 Missing required params: ownerUid (or X-Tenant-Id), branchId, date (YYYY-MM-DD)`; `403`; `404 Branch not found`; `400 Unknown service: <id>`.

**Business logic:** start times every `interval` minutes from open while the whole block fits before close. Each start is checked with the slot rules. Blocked reasons:
- `Daily booking limit reached` — every slot, when `bookingLimitPerDay` is set and the branch's active bookings that day ≥ the limit.
- `Staff does not work these services at this branch on this day` — every slot, when `staffId` is not eligible for one of the services.
- `Time has passed` — times up to now when `date` is today in the branch timezone.
- `Staff on leave`, `Time slot already booked`, `No staff available`, `Time slot fully booked` — per slot.

**Response `200`:**
```json
{
  "dayOfWeek": "Tuesday",
  "branch": { "...branch object (daySchedule set)" },
  "branchHours": { "open": "09:00", "close": "17:00" },
  "interval": 30,
  "available": true,
  "services": [ { "id": "<serviceId>", "name": "Cut & Blow Dry", "duration": 60 } ],
  "totalDuration": 60,
  "staffId": null,
  "allSlots": ["09:00", "09:30", "10:00"],
  "availableSlots": ["09:30", "10:00"],
  "blockedSlots": [ { "time": "09:00", "reason": "Time slot fully booked" } ],
  "dailyLimitReached": false,
  "dailyLimit": null,
  "currentBookings": 3,
  "remainingBookings": null
}
```
When nothing is free, `available` is `false` and `reason` is `Daily booking limit reached` or `No free times for the requested services`.
**Closed day `200`:** `{ "dayOfWeek", "branch", "branchHours": null, "interval", "available": false, "reason": "Branch is closed on this day", "allSlots": [], "availableSlots": [], "blockedSlots": [] }`.

### 9.4 `GET /api/call-center/bookings/{id}` — booking card
**Business logic:** `404 Booking not found`, `409` duplicate code, `422 Booking is missing owner information`, `403 Access denied`. Activities = latest 20 `bookingActivities` rows for the booking.

**Response `200`:**
```json
{
  "booking": { "...booking list row" },
  "services": [ { "...same as booking.services" } ],
  "progress": { "services": { "completed": 0, "total": 1, "percentage": 0 } },
  "activities": [
    {
      "id": "", "activityType": "booking_created", "previousStatus": null, "newStatus": "AwaitingStaffApproval",
      "staffName": "Sam Stylist", "performedByName": "Jane Agent", "performedByRole": "agent",
      "source": "call_center", "createdAt": "2026-11-01T02:00:00.000Z"
    }
  ]
}
```

### 9.5 `POST /api/call-center/bookings/{id}/confirm`
**File:** `bookings/[id]/confirm/route.ts` → `handleCallCenterBookingStatusChange` (`lib/callCenterBookingStatus.ts`).

**Request body (all optional):**
```json
{
  "staffAssignments": { "<serviceId>": { "staffId": "<uid>", "staffName": "<name>" } },
  "staffId": "<uid>",
  "staffName": "<name>",
  "skipStaffValidation": false
}
```
`staffAssignments` is keyed by `booking.services[].id`; `staffId` / `staffName` is the single-service shortcut.

**Business logic:** confirm is allowed from `Pending`, `AwaitingStaffApproval`, `PartiallyApproved` and `StaffRejected`. It acts with owner authority, so it skips the staff-approval step the app flow requires. Any other status → `400 Cannot confirm a booking that is currently <status>`; already confirmed → `409 Booking is already Confirmed`. Every service must end up with a stylist unless `skipStaffValidation: true`; otherwise `400`:
```json
{
  "error": "Staff must be assigned to every service before confirming. Pass `staffAssignments` in the body, or set `skipStaffValidation: true` to override.",
  "missingStaffForServices": ["Cut & Blow Dry"],
  "hint": "Body shape: { \"staffAssignments\": { \"<serviceId>\": { \"staffId\": \"X\", \"staffName\": \"Y\" } } } — or for a single-service booking { \"staffId\": \"X\", \"staffName\": \"Y\" }."
}
```
On success: services set to `approvalStatus: "accepted"`; top-level `staffId`/`staffName` synced (cleared for multi-service bookings); `confirmedBy`, `confirmedByName`, `confirmedByRole`, `confirmedAt`, `confirmedVia: "call_center"` stored; `bookingActivities` + audit log; staff assignment notification per stylist; customer confirmation notification and email.

**Response `200`:**
```json
{ "success": true, "bookingId": "<id>", "bookingCode": "BK-…", "previousStatus": "AwaitingStaffApproval", "status": "Confirmed", "action": "confirm" }
```

### 9.6 `POST /api/call-center/bookings/{id}/cancel`
**Body (optional):** `{ "reason": "Customer no longer needs it" }`. Stores `cancelReason`, `canceledBy…`, `canceledAt`, `canceledVia: "call_center"`; activity + audit log; customer cancellation notification and email.

**Response:** same envelope as 9.5 with `"status": "Canceled"`, `"action": "cancel"`.

### 9.7 `POST /api/call-center/bookings/{id}/complete`
**Body:** none. Marks the booking `Completed` (transition rules apply), stores `completedBy…` / `completedVia: "call_center"`, sends the customer completion notification and email.

**Response:** same envelope with `"status": "Completed"`, `"action": "complete"`.

**Shared errors for 9.5–9.7:** `400 Missing booking id`, `401`, `403 Access denied for this workshop`, `404 Booking not found`, `409` (already in that status / duplicate code), `400 Cannot <action> a booking that is currently <status>`, `422 Booking is missing owner information`.

### 9.8 `PATCH` / `PUT /api/call-center/bookings/{id}` — status change
**Body:** `{ "status": "Confirmed" | "Canceled" | "Completed", ...fields of 9.5 / 9.6 }`. Runs exactly the same handler as the matching POST route and returns the same envelope. Any other status → `400 status must be one of: Confirmed, Canceled, Completed`.

### 9.9 `PATCH /api/call-center/bookings/{id}/reschedule`
**Request body:**
```json
{
  "newDate": "YYYY-MM-DD",
  "newTime": "HH:mm",
  "reason": "optional",
  "newStaffId": "<uid>",
  "newStaffName": "<name>",
  "staffAssignments": { "<serviceId>": { "staffId": "<uid>", "staffName": "<name>" } }
}
```
`newDate` and `newTime` required (`400 newDate (YYYY-MM-DD) and newTime (HH:mm) are required`). `newStaffId` applies to single-service bookings; `staffAssignments` to multi-service ones.

**Business logic / guards:**
- `404` / `409` booking lookup; `403`; `400 Cannot reschedule a completed|canceled booking`.
- `409 This booking has already been started by staff and can no longer be rescheduled. Cancel it instead.` when any service is `completionStatus: "completed"`.
- Branch closed on the new weekday → `400`; a line outside opening hours → `400`.
- Services keep their gaps relative to the booking start time.
- Each stylist (new or kept) must be eligible on the new date (`409 <name> cannot take "<service>" at this branch on <date>`), then the slot rules apply (`409`, same body as 9.2). The booking's own old slot is ignored.
- Nothing changed → `400 The new date, time and staff are the same as the current booking`.

On success: `date`, `time`, `dateTimeUtc`, `services[].time`, stylists updated (a changed stylist's line gets `approvalStatus` `accepted` on Confirmed bookings, otherwise `pending`; removed stylist → `needs_assignment`); `rescheduledAt/By/ByName`, `rescheduledVia: "call_center"` and a `rescheduleHistory` entry (`from`, `to`, `reason`, `by`, `byName`, `at`); `bookingActivities` `booking_rescheduled` + audit log; reassignment notification to each newly assigned stylist; customer notification `booking_status_changed` titled "Booking Rescheduled". **No email** is sent.

**Response `200`:**
```json
{
  "ok": true,
  "bookingId": "<id>",
  "bookingCode": "BK-…",
  "date": "2026-11-04",
  "time": "10:00",
  "staffId": "<uid>",
  "staffName": "Sam Stylist",
  "services": [ { "...service line with new time / staff" } ],
  "previous": { "date": "2026-11-03", "time": "09:30", "staffId": "<uid>", "staffName": "Sam Stylist" }
}
```

---

## 10. Customer notifications

Pink has **no** `customer_notifications` collection. The customer inbox is the `notifications` rows the booking app shows customers, i.e. types `booking_confirmed`, `booking_completed`, `booking_canceled`, `booking_status_changed` (`lib/callCenterCustomerNotifications.ts`).

### Notification object
```json
{
  "id": "<notificationId>",
  "type": "booking_confirmed",
  "title": "Booking Confirmed",
  "message": "…",
  "status": "Confirmed",
  "read": false,
  "ownerUid": "<ownerUid>",
  "bookingId": "<bookingId>",
  "bookingCode": "BK-…",
  "customerUid": null,
  "customerEmail": "sarah@example.com",
  "customerPhone": "+61400111222",
  "clientName": "Sarah Mendis",
  "serviceName": "Cut & Blow Dry",
  "branchName": "Main Branch",
  "staffName": "Sam Stylist",
  "bookingDate": "2026-11-03",
  "bookingTime": "09:30",
  "services": [ { "name": "Cut & Blow Dry", "staffName": "Sam Stylist" } ],
  "createdAt": "2026-11-01T02:00:00.000Z",
  "calledCustomer": false,
  "calledCustomerAt": null,
  "calledCustomerByUid": null,
  "calledCustomerByName": null,
  "calledCustomerByEmail": null,
  "notificationReviewed": false,
  "notificationReviewedAt": null,
  "notificationReviewedByUid": null,
  "notificationReviewedByName": null,
  "notificationReviewedByEmail": null
}
```
`read` is the customer's own read flag.

### 10.1 `GET /api/call-center/customer-notifications`
**Query:**
| Param | Notes |
|-------|-------|
| `ownerUid` / `tenantId` / `X-Tenant-Id` | Salon scope. Required unless `all=1` (`400`). |
| `all=1` (or `scope=all`) | System-wide feed: call center agents and super admins only (`403` otherwise). Scoped agents only see their `assignedWorkshops`. |
| `unreadOnly=1` | Only rows the customer has not read. |
| `limit` | Default `50`, range 1–200. |
| `sinceDays` | Lookback window, default `14`, range 1–90. |

Newest first. Reads are bounded (`limit × 3` rows, max 600) and fall back to an unindexed scan when the `type + createdAt` index is missing.

**Response `200` (salon scope):**
```json
{ "scope": "workshop", "ownerUid": "<ownerUid>", "notifications": [ { "...notification object" } ], "total": 1, "unreadCount": 1, "limit": 50, "sinceDays": 14 }
```
**Response `200` (`all=1`):**
```json
{ "scope": "all", "scopedToWorkshops": null, "notifications": [ { "...notification object" } ], "total": 1, "unreadCount": 1, "limit": 50, "sinceDays": 14 }
```
`scopedToWorkshops` is the agent's `assignedWorkshops` for scoped agents, otherwise `null`.
**Errors:** `400`, `401`, `403`, `500 { "error": "Failed to fetch customer notifications" }`.

### 10.2 `POST /api/call-center/customer-notifications/{notificationId}/called-customer`
**Body (optional):** `{ "calledCustomer": true | false }`. A missing value means `true`.
- `true` → stores `calledCustomer: true`, `calledCustomerAt`, `calledCustomerByUid`, `calledCustomerByName`, `calledCustomerByEmail` (from the token, §2.6).
- `false` → clears those fields.

**Business logic:** notification must exist (`404 Notification not found`), be customer-facing (`403 This notification is not part of the customer inbox`) and have an `ownerUid` (`422`). **Any call center agent may update any row**; BMS staff only their own salon (`403 Access denied for this workshop`).

**Response `200`:**
```json
{
  "success": true,
  "notificationId": "<id>",
  "collection": "notifications",
  "documentPath": "notifications/<id>",
  "calledCustomer": true,
  "calledCustomerByUid": "<uid>",
  "calledCustomerByName": "Jane Agent",
  "calledCustomerByEmail": "jane@callcenter.com"
}
```
Values are read back from Firestore after the write.

### 10.3 `POST /api/call-center/customer-notifications/{notificationId}/notification-reviewed`
Same pattern and permissions as 10.2 for the reviewed flag. **Body (optional):** `{ "notificationReviewed": true | false }` (default `true`).

**Response `200`:**
```json
{
  "success": true,
  "notificationId": "<id>",
  "collection": "notifications",
  "documentPath": "notifications/<id>",
  "notificationReviewed": true,
  "notificationReviewedByUid": "<uid>",
  "notificationReviewedByName": "Jane Agent",
  "notificationReviewedByEmail": "jane@callcenter.com"
}
```

---

## 11. Routes not available on Pink

Black's DID lookup, customers, service checklists, call logs and webhooks routes have no Pink equivalent. Section 15 lists every difference.

---

## 12. Direct chat (agent ↔ salon users)

Firestore `cc_direct_chats/{chatId}` with a `messages` subcollection (`lib/ccDirectChat.ts`).
- 1:1 thread id: `cc_<sortedUidA>_<sortedUidB>` (salon user + agent).
- Queue request id: `cc_req_<24 hex>` — created by a salon user without picking an agent; `queueStatus: "pending"` until an agent claims it.
- Message text is trimmed and capped at 8000 characters (empty → `400 Message text is required`).
- Every message sends an FCM push to the other participant; agent messages also create a `cc_chat_inbound` row in `notifications` for the salon admin panel bell.

### Chat object
```json
{
  "chatId": "cc_<uidA>_<uidB>",
  "workshopOwnerUid": "<ownerUid>",
  "tenantUserUid": "<salon user uid>",
  "tenantRole": "salon_owner",
  "agentUid": "<agent uid>",
  "participantIds": ["<uidA>", "<uidB>"],
  "agentName": "Jane Agent",
  "tenantName": "Salon Owner",
  "lastMessageText": "Hi",
  "lastMessageAt": "2026-11-01T02:00:00.000Z",
  "lastSenderId": "<uid>",
  "unreadForTenant": false,
  "unreadForAgent": true,
  "chatsReviewed": false,
  "chatsReviewedAt": null,
  "chatsReviewedByUid": null,
  "createdAt": "2026-11-01T01:00:00.000Z",
  "updatedAt": "2026-11-01T02:00:00.000Z",
  "queueStatus": "active",
  "sessionStatus": "open",
  "closedAt": null,
  "closedByUid": null,
  "workshop": {
    "ownerUid": "", "name": "", "displayName": "", "slug": "", "logoUrl": "", "email": "", "phone": "",
    "address": "", "abn": "", "timezone": "Australia/Sydney", "state": "", "bookingEngineUrl": "", "accountStatus": "active"
  },
  "workshopUser": { "uid": "", "name": "", "displayName": "", "email": "", "role": "salon_owner", "phone": "", "branchId": "", "branchName": "" }
}
```
`queueStatus`: `pending` (unclaimed) or `active`. `sessionStatus`: `open` or `closed`. `workshopUser` is included on agent-side responses only.

### Message object
```json
{ "messageId": "<id>", "senderId": "<uid>", "senderRole": "agent", "messageKind": "user", "text": "Hello", "createdAt": "2026-11-01T02:00:00.000Z", "seenByRecipient": false, "readAt": null }
```
`messageKind` is `system` for lines like "Chat ended".

### 12.1 Agent side — `/api/call-center/chats/*`
| # | Method | Path | Who | Request | Response |
|---|--------|------|-----|---------|----------|
| 1 | GET | `/api/call-center/chats?limit=50` | agent, BMS staff | `limit` (1–100) | `{ "chats": [ chat ] }` |
| 2 | GET | `/api/call-center/chats/workshop-owners` | agent, BMS staff | — | `{ "workshopOwners": [ { ownerUid, name, slug, logoUrl, contactPhone, email, timezone, state, accountStatus } ] }` |
| 3 | POST | `/api/call-center/chats/start-with-owner` | **agent only** | `{ "workshopOwnerUid": "<uid>", "text": "optional" }` | `{ "chat": chat, "created": true, "messageId": "<id or undefined>" }` |
| 4 | GET | `/api/call-center/chats/{chatId}` | see rules | — | `{ "chat": chat }` |
| 5 | GET | `/api/call-center/chats/{chatId}/messages?limit=40&before=<messageId>` | see rules | `limit` (1–100, default 40), `before` cursor | `{ "messages": [ message ] }` (newest first) |
| 6 | POST | `/api/call-center/chats/{chatId}/messages` | **participants only** | `{ "text": "…" }` | `{ "messageId": "<id>" }` |
| 7 | POST | `/api/call-center/chats/{chatId}/claim` | **agent only** | — | `{ "ok": true, "chatId": "…" }` |
| 8 | POST | `/api/call-center/chats/{chatId}/close` | participant or `call_center_admin` | — | `{ "ok": true }` |
| 9 | POST | `/api/call-center/chats/{chatId}/read` | participants only | — | `{ "updated": 3 }` |
| 10 | PATCH | `/api/call-center/chats/{chatId}/reviewed` | participant, `call_center_admin`, BMS staff of that salon | `{ "chatsReviewed": true \| false }` | `{ "chat": chat }` |

**Rules:**
- **#1 list:** agents get their own threads (`agentUid` = them) plus the pending queue for salons in scope (CC admin or no `assignedWorkshops` = all queues), newest first. BMS staff: super admin without tenant → latest threads across all salons; with tenant → that salon; salon owner / branch admin → their salon. A non-super tenant admin whose scope is "all" must send a tenant (`400`).
- **#2:** same scope and dev bypass as `GET /workshops?summary=1`.
- **#3:** `400 workshopOwnerUid is required` / `Invalid JSON`; `403 You do not have access to this workshop`; `404 Workshop owner not found`; `400 UID is not a salon_owner account`; `403 This workshop account is not active`. Creates or reopens the deterministic thread; the agent must have a non-suspended `call_center_agents` doc without `ccChatDisabled` (`404 Agent not found`, `403 Agent account suspended`, `403 Agent is not available for chat`). An optional `text` is sent as the first message.
- **#4 / #5 read access:** participants; super admins (oversight); agents for **pending** queue rooms of salons they can access; BMS staff for their salon. Otherwise `403 Forbidden`; missing room `404 Chat not found`.
- **#6:** `403 Only the assigned agent or workshop user can post in this thread`; `400 Invalid JSON`; `409` when the salon user writes into a closed session ("This chat has ended…"). A message from the agent reopens a closed session.
- **#7 claim:** only `pending` threads. `409 This chat is already assigned to another agent`; `400 This chat is not in the unclaimed queue`; `403 You do not have access to this workshop's queue`; idempotent for the same agent. The agent becomes a participant and `unreadForAgent` is set.
- **#8 close:** `403 Only a thread participant or call center admin can end this chat`. Writes a system "Chat ended" message, sets `sessionStatus: "closed"`; already closed = no-op.
- **#9 read:** `403 Only a chat participant can mark messages as read`. Marks up to 250 recent inbound messages seen and clears the reader's unread flag.
- **#10:** only literal `true` counts as reviewed; `false` clears `chatsReviewedAt` / `chatsReviewedByUid`. `403 Forbidden` otherwise.

### 12.2 Agent directory
See §6.1 (`GET /api/chats/cc/agents`).

### 12.3 Salon side — `/api/chats/cc/rooms/*`
**Auth:** `verifyAdminAuth` with roles `salon_owner`, `salon_branch_admin`, `salon_staff`. No CORS headers. The user may only act on rooms where they are the `tenantUserUid` of their own salon (`403 Forbidden`).

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/api/chats/cc/rooms?limit=50` | — | `{ "chats": [ chat without workshopUser ] }` (own threads, newest first) |
| POST | `/api/chats/cc/rooms` | `{ "agentUid": "<uid>" }` or `{ "queue": true }` | `{ "chat": chat, "created": true }` |
| GET | `/api/chats/cc/rooms/{chatId}/messages?limit=40&before=` | — | `{ "messages": [ message ] }` |
| POST | `/api/chats/cc/rooms/{chatId}/messages` | `{ "text": "…" }` | `{ "messageId": "<id>" }` |
| POST | `/api/chats/cc/rooms/{chatId}/read` | — | `{ "updated": 2 }` |
| POST | `/api/chats/cc/rooms/{chatId}/close` | — | `{ "ok": true }` |

POST `/rooms`: with no `agentUid` (and `queue` not `false`) a new queue request is created; with `agentUid` the deterministic 1:1 thread is created/reopened. When a **salon owner** opens a 1:1 thread with an agent, a closed support conversation with that agent is reopened and the response also carries `supportConversationId` and `supportConversationReopened`. `400` when neither option is sent.

---

## 13. Support chat — agent side (`/api/support-chat/agent/*`)

**Files:** `app/api/support-chat/agent/*`, logic in `lib/supportChat.ts`. Firestore `conversations/{conversationId}` with a `messages` subcollection. Each salon user has at most one active conversation; after it is closed, their next message starts a new one. Status flow: `waiting` → `connected` → `closed`.

**Auth:** agent routes use `verifyCallCenterAuth` and then load the agent profile (`403 Not a registered call center agent`, `403 Agent account suspended`, `403 Agent chat is disabled`). The two read routes (list, get messages) use `verifyCallCenterAgentOrSuperAdmin`, so a BMS **super admin** token can also read (oversight).

**Errors** are `{ "error": "message" }` with the status carried by the thrown error (default `500`).

### Conversation object (`supportConversationToJson`)
```json
{
  "conversationId": "<id>",
  "userId": "<salon user uid>",
  "userName": "Salon Owner",
  "userEmail": "owner@salon.com",
  "userPhone": null,
  "role": "owner",
  "ownerUid": "<ownerUid>",
  "status": "connected",
  "agentId": "<agent uid>",
  "agentName": "Jane Agent",
  "agentEmail": "jane@callcenter.com",
  "lastMessage": "Hi",
  "lastMessageAt": "2026-11-01T02:00:00.000Z",
  "lastSender": "customer",
  "unreadForAgent": 2,
  "unreadForCustomer": 0,
  "createdAt": "2026-11-01T01:00:00.000Z",
  "updatedAt": "2026-11-01T02:00:00.000Z",
  "claimedAt": "2026-11-01T01:05:00.000Z",
  "closedAt": null,
  "closedBy": null
}
```
`role`: `owner` | `branch_admin` | `staff`. `status`: `waiting` | `connected` | `closed`. `lastSender`: `customer` | `agent` | `system`. `unreadForAgent` / `unreadForCustomer` are **counts**. `closedBy`: `agent` | `system` | `null`.

### Message object
```json
{ "id": "<id>", "sender": "agent", "senderId": "<uid>", "senderName": "Jane Agent", "message": "Hello", "timestamp": "2026-11-01T02:00:00.000Z", "readByAgent": true, "readByCustomer": false }
```

### 13.1 `GET /api/support-chat/agent/conversations`
**Query:** `queueLimit` (default 30), `mineLimit` (default 30), both clamped 1–100.
- `queue` — `status = waiting` in the agent's scope (CC admin, empty `assignedWorkshops`, or a conversation with no `ownerUid` = visible to all).
- `mine` — conversations with `agentId` = this agent (connected and closed history).
- **Super admin:** `queue` = waiting, `mine` = every non-waiting conversation, across all salons.

**Response `200`:** `{ "queue": [ conversation ], "mine": [ conversation ] }`

> **Firestore index required.** The agent query needs a composite index on `conversations` (`status` ASC, `lastMessageAt` DESC). Without it the route returns `500` with `9 FAILED_PRECONDITION: The query requires an index…` (see D.40). As of 2026-10-26 the index is missing in bmspro-pink; create it from the link in that error or in the Firebase console.

### 13.2 `GET /api/support-chat/agent/conversations/{conversationId}/messages`
**Query:** `limit` (default 40, clamped 1–100), `before=<messageId>` (older page). Newest first.
**Access:** waiting conversations → agents in scope; otherwise the assigned agent or a CC admin; super admins always. `404 Conversation not found`, `403 You cannot view this conversation`, `400 Invalid before cursor`.
**Response `200`:** `{ "messages": [ message ], "nextBefore": "<messageId|null>" }`

### 13.3 `POST /api/support-chat/agent/conversations/{conversationId}/messages`
**Body:** `{ "message": "Hello, how can I help?" }` — string, non-empty after trim, max 4000 characters (`400 message must be a string` / `message cannot be empty` / `message exceeds 4000 characters`; `400 Invalid JSON body`).
**Rules:** `404 Conversation not found`; `409 Conversation is closed`; `403 You are not the assigned agent for this conversation`. Pushes the customer.
**Response `200`:** `{ "ok": true, "messageId": "<id>" }`

### 13.4 `POST /api/support-chat/agent/conversations/{conversationId}/claim`
**Body:** none. Atomic: `404`; `409 Conversation is already closed`; `409 Conversation has already been claimed by another agent` (re-claiming your own is fine). Sets `status: "connected"`, agent fields and `claimedAt`, writes the system message "You are connected with <agent>", increments the agent's `activeChatCount` and pushes the customer. No salon-scope check is applied on claim.
**Response `200`:** `{ "ok": true, "conversation": conversation }`

### 13.5 `POST /api/support-chat/agent/conversations/{conversationId}/read`
**Body:** none. Resets `unreadForAgent` to 0 and marks up to 200 customer messages `readByAgent`. `404`; `403 Not your conversation` when assigned to another agent (CC admins allowed).
**Response `200`:** `{ "ok": true }`

### 13.6 `POST /api/support-chat/agent/conversations/{conversationId}/close`
**Body (optional):** `{ "farewellMessage": "Thanks for contacting us!" }` (invalid JSON = `{}`).
**Rules:** `404`; already closed → returned unchanged; assigned to another agent and caller is not a CC admin → `403 You are not the assigned agent for this conversation`. Posts the farewell (default "Thank you for contacting support") and a system "Chat ended" message, sets `status: "closed"`, `closedBy: "agent"`, decrements `activeChatCount`, pushes the customer.
**Response `200`:** `{ "ok": true, "conversation": conversation }`

### 13.7 `POST /api/support-chat/agent/conversations/{conversationId}/transfer`
**Body:** `{ "toAgentUid": "<uid>" }` (`400 toAgentUid is required`, `400 Invalid JSON body`).
**Rules:** caller must be `call_center_admin` (`403 Only call center admins can transfer chats`); target must be a valid agent; `409 Cannot transfer a closed conversation`. Sets the new agent, writes "Chat transferred to <agent>", moves `activeChatCount`.
**Response `200`:** `{ "ok": true, "conversation": conversation }`

### 13.8 `POST /api/support-chat/agent/presence`
**Body:** `{ "online": true | false }` (anything but `true` = offline). Writes `online` and `lastSeenAt` on `call_center_agents/{uid}`.
**Response `200`:** `{ "ok": true, "online": true }`

### 13.9 `POST /api/support-chat/agent/fcm-token`
**Body:** `{ "token": "<fcm token>", "platform": "web" }` (`400 token required`, `400 Invalid JSON body`). Adds the token to `fcmTokens` on the agent doc.
**Response `200`:** `{ "ok": true }`

> The customer side (`/api/support-chat/customer/*`, used by the salon app) is not covered here.

---

## 14. Quick reference — who can call what

| Area | Super admin | Salon owner | Branch admin | Stylist | Agent | CC admin |
|------|:-:|:-:|:-:|:-:|:-:|:-:|
| Register agent / Firebase token (§3) | Supabase super admin / any Supabase user | – | – | – | – | – |
| Agent activities (§4) | ✅ all | ✅ own | ✅ own owner | ❌ | ✅ assigned (or all) | ✅ all |
| Workshops (§5) | ✅ all | ✅ own | ✅ own owner | ❌ | ✅ assigned (or all) | ✅ all |
| Agent directory (§6) | – | ✅ | ✅ | ✅ | ❌ | ❌ |
| Branches, staff, services (§7, §8) | ✅ all | ✅ own | ✅ own owner | ❌ | ✅ assigned (or all); any branch by id | ✅ all |
| Bookings (§9) | ✅ all | ✅ own | ✅ own owner | ❌ | ✅ assigned (or all) | ✅ all |
| Customer notifications list (§10.1) | ✅ all (`all=1`) | ✅ own | ✅ own owner | ❌ | ✅ assigned (or all) | ✅ all |
| Notification tracking (§10.2–10.3) | ✅ | ✅ own | ✅ own owner | ❌ | ✅ any row | ✅ |
| Direct chat, agent side (§12.1) | ✅ read oversight | ✅ own salon | ✅ own owner | ❌ | ✅ participant / claim | ✅ + close any |
| Direct chat, salon side (§12.3) | – | ✅ | ✅ | ✅ | – | – |
| Support chat (§13) | ✅ read only | ❌ | ❌ | ❌ | ✅ | ✅ + transfer |

"Assigned (or all)" = the agent's `assignedWorkshops`; an empty list means every salon (§2.3).

---

## 15. Differences from BMS Black

| Black | Pink |
|-------|------|
| `/agents`, `/auth`, `/auth/login` (agent CRUD + login) | Not present. Agents are created through the Command Center; Pink has `/supabase/register-agent` and `/supabase/firebase-token`. |
| `/agent-activities/{id}/recording` | Not present. |
| `/public/*`, `/did-lookup`, `/workshops/{ownerUid}`, `/customers/*`, `/services/checklists`, `/call-logs`, `/webhooks` | Not present. |
| `bookings/{id}/additional-issues*` (extra work) | Not present — salon bookings have no additional issues. |
| Vehicle types, vehicle pricing, checklists, tasks | Not used. Services have a single `price` / `duration`. |
| Roles `workshop_owner`, `branch_admin`, `staff` | `salon_owner`, `salon_branch_admin`, `salon_staff`. |
| Booking create: only the daily limit restricts; `clientEmail` required | Full stylist/leave/capacity slot checks and opening hours; `clientEmail` optional, `clientPhone` required; code `BK-…`. |
| Availability: daily limit only, 30-min slots | Real per-slot checks, `interval` param, `blockedSlots: [{ time, reason }]`. |
| `PATCH /bookings/{id}` returns 405 in production | Implemented — same handler as confirm / cancel / complete. |
| Reschedule sends a customer email | Customer in-app notification only. |
| `customer_notifications` collection, many extra ops types | Customer-facing `notifications` rows (4 booking types). |
| Support chat status `active` | `connected`; unread fields are counts; extra `transfer`, `presence`, `fcm-token` routes. |

---

# Part C — Command Center proxy routes (`/api/bms-pink/*`)

These live in **command-center-backend** (`src/routes/bms_pink/*`, `src/services/bms_pink/*`), mounted under `/api/bms-pink`.

**How a request flows:**
1. The frontend sends `Authorization: Bearer <Supabase access_token>` from Command Center `POST /api/auth/login` (`attachSupabaseUser`).
2. The backend looks up the **Firebase Pink idToken** it stored at login for that Supabase user (`FIREBASE_PINK_WEB_API_KEY` must be set; tokens auto-refresh for up to the stored-session window). None → `403 No stored Firebase Pink idToken for this user…`.
3. It calls `{PINK_API_BASE_URL}` (default `https://pink.bmspros.com.au`) with that Firebase token and, when relevant, `X-Tenant-Id`, and passes the Pink response through unchanged (status + JSON body).

**Proxy-specific responses:**
- `401 { "error": "Missing Supabase session." }`
- `400 { "error": "Missing X-Tenant-Id header (salon owner uid for BMS Pink call-center scope)." }` on routes marked **tenant** below.
- `400 { "error": "Missing <booking id|branch id|…>." }` for empty path params.
- `502 { "success": false, "error": "<network error>" }` when Pink cannot be reached.
- A non-JSON error from Pink becomes:
  ```json
  { "ok": false, "error": "Upstream BMS Pink returned 404 Not Found", "upstreamStatus": 404, "hint": "Route not found on BMS Pink…", "upstreamBody": "(HTML error page from BMS Pink — endpoint likely missing on that host)" }
  ```

## C.1 Route → upstream mapping

Request and response bodies are exactly those of the Pink section listed.

### Bookings (`booking.routes.ts`)
| Proxy route | Tenant | Upstream (Pink) | § |
|-------------|:-:|-----------------|---|
| `GET /getallbooking?status=&date=&branchId=&customerUid=&limit=&all=` | optional | `GET /api/call-center/bookings` | 9.1 |
| `GET /bookings/availability?branchId=&date=&serviceIds=&staffId=&interval=` | **yes** | `GET /api/call-center/bookings/availability` (`branchId`, `date` required by the proxy) | 9.3 |
| `GET /bookings/by-phone?phone=&ownerUid=` | – | **No upstream** — reads Pink Firestore `bookings` directly (Admin SDK, `FIREBASE_PINK_SERVICE_ACCOUNT`) | below |
| `GET /staff?branchId=&role=&status=` | **yes** | `GET /api/call-center/staff` | 8.1 |
| `POST /bookings` | **yes** | `POST /api/call-center/bookings` | 9.2 |
| `GET /bookings/:bookingId` | **yes** | `GET /api/call-center/bookings/{id}` | 9.4 |
| `PATCH`, `PUT /bookings/:bookingId` | **yes** | `PATCH /api/call-center/bookings/{id}` | 9.8 |
| `POST /bookings/:bookingId/confirm` | **yes** | `POST …/confirm` | 9.5 |
| `POST /bookings/:bookingId/cancel` | **yes** | `POST …/cancel` | 9.6 |
| `POST /bookings/:bookingId/complete` | **yes** | `POST …/complete` | 9.7 |
| `PATCH /bookings/:bookingId/reschedule` | **yes** | `PATCH …/reschedule` | 9.9 |

**`GET /bookings/by-phone`** — `400 Missing required query parameter phone.` Matches phone variants (digits, `+`, local/international forms, max 30) with `in` queries on `clientPhone`, `customerPhone`, `phone`, `contactNumber`; optional `ownerUid` filtered in memory; newest `date` first, max 200. Timestamps become ISO strings.
```json
{ "bookings": [ { "id": "<bookingId>", "ownerUid": "…", "client": "Sarah Mendis", "clientPhone": "+61400111222", "date": "2026-11-03", "time": "09:30", "status": "Confirmed", "services": [ ], "createdAt": "2026-11-01T02:00:00.000Z" } ] }
```
(Raw Firestore booking fields plus `id`.) Errors: `500 { "error": "Firebase Pink (bmspro-pink) Admin SDK is not available…" }`.

### Branches and services (`catalog.routes.ts`)
| Proxy route | Tenant | Upstream (Pink) | § |
|-------------|:-:|-----------------|---|
| `GET /branches?ownerUid=&date=` | **yes** | `GET /api/call-center/branches` (`ownerUid` defaults to `X-Tenant-Id`) | 7.1 |
| `GET /branches/:branchId?date=` | **yes** | `GET /api/call-center/branches/{branchId}` | 7.2 |
| `GET /services?branchId=` | **yes** | `GET /api/call-center/services` | 8.2 |
| `GET /services-by-branch?branchId=` | **yes** | `GET /api/call-center/services?branchId=` (`branchId` required by the proxy) | 8.2 |
| `GET /services/:serviceId/staff?branchId=&date=` | **yes** | `GET /api/call-center/services/{serviceId}/staff` | 8.4 |
| `GET /services/:id` | **yes** | `GET /api/call-center/services/{serviceId}` | 8.3 |

### Customer notifications and agent activity (`activity.routes.ts`)
| Proxy route | Tenant | Upstream (Pink) | § |
|-------------|:-:|-----------------|---|
| `GET /customer-notifications?all=&ownerUid=&unreadOnly=&limit=&sinceDays=` | optional | `GET /api/call-center/customer-notifications` | 10.1 |
| `POST /customer-notifications/:notificationId/notification-reviewed` | – | `POST …/notification-reviewed` | 10.3 |
| `POST /customer-notifications/:notificationId/called-customer` | – | `POST …/called-customer` | 10.2 |
| `POST /agent-activities` | optional | `POST /api/call-center/agent-activities` (JSON only) | 4.1 |
| `GET /agent-activities?ownerId=&agentUserId=&agentEmail=&branchId=&callId=&limit=` | – | `GET /api/call-center/agent-activities` | 4.2 |

### Chat (`chat.routes.ts`)
**Support chat** (`agent/conversations/*` → `/api/support-chat/agent/conversations/*`, §13):

| Proxy route | Upstream | § |
|-------------|----------|---|
| `GET /agent/conversations?queueLimit=&mineLimit=` | `GET /api/support-chat/agent/conversations` | 13.1 |
| `GET /agent/conversations/:conversationId/messages?limit=&before=` | `GET …/messages` | 13.2 |
| `POST /agent/conversations/:conversationId/messages` | `POST …/messages` | 13.3 |
| `POST /agent/conversations/:conversationId/claim` | `POST …/claim` | 13.4 |
| `POST /agent/conversations/:conversationId/read` | `POST …/read` | 13.5 |
| `POST /agent/conversations/:conversationId/close` | `POST …/close` | 13.6 |

**Direct chat** (`chats/*` → `/api/call-center/chats/*`, §12.1; `X-Tenant-Id` optional and forwarded):

| Proxy route | Upstream | § |
|-------------|----------|---|
| `GET /chats?limit=&ownerUid=&tenantId=` | `GET /api/call-center/chats` | 12.1 #1 |
| `GET /chats/workshop-owners` | `GET /api/call-center/chats/workshop-owners` | 12.1 #2 |
| `POST /chats/start-with-owner` | `POST /api/call-center/chats/start-with-owner` (proxy requires `workshopOwnerUid`) | 12.1 #3 |
| `GET /chats/:chatId/messages?limit=&before=` | `GET …/messages` | 12.1 #5 |
| `POST /chats/:chatId/messages` | `POST …/messages` | 12.1 #6 |
| `POST /chats/:chatId/close` | `POST …/close` | 12.1 #8 |

Pink routes **not** exposed through the proxy: `/supabase/*`, `/workshops`, `GET /chats/{chatId}`, `/chats/{chatId}/claim|read|reviewed`, support-chat `transfer` / `presence` / `fcm-token`, and all salon-side `/api/chats/cc/*` routes.

**Total:** 35 proxy method/path pairs: 12 bookings (including the `PUT` alias), 6 catalogue, 5 notifications/activity, 6 support chat, 6 direct chat.

---

# Part D — Tested request / response examples

Captured on 2026-10-26 by calling the **Command Center backend** (`http://127.0.0.1:5050`, `PINK_API_BASE_URL=http://127.0.0.1:3000`) as agent **jay@gmail.com** (Firebase Pink uid `CUyzZara2fh575s7jCYbsLtmJpN2`, assigned to the test salon), against Firestore **bmspro-pink**.

| Test data | Value |
|-----------|-------|
| Salon owner (`X-Tenant-Id`) | `oRZW7kSnYpZixEiYeUjfZx9vsl33` — testsri@gmail.com, "beauty spa" |
| Branch | `wSaW3NH7TZMShk7Kjrjx` — kandy |
| Service | `FEY5qd9k3UxccZLxSGkN` — testsky (15 min, 123) |
| Stylist | `S0Sh7tVxpShpCD63tluPTbr81rA2` — srijith yaparathne |
| Booking date | `2026-10-28` (Wednesday) |

Every call sends `Authorization: Bearer <Supabase access_token from POST /api/auth/login>`. Calls marked **tenant** also send `X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33`. Long arrays are trimmed to 2 items; lists that span all salons are filtered to the test salon's rows.

### D.1 Login (Command Center) — `200`

```http
POST /api/auth/login
```
Request body:
```json
{
  "email": "jay@gmail.com",
  "password": "******"
}
```
Response `200`:
```json
{
  "access_token": "<supabase access token>",
  "roles": [
    "agent"
  ],
  "firebasePinkIdentityToolkit": {
    "ok": true,
    "stored": true,
    "localId": "CUyzZara2fh575s7jCYbsLtmJpN2",
    "email": "jay@gmail.com",
    "displayName": "Niranga Jay",
    "registered": true,
    "sessionValidUntil": 1793029065,
    "sessionValidHours": 4
  }
}
```

### D.2 Branches list — `200`

```http
GET /api/bms-pink/branches
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
  "total": 1,
  "branches": [
    {
      "id": "wSaW3NH7TZMShk7Kjrjx",
      "name": "kandy",
      "address": "8P7H+GCG, Wepathana - Gomagoda Rd, Digana, Sri Lanka",
      "phone": "771234567",
      "email": "",
      "timezone": "Australia/Sydney",
      "status": "Active",
      "hours": {
        "Monday": {
          "open": "09:00",
          "close": "17:00",
          "closed": false
        },
        "Tuesday": {
          "open": "09:00",
          "close": "17:00",
          "closed": false
        },
        "Wednesday": {
          "open": "09:00",
          "close": "17:00",
          "closed": false
        },
        "Thursday": {
          "open": "09:00",
          "close": "17:00",
          "closed": false
        },
        "Friday": {
          "open": "09:00",
          "close": "17:00",
          "closed": false
        },
        "Saturday": {
          "open": "10:00",
          "close": "16:00",
          "closed": false
        },
        "Sunday": {
          "open": "10:00",
          "close": "16:00",
          "closed": true
        }
      },
      "daySchedules": {
        "Sunday": {
          "dayOfWeek": "Sunday",
          "closed": true,
          "open": null,
          "close": null
        },
        "Monday": {
          "dayOfWeek": "Monday",
          "closed": false,
          "open": "09:00",
          "close": "17:00"
        },
        "Tuesday": {
          "dayOfWeek": "Tuesday",
          "closed": false,
          "open": "09:00",
          "close": "17:00"
        },
        "Wednesday": {
          "dayOfWeek": "Wednesday",
          "closed": false,
          "open": "09:00",
          "close": "17:00"
        },
        "Thursday": {
          "dayOfWeek": "Thursday",
          "closed": false,
          "open": "09:00",
          "close": "17:00"
        },
        "Friday": {
          "dayOfWeek": "Friday",
          "closed": false,
          "open": "09:00",
          "close": "17:00"
        },
        "Saturday": {
          "dayOfWeek": "Saturday",
          "closed": false,
          "open": "10:00",
          "close": "16:00"
        }
      },
      "daySchedule": null,
      "bookingLimitPerDay": null
    }
  ]
}
```

### D.3 Branch by id — `200`

```http
GET /api/bms-pink/branches/wSaW3NH7TZMShk7Kjrjx?date=2026-10-28
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "branch": {
    "id": "wSaW3NH7TZMShk7Kjrjx",
    "name": "kandy",
    "address": "8P7H+GCG, Wepathana - Gomagoda Rd, Digana, Sri Lanka",
    "phone": "771234567",
    "email": "",
    "timezone": "Australia/Sydney",
    "status": "Active",
    "hours": {
      "Monday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Tuesday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Wednesday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Thursday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Friday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Saturday": {
        "open": "10:00",
        "close": "16:00",
        "closed": false
      },
      "Sunday": {
        "open": "10:00",
        "close": "16:00",
        "closed": true
      }
    },
    "daySchedules": {
      "Sunday": {
        "dayOfWeek": "Sunday",
        "closed": true,
        "open": null,
        "close": null
      },
      "Monday": {
        "dayOfWeek": "Monday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Tuesday": {
        "dayOfWeek": "Tuesday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Wednesday": {
        "dayOfWeek": "Wednesday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Thursday": {
        "dayOfWeek": "Thursday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Friday": {
        "dayOfWeek": "Friday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Saturday": {
        "dayOfWeek": "Saturday",
        "closed": false,
        "open": "10:00",
        "close": "16:00"
      }
    },
    "daySchedule": {
      "dayOfWeek": "Wednesday",
      "closed": false,
      "open": "09:00",
      "close": "17:00"
    },
    "bookingLimitPerDay": null
  }
}
```

### D.4 Services — `200`

```http
GET /api/bms-pink/services
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "description": "",
      "price": 123,
      "duration": 15,
      "icon": "",
      "imageUrl": "https://firebasestorage.googleapis.com/v0/b/bmspro-pink.firebasestorage.app/o/services%2FoRZW7kSnYpZixEiYeUjfZx9vsl33%2F1793000810155_logo.jpeg?alt=media&token=29d6661e-6937-4238-b85b-f6485b5d53d9",
      "branches": [
        "wSaW3NH7TZMShk7Kjrjx"
      ],
      "staff": []
    }
  ],
  "total": 1
}
```

### D.5 Services by branch — `200`

```http
GET /api/bms-pink/services-by-branch?branchId=wSaW3NH7TZMShk7Kjrjx
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "description": "",
      "price": 123,
      "duration": 15,
      "icon": "",
      "imageUrl": "https://firebasestorage.googleapis.com/v0/b/bmspro-pink.firebasestorage.app/o/services%2FoRZW7kSnYpZixEiYeUjfZx9vsl33%2F1793000810155_logo.jpeg?alt=media&token=29d6661e-6937-4238-b85b-f6485b5d53d9",
      "branches": [
        "wSaW3NH7TZMShk7Kjrjx"
      ],
      "staff": []
    }
  ],
  "total": 1
}
```

### D.6 Service by id — `200`

```http
GET /api/bms-pink/services/FEY5qd9k3UxccZLxSGkN
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "service": {
    "id": "FEY5qd9k3UxccZLxSGkN",
    "name": "testsky",
    "description": "",
    "price": 123,
    "duration": 15,
    "icon": "",
    "imageUrl": "https://firebasestorage.googleapis.com/v0/b/bmspro-pink.firebasestorage.app/o/services%2FoRZW7kSnYpZixEiYeUjfZx9vsl33%2F1793000810155_logo.jpeg?alt=media&token=29d6661e-6937-4238-b85b-f6485b5d53d9",
    "branches": [
      {
        "id": "wSaW3NH7TZMShk7Kjrjx",
        "name": "kandy"
      }
    ],
    "staff": []
  }
}
```

### D.7 Service staff — `200`

```http
GET /api/bms-pink/services/FEY5qd9k3UxccZLxSGkN/staff?branchId=wSaW3NH7TZMShk7Kjrjx&date=2026-10-28
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "service": {
    "id": "FEY5qd9k3UxccZLxSGkN",
    "name": "testsky",
    "hasStaffAllowList": false,
    "staffIds": [],
    "price": 123,
    "duration": 15
  },
  "filter": {
    "branchId": "wSaW3NH7TZMShk7Kjrjx",
    "branchName": "kandy",
    "date": "2026-10-28",
    "dayName": "Wednesday"
  },
  "staff": [
    {
      "id": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "uid": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "name": "srijith yaparathne",
      "email": "testsristaff@gmail.com",
      "role": "salon_staff",
      "staffRole": "test",
      "branchId": null,
      "branchName": null,
      "status": "Active",
      "avatar": "srijith yaparathne",
      "inServiceAllowList": true
    }
  ],
  "total": 1
}
```

### D.8 Staff — `200`

```http
GET /api/bms-pink/staff?branchId=wSaW3NH7TZMShk7Kjrjx
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "staff": [
    {
      "id": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "uid": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "name": "srijith yaparathne",
      "email": "testsristaff@gmail.com",
      "mobile": "+94771234567",
      "role": "salon_staff",
      "staffRole": "test",
      "branchId": "",
      "branchName": "",
      "status": "Active",
      "avatar": "srijith yaparathne",
      "timezone": null,
      "weeklySchedule": {
        "Monday": {
          "branchId": "wSaW3NH7TZMShk7Kjrjx",
          "branchName": "kandy"
        },
        "Tuesday": {
          "branchId": "wSaW3NH7TZMShk7Kjrjx",
          "branchName": "kandy"
        },
        "Wednesday": {
          "branchId": "wSaW3NH7TZMShk7Kjrjx",
          "branchName": "kandy"
        },
        "Thursday": {
          "branchId": "wSaW3NH7TZMShk7Kjrjx",
          "branchName": "kandy"
        },
        "Friday": {
          "branchId": "wSaW3NH7TZMShk7Kjrjx",
          "branchName": "kandy"
        }
      },
      "training": {
        "ohs": false,
        "prod": false,
        "tool": false
      },
      "createdAt": {
        "_seconds": 1793000898,
        "_nanoseconds": 35000000
      },
      "updatedAt": {
        "_seconds": 1793000898,
        "_nanoseconds": 35000000
      }
    }
  ],
  "total": 1
}
```

### D.9 Availability — `200`

```http
GET /api/bms-pink/bookings/availability?branchId=wSaW3NH7TZMShk7Kjrjx&date=2026-10-28&serviceIds=FEY5qd9k3UxccZLxSGkN
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "dayOfWeek": "Wednesday",
  "branch": {
    "id": "wSaW3NH7TZMShk7Kjrjx",
    "name": "kandy",
    "address": "8P7H+GCG, Wepathana - Gomagoda Rd, Digana, Sri Lanka",
    "phone": "771234567",
    "email": "",
    "timezone": "Australia/Sydney",
    "status": "Active",
    "hours": {
      "Monday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Tuesday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Wednesday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Thursday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Friday": {
        "open": "09:00",
        "close": "17:00",
        "closed": false
      },
      "Saturday": {
        "open": "10:00",
        "close": "16:00",
        "closed": false
      },
      "Sunday": {
        "open": "10:00",
        "close": "16:00",
        "closed": true
      }
    },
    "daySchedules": {
      "Sunday": {
        "dayOfWeek": "Sunday",
        "closed": true,
        "open": null,
        "close": null
      },
      "Monday": {
        "dayOfWeek": "Monday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Tuesday": {
        "dayOfWeek": "Tuesday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Wednesday": {
        "dayOfWeek": "Wednesday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Thursday": {
        "dayOfWeek": "Thursday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Friday": {
        "dayOfWeek": "Friday",
        "closed": false,
        "open": "09:00",
        "close": "17:00"
      },
      "Saturday": {
        "dayOfWeek": "Saturday",
        "closed": false,
        "open": "10:00",
        "close": "16:00"
      }
    },
    "daySchedule": {
      "dayOfWeek": "Wednesday",
      "closed": false,
      "open": "09:00",
      "close": "17:00"
    },
    "bookingLimitPerDay": null
  },
  "branchHours": {
    "open": "09:00",
    "close": "17:00"
  },
  "interval": 30,
  "available": true,
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "duration": 15
    }
  ],
  "totalDuration": 15,
  "staffId": null,
  "allSlots": [
    "09:00",
    "09:30",
    "… 14 more"
  ],
  "availableSlots": [
    "09:00",
    "09:30",
    "… 14 more"
  ],
  "blockedSlots": [],
  "dailyLimitReached": false,
  "dailyLimit": null,
  "currentBookings": 0,
  "remainingBookings": null
}
```

### D.10 Create booking (specific stylist) — `201`

```http
POST /api/bms-pink/bookings
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "branchId": "wSaW3NH7TZMShk7Kjrjx",
  "date": "2026-10-28",
  "time": "10:00",
  "client": "Call Center Test A",
  "clientPhone": "+61400000001",
  "notes": "API test - specific stylist",
  "services": [
    {
      "serviceId": "FEY5qd9k3UxccZLxSGkN",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2"
    }
  ]
}
```
Response `201`:
```json
{
  "success": true,
  "bookingId": "TZOfX1n38VpqBWaEe8F7",
  "bookingCode": "BK-2026-102617-7878",
  "status": "AwaitingStaffApproval",
  "totalPrice": 123,
  "totalDuration": 15,
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "price": 123,
      "duration": 15,
      "time": "10:00",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "approvalStatus": "pending",
      "completionStatus": "pending"
    }
  ]
}
```

### D.11 Create booking - clash (409) — `409`

```http
POST /api/bms-pink/bookings
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "branchId": "wSaW3NH7TZMShk7Kjrjx",
  "date": "2026-10-28",
  "time": "10:00",
  "client": "Call Center Test Clash",
  "clientPhone": "+61400000009",
  "services": [
    {
      "serviceId": "FEY5qd9k3UxccZLxSGkN",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2"
    }
  ]
}
```
Response `409`:
```json
{
  "error": "Time slot already booked",
  "details": "The selected time 10:00 conflicts with an existing booking. Please choose a different time.",
  "service": "testsky",
  "time": "10:00"
}
```

### D.12 Create booking (any staff) — `201`

```http
POST /api/bms-pink/bookings
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "branchId": "wSaW3NH7TZMShk7Kjrjx",
  "date": "2026-10-28",
  "time": "11:00",
  "client": "Call Center Test B",
  "clientPhone": "+61400000002",
  "notes": "API test - any staff",
  "services": [
    {
      "serviceId": "FEY5qd9k3UxccZLxSGkN"
    }
  ]
}
```
Response `201`:
```json
{
  "success": true,
  "bookingId": "qFMAVdBLOrOBQ3jtUPsw",
  "bookingCode": "BK-2026-102617-8405",
  "status": "Pending",
  "totalPrice": 123,
  "totalDuration": 15,
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "price": 123,
      "duration": 15,
      "time": "11:00",
      "staffId": null,
      "staffName": "Any Available",
      "approvalStatus": "needs_assignment",
      "completionStatus": "pending"
    }
  ]
}
```

### D.13 Create booking - validation (400) — `400`

```http
POST /api/bms-pink/bookings
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "branchId": "wSaW3NH7TZMShk7Kjrjx",
  "date": "2026-10-28",
  "time": "11:00",
  "client": "X",
  "services": []
}
```
Response `400`:
```json
{
  "error": "clientPhone is required (at least 6 digits)",
  "field": "clientPhone"
}
```

### D.14 All bookings (no tenant) — `200`

```http
GET /api/bms-pink/getallbooking?limit=5
```
Response `200`:
```json
{
  "bookings": [
    {
      "id": "qFMAVdBLOrOBQ3jtUPsw",
      "bookingCode": "BK-2026-102617-8405",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "status": "Pending",
      "date": "2026-10-28",
      "time": "11:00",
      "duration": 15,
      "clientName": "Call Center Test B",
      "clientEmail": "",
      "clientPhone": "+61400000002",
      "customerUid": null,
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "11:00",
          "staffId": null,
          "staffName": "Any Available",
          "approvalStatus": "needs_assignment",
          "completionStatus": "pending"
        }
      ],
      "staffId": null,
      "staffName": "Any Available",
      "totalPrice": 123,
      "notes": "API test - any staff",
      "source": "Call Center",
      "createdAt": "2026-10-26T11:38:07.551Z",
      "updatedAt": "2026-10-26T11:38:07.551Z"
    },
    {
      "id": "TZOfX1n38VpqBWaEe8F7",
      "bookingCode": "BK-2026-102617-7878",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "status": "AwaitingStaffApproval",
      "date": "2026-10-28",
      "time": "10:00",
      "duration": 15,
      "clientName": "Call Center Test A",
      "clientEmail": "",
      "clientPhone": "+61400000001",
      "customerUid": null,
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "10:00",
          "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
          "staffName": "srijith yaparathne",
          "approvalStatus": "pending",
          "completionStatus": "pending"
        }
      ],
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "totalPrice": 123,
      "notes": "API test - specific stylist",
      "source": "Call Center",
      "createdAt": "2026-10-26T11:38:01.861Z",
      "updatedAt": "2026-10-26T11:38:01.861Z"
    },
    "… 3 more"
  ],
  "total": 5
}
```

### D.15 Bookings for salon by date — `200`

```http
GET /api/bms-pink/getallbooking?date=2026-10-28
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "bookings": [
    {
      "id": "qFMAVdBLOrOBQ3jtUPsw",
      "bookingCode": "BK-2026-102617-8405",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "status": "Pending",
      "date": "2026-10-28",
      "time": "11:00",
      "duration": 15,
      "clientName": "Call Center Test B",
      "clientEmail": "",
      "clientPhone": "+61400000002",
      "customerUid": null,
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "11:00",
          "staffId": null,
          "staffName": "Any Available",
          "approvalStatus": "needs_assignment",
          "completionStatus": "pending"
        }
      ],
      "staffId": null,
      "staffName": "Any Available",
      "totalPrice": 123,
      "notes": "API test - any staff",
      "source": "Call Center",
      "createdAt": "2026-10-26T11:38:07.551Z",
      "updatedAt": "2026-10-26T11:38:07.551Z"
    },
    {
      "id": "TZOfX1n38VpqBWaEe8F7",
      "bookingCode": "BK-2026-102617-7878",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "status": "AwaitingStaffApproval",
      "date": "2026-10-28",
      "time": "10:00",
      "duration": 15,
      "clientName": "Call Center Test A",
      "clientEmail": "",
      "clientPhone": "+61400000001",
      "customerUid": null,
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "10:00",
          "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
          "staffName": "srijith yaparathne",
          "approvalStatus": "pending",
          "completionStatus": "pending"
        }
      ],
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "totalPrice": 123,
      "notes": "API test - specific stylist",
      "source": "Call Center",
      "createdAt": "2026-10-26T11:38:01.861Z",
      "updatedAt": "2026-10-26T11:38:01.861Z"
    },
    "… 2 more"
  ],
  "total": 4
}
```

### D.16 Booking by id — `200`

```http
GET /api/bms-pink/bookings/TZOfX1n38VpqBWaEe8F7
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "booking": {
    "id": "TZOfX1n38VpqBWaEe8F7",
    "bookingCode": "BK-2026-102617-7878",
    "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "status": "AwaitingStaffApproval",
    "date": "2026-10-28",
    "time": "10:00",
    "duration": 15,
    "clientName": "Call Center Test A",
    "clientEmail": "",
    "clientPhone": "+61400000001",
    "customerUid": null,
    "branchId": "wSaW3NH7TZMShk7Kjrjx",
    "branchName": "kandy",
    "services": [
      {
        "id": "FEY5qd9k3UxccZLxSGkN",
        "name": "testsky",
        "price": 123,
        "duration": 15,
        "time": "10:00",
        "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
        "staffName": "srijith yaparathne",
        "approvalStatus": "pending",
        "completionStatus": "pending"
      }
    ],
    "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
    "staffName": "srijith yaparathne",
    "totalPrice": 123,
    "notes": "API test - specific stylist",
    "source": "Call Center",
    "createdAt": "2026-10-26T11:38:01.861Z",
    "updatedAt": "2026-10-26T11:38:01.861Z"
  },
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "price": 123,
      "duration": 15,
      "time": "10:00",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "approvalStatus": "pending",
      "completionStatus": "pending"
    }
  ],
  "progress": {
    "services": {
      "completed": 0,
      "total": 1,
      "percentage": 0
    }
  },
  "activities": [
    {
      "id": "YZgHzV6xBptK1O8iziXL",
      "activityType": "booking_created",
      "previousStatus": null,
      "newStatus": "AwaitingStaffApproval",
      "staffName": "srijith yaparathne",
      "performedByName": "Niranga Jay",
      "performedByRole": "agent",
      "source": "call_center",
      "createdAt": "2026-10-26T11:38:02.193Z"
    }
  ]
}
```

### D.17 Booking by bookingCode — `200`

```http
GET /api/bms-pink/bookings/BK-2026-102617-7878
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "booking": {
    "id": "TZOfX1n38VpqBWaEe8F7",
    "bookingCode": "BK-2026-102617-7878",
    "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "status": "AwaitingStaffApproval",
    "date": "2026-10-28",
    "time": "10:00",
    "duration": 15,
    "clientName": "Call Center Test A",
    "clientEmail": "",
    "clientPhone": "+61400000001",
    "customerUid": null,
    "branchId": "wSaW3NH7TZMShk7Kjrjx",
    "branchName": "kandy",
    "services": [
      {
        "id": "FEY5qd9k3UxccZLxSGkN",
        "name": "testsky",
        "price": 123,
        "duration": 15,
        "time": "10:00",
        "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
        "staffName": "srijith yaparathne",
        "approvalStatus": "pending",
        "completionStatus": "pending"
      }
    ],
    "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
    "staffName": "srijith yaparathne",
    "totalPrice": 123,
    "notes": "API test - specific stylist",
    "source": "Call Center",
    "createdAt": "2026-10-26T11:38:01.861Z",
    "updatedAt": "2026-10-26T11:38:01.861Z"
  },
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "price": 123,
      "duration": 15,
      "time": "10:00",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "approvalStatus": "pending",
      "completionStatus": "pending"
    }
  ],
  "progress": {
    "services": {
      "completed": 0,
      "total": 1,
      "percentage": 0
    }
  },
  "activities": [
    {
      "id": "YZgHzV6xBptK1O8iziXL",
      "activityType": "booking_created",
      "previousStatus": null,
      "newStatus": "AwaitingStaffApproval",
      "staffName": "srijith yaparathne",
      "performedByName": "Niranga Jay",
      "performedByRole": "agent",
      "source": "call_center",
      "createdAt": "2026-10-26T11:38:02.193Z"
    }
  ]
}
```

### D.18 Bookings by phone — `200`

```http
GET /api/bms-pink/bookings/by-phone?phone=%2B61400000001&ownerUid=oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "bookings": [
    {
      "id": "TZOfX1n38VpqBWaEe8F7",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "client": "Call Center Test A",
      "clientEmail": null,
      "clientPhone": "+61400000001",
      "customerUid": null,
      "notes": "API test - specific stylist",
      "serviceId": "FEY5qd9k3UxccZLxSGkN",
      "serviceName": "testsky",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "branchTimezone": "Australia/Sydney",
      "date": "2026-10-28",
      "time": "10:00",
      "dateTimeUtc": "2026-10-27T23:00:00.000Z",
      "duration": 15,
      "price": 123,
      "status": "AwaitingStaffApproval",
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "10:00",
          "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
          "staffName": "srijith yaparathne",
          "approvalStatus": "pending",
          "completionStatus": "pending"
        }
      ],
      "bookingSource": "Call Center",
      "source": "call_center",
      "bookingCode": "BK-2026-102617-7878",
      "createdBy": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "createdByName": "Niranga Jay",
      "createdByRole": "agent",
      "createdAt": "2026-10-26T11:38:01.861Z",
      "updatedAt": "2026-10-26T11:38:01.861Z"
    },
    {
      "id": "lAeIBICB9Vdxctp64MsV",
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "client": "Call Center Test A",
      "clientEmail": null,
      "clientPhone": "+61400000001",
      "customerUid": null,
      "notes": "API test - specific stylist",
      "serviceId": "FEY5qd9k3UxccZLxSGkN",
      "serviceName": "testsky",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "branchTimezone": "Australia/Sydney",
      "date": "2026-10-28",
      "duration": 15,
      "price": 123,
      "bookingSource": "Call Center",
      "source": "call_center",
      "bookingCode": "BK-2026-102617-7329",
      "createdBy": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "createdByName": "Niranga Jay",
      "createdByRole": "agent",
      "createdAt": "2026-10-26T11:35:32.531Z",
      "confirmedByName": "Niranga Jay",
      "confirmedVia": "call_center",
      "confirmedBy": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "confirmedAt": "2026-10-26T11:36:02.019Z",
      "confirmedByRole": "agent",
      "rescheduledAt": "2026-10-26T11:36:14.105Z",
      "dateTimeUtc": "2026-10-28T01:00:00.000Z",
      "rescheduledVia": "call_center",
      "rescheduleHistory": [
        {
          "from": {
            "date": "2026-10-28",
            "time": "10:00"
          },
          "to": {
            "date": "2026-10-28",
            "time": "12:00"
          },
          "reason": "Customer asked for a later time",
          "by": "CUyzZara2fh575s7jCYbsLtmJpN2",
          "byName": "Niranga Jay",
          "at": "2026-10-26T11:36:13.784Z"
        }
      ],
      "services": [
        {
          "id": "FEY5qd9k3UxccZLxSGkN",
          "name": "testsky",
          "price": 123,
          "duration": 15,
          "time": "12:00",
          "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
          "staffName": "srijith yaparathne",
          "approvalStatus": "accepted",
          "completionStatus": "pending"
        }
      ],
      "time": "12:00",
      "rescheduledBy": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "rescheduledByName": "Niranga Jay",
      "completedAt": "2026-10-26T11:36:19.881Z",
      "completedVia": "call_center",
      "completedByRole": "agent",
      "completedByName": "Niranga Jay",
      "completedBy": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "status": "Completed",
      "updatedAt": "2026-10-26T11:36:19.881Z"
    }
  ]
}
```

### D.19 Confirm booking — `200`

```http
POST /api/bms-pink/bookings/TZOfX1n38VpqBWaEe8F7/confirm
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{}
```
Response `200`:
```json
{
  "success": true,
  "bookingId": "TZOfX1n38VpqBWaEe8F7",
  "bookingCode": "BK-2026-102617-7878",
  "previousStatus": "AwaitingStaffApproval",
  "status": "Confirmed",
  "action": "confirm"
}
```

### D.20 Confirm again (409) — `409`

```http
POST /api/bms-pink/bookings/TZOfX1n38VpqBWaEe8F7/confirm
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{}
```
Response `409`:
```json
{
  "error": "Booking is already Confirmed",
  "currentStatus": "Confirmed"
}
```

### D.21 Confirm without stylist (400) — `400`

```http
POST /api/bms-pink/bookings/qFMAVdBLOrOBQ3jtUPsw/confirm
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{}
```
Response `400`:
```json
{
  "error": "Staff must be assigned to every service before confirming. Pass `staffAssignments` in the body, or set `skipStaffValidation: true` to override.",
  "missingStaffForServices": [
    "testsky"
  ],
  "hint": "Body shape: { \"staffAssignments\": { \"<serviceId>\": { \"staffId\": \"X\", \"staffName\": \"Y\" } } } — or for a single-service booking { \"staffId\": \"X\", \"staffName\": \"Y\" }."
}
```

### D.22 Reschedule booking — `200`

```http
PATCH /api/bms-pink/bookings/TZOfX1n38VpqBWaEe8F7/reschedule
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "newDate": "2026-10-28",
  "newTime": "12:00",
  "reason": "Customer asked for a later time"
}
```
Response `200`:
```json
{
  "ok": true,
  "bookingId": "TZOfX1n38VpqBWaEe8F7",
  "bookingCode": "BK-2026-102617-7878",
  "date": "2026-10-28",
  "time": "12:00",
  "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
  "staffName": "srijith yaparathne",
  "services": [
    {
      "id": "FEY5qd9k3UxccZLxSGkN",
      "name": "testsky",
      "price": 123,
      "duration": 15,
      "time": "12:00",
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne",
      "approvalStatus": "accepted",
      "completionStatus": "pending"
    }
  ],
  "previous": {
    "date": "2026-10-28",
    "time": "10:00",
    "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
    "staffName": "srijith yaparathne"
  }
}
```

### D.23 Confirm with staffAssignments — `200`

```http
POST /api/bms-pink/bookings/qFMAVdBLOrOBQ3jtUPsw/confirm
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "staffAssignments": {
    "FEY5qd9k3UxccZLxSGkN": {
      "staffId": "S0Sh7tVxpShpCD63tluPTbr81rA2",
      "staffName": "srijith yaparathne"
    }
  }
}
```
Response `200`:
```json
{
  "success": true,
  "bookingId": "qFMAVdBLOrOBQ3jtUPsw",
  "bookingCode": "BK-2026-102617-8405",
  "previousStatus": "Pending",
  "status": "Confirmed",
  "action": "confirm"
}
```

### D.24 Complete booking — `200`

```http
POST /api/bms-pink/bookings/TZOfX1n38VpqBWaEe8F7/complete
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{}
```
Response `200`:
```json
{
  "success": true,
  "bookingId": "TZOfX1n38VpqBWaEe8F7",
  "bookingCode": "BK-2026-102617-7878",
  "previousStatus": "Confirmed",
  "status": "Completed",
  "action": "complete"
}
```

### D.25 Cancel via PATCH status — `200`

```http
PATCH /api/bms-pink/bookings/qFMAVdBLOrOBQ3jtUPsw
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "status": "Canceled",
  "reason": "API test cleanup"
}
```
Response `200`:
```json
{
  "success": true,
  "bookingId": "qFMAVdBLOrOBQ3jtUPsw",
  "bookingCode": "BK-2026-102617-8405",
  "previousStatus": "Confirmed",
  "status": "Canceled",
  "action": "cancel"
}
```

### D.26 Cancel again (409) — `409`

```http
POST /api/bms-pink/bookings/qFMAVdBLOrOBQ3jtUPsw/cancel
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Request body:
```json
{
  "reason": "again"
}
```
Response `409`:
```json
{
  "error": "Booking is already Canceled",
  "currentStatus": "Canceled"
}
```

### D.27 Customer notifications (salon) — `200`

```http
GET /api/bms-pink/customer-notifications?limit=5
X-Tenant-Id: oRZW7kSnYpZixEiYeUjfZx9vsl33
```
Response `200`:
```json
{
  "scope": "workshop",
  "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
  "notifications": [
    {
      "id": "4g9rp5iRbWncGT9i8qtG",
      "type": "booking_canceled",
      "title": "Booking Canceled",
      "message": "Your booking (BK-2026-102617-8405) for testsky with srijith yaparathne on 2026-10-28 at 11:00 has been canceled. Please contact us if you have any questions.",
      "status": "Canceled",
      "read": false,
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "bookingId": "qFMAVdBLOrOBQ3jtUPsw",
      "bookingCode": "BK-2026-102617-8405",
      "customerUid": null,
      "customerEmail": null,
      "customerPhone": "+61400000002",
      "clientName": "Call Center Test B",
      "serviceName": "testsky",
      "branchName": "kandy",
      "staffName": "srijith yaparathne",
      "bookingDate": "2026-10-28",
      "bookingTime": "11:00",
      "services": [
        {
          "name": "testsky",
          "staffName": "srijith yaparathne"
        }
      ],
      "createdAt": "2026-10-26T11:38:43.899Z",
      "calledCustomer": false,
      "calledCustomerAt": null,
      "calledCustomerByUid": null,
      "calledCustomerByName": null,
      "calledCustomerByEmail": null,
      "notificationReviewed": false,
      "notificationReviewedAt": null,
      "notificationReviewedByUid": null,
      "notificationReviewedByName": null,
      "notificationReviewedByEmail": null
    },
    {
      "id": "7bGkKQzfEMDXPPTQwyjI",
      "type": "booking_completed",
      "title": "Booking Completed",
      "message": "Your booking (BK-2026-102617-7878) for testsky with srijith yaparathne has been completed. Thank you for visiting us!",
      "status": "Completed",
      "read": false,
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "bookingId": "TZOfX1n38VpqBWaEe8F7",
      "bookingCode": "BK-2026-102617-7878",
      "customerUid": null,
      "customerEmail": null,
      "customerPhone": "+61400000001",
      "clientName": "Call Center Test A",
      "serviceName": "testsky",
      "branchName": "kandy",
      "staffName": "srijith yaparathne",
      "bookingDate": "2026-10-28",
      "bookingTime": "12:00",
      "services": [
        {
          "name": "testsky",
          "staffName": "srijith yaparathne"
        }
      ],
      "createdAt": "2026-10-26T11:38:39.023Z",
      "calledCustomer": false,
      "calledCustomerAt": null,
      "calledCustomerByUid": null,
      "calledCustomerByName": null,
      "calledCustomerByEmail": null,
      "notificationReviewed": false,
      "notificationReviewedAt": null,
      "notificationReviewedByUid": null,
      "notificationReviewedByName": null,
      "notificationReviewedByEmail": null
    },
    "… 3 more"
  ],
  "total": 5,
  "unreadCount": 5,
  "limit": 5,
  "sinceDays": 14
}
```

### D.28 Customer notifications (all=1) — `200`

```http
GET /api/bms-pink/customer-notifications?all=1&limit=3
```
Response `200`:
```json
{
  "scope": "all",
  "scopedToWorkshops": [
    "oRZW7kSnYpZixEiYeUjfZx9vsl33"
  ],
  "notifications": [
    {
      "id": "4g9rp5iRbWncGT9i8qtG",
      "type": "booking_canceled",
      "title": "Booking Canceled",
      "message": "Your booking (BK-2026-102617-8405) for testsky with srijith yaparathne on 2026-10-28 at 11:00 has been canceled. Please contact us if you have any questions.",
      "status": "Canceled",
      "read": false,
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "bookingId": "qFMAVdBLOrOBQ3jtUPsw",
      "bookingCode": "BK-2026-102617-8405",
      "customerUid": null,
      "customerEmail": null,
      "customerPhone": "+61400000002",
      "clientName": "Call Center Test B",
      "serviceName": "testsky",
      "branchName": "kandy",
      "staffName": "srijith yaparathne",
      "bookingDate": "2026-10-28",
      "bookingTime": "11:00",
      "services": [
        {
          "name": "testsky",
          "staffName": "srijith yaparathne"
        }
      ],
      "createdAt": "2026-10-26T11:38:43.899Z",
      "calledCustomer": false,
      "calledCustomerAt": null,
      "calledCustomerByUid": null,
      "calledCustomerByName": null,
      "calledCustomerByEmail": null,
      "notificationReviewed": false,
      "notificationReviewedAt": null,
      "notificationReviewedByUid": null,
      "notificationReviewedByName": null,
      "notificationReviewedByEmail": null
    },
    {
      "id": "7bGkKQzfEMDXPPTQwyjI",
      "type": "booking_completed",
      "title": "Booking Completed",
      "message": "Your booking (BK-2026-102617-7878) for testsky with srijith yaparathne has been completed. Thank you for visiting us!",
      "status": "Completed",
      "read": false,
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "bookingId": "TZOfX1n38VpqBWaEe8F7",
      "bookingCode": "BK-2026-102617-7878",
      "customerUid": null,
      "customerEmail": null,
      "customerPhone": "+61400000001",
      "clientName": "Call Center Test A",
      "serviceName": "testsky",
      "branchName": "kandy",
      "staffName": "srijith yaparathne",
      "bookingDate": "2026-10-28",
      "bookingTime": "12:00",
      "services": [
        {
          "name": "testsky",
          "staffName": "srijith yaparathne"
        }
      ],
      "createdAt": "2026-10-26T11:38:39.023Z",
      "calledCustomer": false,
      "calledCustomerAt": null,
      "calledCustomerByUid": null,
      "calledCustomerByName": null,
      "calledCustomerByEmail": null,
      "notificationReviewed": false,
      "notificationReviewedAt": null,
      "notificationReviewedByUid": null,
      "notificationReviewedByName": null,
      "notificationReviewedByEmail": null
    },
    "… 1 more"
  ],
  "total": 3,
  "unreadCount": 3,
  "limit": 3,
  "sinceDays": 14
}
```

### D.29 Mark notification reviewed — `200`

```http
POST /api/bms-pink/customer-notifications/4g9rp5iRbWncGT9i8qtG/notification-reviewed
```
Request body:
```json
{
  "notificationReviewed": true
}
```
Response `200`:
```json
{
  "success": true,
  "notificationId": "4g9rp5iRbWncGT9i8qtG",
  "collection": "notifications",
  "documentPath": "notifications/4g9rp5iRbWncGT9i8qtG",
  "notificationReviewed": true,
  "notificationReviewedByUid": "CUyzZara2fh575s7jCYbsLtmJpN2",
  "notificationReviewedByName": "Niranga Jay",
  "notificationReviewedByEmail": "jay@gmail.com"
}
```

### D.30 Mark called customer — `200`

```http
POST /api/bms-pink/customer-notifications/4g9rp5iRbWncGT9i8qtG/called-customer
```
Request body:
```json
{}
```
Response `200`:
```json
{
  "success": true,
  "notificationId": "4g9rp5iRbWncGT9i8qtG",
  "collection": "notifications",
  "documentPath": "notifications/4g9rp5iRbWncGT9i8qtG",
  "calledCustomer": true,
  "calledCustomerByUid": "CUyzZara2fh575s7jCYbsLtmJpN2",
  "calledCustomerByName": "Niranga Jay",
  "calledCustomerByEmail": "jay@gmail.com"
}
```

### D.31 Unmark called customer — `200`

```http
POST /api/bms-pink/customer-notifications/4g9rp5iRbWncGT9i8qtG/called-customer
```
Request body:
```json
{
  "calledCustomer": false
}
```
Response `200`:
```json
{
  "success": true,
  "notificationId": "4g9rp5iRbWncGT9i8qtG",
  "collection": "notifications",
  "documentPath": "notifications/4g9rp5iRbWncGT9i8qtG",
  "calledCustomer": false,
  "calledCustomerByUid": null,
  "calledCustomerByName": null,
  "calledCustomerByEmail": null
}
```

### D.32 Log agent activity — `201`

```http
POST /api/bms-pink/agent-activities
```
Request body:
```json
{
  "ownerId": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
  "callId": "test-call-001",
  "callerNumber": "+61400000001",
  "callerName": "Call Center Test A",
  "agentNote": "Booked testsky for Wednesday",
  "didNumber": "0390000000",
  "branchId": "wSaW3NH7TZMShk7Kjrjx",
  "branchName": "kandy",
  "queueId": "q-pink",
  "queueName": "Pink Queue",
  "recordingUrl": "https://example.com/recordings/test-call-001.wav",
  "recordingFileName": "test-call-001.wav"
}
```
Response `201`:
```json
{
  "success": true,
  "id": "DaZEZ0LVcXTkwtbOoX4k",
  "activity": {
    "id": "DaZEZ0LVcXTkwtbOoX4k",
    "callId": "test-call-001",
    "agentName": "Niranga Jay",
    "agentUserId": "CUyzZara2fh575s7jCYbsLtmJpN2",
    "agentEmail": "jay@gmail.com",
    "agentRole": "agent",
    "recordedByKind": "agent",
    "callerNumber": "+61400000001",
    "callerName": "Call Center Test A",
    "agentNote": "Booked testsky for Wednesday",
    "didNumber": "0390000000",
    "ownerId": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "ownerName": "beauty spa",
    "ownerTimezone": "Australia/Sydney",
    "branchId": "wSaW3NH7TZMShk7Kjrjx",
    "branchName": "kandy",
    "queueId": "q-pink",
    "queueName": "Pink Queue",
    "recordingUrl": "https://example.com/recordings/test-call-001.wav",
    "recordingFileName": "test-call-001.wav",
    "createdAt": "2026-10-26T11:38:57.656Z",
    "updatedAt": "2026-10-26T11:38:57.656Z"
  }
}
```

### D.33 List agent activities — `200`

```http
GET /api/bms-pink/agent-activities?ownerId=oRZW7kSnYpZixEiYeUjfZx9vsl33&limit=5
```
Response `200`:
```json
{
  "success": true,
  "activities": [
    {
      "id": "DaZEZ0LVcXTkwtbOoX4k",
      "callId": "test-call-001",
      "agentName": "Niranga Jay",
      "agentUserId": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "agentEmail": "jay@gmail.com",
      "agentRole": "agent",
      "recordedByKind": "agent",
      "callerNumber": "+61400000001",
      "callerName": "Call Center Test A",
      "agentNote": "Booked testsky for Wednesday",
      "didNumber": "0390000000",
      "ownerId": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "ownerName": "beauty spa",
      "ownerTimezone": "Australia/Sydney",
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "queueId": "q-pink",
      "queueName": "Pink Queue",
      "recordingUrl": "https://example.com/recordings/test-call-001.wav",
      "recordingFileName": "test-call-001.wav",
      "createdAt": "2026-10-26T11:38:57.656Z",
      "updatedAt": "2026-10-26T11:38:57.656Z"
    },
    {
      "id": "cF3xCGHNwT9V3771cVPR",
      "callId": "test-call-001",
      "agentName": "Niranga Jay",
      "agentUserId": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "agentEmail": "jay@gmail.com",
      "agentRole": "agent",
      "recordedByKind": "agent",
      "callerNumber": "+61400000001",
      "callerName": "Call Center Test A",
      "agentNote": "Booked testsky for Wednesday",
      "didNumber": "0390000000",
      "ownerId": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "ownerName": "beauty spa",
      "ownerTimezone": "Australia/Sydney",
      "branchId": "wSaW3NH7TZMShk7Kjrjx",
      "branchName": "kandy",
      "queueId": "q-pink",
      "queueName": "Pink Queue",
      "recordingUrl": "https://example.com/recordings/test-call-001.wav",
      "recordingFileName": "test-call-001.wav",
      "createdAt": "2026-10-26T11:36:45.423Z",
      "updatedAt": "2026-10-26T11:36:45.423Z"
    }
  ],
  "total": 2
}
```

### D.34 Chat: workshop owners — `200`

```http
GET /api/bms-pink/chats/workshop-owners
```
Response `200`:
```json
{
  "workshopOwners": [
    {
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "name": "beauty spa",
      "slug": "beauty-spa",
      "logoUrl": "",
      "contactPhone": "43253535",
      "email": "testsri@gmail.com",
      "timezone": "Australia/Sydney",
      "state": "NSW",
      "accountStatus": "active_trial"
    }
  ]
}
```

### D.35 Chat: start with owner — `200`

```http
POST /api/bms-pink/chats/start-with-owner
```
Request body:
```json
{
  "workshopOwnerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
  "text": "Hi from the call center (API test)"
}
```
Response `200`:
```json
{
  "chat": {
    "chatId": "cc_CUyzZara2fh575s7jCYbsLtmJpN2_oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "workshopOwnerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "tenantUserUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
    "tenantRole": "salon_owner",
    "agentUid": "CUyzZara2fh575s7jCYbsLtmJpN2",
    "participantIds": [
      "CUyzZara2fh575s7jCYbsLtmJpN2",
      "oRZW7kSnYpZixEiYeUjfZx9vsl33"
    ],
    "agentName": "Niranga Jay",
    "tenantName": "testsri@gmail.com",
    "lastMessageText": "Hi from the call center (API test)",
    "lastMessageAt": "2026-10-26T11:39:03.953Z",
    "lastSenderId": "CUyzZara2fh575s7jCYbsLtmJpN2",
    "unreadForTenant": true,
    "unreadForAgent": false,
    "chatsReviewed": false,
    "chatsReviewedAt": null,
    "chatsReviewedByUid": null,
    "createdAt": "2026-10-26T11:36:51.451Z",
    "updatedAt": "2026-10-26T11:39:03.953Z",
    "queueStatus": "active",
    "sessionStatus": "open",
    "closedAt": null,
    "closedByUid": null,
    "workshop": {
      "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "name": "beauty spa",
      "displayName": "testsri@gmail.com",
      "slug": "beauty-spa",
      "logoUrl": "",
      "email": "testsri@gmail.com",
      "phone": "43253535",
      "address": "No 21/1,Yapa Niwasa,Wapathna,Gomagoda 2018",
      "abn": "12343243244",
      "timezone": "Australia/Sydney",
      "state": "NSW",
      "bookingEngineUrl": "https://pink.bmspros.com.au/book-now/beauty-spa",
      "accountStatus": "active_trial"
    },
    "workshopUser": {
      "uid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "name": "beauty spa",
      "displayName": "testsri@gmail.com",
      "email": "testsri@gmail.com",
      "role": "salon_owner",
      "phone": "43253535",
      "branchId": "",
      "branchName": ""
    }
  },
  "created": false,
  "messageId": "Acn50OVzq5XGkaqedVIS"
}
```

### D.36 Chat: list — `200`

```http
GET /api/bms-pink/chats?limit=5
```
Response `200`:
```json
{
  "chats": [
    {
      "chatId": "cc_CUyzZara2fh575s7jCYbsLtmJpN2_oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "workshopOwnerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "tenantUserUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
      "tenantRole": "salon_owner",
      "agentUid": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "participantIds": [
        "CUyzZara2fh575s7jCYbsLtmJpN2",
        "oRZW7kSnYpZixEiYeUjfZx9vsl33"
      ],
      "agentName": "Niranga Jay",
      "tenantName": "testsri@gmail.com",
      "lastMessageText": "Hi from the call center (API test)",
      "lastMessageAt": "2026-10-26T11:39:03.953Z",
      "lastSenderId": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "unreadForTenant": true,
      "unreadForAgent": false,
      "chatsReviewed": false,
      "chatsReviewedAt": null,
      "chatsReviewedByUid": null,
      "createdAt": "2026-10-26T11:36:51.451Z",
      "updatedAt": "2026-10-26T11:39:03.953Z",
      "queueStatus": "active",
      "sessionStatus": "open",
      "closedAt": null,
      "closedByUid": null,
      "workshop": {
        "ownerUid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
        "name": "beauty spa",
        "displayName": "testsri@gmail.com",
        "slug": "beauty-spa",
        "logoUrl": "",
        "email": "testsri@gmail.com",
        "phone": "43253535",
        "address": "No 21/1,Yapa Niwasa,Wapathna,Gomagoda 2018",
        "abn": "12343243244",
        "timezone": "Australia/Sydney",
        "state": "NSW",
        "bookingEngineUrl": "https://pink.bmspros.com.au/book-now/beauty-spa",
        "accountStatus": "active_trial"
      },
      "workshopUser": {
        "uid": "oRZW7kSnYpZixEiYeUjfZx9vsl33",
        "name": "beauty spa",
        "displayName": "testsri@gmail.com",
        "email": "testsri@gmail.com",
        "role": "salon_owner",
        "phone": "43253535",
        "branchId": "",
        "branchName": ""
      }
    }
  ]
}
```

### D.37 Chat: send message — `200`

```http
POST /api/bms-pink/chats/cc_CUyzZara2fh575s7jCYbsLtmJpN2_oRZW7kSnYpZixEiYeUjfZx9vsl33/messages
```
Request body:
```json
{
  "text": "Second test message"
}
```
Response `200`:
```json
{
  "messageId": "ZkKrBapYDYhm8NCjbya0"
}
```

### D.38 Chat: messages — `200`

```http
GET /api/bms-pink/chats/cc_CUyzZara2fh575s7jCYbsLtmJpN2_oRZW7kSnYpZixEiYeUjfZx9vsl33/messages?limit=5
```
Response `200`:
```json
{
  "messages": [
    {
      "messageId": "ZkKrBapYDYhm8NCjbya0",
      "senderId": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "senderRole": "agent",
      "messageKind": "user",
      "text": "Second test message",
      "createdAt": "2026-10-26T11:39:10.410Z",
      "seenByRecipient": false,
      "readAt": null
    },
    {
      "messageId": "Acn50OVzq5XGkaqedVIS",
      "senderId": "CUyzZara2fh575s7jCYbsLtmJpN2",
      "senderRole": "agent",
      "messageKind": "user",
      "text": "Hi from the call center (API test)",
      "createdAt": "2026-10-26T11:39:03.953Z",
      "seenByRecipient": false,
      "readAt": null
    },
    "… 3 more"
  ]
}
```

### D.39 Chat: close — `200`

```http
POST /api/bms-pink/chats/cc_CUyzZara2fh575s7jCYbsLtmJpN2_oRZW7kSnYpZixEiYeUjfZx9vsl33/close
```
Request body:
```json
{}
```
Response `200`:
```json
{
  "ok": true
}
```

### D.40 Support: conversations — `500`

```http
GET /api/bms-pink/agent/conversations?queueLimit=5&mineLimit=5
```
Response `500`:
```json
{
  "error": "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/bmspro-pink/firestore/indexes?create_composite=ClFwcm9qZWN0cy9ibXNwcm8tcGluay9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvY29udmVyc2F0aW9ucy9pbmRleGVzL18QARoKCgZzdGF0dXMQ…"
}
```

### D.41 Support: messages - unknown id (404) — `404`

```http
GET /api/bms-pink/agent/conversations/does-not-exist/messages
```
Response `404`:
```json
{
  "error": "Conversation not found"
}
```

### D.42 Missing X-Tenant-Id (400) — `400`

```http
GET /api/bms-pink/branches
```
Response `400`:
```json
{
  "error": "Missing X-Tenant-Id header (salon owner uid for BMS Pink call-center scope)."
}
```
