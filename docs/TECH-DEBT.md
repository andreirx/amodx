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

**Remaining — 2 high + 27 moderate (whole repo).** Every one needs a `--force` breaking downgrade or a
deliberate version-pin bump; none clears with plain `npm audit fix`. **Do NOT run `npm audit fix --force`.**
Grouped by the parent that owns the fix:

1. **`aws-cdk-lib` 2.241.0 — exact pin in `infra/package.json` (deploy-time).** `aws-cdk-lib` (HIGH —
   OS command injection in NodejsFunction bundling), bundled `fast-uri` (HIGH — path traversal / host
   confusion), `yaml` (mod — stack overflow), `brace-expansion` (mod — ReDoS). All four are **bundled
   inside the cdk tarball**, so `npm audit fix` cannot dedupe them out.
   - **Fix:** bump the pin `2.241.0 → 2.260.0` — semver-*minor*, not major (shows as `--force` only
     because the version is exact-pinned). Clears all four at once.
   - **Runtime exposure:** none. CDK is build/deploy tooling, never bundled into a Lambda or the
     renderer, and never parses untrusted URLs / YAML / brace input.
   - ~~**Gated on** the CDK infra test suite~~ — **GATE SATISFIED 2026-07-28 by `test-4`.**
     `infra/test/amodx-stack.test.ts` runs a real `Template.fromStack` on every push (CI job
     `infra-synth`). Note what this gate does and does not give you: the 15 assertions are
     **named**, not a snapshot, so a `2.241.0 → 2.260.0` bump that changes the cache key, the
     invalidation blast radius or a flush schedule fails with the property's name — but a bump
     that changes anything *not* asserted passes silently. Before bumping, also run a manual
     `cdk synth` of both stages and diff the templates by hand; there is no baseline artifact.
2. **`open-next` 3.1.3 / `esbuild` (renderer build, build-time).** `esbuild` + `open-next` (mod). The
   advisory is the `esbuild --serve` dev-server CORS hole; open-next uses esbuild as a one-shot bundler,
   not a server. `--force` → `open-next@0.0.1` (absurd downgrade). **Fix:** move open-next forward to a
   release carrying patched esbuild.
3. **`next` / `postcss` (renderer, build-time).** `postcss` XSS via unescaped `</style>` in CSS
   stringify, bundled in `next`. `--force` → `next@9.3.3`. **Fix:** Next.js ≥ 16.3 stable (16.3 is
   canary as of writing). The renderer does not inject user content into CSS-stringify paths.
4. **`next-auth` 4.x / `uuid` (renderer, server-side runtime).** `uuid` missing buffer-bounds check in
   v3/v5/v6 when `buf` is passed, bundled in next-auth. `--force` → `next-auth@3.29.10` (breaking).
   **Do NOT downgrade NextAuth.** We never pass a custom `buf`, so standard usage is unaffected. Resolve
   during the Track C / customer-auth dependency review.
5. **`jest` / `ts-jest` toolchain (infra test, dev-only).** ~19 of the 27 moderate:
   `@istanbuljs/load-nyc-config → js-yaml` quadratic DoS, propagated up the whole jest tree (`@jest/*`,
   `babel-jest`, `jest`, `ts-jest`, …). `--force` → `jest@25` / `ts-jest@27` (ancient breaking
   downgrades). Dev-only test tooling, never deployed. **Fix:** refresh the infra jest/ts-jest stack to
   versions with a patched `js-yaml` — not a downgrade.

**Order when `dep-1` runs:** (1) ~~activate CDK infra tests + CI `cdk synth` baseline~~ **DONE
(`test-4`, 2026-07-28)** → (2) bump
`aws-cdk-lib → 2.260.0` (clears both HIGH + `yaml` + `brace-expansion`) → (3) move `open-next` forward
for `esbuild` → (4) Next.js 16.3 stable for `postcss` → (5) review `next-auth`/`uuid` in Track C →
(6) refresh jest/ts-jest.

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
`docs/slices/test-4-infra-truth.md` § *Build run*.

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
