# Runbook: deploying Track CACHE (cache-1 + cache-2 + cache-3)

Operator-driven. Written 2026-07-27 from the three slice docs' deployment notes.
Commits: cache-1 `d2ecffe`, cache-2 `d75f06a`, cache-3 `918370e`. One combined deploy is
ratified (cache-3's changes are in the same tree; CloudFormation applies the cache-policy
+ CF-function changes with the renderer/backend updates).

## Preconditions

- Working tree clean on `main`; root `npm run build` green.
- **SEC-1 committed** (`docs/slices/sec-1-audit-remediation-2026-07.md`): the deploy
  must carry the patched `next` (middleware-bypass fix) / `next-auth` / `sharp`.
- Staging is ~630 resources behind the repo (measured 2026-07-26) — the staging deploy
  absorbs that drift BY DESIGN (ratified staged-reconcile). Skim `cdk diff` for staging
  only for surprises in stateful resources (DynamoDB tables, S3 buckets, Cognito pools —
  expect NO replacements; abort if any stateful resource shows `replace`).

## Step 1 — deploy to staging

    cd infra && npx cdk diff <staging-stack>   # check: no stateful replacements
    npx cdk deploy <staging-stack>

## Step 2 — staging probe suite (all must pass before prod)

Let `$H` = a staging tenant host with a published page `/p`, all curls through CloudFront.

| # | Probe | Expect |
|---|-------|--------|
| 1 | `curl -sI https://$H/p` twice | 1st `x-cache: Miss`, 2nd `x-cache: Hit`; `s-maxage` present; NO `Set-Cookie` |
| 2 | `curl -sI -H 'RSC: 1' https://$H/p` | flight payload response does NOT overwrite the HTML entry: repeat probe 1's 2nd curl → still HTML `Hit` |
| 3 | `curl -sI 'https://$H/p?fbclid=junk'` twice | dynamic (`no-store`) — junk param cannot fragment or poison the edge cache |
| 4 | warm-edge session: after probe 1 is warm, `curl -sI -H 'Cookie: next-auth.session-token=x' https://$H/p` | `Miss` (x-has-session varies the key), `no-store` — NOT the warm anonymous `Hit` |
| 5 | `curl -sI https://unknown-host.example.com/` (Host pointed at the distribution) | `404` + `no-store` (no soft-200, nothing cached) |
| 6 | `curl -sI https://$H/does-not-exist` | `307 → ?nf=1` then `404` + `no-store`; repeating never loops (nf stays in the cache key) |
| 7 | ISR purge-on-edit: edit `/p` in admin, then `curl -s https://$H/p` after a fresh CloudFront miss (or GO LIVE NOW) | fresh content — the domain-keyed purge worked |
| 8 | create a page at a previously-404'd slug, request it | page renders (stored 307 was purged by content/create) |
| 9 | visit `https://$H/p?ref=test` in a browser | `amodx_ref` cookie set via `/api/ref`; a following anonymous `curl -sI https://$H/p` carries NO `Set-Cookie` |
| 10 | CloudWatch: renderer Lambda invocations | drop sharply for repeated page views vs pre-deploy |
| 11 | `curl -sI 'https://$H/_next/image?url=<asset>&w=256&q=75'` | 200 image — patched sharp/libvips serving normally |

## Step 3 — production

    npx cdk diff <prod-stack>    # should now be SMALL; review line by line
    npx cdk deploy <prod-stack>

Re-run probes 1–6 + 9 against one production tenant. Then watch CloudFront cache-hit
ratio (target >80% within a day as caches warm) and Lambda invocation counts.

## Rollback

- Renderer/backend: redeploy the previous build (git revert or checkout previous commit,
  `cdk deploy`), then flush both layers: CloudFront `/*` invalidation + S3 `_cache/`
  purge (or POST /system/invalidation + nightly-flush manually) so nothing mis-cached
  survives.
- Cache policy/CF function alone: `git revert 918370e` in `infra/` and redeploy — policy
  updates are in-place, no distribution replacement.

## Post-deploy follow-ups (queued)

- Mark cache-1/2/3 SHIPPED in their slice docs + move to docs/shipped/slices/ once the
  probes pass in production (operator).
- `cache-4` (instant per-page go-live; debounce only for bulk) and `cache-5`
  (domain-onboarding vs unknown-host cache) get slice docs next.
- Track TEST: `test-2` is **implemented** (2026-07-28) — `cd renderer && npm run test:serving`
  runs the ORIGIN half of these probes as a committed suite in ~9 s with no credentials, and
  measured no drift from the `next` 16.2.12 bump. It does **not** replace anything in this
  runbook: every probe below that needs a warm CloudFront edge (RSC, junk-param, attribution,
  and above all the **warm-edge session probe**) is by construction unreachable from the
  origin and stays operator-run. `test-4` is the slice that would cover the CloudFront
  cache policy and viewer-request Function, and it is not started.
