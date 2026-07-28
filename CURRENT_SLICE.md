# CURRENT_SLICE.md

## Current Priority

**Track CACHE is code-complete and awaiting one combined deploy.** All three slices are
implemented; nothing is deployed.

`cache-3` — CloudFront cache-key hygiene — is **IMPLEMENTED 2026-07-27 (revision 5 —
review iteration 3's three required changes applied; revision 4 applied review iteration 2's
four; revision 3 applied both human decisions), review pending**
(`docs/slices/cache-3-cache-key-hygiene.md`, § Ratified resolutions + § Revision 5 +
§ Build run 2026-07-27 revision 5). Revision 5 is **documentation-only** — the sole non-`.md`
edit is a code comment, and the synthesized CloudFront template was measured byte-identical
across it (slice doc build-run rows 5/5b). The evidence gate was re-run from scratch anyway:
the source-isolated synth comparison shows the same three semantic deltas and nothing else
(rows 5c/5d). It fixes
the staging deploy command (`-c stage=staging` is mandatory —
`infra/bin/infra.ts:12` defaults to `prod`), replaces the stale "two-property edit" CDK
scope statement with the real three-delta/two-construct scope, and corrects a comment in
`infra/lib/renderer-hosting.ts` that named a nonexistent middleware function.

It closes **H1** (the RSC header family was missing from the CloudFront cache key), replaces
`queryStringBehavior: all()` with a 7-parameter allowlist, moves the `amodx_ref`
attribution cookie off page responses (`components/ReferralCapture.tsx` inline script
beacons to `app/api/ref/route.ts`, which sets the cookie — the write stayed server-side
because a `document.cookie` write cannot overwrite the pre-deploy `HttpOnly` cookie,
RFC 6265 §5.3 step 11, slice doc F8), and — **new in revision 3** — closes **H3**.

**H3, found in review iteration 2:** the cache key was blind to the session cookie
(`cookieBehavior: none()`, no session-derived header), so an authenticated request had the
*same* key as an anonymous one. Middleware's rule that session traffic goes to the
`no-store` twin is an **origin** behaviour and a warm entry is answered before the origin
runs — so on an access-gated page a signed-in visitor would have been served the cached
"Restricted Access" shell for up to a year. Per decision `CACHE3-SESSION-KEY` = **option B**,
the existing viewer-request CloudFront Function now derives `x-has-session: '0'|'1'` from the
cookie jar and that header is in the cache key. Cookies stay out of the key. The match is by
**prefix** (revision 4, narrowed from revision 3's substring test) over
`next-auth.session-token` and the legacy `__secure-next-auth.session-token`, so chunked
`.0`/`.1` variants are covered and names that merely embed the literal are not. Middleware
uses the identical predicate; the two are pinned equal by test (slice doc F11).

The same edit corrected middleware's **routing** for chunked session cookies, which
exact-name matching never detected (slice doc F12 — declares the out-of-packet-scope
middleware edit). That is routing only: the dynamic twin still does not reassemble chunked
JWTs, so a chunked session bypasses the cache correctly and is *still* denied gated content.
Deferred debt, `docs/TECH-DEBT.md`.

Four findings the operator must read before deploying:

- **`nf` is mandatory in the query allowlist** (slice doc F1). It is
  `lib/not-found-handoff.ts`'s `NOT_FOUND_PARAM`, and the `307 → ?nf=1` handoff is itself
  cacheable — drop `nf` from the key and every 404 becomes an infinite redirect loop.
- **The deploy is now STAGED** (decision `CACHE3-STAGING-DRIFT` = staged reconcile, replacing
  the bounded-`cdk diff` gate). Staging has drifted ~630 resources behind HEAD (F7), so:
  (1) deploy HEAD to staging, absorbing the drift; (2) run the full Track CACHE probe suite
  there; (3) *then* review a small production diff. Step-by-step plan in the slice doc
  § Deployment.
- **The WARM-EDGE session probe is mandatory and cannot be skipped or substituted** (slice
  doc § Deployment probe 6). No origin `curl` can fail the H3 way — at the origin middleware
  runs and routes correctly. It needs a real CloudFront hit on a gated page with a real
  session cookie. Under this repo's NextAuth config that cookie is named
  `next-auth.session-token`, **not** the `__Secure-` default. If the browser shows `.0`/`.1`
  chunks, read the slice doc's *6b-caveat* first: a chunked session will correctly miss the
  edge and still show "Restricted Access", because the twin does not reassemble chunks
  (`docs/TECH-DEBT.md`). That is not an H3 regression.
- **Do not roll back only the `x-has-session` half.** With `cache-1` live, that is H3 at full
  strength. The cache policy and the CloudFront Function are one unit.

`cache-2` — ISR revalidation keyed by domain — is **IMPLEMENTED 2026-07-26 (revised same day),
review pending** (`docs/slices/cache-2-isr-revalidation-keying.md`, § Build run). Nothing
deployed. Both operator decisions are now **resolved and applied**: `CACHE-2-D1` (the
multi-domain evidence item had no representable input — one domain per tenant — so it is
replaced by a test pinning the single-domain contract) and `CACHE-2-D2` (scope amended to
allow exactly one `infra/` line, `revalidationSecret.grantRead(createContentFunc)` in
`infra/lib/api.ts:144`, so the `content/create.ts` purge is complete rather than inert).
The slice is therefore backend + one IAM statement; that grant and the create-purge must
deploy together.

`cache-1` is IMPLEMENTED (approved + committed 2026-07-26, d2ecffe) but **NOT DEPLOYED**.
Its deploy gate — `cache-3` — is now implemented, so the gate is satisfied in code and
pending review.

**Deploy order: cache-3 → cache-1 + cache-2 (one combined deploy is fine), staged
staging-first.** Never `cache-1` alone: that window is exactly H1 on live tenants. The
`CACHE-2-D2` grant is part of cache-2, not an optional extra step. Post-deploy verification
is per-slice and all of it is still NOT RUN: the cache-key probes (RSC, junk-param,
404-loop, attribution, **warm-edge session**) in the cache-3 slice doc § Deployment, the
header probes + rollback in the cache-1 slice doc, and the ISR purge check in the cache-2
slice doc. Expect a functionally cold Layer-1 cache on
deploy — changing the cache key strands every existing entry under the old key (Layer 2 is
untouched, so refill is mostly an origin ISR hit rather than fresh SSR).

Read before implementation: `docs/VISION.md` → `docs/ROADMAP.md` → this file →
`docs/slices/cache-1-restore-static-rendering.md` →
`docs/slices/cache-2-isr-revalidation-keying.md` →
`docs/slices/cache-3-cache-key-hygiene.md` → `docs/caching-architecture.md`.

## Planning phase — COMPLETE

The four feature plans and the platform decisions are approved and are the binding
source for the slice inventory:

- `docs/platform-decisions.md` — PD-001 (tenant-local identity), PD-002 (renderer-proxy
  customer data transport), PD-003 (Cognito as login substrate; dormant CUSTOMER branch).
- `docs/plan-public-pool-customer-auth.md` — approved.
- `docs/plan-appointments-private-table-extension.md` — approved.
- `docs/plan-commerce-private-table.md` — approved.
- `docs/plan-youtube-vimeo-embed.md` — source for Track A.

## In Progress

None. **Track A is code-complete**: `vid-1`, `vid-2` and `vid-3` are all **IMPLEMENTED,
review pending** (see § Recently Completed). Nothing in Track A is deployed, and its
operator-owned visual/device checks are still `NOT RUN` —
`docs/slices/vid-3-video-hero-block.md` § *Operator visual checklist*.

## Next

Review `cache-3`, then **deploy cache-3 + cache-1 + cache-2 together** with the post-deploy
operator verification each slice doc specifies. Track TEST is code-complete —
`test-1`…`test-4` are all implemented and committed (`c37ca9a`, `6a46760`, `931a3ff`,
`30787ed`), review pending. **Track A is now code-complete too** — `vid-1` (`571286e`),
`vid-2` (`e8da608`) and `vid-3` are implemented, review pending — so the next implementation
slice is **`fnd-1` (shared `normalizeEmail`)**, then begin Track B (`cmrc-1`). The `fnd-1`
and Track B/C/D slice docs are not yet authored — generate them per `docs/ROADMAP.md` when
their track starts.

*(Updated 2026-07-28 on `vid-3` completion. Per-slice status lives in `docs/ROADMAP.md`,
which outranks this file — `docs/VISION.md` § Decision hierarchy.)*

*(Corrected 2026-07-28 during `vid-2`. This paragraph still listed `test-3` and `test-4` as
work "to finish" after they had been committed, and listed `vid-1`/`vid-2` as not started.
Per-slice status lives in `docs/ROADMAP.md`, which outranks this file — `docs/VISION.md`
§ Decision hierarchy.)*

*(Track TEST was missing from this list until 2026-07-28. `docs/ROADMAP.md` § Track order
ratified CACHE → TEST → A on 2026-07-26, and the ROADMAP outranks this file — see
`docs/VISION.md` § Decision hierarchy — so the omission was staleness, not a re-ordering.)*

## Recently Completed

- `vid-3` — `video-hero` block: background embeds + tabbed source picker (2026-07-28).
  **Track A is complete.** `video-hero/VideoHeroRender.tsx` now branches on
  `parseVideoSource` and nothing else, so no render path in `packages/plugins` carries a
  video-URL regex any more. `youtube`/`vimeo` → a background `<iframe>` whose `src` is
  **rebuilt from the validated provider id** by `buildBackgroundEmbedUrl` (YouTube's six
  background params including the `playlist={id}` pairing without which `loop=1` is inert;
  Vimeo's `?background=1`), with `title`, `allow="autoplay; …"` and deliberately **no**
  `loading="lazy"` — the opposite call from `vid-2`'s inline block, because this is above the
  fold, and the suite cross-checks both so a copy-paste between them fails. `direct` keeps
  the existing native `<video>`; `unknown` falls back to the **poster** — or to no backdrop
  at all when none is set — which is the deliberate divergence from `VID2-UNKNOWN-OUTPUT`
  (`VID3-UNKNOWN-POSTER`): an empty 16:9 box is a hole in a content column, but a hero still
  needs a backdrop behind its headline. **The defect retired:** before this slice every
  non-empty `videoSrc` produced a `<video>`, so a pasted YouTube link rendered a media
  element pointed at an HTML page — no playback, no error, and the poster suppressed. It also
  **closes `vid-1` residual 4** for this block, which was a real exposure: `videoSrc` went
  into `<source src>` with no scheme check at all. `VideoHeroEditor.tsx` gains the plan's
  tabbed Upload | Library | Embed selector, a provider indicator and warning callout on the
  same classifier the page uses, and a YouTube thumbnail preview. Because
  `buildBackgroundEmbedUrl` hardcodes mute+loop, the Muted/Loop checkboxes are **replaced by
  a statement of fact** on embed sources rather than left as controls that silently do
  nothing. New `test/videoHeroPlugin.test.ts` (66 tests, `renderToStaticMarkup` through
  `RENDER_MAP["videoHero"]`, `vid-2`'s pattern); plugins suite now **172**. Zero packages
  added; `package-lock.json` and `.github/workflows/ci.yml` untouched. All gates green
  (5-package rebuild, 8-workspace typecheck, 172 + 20 + 51 + 29 + 15 across five
  credential-free runners). **Viewport cover, mobile autoplay and hydration are `NOT RUN` and
  are the operator's** — a 9-item checklist is in the slice doc. MCP sync **checked and not
  owed** (`OBSERVED`: `videoHero` is in neither `BLOCK_SCHEMAS` nor `add_block`'s enum);
  adding it is new scope, surfaced not built. Status `IMPLEMENTED`, review pending;
  `docs/ROADMAP.md` § Track A is authoritative.
- `vid-2` — inline `video` plugin: parser-driven embeds + native `<video>` (2026-07-28).
  `video/VideoRender.tsx` now branches on `parseVideoSource` and nothing else — its inline
  YouTube regex is deleted. YouTube/Vimeo get an `<iframe>` whose `src` is **rebuilt from the
  validated provider id** (`loading="lazy"`, `title`); direct `.mp4`/`.webm` get a native
  `<video controls>`, which is the defect fix — they were previously piped to an iframe and
  did not play reliably; an unrecognized or empty URL renders **nothing at all**, not an empty
  black 16:9 box (decision `VID2-UNKNOWN-OUTPUT`). Because the page is silent, the author's
  only signal is editor-side: `VideoEditor.tsx` shows a provider indicator (icon shape +
  label, `text-muted-foreground`) and a warning callout on a non-empty unrecognized URL.
  Both surfaces call the same classifier, so the editor's promise and the page's behaviour
  cannot drift. New `test/videoPlugin.test.ts` (38 tests) asserts **rendered output** through
  `RENDER_MAP["video"]` using `renderToStaticMarkup` — no DOM/jsdom/RTL harness, no package
  added to the tree. Discharges `vid-1` residual 4 (output encoding) for `video`; still open
  for `video-hero`. **CSP finding: there is no CSP anywhere in the estate**, so the embeds are
  unblocked today — a future CSP must allow `frame-src` for `www.youtube.com`,
  `www.youtube-nocookie.com` and `player.vimeo.com` or every video block goes blank at once.
  **Plugins-only change; `.github/workflows/ci.yml` is not touched** (`OBSERVED`: byte-identical
  to `HEAD`). No CI edit was needed — the `vid-1` step `Plugins unit tests` runs `npm test` in
  `packages/plugins`, which is `vitest run` with no path argument, so it discovers
  `videoPlugin.test.ts` by glob. Surfaced, not acted on: that step's title and comment now
  under-describe the job (it also gates rendered output, and React does now enter it via
  `react-dom/server`) — a name-vs-behaviour drift proposed for a future CI-scoped slice, see
  `docs/slices/vid-2-inline-video-embed.md` § *CI comment — surfaced, not acted on*.
  Status `IMPLEMENTED`, review pending; `docs/ROADMAP.md` § Track A is authoritative.

  *(Corrected in revision 2. Revision 0 made a comment-only `ci.yml` edit, revision 1 reverted
  it, but this entry still claimed "one CI *comment* correction" against an unchanged file.)*
- `vid-1` — video URL parser (2026-07-28, committed 571286e). Four-way classification
  (`youtube` / `vimeo` / `direct` / `unknown`) in `packages/plugins/src/common/videoSource.ts`,
  pure and zero-import, plus the plugins workspace's first test harness. Ratified contract
  amendment `VID1-DIRECT-SCHEME-CONTRACT`: `direct` requires an absent/`http`/`https` scheme.
  Status `IMPLEMENTED`, review pending; `docs/ROADMAP.md` § Track A is authoritative.
- `test-2` — serving-contract characterization suite (2026-07-28).
  `renderer/test/serving-contract/` + `npm run test:serving`: 16 assertions, one per row of
  `docs/caching-architecture.md` § *Serving contract*, plus 4 harness isolation self-checks,
  run against `next build` + `next start` + an in-process DynamoDB stub. ≈10 s, **zero new
  dependencies** (`node:test`). Credential-free *by construction* — the child processes get a
  built environment, not an inherited one, and cannot read `renderer/.env*` (revision 1;
  before it, the operator's real `AMODX_API_KEY` was reaching the renderer). Revision 2 moved
  the `.env*` hook from an argv `--require` to `NODE_OPTIONS`, so it covers the whole process
  tree `next build` forks, and made the coverage a **measurement** — `(iso3)` reads the hook's
  own per-process journal back out of the real build/boot (14 processes covered) and asserts
  Next's first-party `- Environments:` report is absent.
  New CI job `serving-contract` in `.github/workflows/ci.yml`.
  Touches no renderer/infra/backend source — the only non-doc change outside `test/` is the
  renderer `test:serving` script. **Its first run is also the regression check `sec-1`'s
  `next` 16.2.9 → 16.2.12 bump never received: no contract drift, every measured row
  identical** (slice doc § Build run). Status `IMPLEMENTED`, review pending.
- `cache-3` — cache-key hygiene (2026-07-27, revision 5). CloudFront cache policy: RSC
  header family added (closes H1), `x-has-session` added (closes H3),
  `queryStringBehavior: all()` → a 7-parameter allowlist; the viewer-request CloudFront
  Function derives the session bit. `amodx_ref` moved off page responses to
  `components/ReferralCapture.tsx` + `app/api/ref/route.ts`.
  Status `IMPLEMENTED`, not `SHIPPED` — authoritative status is § Current Priority above;
  this entry is a pointer, not a second source of truth.
- `cache-2` — ISR revalidation keyed by domain (2026-07-26). Backend code **plus one IAM
  statement** (`revalidationSecret.grantRead(createContentFunc)`, `infra/lib/api.ts:144`):
  6 handlers now purge `/<domain>/<path>` instead of the no-op `/<tenantId>/<path>`, and
  the 6th (`content/create.ts`) is inert without that grant, so the two deploy together.
  Status `IMPLEMENTED`, not `SHIPPED` — authoritative status is § Current Priority above;
  this entry is a pointer, not a second source of truth.
- Slice infrastructure scaffolding: `VISION.md`, `ROADMAP.md`, `documentation.md`, this
  file, the `CLAUDE.md` Slice Workflow section, and `docs/slices/` + `docs/shipped/slices/`.
