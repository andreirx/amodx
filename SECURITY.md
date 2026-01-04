# Security & Architecture Concerns (Mitigation Log)

This document tracks accepted architectural trade-offs and security mitigations for the AMODX platform.

## 1. CORS Strategy (Admin Panel)

**Observation:** `infra/lib/api.ts` configures CORS origins.
**Risk:** Permissive CORS (`*`) allows any site to query the API.
**Mitigation:**
1.  **Dynamic Configuration:** The infrastructure code accepts the Agency Domain at deploy time.
2.  **Strict Allowlist:**
    *   `https://admin.your-agency.com` (Production Admin)
    *   `http://localhost:3000` & `5173` (Local Development)
3.  **Fallback:** `*` is only used if no Root Domain is configured in `amodx.config.json` (during initial bootstrap).

## 2. Public Content Access (Header Manipulation)

**Observation:** `renderer/src/app/api/posts/route.ts` uses `x-tenant-id` from the request header to query DynamoDB.
**Risk:** A user could manually send `curl -H "x-tenant-id: target-tenant"` to read content from a different site.
**Mitigation:**
1.  **Public is Public:** The endpoint explicitly filters for `FilterExpression: "#s = :published"`. It only returns content intended for public viewing.
2.  **No Private Data:** It explicitly does NOT return Drafts, Archived content, or internal notes.
3.  **Verdict:** This behavior is acceptable for a CMS. It is equivalent to scraping the target site.

## 3. PII in Comments

**Observation:** The Database stores `authorEmail` for comments.
**Risk:** Leaking email addresses to public visitors.
**Mitigation:**
1.  **Sanitization:** `backend/src/comments/list.ts` explicitly maps the database object to a sanitized response object.
2.  **Logic:** `authorEmail` is only included if the requestor has an authenticated Admin/Editor role. Public/Robot requests receive a stripped object.

## 4. Tenant Isolation (Backend)

**Observation:** Single Table Design puts all tenants in one DB.
**Risk:** Code bug could leak data between tenants.
**Mitigation:**
1.  **Policy Engine:** All Backend Handlers use `requireRole(auth, ..., tenantId)` which strictly compares the Token's `custom:tenantId` claim against the requested header.
2.  **No Defaults:** Removed the `|| "DEMO"` fallback from production handlers. Missing headers result in `400 Bad Request`.
