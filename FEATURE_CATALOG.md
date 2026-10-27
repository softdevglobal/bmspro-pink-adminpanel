# BMS Pro Pink — Feature Catalog

Multi-tenant salon / beauty SaaS (admin panel + Book Now public booking + mobile / call-center APIs). Roles: Super Admin, Salon Owner, Branch Admin, Staff (staff mainly via mobile; limited/no sidebar in admin). Call-center agents authenticate into related APIs / Command Center (no dedicated agent console sidebar in this admin panel).

---

## 1. Services Management

**Who:** Salon Owner

**What it does:**

- Owners create / edit / delete salon services: name, price, duration (minutes), image, branch assignment, staff assignment.
- Flat service pricing (AUD) — no vehicle-type or size-based pricing (salon domain).
- Services sync into assigned branches (`serviceIds`) and feed Book Now / booking slot flows.
- No Super Admin shared service-template catalog in this product (owner-owned tenant catalog only).

**Key routes:**

- `/services` — owner service catalog

---

## 2. Staff Management

**Who:** Salon Owner (full) · Staff (self via mobile: check-in, leave, accept / reject jobs)

**What it does:**

- Create staff / branch-admin logins (email, password, role, branch, timezone, weekly roster).
- Enforce plan staff limits; welcome email (and SMS when phone + credits available) with credentials.
- Directory with suspend / delete; staff detail view.
- Attendance & GPS — live / historical check-ins against branch geofence + map view.
- Timesheets — hours from check-in / out (including breaks), day / week summaries.
- Leave requests — approve / reject with reason; staff submit via mobile.
- Staff can accept / reject assigned bookings (feeds awaiting-staff and staff-rejected booking views).

**Key routes:**

- `/staff` → redirects to `/staff/manage`
- `/staff/manage` — directory, roster
- `/staff/attendance` — Attendance & GPS
- `/staff/timesheets`
- `/staff/leave-requests`
- `/staff/[id]` — staff detail

---

## 3. SMS Features

**Who:** Super Admin (catalog & oversight) · Salon Owner (credits, send, logs)

**Credits / top-up**

- Owners buy one-time SMS credit top-ups via Stripe Checkout on `/sms`.
- Balance lives on the owner user record (`smsMessageLimit` / `smsMessagesUsed`); low-balance badge in sidebar.
- Delivery via TextBee (Android device gateway).
- Super Admin builds SMS credit packages (quota, price, Stripe product / price sync, active / hidden / popular).
- Checkout auto-heals stale Stripe price IDs by re-syncing the package into the current Stripe account.

**Custom / greeting messages**

- Owners compose and send SMS to customers, staff, or both, with merge fields and seasonal / promo templates.
- `/greeting-messages` redirects to `/owner-custom-messages`.
- Sidebar also exposes `/sms/custom-messages` (same custom-message surface).

**Logs & platform SMS ops**

- Owner SMS send / usage history; Super Admin platform SMS log + per-tenant usage.

**Key routes:**

- Owner: `/sms`, `/sms/log`, `/owner-custom-messages` (alias `/greeting-messages`), `/sms/custom-messages`
- Super Admin: `/sms-packages`, `/sms-packages/usage`, `/sms-packages/log`

---

## 4. Subscription Plans / Packages / Billing (Stripe)

**Who:** Super Admin (plan catalog & tenant assignment) · Salon Owner (pay / upgrade / downgrade / cancel)

**What it does:**

- Super Admin CRUD on subscription plans: price (AUD), billing interval, trial days, branch / staff limits, features, Stripe price ID, active / hidden / popular, plan image.
- Tenant onboarding assigns a plan (manual via Tenants or self-serve signup).
- Owner Subscription page: current plan, trial / grace / past-due banners, Stripe Checkout, Customer Portal, upgrade / downgrade / cancel-at-period-end.
- Stripe webhooks update billing status on the owner user (`trialing`, `active`, `past_due`, `suspended`, etc.).
- Public signup can pick an active (non-hidden) plan.
- Success / cancel return URLs after Checkout.
- `/billing` is a legacy / unused mock (sidebar link commented out); live billing is `/subscription`.

**Key routes:**

- `/packages` — super admin plan catalog
- `/subscription`, `/subscription/success`, `/subscription/cancel`
- `/signup` — self-serve owner registration + plan
- `/billing` — legacy / unused in sidebar
- APIs: `/api/packages`, `/api/stripe/*`, `/api/billing/*`

---

## 5. Bookings

**Who:** Salon Owner · Branch Admin · Staff (execute / respond on mobile) · Customers (Book Now)

**What it does:**

- Create bookings from admin (multi-service); day’s board / calendar-style workflow.
- Status pipelines: pending requests → awaiting staff approval / confirmed → completed / cancelled; staff-rejected queue.
- Staff assignment (named staff or “Any Staff”), staff accept / reject, awaiting-staff and staff-rejected pages.
- Slot generation respects branch hours, staff roster, leave, and conflicts.
- Admin actions: confirm, assign / reassign, complete, cancel.

**Key routes:**

- `/bookings/dashboard` (+ `?create=true`)
- `/bookings/pending` | `/confirmed` | `/completed` | `/cancelled`
- `/bookings/awaiting-staff` | `/bookings/staff-rejected` (pages exist; not primary sidebar links)
- `/bookings` — broader / legacy bookings UI

---

## 6. Branches

**Who:** Salon Owner · Branch Admin (typically scoped to assigned branch)

**What it does:**

- Multi-branch setup within plan branch limits.
- Address, phone, email, timezone, open hours, daily booking limit, status.
- Assign services & staff; designate branch admin.
- Map pin + check-in geofence radius (Google Maps).
- Branch detail analytics / schedule views; branch admins often land on their assigned branch.

**Key routes:**

- `/branches`
- `/branches/[id]`

---

## 7. Customers

**Who:** Salon Owner

**What it does:**

- Customer CRM: name, phone, email, notes, active / inactive.
- Visit / last-visit style stats and detail preview.
- No vehicle registry (salon domain — people + contact only).

**Key routes:**

- `/customers`

---

## 8. ACSU Loyalty

**Who:** Salon Owner

**What it does:**

- Enable / disable ACSU loyalty for the salon.
- Points balance, AUD $/point conversion rate, manual top-up.
- Transaction history tied to completed bookings (customer, staff, branch, service, value, points).

**Key routes:**

- `/loyalty`

---

## 9. Tenants (Super Admin)

**Who:** Super Admin

**What it does:**

- Onboard salon owners (business details, ABN, plan, timezone, slug / Book Now URL, credentials).
- Edit, suspend / unsuspend, delete tenants; grant plan.
- Platform-wide tenant list and health; welcome email on create.
- Business types oriented to beauty / hair / nail / massage / barber / wellness / medical spa (AU).

**Key routes:**

- `/tenants`
- `/admin-dashboard` — platform KPIs (tenants, MRR, bookings, plan mix)

---

## 10. Book Now (Public Booking Engine)

**Who:** End customers (public) · configured by Salon Owner / Super Admin onboarding

**What it does:**

- Public site per salon slug: browse services, pick branch / slot, book appointments.
- Admin panel does not host the booking UI; `/book-now/*` rewrites to the Pink booking engine (`NEXT_PUBLIC_BOOKING_ENGINE_URL`).
- Owner settings and tenant create expose booking engine URL / slug (copy link).

**Key routes:**

- `/book-now/[slug]` (rewrite to booking engine)
- Owner: `/owner-settings` (logo, profile, booking URL)

---

## 11. Call Center & Support Chat

**Who:** Call-center agents (API / Command Center clients) · Super Admin & Salon Owner (oversight via APIs) · Owner / Branch Admin (chat participants)

**What it does:**

- Agents look up salons / branches / customers / services via call-center APIs (Pink-shaped payloads; no vehicle-type pricing).
- 1:1 CC direct chat (queue claim or agent-initiated); FCM push.
- Claimable support conversations with messages, presence, transfer, close.
- Floating Support Chat widget on owner / branch admin shell; suppresses duplicate CC toasts while open.
- No dedicated `/agent-activities` UI page in this admin panel (API / Command Center oriented).

**Key surfaces:**

- Dashboard Support Chat widget
- APIs under `/api/call-center/*`, `/api/chats/cc/*`, `/api/support-chat/*`

---

## 12. Notifications

**Who:** Salon Owner · Branch Admin (and staff via mobile)

**What it does:**

- In-app bell + toasts + sound on dashboard shell (`NotificationProvider`).
- Notable types: booking requests, leave requests, CC chat inbound, super-admin broadcasts.
- Mark read / delete; delete-all.
- Surfaces: Dashboard notification panel; broadcasts from `/custom-messages`.

---

## 13. Custom Platform Notifications (Broadcasts)

**Who:** Super Admin → Salon Owners / all staff + owners

**What it does:**

- Author titled announcements to Admin panel and / or Mobile app.
- Audience: business owners only, or all staff & owners.
- Delivered as read-only in-app notifications (optional mobile push).

**Key routes:**

- `/custom-messages`

---

## 14. Audit Logs

**Who:** Salon Owner (tenant) · Super Admin (platform)

**What it does:**

- Tenant log: create / update / delete / status / login / logout across bookings, services, staff, branches, customers, settings, check-ins, profile.
- Filter by action type, entity, search; detail preview.
- Super Admin log covers tenant onboard / suspend / plan changes and cross-tenant admin actions.

**Key routes:**

- `/audit-logs`
- `/super-admin-audit-logs`

---

## 15. Dashboards

**Who:** Salon Owner / Branch Admin · Super Admin

**What it does:**

- Owner / branch dashboard — revenue, booking counts / status mix, weekly calendar, today’s schedule (branch / staff filters), notifications, support-chat entry.
- Admin dashboard — active tenants, MRR, plan distribution, platform bookings / revenue, staff / customer / service totals, top tenants.

**Key routes:**

- `/dashboard`
- `/admin-dashboard`

---

## 16. Settings & Account

**Who:** Salon Owner · all roles (auth) · Super Admin (platform settings page)

**What it does:**

- Business profile: name, ABN, address, phone, timezone, logo.
- Change password; audit of profile / password changes.
- Login, forgot / reset password; signup for new salons.
- Display / copy Book Now URL.
- AuthGuard payment gate + trial warning when billing requires attention.
- Internal `/setup` for bootstrapping a super admin (ops, not product UI).
- Super Admin `/settings` — platform settings page (gated).

**Key routes:**

- `/owner-settings`
- `/settings` (super admin)
- `/login`, `/reset-password`, `/signup`
- `/setup`

---

## Role × Feature Matrix (sidebar-facing)

| Area | Super Admin | Owner | Branch Admin | Staff* |
|------|:-----------:|:-----:|:------------:|:------:|
| Platform dashboard / tenants / packages | ✓ | — | — | — |
| SMS packages & platform SMS log / usage | ✓ | — | — | — |
| Custom platform broadcasts | ✓ | receive | receive | receive |
| Bookings | — | ✓ | ✓ | mobile |
| Services / customers / ACSU loyalty | — | ✓ | — | — |
| SMS credits / custom messages / SMS log | — | ✓ | — | — |
| Staff HR (manage / leave / attendance / timesheets) | — | ✓ | — | mobile (attendance / leave) |
| Branches | — | ✓ | ✓ | — |
| Subscription & owner settings | — | ✓ | — | — |
| Support chat widget | — | ✓ | ✓ | — |
| Audit logs | platform | tenant | — | — |
| Book Now | configure (tenant) | configure | — | — |

\*Staff primarily use the mobile app; admin sidebar is built for owner / branch admin / super admin. `salon_staff` is blocked from the admin portal by AuthGuard.

---

## Auth & Product Framing

- Firebase Auth + role on `users` (or `super_admins` / `call_center_agents`).
- Currency / locale oriented to Australia (AUD, ABN, en-AU).
- Stack: Next.js admin panel, Firestore, Stripe, TextBee SMS, ZeptoMail, FCM, Google Maps, optional Supabase / Command Center bridging for agents.
- Salon domain (no Estimates / Quotations / Items / Vehicles modules — those belong to workshop/Black product lines).

---

## Notable absences vs BMS Pro Black (by design)

- No vehicle types, inspection checklists, or per-vehicle pricing on services.
- No Estimates / Quotations / Invoices / Items catalog for job docs.
- No Super Admin default service template board (`/admin-services`).
- No service-reminder cron board (`/bookings/service-reminder`).
- No `/agent-activities` admin UI page (call-center is API / Command Center oriented here).
- Adds **ACSU Loyalty** (`/loyalty`) as a Pink-specific owner feature.
