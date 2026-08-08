# Technical Debt Tracker

Items tracked here are known issues that don't block production but should be addressed.

---

## Dependency Audit Remediation

`npm audit` status and the remaining **pinned** items. Tracked as ROADMAP slice `dep-1`.

**Cleared — no longer debt:**
- **Backend criticals** (2026-06-01): `vitest 4.0.16 → 4.1.8`, removed the direct `@vitest/ui` devDep —
  both **GHSA-5xrq-8626-4rwp** (Vitest UI server file read/exec; dev-only, never in the Lambda runtime).
  Backend: **0 vulnerabilities; 47/47 tests pass**.
- **Non-breaking `npm audit fix`** (2026-06-29): cleared 4 HIGH + the non-breaking moderates —
  `linkify-it` (renderer, Tiptap editor chain), `form-data` (mcp-server → axios), `undici`
  (backend Lambda runtime + mcp-server), `vite` (admin + backend build), plus `markdown-it`,
  `@babel/core`, `js-yaml` (eslint path). Full rebuild green: exit 0, 8/8 workspaces.
- **`next-auth` → `uuid`** — was item 4 below; cleared by `sec-1`'s `next-auth 4.24.13 → 4.24.15`.
  `OBSERVED` 2026-07-28: `next-auth`'s manifest now declares `uuid: ^11.1.1` and the tree resolves
  `uuid@11.1.1`, so the vulnerable bundled v3/v5/v6 copy no longer exists. `uuid` does not appear
  in `npm audit` at all.
- **`jest` / `ts-jest` → `js-yaml`** — was item 5 below (~19 of the then-27 moderates); cleared
  upstream, not by us. `OBSERVED` 2026-07-28: `@istanbuljs/load-nyc-config` resolves
  `js-yaml@3.15.0`, a **patched 3.x**, and neither `js-yaml` nor `@istanbuljs/load-nyc-config`
  appears in `npm audit`. The jest tree is still in the audit, but now for `brace-expansion`
  (item 1 below) — a different advisory with a different owner. Do not read "jest is still listed"
  as "this item came back."

**Remaining — 46 findings: 43 high, 3 moderate (whole repo).** `EXECUTED` 2026-07-28 at the repo root
(`npm audit`; roots and owners enumerated from `npm audit --json`). A root-level audit covers all 8
workspaces through the hoisted `node_modules`, so "whole repo" is literal.

> **Why this is not the previous `2 high + 27 moderate`.** That line was accurate when written; the
> advisory database moved under it, in both directions. Two items cleared (`uuid`, `js-yaml` — see
> *Cleared* above, −21ish moderates), and three moved the other way: `brace-expansion` was re-rated
> **moderate → high** and gained three new advisories, which alone accounts for **36 of the 46**
> nodes; `sharp` and `react-router` are new HIGH advisories against packages that were already
> installed. Net: fewer moderates, far more highs. **A count in this file is only true as of its
> measurement date — re-run `npm audit` before acting on it, do not trust the number.**

Every remaining item needs a `--force` breaking downgrade or a deliberate version-pin bump.
**`EXECUTED` 2026-07-28: a non-breaking `npm audit fix` clears nothing** — `npm audit fix --dry-run`
reports 118 added / 45 changed / 1 removed and a post-fix count of **still 46 (43 high, 3 moderate)**.
This matters because `npm audit --json` marks items 4 and 5 below `"fixAvailable": true`; the dry-run
shows that flag is not borne out for either. **Do NOT run `npm audit fix --force`.**

Grouped by the parent that owns the fix, largest blast radius first:

1. **`brace-expansion` (HIGH) — 36 of the 46 nodes, dev/build tooling only.** Installed `1.1.16`;
   the advisories cover **`<=5.0.7`, i.e. every published version**, which is why nothing dedupes it
   away. Four advisories, all denial-of-service: zero-step sequence process hang / memory exhaustion,
   a large numeric range that defeats the documented `max` protection, and ReDoS.
   - **Owners (four independent trees, one shared leaf):** the `eslint` / `@typescript-eslint` stack
     (admin `eslint ^9.39.1`, renderer `eslint ^9`, `eslint-config-next`), the infra `jest` /
     `ts-jest` stack (`@jest/*`, `babel-jest`, `jest-*`, `ts-jest`), `open-next` (renderer build),
     and `@node-minify/core`. Reached via `glob` → `minimatch` → `brace-expansion` in most paths.
   - **`npm audit` proposes `eslint@10.8.0` (semver-major) and that clears only the eslint subtree** —
     the jest, open-next and node-minify paths keep their own copies. There is no one-bump fix.
   - **Runtime exposure: none.** Every owner is lint or test or build tooling; `brace-expansion` is
     not present in any Lambda bundle or the renderer runtime, and none of these tools expands a
     brace pattern that a tenant or end user controls — the patterns come from our own config files.
   - **Fix:** move each owner forward as its ecosystem ships a patched `minimatch`/`brace-expansion`.
     Low urgency, high node count; do **not** let the count drive priority ahead of items 2–3.
2. **`next` 16.2.x → `postcss` + `sharp` (renderer).** Two HIGH advisory roots behind one parent.
   - `postcss` (HIGH, 3 advisories): XSS via unescaped `</style>` in CSS stringify output, **and**
     arbitrary file read / information disclosure via an attacker-controlled `sourceMappingURL`.
     Build-time; the renderer does not stringify tenant content through PostCSS.
   - `sharp` **0.34.5** (HIGH): inherited libvips CVE-2026-33327 / -33328 / -35590 / -35591. Fixed in
     `sharp >= 0.35.0`. Pulled in as `next`'s optional image-optimization dependency.
   - **Exposure — assess before `dep-1` closes, do not assume build-time.** `INFERRED`, not verified:
     unlike `postcss`, `sharp` runs at **request time** in Next's image optimizer, so if the deployed
     OpenNext bundle includes the image-optimization function, a malicious image reaching that path
     is live attack surface. Whoever runs `dep-1` must first establish (a) whether the deployed
     bundle ships `sharp`, and (b) whether any un-trusted image can reach it, or whether every
     optimized image originates from an authenticated tenant-admin upload. Record the answer here.
     **Partial input from `cache-6`, not an answer:** § *cache-6 residuals* → *`sharp` request-time
     exposure* confirms the function is deployed, and warns that CloudFront's current query-string
     stripping does **not** bound exposure, because the same Lambda has an unauthenticated Function
     URL. (b) must therefore be answered across every path to the function, not just the edge one.
   - **`npm audit` proposes `next@9.3.3`** — an absurd six-major downgrade; ignore it.
     **Fix:** Next.js >= 16.3 stable (16.3 was canary when first written — re-check), which carries
     both a patched `postcss` and `sharp >= 0.35.0`.
3. **`aws-cdk-lib` 2.241.0 — exact pin in `infra/package.json` (deploy-time).** `aws-cdk-lib` itself
   (HIGH, 3 advisories — OS command injection in NodejsFunction bundling, the same in Docker
   bundling, CodeBuild S3 log encryption), plus two dependencies **bundled inside the cdk tarball**:
   `fast-uri` **3.1.0** (HIGH, 4 advisories — path traversal via percent-encoded dot segments, host
   confusion via percent-encoded authority delimiters) and `yaml` 1.x (moderate — stack overflow on
   deeply nested collections).
   - Note the hoisted root `fast-uri` is already the patched `3.1.4`; the vulnerable copy is only the
     nested `node_modules/aws-cdk-lib/node_modules/fast-uri`. `npm audit` marks it
     `"fixAvailable": true`, but it is bundled, and the dry-run above confirms plain `audit fix`
     does not remove it.
   - **Fix:** bump the pin `2.241.0 → 2.262.1` (the version `npm audit` now names; it was 2.260.0
     when this entry was first written) — semver-*minor*, not major, and it shows as `--force` only
     because the version is exact-pinned. Clears all three at once.
   - **Runtime exposure:** none. CDK is build/deploy tooling, never bundled into a Lambda or the
     renderer, and never parses untrusted URLs or YAML.
   - ~~**Gated on** the CDK infra test suite~~ — **GATE SATISFIED 2026-07-28 by `test-4`.**
     `infra/test/amodx-stack.test.ts` runs a real `Template.fromStack` on every push (CI job
     `infra-synth`). Note what this gate does and does not give you: the 17 assertions are
     **named**, not a snapshot, so a `2.241.0 → 2.262.1` bump that changes the cache key, the
     invalidation blast radius or a flush schedule fails with the property's name — but a bump
     that changes anything *not* asserted passes silently. Before bumping, also run a manual
     `cdk synth` of both stages and diff the templates by hand; there is no baseline artifact.
4. **`react-router` / `react-router-dom` 7.18.1 (HIGH) — admin SPA.** New advisory: RSC-mode CSRF
   bypass allowing action execution before the 400 response. Vulnerable range `7.12.0 - 8.2.0`, so
   the fix is `>= 8.2.1` — **outside** admin's declared `react-router-dom: ^7.10.1`, i.e. a
   **semver-major** upgrade despite `npm audit` reporting `"fixAvailable": true` (the dry-run above
   shows that flag clears nothing).
   - **Exposure:** the admin is a Vite **client-side** SPA — it does not run React Router in RSC
     mode, which is the mode the advisory requires. `INFERRED` from admin's build setup; confirm
     before deciding, then either upgrade to 8.x during a dedicated admin slice or record a reasoned
     acceptance here. Do not fold a router major into an unrelated slice.
5. **`open-next` 3.1.3 / `esbuild` (renderer build, build-time; the 2 remaining moderates).** The
   advisories are the `esbuild --serve` dev-server CORS hole and an arbitrary file read in the same
   dev server; open-next uses esbuild as a one-shot bundler, never as a server. `--force` →
   `open-next@0.0.1` (absurd downgrade). **Fix:** move open-next forward to a release carrying
   patched esbuild.

**Order when `dep-1` runs:** (1) ~~activate CDK infra tests + CI `cdk synth` baseline~~ **DONE
(`test-4`, 2026-07-28)** → (2) **answer the `sharp` runtime-exposure question in item 2** — it is the
only remaining item with a plausible request-time path, so it sets the urgency of everything else →
(3) bump `aws-cdk-lib → 2.262.1` (clears 1 HIGH root + bundled `fast-uri` + `yaml`) → (4) Next.js
16.3 stable for `postcss` + `sharp` → (5) move `open-next` forward for `esbuild` → (6) decide
`react-router` 8.x in an admin-owned slice → (7) let the `brace-expansion` owners age forward.

**Re-measure before acting.** `npm audit` at the repo root; `npm audit --json` for the roots/owners.
Do not carry the numbers above into a slice report without re-running them.

---

## High Priority (Missing Features)

### Chunked NextAuth session cookies are not reassembled (gated content denied)
**Found:** `cache-3` revision 4 review. **Scope:** deferred — the fix is in the dynamic twin
routes, which `cache-3` is explicitly barred from touching.

NextAuth chunks the session JWT into `next-auth.session-token.0`, `.1`, … when it exceeds the
4096-byte cookie limit (`next-auth/core/lib/cookie.js:144-160`). The dynamic twin's
`readSessionToken()`
(`renderer/src/app/[siteId]/%5Fdyn/[[...slug]]/page.tsx:33-38`) reads two exact, unchunked
names and returns `null` for anything else — it neither collects nor concatenates chunks. So
a visitor whose JWT was chunked reaches `SitePage` with `sessionToken: null` and the ACCESS
GATEKEEPER (`renderer/src/components/SitePage.tsx`) denies gated content.

What `cache-3` **did** fix is *routing*, on both layers: such a request now keys as
`x-has-session: 1` at the edge and is rewritten to the `no-store` twin at the origin, so it
can neither hit nor populate an anonymous cache entry. Do not read the `cache-3` probes
(`probe-cache3.sh` §F3/§F3b, `probe-cache3-cffunc.mjs`) as evidence that chunked
authentication works — they measure routing only.

**Fix shape:** replicate NextAuth's `SessionStore` reassembly in `readSessionToken()` —
collect every cookie whose name is `<base>` or `<base>.<i>`, sort by numeric suffix,
concatenate the values, then `decode()`. Same twin file also carries a stale comment ("Both
the plain and `__Secure-` names are in use"); under the repo's explicit `cookies` config only
the plain name is emitted (`next-auth/core/init.js:59-61` — top-level spread replaces the
default entry).

**Blast radius today:** only tenants with large Google profile claims or many custom session
fields reach 4096 bytes. Unmeasured in production; no probe exists for it.

### Tenant domain aliases are not representable
A tenant has exactly one `domain` (`TenantConfigSchema.domain`, mirrored to the `GSI_Domain`
partition key), and `renderer/src/lib/tenant-directory.ts` admits a host only on an exact
match. So `example.com` and `www.example.com` cannot both serve one tenant, and a domain
migration has no overlap window. Noted by `cache-2` (finding F2) because it is what makes the
ISR purge single-valued; if aliases are added, the fan-out point is `TenantRouting.domain` in
`backend/src/lib/revalidate-paths.ts`, plus the middleware host gate and the CloudFront alias
list. Not a defect today — no tenant is configured to need it.

### Netopia Payments (future)
Some clients need card payments via Netopia. Architecture is ready:
- Add "netopia" to paymentMethod enum and enabledPaymentMethods
- Add Netopia credentials to IntegrationsSchema
- Checkout: redirect to Netopia hosted page after order creation (status=placed, paymentStatus=pending)
- Webhook handler: on payment success → update paymentStatus to "paid"
- Return page: show confirmation
- Estimated effort: Medium (1-2 days)

### Google Reviews sync
ReviewSchema supports `source: "google"` and `googleReviewId` but there's no import/sync handler for Google Places API reviews. Need a backend handler that pulls reviews from Google My Business / Places API and writes them as ReviewSchema items.

### Reports / Analytics page
No admin page for viewing order reports, revenue charts, or product performance metrics. "Nice to have" per original spec.

### Form email notifications not implemented
`backend/src/forms/public-submit.ts` saves submissions but doesn't send notification emails to `FormDefinition.notifyEmail`. Needs SES integration similar to existing contact form handler.

### WordPress page import is text-only
`backend/src/import/wordpress.ts` converts WordPress pages to Tiptap blocks, but the conversion is shallow:
- **Images**: Converted to `[Image: url]` text placeholders instead of actual image blocks. Should check MEDIAMAP# for imported media URLs and create proper image nodes.
- **Forms**: Contact Form 7 / WPForms are converted to plain text (field labels only). Could potentially map to FormDefinition or at least create a form embed placeholder.
- **Buttons/CTAs**: Converted to plain text. Should detect `<a class="button">` patterns and create CTA blocks.
- **Layout blocks**: Gutenberg columns, hero sections, galleries are flattened to text. Complex to reverse-engineer but could detect common patterns.
- **Current state**: Acceptable for content migration (text + paragraphs work), but requires manual cleanup for rich layouts.
- **Estimated effort**: High (3-5 days for meaningful improvement)

### Email/Password Customer Accounts via Public Cognito Pool
The public Cognito pool (`AmodxPublicPool`) is provisioned in CDK but dormant. Currently customer auth is Google-only via NextAuth. This task activates the public pool so tenants can offer email/password registration alongside Google OAuth.

**See full implementation plan:** `docs/plan-public-pool-customer-auth.md`

**Summary:** Wire the existing public Cognito pool as a NextAuth `CredentialsProvider` for sign-up/sign-in, add registration + login UI, link Cognito identities to existing `CUSTOMER#email` DynamoDB records, add password reset flow. Google OAuth continues working alongside it. Estimated effort: 3-5 days.

---

### Upload size limit is advisory, not enforced at the storage boundary
The asset upload flow (`backend/src/assets/create.ts`) uses presigned PUT URLs. Size validation occurs in two places: client-side pre-check (`admin/src/lib/upload.ts` via `validateUpload()`) and backend presign-request validation (same `validateUpload()` before generating the URL). Both check the client-declared `size` field against the limits (10MB images, 50MB videos).

**This is not hard enforcement.** Presigned PUT URLs do not support signed size conditions. A caller that reports `size: 1` in the presign request and then uploads a larger object to S3 will succeed. The client pre-check and backend validation catch all non-adversarial uploads but do not constitute a trust boundary.

**Fix:** Migrate from presigned PUT to presigned POST with a signed `content-length-range` policy condition. This is the AWS-recommended mechanism for browser uploads that require server-enforced size limits. The change touches: `backend/src/assets/create.ts` (switch from `PutObjectCommand` + `getSignedUrl` to `createPresignedPost`), `admin/src/lib/upload.ts` (switch from raw PUT to `FormData` POST with signed fields), and any other upload callers. Requires focused test coverage before merge.

**Current risk level:** Low. The gap is only exploitable by deliberately forging the size field in the authenticated API call. All honest upload paths (admin UI, MCP server) use the real `File.size`. The MIME allowlist IS enforced because `ContentType` is signed into the presigned URL.

### Tiptap version skew: plugins 2.x / admin 3.x
`packages/plugins` depends on `@tiptap/core@^2` and `@tiptap/react@^2`. `admin` depends on `@tiptap/*@^3`. Both are installed separately (not deduped). The `InlineRichTextField` support component creates a standalone Tiptap 2.x ProseMirror instance that coexists with the admin's 3.x outer editor. This works because the two editors are fully isolated (no shared state, schema, or extensions), but it means:
- Duplicate editor runtime in the admin bundle
- Future contributors may assume editor helpers can be shared across both worlds
- If Tiptap 2.x stops receiving security patches, plugins must be upgraded

**Fix:** Dedicated PR to upgrade `packages/plugins` from Tiptap 2.x to 3.x. Key changes per the official migration guide: import reshuffling (`@tiptap/extensions`), `shouldRerenderOnTransaction` default change, `getPos()` can return undefined. Current plugin surface (Node.create, ReactNodeViewRenderer, NodeViewWrapper, storage injection) is low-risk but requires regression testing all 19 plugin NodeViews inside the admin editor.

## Medium Priority (Code Quality)

### Review `source` enum defects — write path bypasses Zod, forcing a compat widening (F-REV1-x / D1); the two review systems' enums diverge (D2)
Surfaced by the `plan-reviews-import.md` audit (§ 2.5); recorded here with the `rev-1` slice,
which touches `ReviewSchema` but does **not** change handler behavior (packet: types-only, no
behavior change). Both are for `rev-2` to reconcile when it opens the System-A write path.

- **F-REV1-x / D1 — `create.ts` writes values the shared schema never accepted; the write path
  bypasses Zod (shared-first rule violated historically).** `backend/src/reviews/create.ts`
  persists two shapes the pre-`rev-1` `ReviewSchema` rejected, and has done so since inception:
  `source: source || "manual"` (create.ts:57) and `googleReviewId: googleReviewId || null`
  (create.ts:61). `"manual"` was **not** a member of the original `source` enum
  (`google | internal | imported`), and `googleReviewId` was `z.string().optional()`, which
  rejects `null`. The reviewer PROVED this against the working tree (`safeParse` on the exact
  persisted row returned `false`), so the "every existing row parses" backward-compat requirement
  was in direct conflict with the strict schema.
  **Resolution taken in `rev-1` (revise cycle, 2026-08-08 — evidence wins):** the SCHEMA was
  widened to describe **persisted reality** — `source` now includes `"manual"` (annotated legacy
  member; the default stays `"internal"`), and `googleReviewId` is `z.string().nullable().optional()`.
  This is a compat widening, **not** a fix of the underlying defect.
  **The underlying defect remains:** `create.ts` (and `update.ts`) write records **without ever
  parsing them through `ReviewSchema`** — a source-tree grep finds no runtime
  `ReviewSchema.parse()`/`safeParse()` in any handler; `rev-1` added only compile-time `type`
  annotations. So the write path can still drift from the contract silently, and `"manual"` — a
  value that should never be the source of a *new* review — is still what the handler writes when
  the caller omits `source`. The renderer only special-cases `"google"`, so the value renders
  identically today and hides the drift.
  **Fix (separate future slice, NOT `rev-1`):** introduce validate-on-write — parse the POST body
  with `ReviewSchema` on the create/update path and default `source` to `"internal"` (stop writing
  `"manual"`). Changing the write path is a behavior change out of scope for the types-only
  `rev-1`; it needs its own slice.
- **D2 — the two review systems' `source` enums diverge.** System A (DB), after the F-REV1-x compat
  widening: `google | internal | imported | manual`. System B (`reviews-carousel` block,
  `packages/plugins/src/reviews-carousel/schema.ts`): `google | facebook | manual`. `"facebook"`
  exists only in the block, `"imported"` only in the DB, and `"manual"`/`"internal"` are two names
  for the same idea now present (post-widening) in different combinations across the two systems.
  Any cross-system feature (e.g. rendering an imported FB review through System A) trips over this.
  Unifying them is a schema-migration decision (`rev-6` adds `"facebook"` to System A per the plan
  § 4.6; the validate-on-write fix should also retire `"manual"` in favor of `"internal"` on the
  DB side), not a cosmetic rename.

### Split Settings page into sections
The Settings page (`admin/src/pages/Settings.tsx`) is ~1300 lines covering site identity, theme, analytics, identity providers, payments, GDPR, commerce bar, URL prefixes, company details, legal links, and more. Split into tabbed sections.

### Extract commerce views from catch-all page
`renderer/src/app/[siteId]/[[...slug]]/page.tsx` is ~900 lines containing ProductPageView, CategoryPageView, CartPageView, CheckoutPageView, ConfirmationPageView, OrderTrackingView, and ShopPageView all inline. Extract each to its own file under `renderer/src/components/commerce/`.

---

### Mobile device orientation for button effects
Button overlay effects use time-based sweeping highlight on mobile. Desktop uses pointer tracking. Mobile could use `DeviceOrientationEvent` API for tilt-reactive specular highlights (beta → Y, gamma → X). Requires iOS `requestPermission()` from user gesture + HTTPS. Deferred because the time-based fallback is visually acceptable.

### Glow shader multi-color + speed support
The "glow" (HDR Caustics) pipeline currently uses `colors[0]` only and ignores the `speed` parameter. Since the unified effect system now allows any effect type on any context (background or button), the glow shader should be enhanced to sample from the full color array and respect the speed uniform. Low impact — current behavior is functional, just limited.

### Existing tenants with page effect intensity > 0.15
The PageEffectConfigSchema intensity cap was lowered from 0.5 to 0.15. Existing tenants with higher values stored in DynamoDB will render fine (renderer reads raw JSON, no validation). But when they open Admin > Settings, the intensity slider now caps at 0.15. Their stored value will display clamped. On save, the old higher value is replaced. No data loss but a subtle visual change they didn't request.

### ~~CDK infra test suite is a placeholder~~ — CLOSED by `test-4` (2026-07-28)
**Was:** `infra/test/infra.test.ts` was entirely commented out (CDK scaffold boilerplate) yet
reported PASS 1/1. No resource assertions, no CI synthesis step — CDK upgrades, construct
changes and dependency bumps had zero automated verification.

**Now:** the stub is deleted. `infra/test/amodx-stack.test.ts` runs a real
`Template.fromStack(new AmodxStack(...))` and makes 15 **named** assertions — cache-key header
and query allowlists, `CookieBehavior: none`, TTLs, the viewer-request CloudFront Function on
both keyed behaviors, `api/*` = CACHING_DISABLED, the S3 static behaviors, the
`cloudfront:CreateInvalidation` blast radius, and both flush schedules — each carrying the
slice or decision that ratified it. CI job `infra-synth`. Mutation-checked in five rounds.
`docs/shipped/slices/test-4-infra-truth.md` § *Build run*.

Deliberately **not** a `toMatchSnapshot()`: a snapshot over 410 resources fails on every
unrelated change and is re-blessed rather than read.

### Two `no-dotenv.cjs` copies (`renderer/` and `infra/`)
**Found:** `test-4` (2026-07-28). **Priority:** low.

`renderer/test/serving-contract/no-dotenv.cjs` (`test-2`) and `infra/test/no-dotenv.cjs`
(`test-4`) implement the same `fs`-layer `.env*` blindfold. They differ in scope — the renderer
copy is hard-scoped to `renderer/`; the infra copy must also cover `admin/`, because the synth
runs the admin vite build too — and `test-4`'s writable surface excluded `renderer/**`, so the
copy was the available move.

**Trigger for consolidating:** a third caller, or any workspace gaining a `packages/test-utils`
for another reason. Do not create such a package *for this*: it would add a build-order edge to
the monorepo to save ~40 lines. If they are ever merged, the merged file must keep both the
audit journal and the `throwIfNoEntry` handling — those are load-bearing for the `(iso*)`
assertions, not decoration.

### Stale compiled `*.js` / `*.d.ts` in `infra/lib` and `infra/bin` shadow the TypeScript sources
**Found:** `test-4` (2026-07-28). **Priority:** medium — it produced a false green once already.

`infra/lib/` and `infra/bin/` carry untracked, gitignored compiled artifacts (`amodx-stack.js`,
`renderer-hosting.js`, …) dated 2026-01-27, left over from before `infra/tsconfig.json` gained
`noEmit: true`. They predate the entire CACHE track:

    grep -c 'RendererCachePolicy\|x-has-session' infra/lib/renderer-hosting.js   -> 0
    grep -c 'DebounceFlushFunc'                  infra/lib/amodx-stack.js        -> 0

Any tool whose module resolution prefers `.js` over `.ts` silently loads that seven-month-old
stack. `infra/cdk.json` has always guarded the deploy path (`ts-node --prefer-ts-exts`);
`test-4`'s first run was NOT guarded and synthesized the stale snapshot — 10 assertions failed
for a reason that had nothing to do with the current source.

**Mitigated, not fixed:** `infra/jest.config.js` now pins
`moduleFileExtensions: ['ts','tsx','js','json','node']`, and assertion `(src1)` fails if that
ordering is removed. The files themselves were left in place on purpose: they are the
operator's working-tree detritus, and deleting them would hide the hazard from the next tool
that has no guard.

**Fix when convenient:** `rm infra/lib/*.js infra/lib/*.d.ts infra/bin/*.js infra/bin/*.d.ts`
locally, and consider whether anything still needs `npm run build -w infra` (today it is
`tsc` against a `noEmit: true` config, i.e. a typecheck wearing the name `build`).

### CDK constructs run application builds inside their constructors
**Found:** `test-4` (2026-07-28). **Priority:** medium. **Blocked on:** the standing
"no `infra/lib` changes" directive.

`RendererHosting` and `AdminHosting` shell out to real builds from their constructors —
`execSync('npm run build:open')` at `infra/lib/renderer-hosting.ts:62` and
`execSync('npm run build')` at `infra/lib/admin-hosting.ts:31` — both with an inherited
`{...process.env}`. So `cdk synth` (and therefore any synth-based test) is neither cheap nor a
pure function of the CDK source. Three consequences:

1. `cd infra && npm test` takes ≈58 s and **rebuilds `renderer/.open-next` and `admin/dist`**
   as a side effect. Both are gitignored and every deploy regenerates them, so nothing durable
   is lost — but a test that rebuilds two applications is surprising and it makes the CI job a
   multi-minute one.
2. The suite cannot be credential-free by omission. `next build` loads `renderer/.env.local`
   (a real `AMODX_API_KEY`, `TABLE_NAME`, `AWS_REGION` on this checkout) and `vite build` loads
   `admin/.env.local`. `test-4` had to add `infra/test/no-dotenv.cjs` +
   `installProcessTreeIsolation()` to close that; the leak is *in the construct*, and the test
   can only work around it from outside.
3. A future test that wants to assert a construct in isolation cannot instantiate it without
   triggering a build. `test-4` rejected stubbing `execSync` because the resulting graph
   differs from the deployed one.
4. **Consecutive runs are not independent.** `OBSERVED` 2026-07-28: a `renderer/.next/standalone`
   tree left behind by a previous run made `next build` die with
   `ENOTEMPTY: directory not empty, rmdir …/.next/standalone/node_modules/next`, which threw in
   `beforeAll` and turned **all 15** assertions red for a reason with nothing to do with infra.
   `rm -rf renderer/.next` clears it. CI is unaffected (clean checkout); a developer re-running
   locally, especially after interrupting a run, is not.

**Fix:** move build orchestration to a deploy script / `npm run` step and have the constructs
consume an already-built directory (failing loudly if it is absent). Then a synth is pure,
the test drops to seconds, and the isolation apparatus above becomes unnecessary.

### ~~`docs/caching-architecture.md` says CloudFront invalidation reaches 3 roles; the template has 4~~ — CLOSED 2026-07-28
**Found:** `test-4` (2026-07-28). **Closed:** same slice, revise cycle, by operator decision
`test4-invalidation-role-contract`.

**Was:** § *Key Architectural Decision: No CloudFront IAM on Mutation Lambdas* said
`cloudfront:CreateInvalidation` is "limited to 3 specialized Lambdas". The synthesized template
grants it to **4** roles: `DebounceFlushFunc`, `InvalidationFlushFunc`, `NightlyCacheFlushFunc`
— and `CustomCDKBucketDeployment…ServiceRole`, CDK's own asset-upload custom resource, which
gets the permission because `renderer-hosting.ts:539` passes `distribution: this.distribution`
to `s3deploy.BucketDeployment`.

**Resolution:** the template is the evidence and it wins — the contract was corrected, not the
infra. That section now states the four roles and the split that matters: 3 **request-path**
Lambdas (the least-privilege claim) + 1 **deploy-time** role that holds the action only during
`cdk deploy`. Assertion `(d)` pins both categories by name and fails on a fifth grant.

### `playwright.yml` still deletes the lockfile; lockfile Linux entries are fragile
Recorded by slice `test-1` (2026-07-27), **updated after the lockfile was repaired** in the same
slice's revise cycle.

**Was:** the committed lockfile carried `@rollup/rollup-darwin-arm64`, `lightningcss-darwin-arm64`,
`@tailwindcss/oxide-darwin-arm64`, `@unrs/resolver-binding-darwin-arm64` and `@img/sharp-darwin-arm64`
with no linux siblings. Confirmed `EXECUTED` in `node:22` on `linux/amd64`: `npm ci` from that
lockfile *succeeded* (the entries are `optional`, so npm skips them silently) and `npm run build`
then died in admin's `vite build` with
`Cannot find module @rollup/rollup-linux-x64-gnu ... (npm/cli#4828)`.

**Now:** the missing entries were **added to the lockfile by hand**, at the exact versions their
parents already pinned. 63 entries added (the linux and win32 siblings of `rollup`,
`@tailwindcss/oxide`, `unrs-resolver`, `lightningcss` and `sharp`); **0 existing entries modified,
0 removed**. Linux entries went 22 → 71. `ci.yml` uses `npm ci`, and `npm ci && npm run build`
is green in `linux/amd64 node:22`.

**Why by hand and not by regenerating.** npm resolves optional platform binaries **against the
host, seeded from the reified `node_modules`**, and will **not** backfill missing optional platform
variants into an existing lockfile. Four in-place repair attempts were run and all four were exact
no-ops: `npm install`; `npm install --package-lock-only`; the same with
`--os=linux --cpu=x64 --libc=glibc`; and `--force`. Hand-deleting the darwin child entries did not
force re-resolution either — npm left them deleted.

A clean-room regeneration (scratch dir with only the `package.json` files, no `node_modules`, no
lockfile) *does* produce the Linux entries, but it re-resolves **every** semver range at the same
time: measured at 344 version changes, 418 entries removed, 212 added. That is a fleet-wide
dependency upgrade — `@tiptap/* 3.13 → 3.29`, `tailwindcss 4.1 → 4.3`, `next 16.2.9 → 16.2.12`,
`@aws-sdk/* 3.1004 → 3.1095` — and it was **rejected** for riding along inside an unrelated CI
slice with no runtime verification behind it. The direct edit changes nothing but the platform
coverage, which is exactly the defect. If those upgrades are wanted, they are their own slice with
their own e2e evidence.

**Rules for anyone touching this in future** (recipe in `TESTING.md` § CI/CD Integration):

- Never "fix" a missing-native error by deleting the lockfile or regenerating it wholesale.
- After any lockfile edit, prove it surgical by parsing old vs new and asserting 0 modified /
  0 removed entries. `git diff`'s default myers algorithm mis-anchors large JSON insertions and
  renders unchanged blocks as delete+add; use `--diff-algorithm=histogram` to read it.

**Residual debt:**

1. **`playwright.yml` still runs `rm -f package-lock.json && npm install`** (line 21). It is
   therefore still unpinned, and installs a *different, floating* dependency set than `ci.yml`.
   Migrating it to `npm ci` is mechanical but was out of `test-1`'s packet scope
   (the packet forbids touching that file). Do it as its own change.
2. **The lockfile's Linux entries are fragile.** They are hand-maintained: any future `npm install`
   that re-resolves one of these five families can prune its foreign-platform siblings back to
   darwin-only, silently reverting CI to red — and the failure appears in `npm run build`, not in
   `npm ci`, so it reads as a build bug rather than an install bug. There is no guard. A cheap one
   would be a CI step asserting `@rollup/rollup-linux-x64-gnu` is present in `package-lock.json`;
   not implemented, and worth doing when `playwright.yml` is migrated.
3. **Coverage is linux + win32 + the pre-existing darwin only.** The `wasm32-wasi` siblings of
   `@tailwindcss/oxide`, `unrs-resolver` and `sharp` were deliberately left out: they depend on
   `@emnapi/*`, `@napi-rs/wasm-runtime` and `@tybys/wasm-util`, none of which are in this lockfile,
   so adding them would stop being a pure platform-entry addition. android/freebsd/openbsd siblings
   were likewise not added. None are reachable from any runner this repo uses.
4. `actions/setup-node`'s `cache: npm` is now usable (it needs a valid lockfile) but was left off
   to keep the slice minimal.

`security-audit.yml` is unaffected: it already used `npm ci` and only installs, never builds.

## Low Priority

### RecaptchaConfigSchema.enabled field is deprecated
The `enabled` boolean in `RecaptchaConfigSchema` (shared/index.ts) is no longer used by the resolver. Deployment-level keys make reCAPTCHA mandatory. The field is retained for backward compatibility with existing DynamoDB records. Can be removed in a future schema migration if all tenants are re-saved (the field would simply be ignored on read).

### WGSL shader build-time validation
The `@amodx/effects` package contains WGSL shaders as TypeScript string constants. These are only validated at runtime when `device.createShaderModule()` is called in the user's browser. A reserved keyword (`ptr`) shipped to production and caused silent render failure — no console output, no visual indication, just a blank canvas.

**Required:** Add build-time WGSL validation so shader errors fail the build, not the user session.

**Recommended approach:** Naga CLI (Rust WGSL validator used by Firefox/wgpu) as a pre-build step + `wgsl_reflect` npm package for fast local checks. Either one alone would have caught the `ptr` reserved keyword issue.

**Files affected:** `packages/effects/src/shaders/*.ts` (aurora, plasma, caustics, glow, confetti)

**Current mitigation:** Runtime diagnostic logging added to `createFullscreenPipeline()` — calls `module.getCompilationInfo()` and throws with line-number diagnostics on error. This surfaces errors in the browser console but does NOT prevent bad shaders from reaching production.

### Replace `any` types in admin pages
Several admin pages (Orders, Customers, Products, etc.) use `any` types for API responses. Create proper TypeScript interfaces using the shared schemas.

### Serving-contract suite — coverage the origin cannot reach (slice `test-2`)

`renderer/test/serving-contract/` pins the origin half of `docs/caching-architecture.md`
§ *Serving contract*. Three gaps are deliberate, documented here so they stay known
positions rather than assumed coverage:

1. **The CloudFront half is untested by anything runnable.** The cache-key header allowlist,
   the query-string allowlist, and the `x-has-session` viewer-request Function
   (`infra/lib/renderer-hosting.ts`) are inline ES5 in a CDK template literal — invisible to
   `tsc`, to lint and to the `infra` suite. `cache-3` exercised them with
   `probe-cache3-cffunc.mjs`, which is **not committed** (it lives with that slice's relay
   working state). Hazards H1 and H3 both live in that layer. Owner: slice `test-4`
   (`cdk synth` assertions), which should adopt that probe rather than re-derive it.
2. **The OpenNext Lambda bundle is not driven by any committed harness.** `cache-1`
   re-measured every row through the built bundle by hand; the driver is likewise
   uncommitted. Slice-doc § Non-scope calls this out as a separate slice if wanted.
3. **Two measured rows were left unasserted** because they sit outside the ratified
   assertion list: `/_dyn/<path>` from the wire (measured `404` + `private, no-store` — a
   cache-*bypass* surface, so worth pinning) and `RSC: 1` flipping the body to
   `text/x-component` (the origin premise the H1 fix rests on). Both measured green on
   2026-07-28; see the slice doc § *Not built*.

---

## Completed

- ~~Coupon not wired through checkout~~ — DONE (server-side validation, atomic usage increment)
- ~~Delivery date picker missing from checkout~~ — DONE (mini calendar, yearly holidays, lead-day skip)
- ~~Split CDK api.ts~~ — DONE (parent + 2 NestedStacks)
- ~~Navbar shrink-on-scroll~~ — DONE (h-16→h-12, logo shrinks, CSS transitions)
- ~~Commerce bar above navbar~~ — DONE (phone, social icons, cart total, CTA button)
- ~~availableFrom/availableUntil not enforced~~ — DONE (filtered in all public endpoints + renderer SSR)
- ~~Order workflow / status enum~~ — DONE (placed/confirmed/prepared/shipped/delivered/cancelled/annulled)
- ~~Configurable email templates~~ — DONE (per-status templates with {{variables}}, configurable recipients)
- ~~WooCommerce import: SKU + variations~~ — DONE (two-pass parsing, variable→variants mapping)
- ~~Payment methods config~~ — DONE (enabledPaymentMethods, bank transfer details in admin)
- ~~Footer enhancement~~ — DONE (company details, footer links, legal links, multi-column layout)
- ~~Product variants admin tab~~ — DONE (VariantsTab in ProductEditor with groups + options)
- ~~Customer accounts (Phase 5E)~~ — DONE (NextAuth Google OAuth, account page, order history, checkout pre-fill)

## test-3 residuals (2026-07-28, from ratification packet TEST3-SLICEDOC-STATUS)

- **F-SHARED-1 (PRODUCT BUG, migration-sensitive):** `ShippingAddressSchema.country`
  defaults to literal `"Romania"`, violating the universal-default rule; persisted
  orders carry the value. Fix needs a schema default change + decision on existing
  rows. Address: before Track B storage cutover (cmrc-4) at the latest.
- **F-BACKEND-2 (PRODUCT BUG):** `isProductAvailable` compares availableFrom/Until
  against the UTC day, not tenant-local time — products flip availability at the
  wrong hour for non-UTC tenants. Address: with commerce work or sooner.
- **F-BACKEND-1:** `invalidate-cdn.ts` has no pure seam; unit coverage skipped per
  slice instruction (no src changes). Address: opportunistically when the file next
  changes (cache-4 touches it).
- **F-RENDERER-1:** `tenant-directory.ts` lacks an injectable clock/lookup; tests use
  a module-registry substitute. Acceptable; a seam only if the module grows.
- **Test files outside typecheck:** `packages/shared` and `backend` test dirs are not
  in `tsconfig.include`, so `typecheck` doesn't cover them. Address: test-4 or a
  one-line tsconfig ride-along in the next slice touching those workspaces.
  *(2026-07-28, `vid-1`: `packages/plugins/test/` joins the list — same cause, and here a
  one-line `include` widening is the WRONG fix, because that tsconfig also drives
  `npm run build` and would emit the test file into `dist/`. The correct fix for all three
  is a `tsconfig.test.json` per workspace plus a second `tsc --noEmit` invocation, which is
  three files of structure for a gap that has caught nothing yet — deferred deliberately.)*

## vid-1 residuals (2026-07-28)

Parser-module gaps in `packages/plugins/src/common/videoSource.ts`. All four are **chosen
positions**, each pinned by a test that asserts the current behaviour, so none can regress
silently into a wrong answer.

- **`youtube.com/live/{id}` and legacy `youtube.com/v/{id}` classify as `unknown`.** The
  plan enumerates four YouTube forms and these are not among them. A tenant pasting a
  livestream URL gets the graceful-degradation path (nothing rendered), not a broken embed.
  Address: one line each in `youtubeId()` when a tenant asks.
- **`youtube-nocookie.com` classifies as `unknown`.** Privacy mode is explicit non-scope in
  the slice; the plan parks it as a future tenant-level setting. Note the asymmetry this
  creates: a tenant who has *already* pasted a nocookie URL gets no embed. Address: with the
  privacy-mode setting, not before.
- **Vimeo unlisted-video privacy hashes (`vimeo.com/{id}/{hash}`) classify as `unknown`.**
  Playing those needs `?h={hash}` on the player URL, which `ParsedVideoSource` does not
  model. Emitting `player.vimeo.com/video/{id}` without it would 404 at the player — a
  broken embed is worse than no embed. Address: needs a field on `ParsedVideoSource`, so it
  is a schema-shaped change, not a regex tweak.
- **`isDirectMediaUrl`'s scheme guard is defence in depth, not output encoding.** RATIFIED
  2026-07-28 as an amendment to the plan's `direct` rule (`VID1-DIRECT-SCHEME-CONTRACT` =
  RETAIN) — so the guard itself is *not* debt, and `docs/plan-youtube-vimeo-embed.md` rule 3
  was edited to match. The debt is what it does **not** cover: it stops
  `javascript:`/`data:`/`vbscript:`/`file:` reaching `kind: "direct"`, but `vid-2` and `vid-3`
  still own not putting an arbitrary tenant string into an attribute unencoded — and
  `ParsedVideoSource.rawUrl` still carries the raw input for editor echo-back even when
  `kind` is `unknown`. Address: as part of those slices' render paths.
  *(Sharpened at revision 2, 2026-07-28: for `kind: "direct"` the plan's contract is that
  `embedUrl` **is** the raw URL — `embedUrl === rawUrl`, byte for byte, no normalization of
  any kind. So the only thing standing between a tenant-pasted string and `<video src>` on
  that path is the scheme guard plus whatever `vid-2` does. Contrast the provider path, where
  `embedUrl` is rebuilt from a validated id and none of the caller's string survives. `vid-2`
  must not read "the parser returns an embedUrl" as "the parser returns a safe embedUrl" —
  that is true for `youtube`/`vimeo` and false for `direct`.)*
  *(**Discharged for the `video` block, 2026-07-28, `vid-2`.** `video/VideoRender.tsx` never
  renders `rawUrl`; provider kinds get a URL rebuilt by `buildEmbedUrl` from the validated id;
  `direct` gets `embedUrl` inside a JSX attribute, which React escapes, and the scheme guard
  bounds it to http(s)/relative; the file uses no `dangerouslySetInnerHTML`. Pinned by
  `test/videoPlugin.test.ts` § *hostile input renders nothing*, which asserts the END-TO-END
  result — `javascript:`/`vbscript:`/`data:`/`file:` media-lookalikes and a markup-injection
  attempt all produce the empty string. **Still open for `video-hero`**, which does not use
  the parser until `vid-3`.)*
  *(**Discharged for `video-hero` too, 2026-07-28, `vid-3` — this residual is now CLOSED.**
  `video-hero/VideoHeroRender.tsx` never renders `rawUrl`; the provider kinds get a URL
  rebuilt by `buildBackgroundEmbedUrl` from the validated id; `direct` gets `embedUrl` inside
  a JSX attribute, which React escapes, bounded by the scheme guard; there is no
  `dangerouslySetInnerHTML`. This was a REAL exposure, not a formality: before `vid-3` the
  block dropped `videoSrc` into `<source src>` with no scheme check whatsoever, so
  `javascript:…/clip.mp4` reached the attribute. Pinned by
  `test/videoHeroPlugin.test.ts` § *hostile input degrades to the poster*. Note the one thing
  it does NOT cover — `posterSrc` — which is carried forward below.)*

## vid-2 residuals (2026-07-28)

Both items are **admin-side styling**, both are recorded rather than fixed because fixing
either is a design-system change with callers well outside slice `vid-2`'s writable surface.

- **No semantic `warning` token in the admin design system.** `admin/src/index.css`
  `@theme inline` defines `muted`, `accent`, `destructive`, `border`, `primary`, `secondary`,
  `card`, `popover`, `chart-1..5` and `sidebar-*` — and no warning/caution family.
  `docs/plan-youtube-vimeo-embed.md` § *Editor UX* asks for an "amber warning" on an
  unrecognized video URL; `bg-amber-50` would be a hardcoded colour (CLAUDE.md Critical
  Rule 6) and `destructive` is the wrong semantic — nothing failed, and the validation is
  deliberately warning-only and non-blocking. So `VideoEditor.tsx`'s callout uses the neutral
  fallback the slice doc prescribes: `border-border` + `bg-muted` + `text-muted-foreground`,
  with the `TriangleAlert` icon SHAPE carrying the severity. Consequence: a warning and an
  informational note are visually identical in the admin today. Address: add
  `--warning` / `--warning-foreground` to `admin/src/index.css` (light + dark) and the
  `@theme inline` map, then switch this callout and any others; it is a design-system slice,
  not a plugin slice.
- **`video/VideoEditor.tsx` retains pre-existing hardcoded chrome colours.** `vid-2` removed
  the one that was actively wrong — the fixed YouTube-red badge (`bg-red-50 text-red-600`) on
  a block that now also serves Vimeo and uploaded media — and replaced it with the detected
  provider in theme tokens. It did **not** touch `border-gray-200`, `bg-white`,
  `bg-gray-50/50`, `text-gray-700`, or the local `Input`'s `focus:border-red-500`: those are
  the shared visual language of every plugin editor in the package (see
  `html/HtmlEditor.tsx`, `reviews-carousel/ReviewsCarouselEditor.tsx`, which are wholesale
  amber), so changing them in one file would make it the odd one out rather than fix
  anything. `test/videoPlugin.test.ts` asserts vid-2 did not ADD to the set. Address: a
  package-wide editor-chrome tokenization pass, once the warning family above exists.

## vid-3 residuals (2026-07-28)

Track A is complete with `vid-3`; these are what it deliberately did not do. The first two
are the slice doc's own § Non-scope, restated here so they are findable from the debt
register rather than only from a closed slice.

- **`youtube-nocookie.com` privacy mode.** Not a parser gap that can be patched in isolation:
  a nocookie URL classifies `unknown` today (`vid-1` residuals above), and the plan parks the
  fix as a TENANT-LEVEL setting — the tenant chooses privacy mode and every embed on the site
  switches origin. That means a `TenantConfig` field, a Settings control, and a way to get
  that setting into a pure plugin render component that today receives only `{ attrs,
  tenantId? }`. Address: as a small slice of its own, not as a regex change. A future CSP must
  then allow `frame-src https://www.youtube-nocookie.com` as well.
- **oEmbed provider metadata (title, duration, channel, Vimeo thumbnails).** `vid-3`'s editor
  shows a real thumbnail for YouTube only, because YouTube has a static id-derivable URL
  (`img.youtube.com/vi/{id}/hqdefault.jpg`) and Vimeo does not — its thumbnail needs an oEmbed
  round trip. That means a network call from a plugin editor, which nothing in this package
  does today, plus caching and a failure mode. Consequence meanwhile: the Vimeo preview is an
  id-labelled placeholder, not a picture. Address: with the schema Option B work below, which
  is where fetched metadata would be stored.
- **Schema Option B — a normalized `VideoSourceSchema`.** Both blocks keep a dumb string
  (`url` / `videoSrc`) and re-parse it on every render, which is Option A of
  `docs/plan-youtube-vimeo-embed.md` § *Architecture Decisions 1* and is correct while the
  parse is a pure nanosecond regex with no metadata to keep. It stops being correct the moment
  anything needs to be STORED alongside the id — oEmbed metadata, a per-block privacy-mode
  override, a Vimeo unlisted-video hash. Address: migration of two blocks' persisted attrs, so
  it needs a real data-migration slice; do not do it incidentally.
- **The `video-hero` cover sizer is viewport-relative, not container-relative.** The ratified
  sizer (plan § Phase 3) uses `177.7778vh` / `100vh` / `56.25vw`, while the hero section is
  `min-h-[70vh]` — a *minimum*. If an author's headline, subheadline and CTA push the section
  TALLER than the viewport, the box can stop covering the bottom of it and the overlay colour
  shows through. Not reachable at default content lengths, and over-covering (the normal case)
  is harmless because the section is `overflow-hidden`. A container-relative version needs
  `container-type: size` on the section plus `cqw`/`cqh` units — well supported now, but it
  changes the ratified geometry, so it is a decision, not a tidy-up. Address: only if the
  operator's landscape/portrait checks find a real case.
- **`posterSrc` is not validated anywhere.** `vid-3` put `videoSrc` behind the parser's scheme
  guard and thereby closed the `vid-1` residual for this block — but `posterSrc` is an IMAGE
  URL, outside `parseVideoSource`'s domain, and still reaches `<img src>` / `<video poster>`
  exactly as it did before. Unchanged pre-existing surface, and the same is true of every
  image-bearing plugin in the package (`image`, `hero`, `carousel`, `testimonials`), so this
  is a package-wide gap rather than a `video-hero` one. Bounded by the fact that the value
  comes from an authenticated tenant admin and lands in a React-escaped attribute; a
  `javascript:` URL in `src` is inert in every current browser (unlike `href`). Address: a
  shared image-URL guard applied across the package, if it is judged worth the surface.

## fnd-1 residuals (2026-07-28)

`fnd-1` added `normalizeEmail()` to `@amodx/shared` and **deliberately changed zero call
sites** (its § Non-scope). The estate therefore still normalizes email identity inline and
inconsistently — that is not a regression the slice introduced, it is the pre-existing state
the slice exists to make fixable. Everything below is `fnd-2`'s work; the full table with
`file:line` is `docs/shipped/slices/fnd-1-normalize-email.md` § *Call-site inventory*.

- **Three email-keyed reads apply NO normalization at all — the highest-priority item.**
  `backend/src/customers/get.ts:24` and `:35` and `backend/src/customers/update.ts:31` build
  `CUSTOMER#<email>` / `CUSTORDER#<email>#` straight from a raw path parameter, while
  checkout (`backend/src/orders/create.ts:337`) writes the key lowercased. An admin opening
  `Customer@x.com` therefore misses the record checkout wrote as `customer@x.com` and sees
  "not found" rather than an error. Pre-existing; unchanged by `fnd-1`.
- **Eleven inline `.toLowerCase()` sites lowercase but never `trim()` or NFKC** (5 files).
  Two are not merely key reads: `backend/src/orders/public-get.ts:23` is the **authorization**
  compare for anonymous order lookup, and `backend/src/resources/presign.ts:35` gates signed
  asset URLs by order history. A migration that changes normalization changes what those two
  admit — `fnd-2` must treat them as security-relevant, not as mechanical replacements.
- **`EMAILLIMIT#<email>` is bypassable by encoding.** `backend/src/orders/create.ts:393` keys
  the order-confirmation email rate limit on a lowercased-only address, so `a@x.com` and a
  fullwidth or decomposed-accent variant get independent hourly budgets. Low severity (the
  limit is anti-bombing, not authorization) but it is a real hole in a control that exists.
- **Validation runs before normalization, i.e. the wrong way round.**
  `backend/src/orders/create.ts:30` parses the raw body with `OrderInputSchema` and lowercases
  at `:293`, so the value actually persisted was never validated in the form it was persisted
  in. The verdicts differ in practice — a fullwidth `＠` address fails `z.string().email()`
  raw and passes after NFKC. `fnd-1` pins the *rule* by test; `fnd-2` fixes the *call sites*.
- **`fnd-2` is a key migration, not a refactor.** Any persisted `CUSTOMER#<email>` whose stored
  form differs from `normalizeEmail(email)` becomes unreachable the moment its readers switch.
  It needs expand-before-contract: dual-read old+new keys, backfill, then contract. Do not
  schedule it as a mechanical find-and-replace.
- **Accepted, not debt (recorded so it is not "fixed" by mistake):** the Unicode default
  lowercase of `İ` (U+0130) is `i` + COMBINING DOT ABOVE, so `İSMAIL@x.com` and `ismail@x.com`
  are different identities. The alternative, `toLocaleLowerCase("tr")`, makes the identity key
  depend on ambient locale. Determinism wins; if a tenant ever hits it, the fix is a support
  merge, not a change to the function.

## cache-6 residuals (2026-07-28)

### `_next/image*` webp/avif negotiation does not happen at the edge
**Found:** `cache-6`. **Priority:** medium (bandwidth, not correctness). **Pre-existing** —
`cache-6` did not introduce it and did not widen it.

The OpenNext image adapter emits `Vary: Accept` and Next's optimizer selects the output format
from the request's `Accept` header. CloudFront does not honour origin `Vary`, and `Accept` is
in neither `ImageCachePolicy`'s key nor any origin request policy on that behavior, so the
optimizer always sees no `Accept` and falls back to the source format. Identical under the
managed `CACHING_OPTIMIZED` policy this replaced: `cache-6` changed which *query parameters*
are keyed, not which *headers* are.

**Do not fix by adding `Accept` to the cache key.** Raw `Accept` strings are high-cardinality
and would fragment every image across browser versions — the same fragmentation `cache-3`
removed from the default behavior's query allowlist. The shape that works is a normalized
one-bit-per-format header derived in a viewer-request CloudFront Function, exactly as
`x-has-session` is derived. Not scoped.

**Trigger for doing it:** image bandwidth showing up in the CloudFront bill, or a Lighthouse
"serve images in next-gen formats" finding on a real tenant.

### Nothing derives the CloudFront allowlists from the code that depends on them
**Found:** `cache-6`. **Priority:** medium.

Both `cache-6` defects are the same shape: *an input the application requires was absent from a
CDK allowlist, and CloudFront deleted it*. Assertions `(g)` and `(h)` in
`infra/test/amodx-stack.test.ts` now pin both lists exactly, which stops a regression — but
nothing detects the **next** omission, because nothing extracts the required set from the
consumers (`renderer/src/app/api/revalidate/route.ts`'s `headers.get('x-revalidation-token')`,
the optimizer's `const { url, w, q } = query`).

**The next omission arrived (`cache-7`, 2026-08-05), exactly as predicted.** A third header
pair required by a consumer — `x-prerender-revalidate` + `x-isr`, sent by open-next's
RevalidationFunction (`node_modules/open-next/dist/adapters/revalidate.js:25-26`) — was absent
from the same `(h)` allowlist, so background ISR regeneration was a no-op for every page in
prod. It was caught by an operator reading CloudWatch, not by any guard; assertion `(h)` was
updated to ten headers *after* the fact. The consumer this time is a `headers: {...}` literal
inside open-next's *own bundled source*, i.e. the harder-to-extract side this item already
flagged. The trigger below stands, now with two data points behind it.

`cache-3`'s `probe-cache3-cffunc.mjs` §C is the pattern that would close it — extract both
sides, fail on divergence. Deliberately not applied here: one of the two consumer sides is a
destructure inside Next's own bundled source, so the extraction would be far more fragile than
the cookie-name comparison it would be modelled on, and a flaky guard on a deploy-gating suite
is worse than a documented gap.

### `sharp` request-time exposure — `cache-6` enables one path; `dep-1` still owns the answer
**Found:** `cache-6`, as a ripple of D2. **Priority:** informational; owner is `dep-1`.

The dependency tracker's item 2 asks whoever runs `dep-1` to establish "(a) whether the
deployed bundle ships `sharp`, and (b) whether any un-trusted image can reach it". `cache-6`
supplies half of (a): the image-optimization Lambda **is** deployed and
`renderer/.open-next/image-optimization-function/` **is** built into the stack (`OBSERVED`).

**Correction, 2026-07-28 (review iteration 0).** The first version of this entry claimed live
request-time exposure is "zero today", on the grounds that CloudFront strips the query string
so every request 500s before an image is fetched or decoded. **That does not follow, and the
claim is withdrawn.** CloudFront is not the only path to the function. The same Lambda carries
its own Function URL with `AuthType: NONE` and a `lambda:InvokeFunctionUrl` permission for
`Principal: "*"` — `OBSERVED` in `infra/cdk.out/AmodxStack.template.json`
(`RendererHostingImageOptFunctionFunctionUrl279D4F6A`,
`RendererHostingImageOptFunctioninvokefunctionurl3C0532AE`), source
`infra/lib/renderer-hosting.ts:152-154`. A request sent straight to that URL never traverses
the distribution, so nothing strips its query string and it reaches the optimizer **today**.
Edge behaviour bounds one path; it establishes nothing about exposure.

The accurate statement is therefore: **`cache-6` enables the CloudFront path to the optimizer.
It neither creates nor removes the Function-URL path, and it neither raises nor lowers the
exposure `dep-1` has to characterise.** What `dep-1` must still determine is unchanged in
substance and now explicitly two-part: the **reachable input set** — which `url` values the
optimizer will actually fetch and decode, across *every* path that reaches it, not just the
CloudFront one — and the `sharp` version that is actually shipped in the bundle.

One lead, offered as a lead and not an answer: the built bundle contains the literal string
`remotePatterns:[]` (`OBSERVED` in `renderer/.open-next/image-optimization-function/index.mjs`;
`renderer/next.config.*` sets no `images` config, so this is Next's default). *If* that is the
config the request path actually consults, it would reject absolute remote URLs and leave only
same-origin `url` values. Whether it is, is `INFERRED` and unverified — it is exactly the kind
of thing `dep-1` must confirm from the request path rather than assume from a string match.

None of this is a reason to hold the fix — a broken image pipeline is the larger harm — but
`dep-1`'s `sharp >= 0.35.0` bump is on the critical path either way.

## Image optimization: second, deeper defect (2026-07-28, staging probes post-cache-6)

- **What:** with cache-6's transport fix deployed (query params now reach the image
  Lambda), the optimizer fails at its upstream fetch: `TypeError: a is not a function`
  (CloudWatch, ImageOptFunction) — the open-next@3.1.3 image handler is
  runtime-incompatible with next@16. Layer 1 of the defect (CloudFront stripping
  url/w/q) is FIXED; layer 2 makes optimized images still 500 until resolved.
- **Prod impact:** unchanged from before (images were already 500 via layer 1); no
  regression from any Track CACHE deploy.
- **Proper solution:** the open-next upgrade slice (option C lineage from CACHE-1-D2):
  upgrade open-next to a Next-16-supporting major, re-run the FULL serving-contract
  suite (test-2) + live probe suite — the upgrade swaps the entire serving adapter, so
  it is its own production-sensitive slice, not a ride-along.
- **When:** before any tenant work that depends on next/image; otherwise next in the
  CACHE track after the combined deploy ships.
- **Status:** OPEN

## MCP server runtime floor (2026-08-01, resolved incident)

- **What happened:** SEC-1's @modelcontextprotocol/sdk bump requires Node >= 20 (uses
  the `File` global). Claude Desktop resolved an older node -> server crashed
  ~7s after initialize with `ReferenceError: File is not defined` ("Server
  disconnected"). Fixed by pinning `/opt/homebrew/bin/node` in
  claude_desktop_config.json (backup: .bak-2026-08-01) and declaring
  `engines.node >= 20` in tools/mcp-server/package.json.
- **Residual:** engines is advisory at runtime; a version check at server startup
  (fail-fast with a clear message, matching the existing e2366e9 fail-fast pattern)
  would make this loud. Add with the next mcp-server slice.
- **Status:** incident RESOLVED; startup version check OPEN

## EMAIL-HOTFIX-1 residuals (2026-08-01)

`EMAIL-HOTFIX-1` implemented the ratified ship-now half of D-EMAIL-6 (option D): the `From`
header now carries the tenant `siteName` as an RFC 5322 display name at all six SES send
sites, via `backend/src/lib/email-from.ts` (`formatFromHeader`). When a send site has no
tenant name in scope, the display name falls back to the platform brand label
(`DEFAULT_FROM_NAME`, "AMODX") — a bare address is never emitted. The sender ADDRESS is
unchanged. Deliberately NOT in scope (each is ratified-deferred, not an oversight):

- **The full per-tenant sender identity is unshipped — this is only the brand-*label*, not a
  per-tenant sending domain.** Mail still leaves from the one shared platform address, so
  F-EMAIL-1's DKIM/SPF/deliverability half is untouched. That is `email-2a` (ratified
  D-EMAIL-6 option B / D-EMAIL-1). Do not read the display-name fix as closing F-EMAIL-1.
- **`Reply-To` was NOT added** (ratified D-EMAIL-6.4 defers it until an explicit
  reply-address contract exists; see F-EMAIL-2 / F-EMAIL-2b). Customer replies to order mail
  still reach the platform inbox, not the merchant, for every tenant.
- **`backend/src/webhooks/paddle.ts` carries the platform brand label, not a tenant name.**
  The Paddle digital-delivery path loads no tenant config, and the hotfix forbids adding a
  DDB read to a send path, so its `From` reads `"AMODX" <…>` rather than the buyer's tenant
  name. Cost to personalise: one `GetItem` (`SYSTEM` / `TENANT#<id>`) per webhook to fetch
  `name`. Fold into `email-2a` where tenant config is loaded anyway.
- **Status:** display-name change IMPLEMENTED (uncommitted, pending review/deploy); per-tenant
  identity + Reply-To + paddle tenant-name personalisation OPEN (→ `email-2a`)

## Google OAuth client inactivity clocks (operational note, 2026-08-06)

- Google deletes OAuth clients after 5 months without a sign-in/token exchange
  (incident: amodx-481815 deletion warning; resolved by human logging in periodically).
- Applies PER CLIENT: the live tenant-configured client (blog comments/account
  sign-in) and the test client each have their own clock; per-tenant Google clients
  (Critical Rule 8 pattern) will each carry one.
- Track C input: once customer auth ships, real traffic keeps live clients warm; the
  auth settings card should surface "Google sign-in last used" per tenant (same
  health-card pattern as the EMAIL plan's DNS checker) so dormant clients are visible
  before Google's mail arrives.
- Until then: human logs in via blog comments every ~4 months.

## opennext-1 PARKED (human 2026-08-08)

- Decision: skip the OpenNext 3.1.3 -> Next-16-supporting upgrade for now.
- Consequence: `_next/image` optimization stays 500 (pre-existing, no regression;
  raw/direct image URLs work; renderer galleries use raw asset URLs, not next/image).
  cache-4b (tag revalidation) stays WITHDRAWN - it was the other thing this unblocked.
- Revisit trigger: a real need for on-the-fly image resizing (e.g. tenant-uploaded
  hero images at multiple breakpoints hurting load), OR a Next/OpenNext security
  advisory forcing the bump. Until then, not worth the full serving-adapter swap risk.
- Standing: rev-4 gallery + any new image UI must use raw asset URLs, never next/image,
  until this lands.
- Status: PARKED (not OPEN debt - a deliberate deferral with a named revisit trigger)
