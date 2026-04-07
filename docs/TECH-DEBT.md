# Technical Debt Tracker

Items tracked here are known issues that don't block production but should be addressed.

---

## High Priority (Missing Features)

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

### Deferred npm audit vulnerabilities (blocked on infra guardrails)
Three groups of vulnerabilities remain unfixed because their fixes require upgrading frozen packages. These MUST NOT be upgraded until CDK infra snapshot tests and CI `cdk synth` are in place.

**aws-cdk-lib 2.241.0** (pinned to exact version in `infra/package.json`):
- `yaml@1.10.2` (moderate) — Stack Overflow via deeply nested YAML. Bundled inside aws-cdk-lib. Fixed in aws-cdk-lib >= 2.245.0.
- `brace-expansion@5.0.3` (moderate) — Zero-step sequence hang. Bundled inside aws-cdk-lib. Fixed in aws-cdk-lib >= 2.245.0.
- **Actual risk**: Near-zero. CDK never parses untrusted YAML or user-supplied brace patterns. These are build-time tools.

**open-next@3.1.3 / esbuild@0.19.2** (open-next pins esbuild):
- `esbuild <= 0.24.2` (moderate) — Dev server cross-origin request vulnerability (GHSA-67mh-4wv8-2f99). Only applies to `esbuild --serve`, which open-next does NOT use. Build-time only.
- **Actual risk**: Zero in production. esbuild is a bundler, not a server, in our deployment.
- **Blocked on**: upstream open-next releasing with esbuild >= 0.25.0.

**Upgrade plan**: (1) Add infra snapshot tests + CI `cdk synth`, (2) add targeted CDK assertions for critical resources, (3) baseline synth/diff, (4) upgrade aws-cdk-lib to >= 2.245.0, (5) wait for open-next to update esbuild dep.

### CDK infra test suite is a placeholder
`infra/test/infra.test.ts` is entirely commented out (CDK scaffold boilerplate). No snapshot test, no resource assertions, no CI synthesis step. This means CDK upgrades, construct changes, or dependency bumps have zero automated verification. Must be activated before any aws-cdk-lib version change.

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
