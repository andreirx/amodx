# Appointments-Private Table & Scheduling Extension Plan

## Status

- Decision record: proposed and documented
- Current maturity: no scheduling module; Public Cognito pool is provisioned but dormant
- Target maturity: production-grade boundary where:
  - appointment data (including customer details) lives in a dedicated appointments-private table
  - the renderer Lambda cannot read that table
  - only authenticated end-users (Public Cognito) can create/manage their own appointments
  - tenants can enable/disable the entire feature via a single config flag

## Problem

AMODX tenants will need “events between the user and the tenant” such as dentist appointments, car repair bookings, or lawyer meetings.

Today:

- There is no scheduling domain model or storage.
- The Public Cognito pool exists, but is unused.
- The main DynamoDB table is shared by many entity families, and the renderer has read access to that table.

If we naively add appointments into the main table and allow the renderer to read/write them, we repeat the original commerce exposure: compromise of the public renderer process would grant access to customer-private appointment data (names, emails, phone numbers, times, notes).

## Goal

Introduce an EVENTS SCHEDULING extension with the following properties:

- Authenticated booking only:
  - End-users must sign in via the Public Cognito pool before booking or managing appointments.
- Tenant isolation:
  - Every appointment is scoped to a single tenant.
  - Cross-tenant reads/writes are blocked by the same `requireRole()` + `tenantId` pattern as existing backend handlers.
- Private storage boundary:
  - Customer-private appointment data lives in a dedicated appointments-private DynamoDB table.
  - The renderer Lambda has **no IAM access** to this table.
  - All reads/writes go through backend handlers.
- Operational control:
  - A per-tenant toggle, e.g. `TenantConfig.appointmentsEnabled` (UI: a single checkbox “Enable appointments/scheduling”), enables or disables the entire feature set for that tenant.

## Non-Goals (Phase 1)

- No general workflow engine or arbitrary multi-step orchestration.
- No calendar sync (Google/Outlook) in the first phase.
- No shared “global booking” across tenants; everything remains tenant-local.
- No anonymous bookings; public unauthenticated booking is explicitly out of scope for the first extension.

## Architectural Boundary

### Main Table (unchanged)

The existing single table remains the public/content/catalog table:

- tenant config and site config
- content and routes
- products and categories
- forms, popups, delivery config
- all current non-appointment entity families

The renderer continues to have read access to this table (subject to future least‑privilege phases).

### New Appointments-Private Table

A new DynamoDB table holds only customer-private scheduling entities (example key shapes; exact schema TBD in implementation):

- `APPOINTMENT#<appointmentId>`
- `APPTCUSTOMER#<email>#<appointmentId>` (customer→appointment adjacency)
- optionally, per-tenant counters or work-queue items related to appointments

Keys:

- `PK = TENANT#<tenantId>`
- `SK = <entity-specific pattern>`

This mirrors the commerce private-table pattern and preserves access patterns while isolating customer‑private data.

### Tenant Feature Toggle

Extend `TenantConfig` with a boolean flag:

- `appointmentsEnabled: boolean` (default: `false`)

Behavior:

- **Admin UI**:
  - Shows an “Appointments / Scheduling” settings section with a single checkbox:
    - “Enable appointments/scheduling for this site”
  - When disabled: hide appointments admin pages and configuration UI.
- **Renderer**:
  - When disabled: hide booking widgets/routes and avoid calling scheduling endpoints.
- **Backend**:
  - All appointment handlers check `appointmentsEnabled` for the target tenant and return `403` or `404` when disabled, even if called directly.

This matches the commerce `commerceEnabled` gating pattern.

## Security Properties After Cutover

### Improved

- Renderer Lambda compromise does not grant direct read access to appointment records or customer identities associated with bookings.
- Appointment endpoints require:
  - a valid Public Cognito JWT (end user)
  - correct tenant scoping based on `custom:tenant_id`
- Tenants can disable the entire feature with a single flag if they do not want to process appointments at all.

### Residual

- Renderer still has access to whatever remains in the main table (content, products, etc.).
- Appointment data is isolated, but other non-commerce/non-appointment private families still rely on the main table boundary.

## API Design

### Customer-Facing Endpoints (renderer or direct)

Preferred shapes (no email in URL path):

- `POST /appointments` — create a new appointment for the authenticated user
- `GET /appointments` — list the authenticated user’s appointments
- `DELETE /appointments/{id}` — cancel one of the user’s appointments

Trust model:

- Public Cognito JWT in `Authorization` header
  - Authorizer verifies token against the Public pool.
  - Maps `custom:tenant_id` → `auth.tenantId`.
  - Assigns a dedicated role, e.g. `CUSTOMER`, to distinguish from admin/editor roles.
- Backend handlers:
  - Extract `tenantId` from `auth.tenantId`.
  - Use `requireRole(auth, ["CUSTOMER"], tenantId)` for customer endpoints.
  - Use appointments-private table for all reads/writes.

### Admin/Tenant Owner Endpoints

Examples:

- `GET /appointments/admin` — list tenant appointments with projection
- `GET /appointments/admin/{id}` — detailed view
- `PUT /appointments/admin/{id}` — status updates (confirmed, completed, cancelled by tenant)

Trust model:

- Admin Cognito JWT (existing pool).
- `requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId)` as appropriate.
- Same appointments-private table; no renderer involvement.

### Notifications and Audit

- Appointment lifecycle events (created, rescheduled, cancelled, completed) call `publishAudit()` → EventBridge → worker Lambda → DynamoDB audit trail.
- Optional email notifications (SES) follow the commerce order-email template pattern:
  - Per-tenant templates for “Appointment booked”, “Reminder”, “Cancelled”, etc.
  - Variables: `{{appointmentDate}}`, `{{serviceName}}`, `{{customerName}}`, etc.

## Authentication Architecture Integration

### Public Cognito Pool Usage

From `infra/lib/auth.ts` and `docs/authentication-architecture.md`:

- The Public pool currently defines a custom attribute: `custom:tenant_id`.
- It is provisioned but not wired into any routes.

Required changes (conceptual, not implemented here):

- Extend `backend/src/auth/authorizer.ts` (or add a sibling authorizer) to:
  - Verify JWTs against the Public pool as well as the Admin pool.
  - When a token is from the Public pool:
    - Map `custom:tenant_id` → `auth.tenantId`.
    - Set `auth.role = "CUSTOMER"` (or similar).
- Appointment endpoints then rely on `requireRole()` and strict tenant equality to enforce isolation.

This keeps the same “authorizer → auth context → handler” pattern used by commerce and admin routes.

## Clean Architecture Shape

### Support Module

Introduce a backend support module similar in spirit to `commerce-db.ts`:

- Suggested file: `backend/src/lib/appointments-db.ts`
- Responsibilities:
  - Typed functions for:
    - `createAppointment(...)`
    - `getAppointment(tenantId, appointmentId)`
    - `listAppointmentsForCustomer(tenantId, email)`
    - `listAppointmentsForTenant(tenantId, filters)`
    - `cancelAppointment(...)`
  - Encapsulate PK/SK construction and GSI usage.
  - Enforce “no scans, always projection” for list endpoints.

Table name:

- Supplied via dedicated env var (e.g. `APPOINTMENTS_TABLE_NAME`).
- Fallback to main table **only in early development**, but production DOD is “renderer has zero IAM access and appointment data lives in the separate table”.

### Feature Implementation

Use the support module from:

- Customer booking endpoints.
- Admin/tenant management endpoints.
- Any future reminder worker that needs to read upcoming appointments.

Renderer and admin code must **not** import `appointments-db.ts` or any DynamoDB helper directly; they only call API routes.

## Rollout Plan

This mirrors the commerce-private-table rollout, but for a new domain (appointments) instead of migration.

### Phase 1 — Design & Schema in Shared Types

- Define appointment-related Zod schemas and TypeScript types in `packages/shared`:
  - `AppointmentSchema`, `AppointmentStatus`, `AppointmentServiceSchema`, etc.
  - Include `appointmentsEnabled` flag in `TenantConfig` schema.
- This allows admin/renderer/backend to share DTOs and validation.

### Phase 2 — Infra: Empty Appointments-Private Table

- Add new DynamoDB table in `infra/`:
  - PAY_PER_REQUEST, PITR enabled.
  - Keys: `PK`, `SK` with patterns described above.
- Wire `APPOINTMENTS_TABLE_NAME` into relevant backend Lambdas.
- Do **not** grant any IAM access to the renderer Lambda for this table.

At this point the table is empty and inert.

### Phase 3 — Auth Wiring

Two main options (to be implemented later, trade-offs documented here):

1. **Single shared authorizer (extended)**  
   - Extend `backend/src/auth/authorizer.ts` to:
     - Detect token issuer/audience and route to Admin vs Public verifier.
     - Map Public pool `custom:tenant_id` into `auth.tenantId`.
     - Set `auth.role = "CUSTOMER"` for Public pool tokens.
   - Pros:
     - One place to harden and audit.
     - Simpler API Gateway configuration.
   - Cons:
     - More complexity in a single authorizer function.
     - Careful testing required to avoid role confusion.

2. **Separate authorizer / routes for scheduling**  
   - Provision a second authorizer Lambda dedicated to the Public pool.
   - Appointment routes use this authorizer; admin/commerce routes keep the current one.
   - Pros:
     - Clear separation of concerns between admin and customer auth.
     - Easier to reason about in logs and IAM.
   - Cons:
     - More moving parts at the API Gateway level.
     - Slightly more infrastructure surface area (additional authorizer function).

This document does not choose between them; the implementation phase must explicitly pick one and update this doc.

### Phase 4 — Backend Handlers (Customer + Admin)

- Implement backend handlers under `backend/src/appointments/*`:
  - Customer endpoints: create/list/cancel own appointments.
  - Admin endpoints: list/update appointments and manage service/availability configuration.
- All handlers:
  - Read `auth` from `event.requestContext.authorizer.lambda`.
  - Use `requireRole()` with strict tenant checks.
  - Read/write only via `appointments-db.ts`.

### Phase 5 — Tenant Toggle & UI

- Extend admin settings:
  - Add “Appointments / Scheduling” section with a single checkbox bound to `appointmentsEnabled`.
- Extend renderer:
  - When `appointmentsEnabled` is `false`, hide booking UX and skip scheduling API calls.
  - When `true`, expose booking widgets/pages but still require Public Cognito sign-in.

### Phase 6 — Notifications & Audit

- Wire appointment lifecycle to:
  - `publishAudit()` for traceability.
  - Optional SES-based notifications for customers and tenant operators.

### Phase 7 — Validation

For at least one staging tenant:

- Confirm that booking requires Public Cognito sign-in.
- Confirm that a user from tenant A cannot access tenant B’s appointments (JWT `tenant_id` isolation).
- Confirm that the renderer Lambda IAM role has no permissions on the appointments-private table.
- Confirm that disabling the checkbox removes all scheduling UX and backend endpoints reject calls for that tenant.

## Assumptions and Technical Debt

- Public Cognito pool will be used exclusively for end-user customer auth (not admins).
- Email remains the primary cross-system customer identifier (matching commerce).
- This plan assumes that an appointments domain is relatively small compared to commerce; table cost impact is low.
- Deferred work:
  - Calendar sync (Google/Outlook).
  - Advanced workflow (multi-step approval, dependencies).
  - Hardening other non-commerce private families into their own tables.

Any deviations from this plan (e.g., temporarily storing appointments in the main table during prototyping) must be documented and later migrated to the appointments-private table, similar to the commerce-private migration strategy.
