/**
 * Infra truth — real `cdk synth` assertions over `AmodxStack`. Slice `test-4`.
 *
 * WHAT THIS REPLACES
 * `infra/test/infra.test.ts` was 100% commented out and reported PASS 1/1 — a false green,
 * forbidden by docs/testing-strategy.md § Invariants ("a suite that asserts nothing must not
 * exist"). It is deleted; this file is its replacement.
 *
 * WHAT IT PINS
 * The CloudFront-side half of the caching contract. `renderer/test/serving-contract/` measures
 * the ORIGIN half end-to-end but cannot see the edge: cache-key allowlists, the viewer-request
 * Function, and the IAM blast radius of cache invalidation exist only as CDK source, so today
 * nothing fails if an edit regresses them. Each assertion below names the slice or decision
 * that ratified the property it pins, so a red run points at the document to re-read rather
 * than at a number to change.
 *
 * ── ONE SYNTH, ONE FILE ────────────────────────────────────────────────────────────────────
 * `Template.fromStack` here is NOT cheap and NOT pure: `RendererHosting` and `AdminHosting`
 * run real application builds inside their constructors (`npm run build:open` and
 * `npm run build` respectively — infra/lib/renderer-hosting.ts:62, infra/lib/admin-hosting.ts:31),
 * and every `NodejsFunction` bundles its handler with esbuild. MEASURED 2026-07-28 on the
 * operator's machine: 52-58 s wall clock across five runs, 410 resources in the parent template.
 *
 * Two consequences, both deliberate:
 *
 *   1. Everything lives in ONE test file and synthesizes ONCE in `beforeAll`. Jest gives each
 *      test FILE its own module registry and process, so a second file would pay that minute
 *      again. Split this file only if you are willing to pay per split.
 *   2. `cd infra && npm test` REBUILDS `renderer/.open-next` and `admin/dist` as a side effect.
 *      Both are gitignored build outputs that `cdk deploy` regenerates on every synth anyway,
 *      so nothing durable is lost — but it is a surprising thing for a test to do, and it is
 *      the reason the suite takes a minute rather than a second. The alternative (stubbing
 *      `child_process.execSync` and fabricating a `.open-next` tree) was rejected: it would
 *      synthesize a DIFFERENT construct graph from the one that deploys — no image-optimization
 *      behavior, no warmer rule — which is the opposite of what a slice called "infra truth"
 *      should assert. The clean fix is to lift build orchestration out of the constructs, and
 *      that is an `infra/lib` edit this slice is barred from making (docs/TECH-DEBT.md).
 *
 * ── CREDENTIAL-FREE, BY CONSTRUCTION ───────────────────────────────────────────────────────
 * Nothing here reaches AWS. Two independent reasons, plus the measurement of each:
 *
 *   - No context provider runs. The test config carries NO `domains.root`, so `AmodxDomains`
 *     — the only construct that calls `route53.HostedZone.fromLookup` — is never instantiated.
 *     Every other cloud value in the stack is a CloudFormation intrinsic resolved at deploy
 *     time, not a synth-time lookup.
 *   - The two application builds the constructors spawn are given a CONSTRUCTED environment:
 *     `installProcessTreeIsolation()` below strips every credential-shaped variable, points the
 *     AWS SDK's file-based credential chain at a path that does not exist, disables IMDS, and
 *     hides `renderer/.env*` + `admin/.env*` from the whole process tree via `NODE_OPTIONS`.
 *     `(iso1)` measures that the hook actually reached the spawned processes; `(iso2)` is the
 *     positive control for the hook's detector; `(iso3)` pins the stripped environment.
 *
 * Dropping `domains.root` changes only domain-shaped output — `Aliases` and `ViewerCertificate`
 * on the distributions, the API custom domain, the Route53 records. VERIFIED 2026-07-28 by
 * diffing every property asserted below against the real staging template
 * (`infra/cdk.out/AmodxStack-staging.template.json`, synthesized WITH domains): the cache
 * policy, all six behaviors, the CloudFront Function, the four invalidation grants and both
 * EventBridge rules are byte-identical there.
 *
 * That diff predates `cache-6`, so it says nothing about the two properties `cache-6` added —
 * `ImageCachePolicy` and the eighth `RendererOriginPolicy` header — nor about the ninth and
 * tenth `RendererOriginPolicy` headers `cache-7` added (`x-prerender-revalidate`, `x-isr`).
 * None is domain-shaped (a query-string key and header allowlist entries), so the same argument
 * covers them, but it is an argument here rather than a measurement. Labelled INFERRED, not
 * OBSERVED.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AmodxStack } from '../lib/amodx-stack';

/** AWS-managed cache policy ids (stable, documented, and what the CDK enum resolves to). */
const MANAGED_CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const MANAGED_CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

const NO_DOTENV_PRELOAD = path.join(__dirname, 'no-dotenv.cjs');

let auditPath: string;
let scratchDir: string;

/** Parent-stack template. */
let template: Template;
/** Parent + every NestedStack, so "and no other role" claims are stack-tree-wide. */
let allTemplates: Template[];

/**
 * Replace this process's environment with one that carries no credential and no project
 * secret, BEFORE the constructors spawn `next build` / `vite build` with `{...process.env}`.
 *
 * Deleting from `process.env` is the only seam available: the constructs choose the child
 * environment themselves and this slice may not edit `infra/lib`. It is sufficient because
 * both `execSync` calls copy `process.env` at spawn time, and this runs first.
 */
function installProcessTreeIsolation(): void {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amodx-test4-'));
    auditPath = path.join(scratchDir, 'dotenv-audit.jsonl');
    fs.writeFileSync(auditPath, '');

    for (const key of Object.keys(process.env)) {
        if (/^(AWS_|AMODX_)/.test(key)) delete process.env[key];
    }
    for (const key of ['TABLE_NAME', 'API_URL', 'NEXTAUTH_SECRET', 'REVALIDATION_SECRET']) {
        delete process.env[key];
    }

    // Close the SDK's remaining two credential sources. Without these, deleting the AWS_*
    // variables would still leave `~/.aws/credentials` and the instance metadata endpoint
    // reachable — the shell environment is not the whole credential chain.
    process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(scratchDir, 'no-such-credentials');
    process.env.AWS_CONFIG_FILE = path.join(scratchDir, 'no-such-config');
    process.env.AWS_EC2_METADATA_DISABLED = 'true';

    // The `.env*` blindfold, delivered in the environment so it survives every fork. The path
    // is JSON-quoted because this repository's checkout path contains a space (MEASURED by
    // `test-2`: Node accepts `--require="<path>"`).
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(NO_DOTENV_PRELOAD)}`;
    process.env.AMODX_INFRA_DOTENV_AUDIT = auditPath;
    // Second, independent mechanism against @next/env specifically: this makes its `processEnv()`
    // return before the merge loop. Kept alongside the fs hook because they stop different
    // halves — the hook stops the READ, this stops the MERGE however the file was read.
    process.env.__NEXT_PROCESSED_ENV = 'true';
}

function readAudit(): Array<Record<string, unknown>> {
    return fs
        .readFileSync(auditPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The one resource of `type`, or a readable failure naming how many were found. */
function onlyResource(type: string): any {
    const found = template.findResources(type);
    const keys = Object.keys(found);
    if (keys.length !== 1) {
        throw new Error(`expected exactly 1 ${type}, found ${keys.length}: ${keys.join(', ')}`);
    }
    return { logicalId: keys[0], ...found[keys[0]] };
}

/**
 * The one CloudFront cache policy whose logical id contains `logicalIdPart`.
 *
 * A bare `onlyResource` over the type was enough until `cache-6`, which added a
 * SECOND policy (`ImageCachePolicy`) so that `_next/image*` keys on its query string. Logical
 * ids are the construct path with a CDK hash suffix, so `RendererCachePolicy` and
 * `ImageCachePolicy` are unambiguous substrings of exactly one id each.
 */
function cachePolicyByConstructId(logicalIdPart: string): any {
    const found = Object.entries(template.findResources('AWS::CloudFront::CachePolicy')).filter(
        ([id]) => id.includes(logicalIdPart),
    );
    if (found.length !== 1) {
        throw new Error(
            `expected 1 cache policy whose logical id contains "${logicalIdPart}", found ${found.length}`,
        );
    }
    return { logicalId: found[0][0], ...(found[0][1] as any) };
}

function rendererDistributionConfig(): any {
    const dists = template.findResources('AWS::CloudFront::Distribution');
    const match = Object.entries(dists).filter(([id]) => id.includes('RendererDistribution'));
    if (match.length !== 1) {
        throw new Error(`expected 1 renderer distribution, found ${match.length}`);
    }
    return (match[0][1] as any).Properties.DistributionConfig;
}

/** The behavior for `pathPattern`, or the default behavior when `pathPattern` is undefined. */
function behavior(pathPattern?: string): any {
    const config = rendererDistributionConfig();
    if (pathPattern === undefined) return config.DefaultCacheBehavior;
    const found = (config.CacheBehaviors as any[]).filter((b) => b.PathPattern === pathPattern);
    if (found.length !== 1) {
        throw new Error(`expected 1 behavior for "${pathPattern}", found ${found.length}`);
    }
    return found[0];
}

function originById(id: string): any {
    const found = (rendererDistributionConfig().Origins as any[]).filter((o) => o.Id === id);
    if (found.length !== 1) throw new Error(`expected 1 origin with Id ${id}`);
    return found[0];
}

beforeAll(() => {
    installProcessTreeIsolation();

    const app = new cdk.App();
    const stack = new AmodxStack(app, 'Test4Stack', {
        // A concrete env, so nothing is environment-agnostic-by-accident; the account is a
        // placeholder and is never contacted.
        env: { account: '111111111111', region: 'eu-central-1' },
        stage: 'test',
        // No `domains.root` => no `AmodxDomains` => no `HostedZone.fromLookup`. See the header.
        config: { domains: {} },
    });

    template = Template.fromStack(stack);
    allTemplates = [
        template,
        ...stack.node
            .findAll()
            .filter((c): c is cdk.NestedStack => c instanceof cdk.NestedStack)
            .map((nested) => Template.fromStack(nested)),
    ];
});

afterAll(() => {
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// Source-of-truth self-check. Runs first because every other assertion is meaningless if this
// one fails.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('suite integrity', () => {
    test('(src1) the stack under test is the TypeScript source, not a stale compiled sibling', () => {
        // MEASURED 2026-07-28, and the reason this assertion exists: `infra/lib/` carries
        // untracked, gitignored `*.js` siblings emitted before `infra/tsconfig.json` gained
        // `noEmit: true`. They are dated 2026-01-27 — before cache-1, cache-2 and cache-3 — and
        // jest's DEFAULT `moduleFileExtensions` resolves `js` ahead of `ts`, so the first run of
        // this suite silently synthesized that seven-month-old snapshot and reported the missing
        // cache policy as an ordinary failure. A less suspicious set of assertions would simply
        // have been written to match the stale artifact, and the suite would have been green and
        // meaningless.
        //
        // `cdk.json` already guards the deploy path with `ts-node --prefer-ts-exts`;
        // `jest.config.js` now guards this one with an explicit `moduleFileExtensions`. This
        // assertion is what keeps the guard from being removed by someone tidying that config.
        expect(require.resolve('../lib/amodx-stack')).toMatch(/\.ts$/);
        expect(require.resolve('../lib/renderer-hosting')).toMatch(/\.ts$/);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (a) RendererCachePolicy — the cache key itself
//     Ratified by `cache-1` (RSC family, hazard H1) and `cache-3` revisions 1-4 (query
//     allowlist, decision CACHE3-SESSION-KEY = option B for `x-has-session`).
//     Prose: docs/caching-architecture.md § "Cache Policy (Default Behavior)".
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('RendererCachePolicy — the CloudFront cache key', () => {
    test('(a1) header allowlist is EXACTLY the six ratified headers, in order', () => {
        // `X-Forwarded-Host` = tenant isolation (Phase 4). The four RSC/Next-Router-* headers
        // mirror the origin's own `Vary`, which CloudFront does not honour: without them a
        // single `curl -H 'RSC: 1'` pins a React flight payload at the edge under a page's HTML
        // URL and every later visitor gets raw flight text (hazard H1, docs/caching-architecture.md
        // § "H1"). `x-has-session` is the one-bit session discriminator added by `cache-3`
        // revision 3 to close hazard H3 — cookies are deliberately NOT in the key, so without it
        // a signed-in visitor's request is indistinguishable at the edge from an anonymous one
        // and an access-gated page serves its cached "Restricted Access" shell.
        //
        // ADDING a header here is a cache-key change: read § "Why the header allowlist has six
        // entries" before touching it. REMOVING one reopens the hazard named next to it.
        const headers = cachePolicyByConstructId('RendererCachePolicy').Properties.CachePolicyConfig
            .ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig;
        expect(headers.HeaderBehavior).toBe('whitelist');
        expect(headers.Headers).toEqual([
            'X-Forwarded-Host',
            'RSC',
            'Next-Router-Prefetch',
            'Next-Router-State-Tree',
            'Next-Router-Segment-Prefetch',
            'x-has-session',
        ]);
    });

    test('(a2) query allowlist is EXACTLY the seven read parameters, in order', () => {
        // `cache-3` replaced `queryStringBehavior: all()` with this allowlist: `all()` let any
        // `?utm_*`/`?fbclid`/attacker-chosen junk parameter mint a distinct entry and an SSR
        // Lambda invocation per unique value.
        //
        // The list is exactly the set of `query.*` reads in renderer/src — `page`, `q`,
        // `availability`, `id`, `email` (components/SitePage.tsx), `preview` (the %5Fdyn twins)
        // and `nf` (lib/not-found-handoff.ts). A parameter that changes the rendered
        // representation and is NOT here collapses onto the bare-path entry and, once that entry
        // is warm, is answered at the edge WITHOUT REACHING THE LAMBDA — middleware cannot
        // rescue it, because middleware runs at the origin.
        //
        // `nf` is MANDATORY, not an optimisation (`cache-3` finding F1): the not-found handoff
        // redirects `/p` -> `/p?nf=1` and that 307 is itself cacheable. Drop `nf` from the key
        // and `/p?nf=1` collapses onto `/p`, hits the stored 307, and every 404 becomes an
        // infinite client redirect loop.
        const qs = cachePolicyByConstructId('RendererCachePolicy').Properties.CachePolicyConfig
            .ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig;
        expect(qs.QueryStringBehavior).toBe('whitelist');
        expect(qs.QueryStrings).toEqual([
            'page',
            'q',
            'availability',
            'id',
            'email',
            'preview',
            'nf',
        ]);
    });

    test('(a3) cookies are NOT part of the cache key', () => {
        // Deliberate, and the precondition for `x-has-session` existing at all: cookie VALUES
        // are per-visitor, so keying on one would give every logged-in visitor a private set of
        // entries (unbounded fragmentation) and would put a credential into the cache key.
        // `RendererOriginPolicy` still forwards all cookies to the origin, so the render sees
        // the real jar on a miss. Flipping this to `all`/`whitelist` is a fragmentation and
        // credential-exposure change, not a tuning knob.
        const cookies = cachePolicyByConstructId('RendererCachePolicy').Properties.CachePolicyConfig
            .ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig;
        expect(cookies).toEqual({ CookieBehavior: 'none' });
    });

    test('(a4) TTLs: default 0 (origin Cache-Control wins), min 0 (no-store is not stored), max 365d', () => {
        // `MinTTL: 0` is load-bearing for the whole no-store design: a non-zero minimum would
        // make CloudFront store the dynamic twin's `no-store` responses, which is the mechanism
        // `cache-1` relies on to keep query-string and session traffic out of the cache.
        // `DefaultTTL: 0` means the origin's own `Cache-Control` decides, which is what the
        // serving-contract suite measures at the origin.
        const config = cachePolicyByConstructId('RendererCachePolicy').Properties.CachePolicyConfig;
        expect(config.DefaultTTL).toBe(0);
        expect(config.MinTTL).toBe(0);
        expect(config.MaxTTL).toBe(31536000); // cdk.Duration.days(365)
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (b)/(c) Distribution behaviors
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('Renderer distribution behaviors', () => {
    test('(b) the viewer-request CloudFront Function is attached to BOTH the default and api/* behaviors', () => {
        // The Function is what SETS `x-forwarded-host`, `x-origin-verify` and `x-has-session`.
        // Two of those three are in the cache key (a1), so a behavior that keys on them without
        // the Function attached would key on whatever the VIEWER sent: a client could mint key
        // partitions, or read another tenant's entry by sending its `X-Forwarded-Host`. On
        // `api/*` the Function is not a cache-key concern but an origin-trust one — it carries
        // `x-origin-verify`, which the renderer Lambda checks to reject non-CloudFront traffic
        // (Phase 6.1). Ratified: docs/caching-architecture.md § "Multi-Tenant Isolation".
        const fnLogicalId = onlyResource('AWS::CloudFront::Function').logicalId;
        const expected = [
            { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [fnLogicalId, 'FunctionARN'] } },
        ];
        expect(behavior().FunctionAssociations).toEqual(expected);
        expect(behavior('api/*').FunctionAssociations).toEqual(expected);
    });

    test('(b2) the default behavior uses the RendererCachePolicy, not a managed policy', () => {
        // Guards the `enableCaching` wiring in amodx-stack.ts: `RendererHosting` falls back to
        // the managed CACHING_DISABLED policy when `enableCaching` is false, in which case every
        // property asserted in (a) would still be present in the template but attached to
        // nothing. Without this assertion, (a1)-(a4) could all pass on a distribution that
        // caches nothing.
        expect(behavior().CachePolicyId).toEqual({
            Ref: cachePolicyByConstructId('RendererCachePolicy').logicalId,
        });
    });

    test('(c) api/* uses the AWS-managed CACHING_DISABLED policy', () => {
        // Comments POST, account actions and the revalidation endpoint live here. Falling
        // through to the default behavior would cache authenticated JSON at the edge.
        // docs/caching-architecture.md § "/api/* Behavior".
        expect(behavior('api/*').CachePolicyId).toBe(MANAGED_CACHING_DISABLED);
    });

    test('(f) _next/static/*, assets/* and favicon.ico are served from S3, never from the renderer Lambda', () => {
        // Two properties in one: the origin must be the asset BUCKET (an S3 origin with Origin
        // Access Control), not the Lambda function URL — a static request that reaches the
        // Lambda is a cold start and a bill per asset — and the policy must be the managed
        // CACHING_OPTIMIZED, because these paths are content-hashed and immutable.
        for (const pattern of ['_next/static/*', 'assets/*', 'favicon.ico']) {
            const b = behavior(pattern);
            const origin = originById(b.TargetOriginId);
            expect({ pattern, s3: 'S3OriginConfig' in origin }).toEqual({ pattern, s3: true });
            expect({ pattern, custom: 'CustomOriginConfig' in origin }).toEqual({
                pattern,
                custom: false,
            });
            expect(origin.OriginAccessControlId).toBeDefined();
            expect({ pattern, policy: b.CachePolicyId }).toEqual({
                pattern,
                policy: MANAGED_CACHING_OPTIMIZED,
            });
        }
    });

    test("(g) _next/image* keys on EXACTLY url,w,q — the optimizer's required query inputs", () => {
        // Slice `cache-6` defect 2. Before it, this behavior used the managed CACHING_OPTIMIZED
        // policy with NO origin-request policy attached. That policy keys on nothing but the path,
        // and with no ORP the keyed set is also the FORWARDED set — so CloudFront deleted the
        // query string on the way to the image Lambda, `next/dist/server/image-optimizer.js`
        // destructured `const { url, w, q } = query` into three undefineds, and the adapter turned
        // the resulting throw into a 500 `"url" parameter is required`. OBSERVED live on staging
        // AND on prod: image optimization was broken for every tenant.
        //
        // This assertion is the thing whose absence let that ship. It pins two properties, and
        // BOTH are load-bearing in opposite directions:
        //
        //   - The three parameters must be PRESENT. Being in the cache key is what forwards them
        //     (keyed values always reach the origin), so their presence here IS the fix. Removing
        //     one is the 500 coming back — or, for `w`, the subtler version: every width served
        //     the first-requested width's bytes.
        //   - There must be NO OTHER QUERY PARAMETER. A fourth one is a parameter the optimizer
        //     does not read, so keying it mints a distinct entry and a distinct 1.5 GB Lambda
        //     invocation per `?url=...&cachebust=<n>` — the same junk-parameter fragmentation
        //     `cache-3` removed from the default behavior.
        //
        // Scope of the claim, precisely: `url,w,q` is the optimizer's required QUERY-STRING input
        // set and this policy's full query dimension — NOT its entire input. It also negotiates
        // the output format on the `Accept` header, which is deliberately outside the key (below).
        const policy = cachePolicyByConstructId('ImageCachePolicy');
        const params = policy.Properties.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin;

        // The behavior must actually USE it — otherwise the policy above could be a correct
        // resource attached to nothing, which is exactly the shape of the defect being fixed.
        expect(behavior('_next/image*').CachePolicyId).toEqual({ Ref: policy.logicalId });

        expect(params.QueryStringsConfig.QueryStringBehavior).toBe('whitelist');
        expect(params.QueryStringsConfig.QueryStrings).toEqual(['url', 'w', 'q']);

        // Headers and cookies stay out for the fragmentation reason above. Consequence recorded
        // rather than fixed: the adapter emits `Vary: Accept` and CloudFront does not honour
        // origin `Vary`, so webp/avif negotiation does not happen at the edge. That is
        // PRE-EXISTING — CACHING_OPTIMIZED did not forward `Accept` either — and is tracked in
        // docs/TECH-DEBT.md, not changed here.
        expect(params.HeadersConfig).toEqual({ HeaderBehavior: 'none' });
        expect(params.CookiesConfig).toEqual({ CookieBehavior: 'none' });
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (h) RendererOriginPolicy — the TRANSPORT list
//     Ratified by `cache-6` (defect 1). Distinct concern from (a): the cache policy decides
//     which stored response a viewer gets; this policy decides which headers the origin is
//     allowed to SEE AT ALL, on hits and misses alike.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('RendererOriginPolicy — what reaches the origin', () => {
    test('(h) header allowlist is EXACTLY the ten forwarded headers, in order', () => {
        // `x-revalidation-token` is the entry `cache-6` added, and its absence was a live
        // production defect, not a hypothetical: `backend/src/lib/revalidate.ts` sends it and
        // `renderer/src/app/api/revalidate/route.ts` 401s when it does not equal
        // `REVALIDATION_SECRET`. CloudFront stripped it, every backend caller reaches the
        // renderer THROUGH the distribution (`RENDERER_URL`), so deployed ISR purges had never
        // worked. Note this is independent of `cache-2`, which fixed the purge PATH — a correctly
        // addressed purge that 401s is still a no-op.
        //
        // REMOVING any entry deletes that header at the edge. `x-origin-verify` is origin trust
        // (Phase 6.1 — the renderer rejects requests without it), `X-Forwarded-Host` is how the
        // origin resolves the tenant at all. ADDING one is cheap but not free: it is a new input
        // the origin can be made to see by any viewer, so it needs the same justification the
        // seven originals have.
        //
        // The last two, `x-prerender-revalidate` + `x-isr`, are `cache-7` — the SAME transport
        // defect as `x-revalidation-token` above, a rung further along the ISR path. open-next's
        // RevalidationFunction sends BOTH on its HEAD re-render (`revalidate.js:25-26` in the
        // installed open-next@3.1.3); the credential authorises a blocking re-render and the
        // `x-isr` marker forces the result to be written back to S3 rather than treated as a
        // throwaway on-demand render (`patchedAsyncStorage.js:9-11`). Stripped, every page logged
        // "Failed to revalidate" and stayed STALE until the nightly flush (OBSERVED, prod). They
        // are TRANSPORT-only, in no cache key — see the `(h)` prose in `renderer-hosting.ts`.
        const headers = onlyResource('AWS::CloudFront::OriginRequestPolicy').Properties
            .OriginRequestPolicyConfig.HeadersConfig;
        expect(headers.HeaderBehavior).toBe('whitelist');
        expect(headers.Headers).toEqual([
            'Accept',
            'Accept-Language',
            'Content-Type',
            'X-Forwarded-Host',
            'x-origin-verify',
            'x-tenant-id',
            'x-automation-key',
            'x-revalidation-token',
            'x-prerender-revalidate',
            'x-isr',
        ]);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (d) IAM blast radius of cache invalidation
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('cloudfront:CreateInvalidation blast radius', () => {
    /**
     * The SECURITY-RELEVANT set: roles that can invalidate CloudFront while serving a request.
     * Ratified by docs/caching-architecture.md § "Key Architectural Decision: No CloudFront IAM
     * on Mutation Lambdas" — the previous design granted this to ALL ~70 Lambdas via a
     * post-construction loop; the debounce design replaced that with a DynamoDB marker written
     * by `withInvalidation()`. A FOURTH entry in this list is that loop coming back.
     */
    const REQUEST_PATH_INVALIDATORS = [
        // EventBridge rate(1 minute); fires the debounced `/*` invalidation once the 15-minute
        // DEBOUNCE_WINDOW_MS has elapsed since the last CDN_PENDING marker.
        'DebounceFlushFuncServiceRole',
        // POST /system/invalidation — the admin "GO LIVE NOW" button, on demand.
        'InvalidationFlushFuncServiceRole',
        // EventBridge cron(0 2 * * ? *) — the change-gated nightly safety net for a missed debounce.
        'NightlyCacheFlushFuncServiceRole',
    ];

    /**
     * DEPLOY-TIME TOOLING: holds the permission only while `cdk deploy` runs, never in response
     * to visitor or admin traffic. Not a least-privilege concern for the request path, but it IS
     * a real grant in the template and therefore has to be named rather than filtered away.
     */
    const DEPLOY_TIME_INVALIDATORS = [
        // CDK's own s3deploy.BucketDeployment custom resource. It receives CreateInvalidation
        // because `infra/lib/renderer-hosting.ts:539` passes `distribution: this.distribution`,
        // so the static assets it has just uploaded are invalidated at the edge in the same
        // deploy. Pre-existing CDK-generated tooling, not a grant this project wrote.
        'CustomCDKBucketDeployment',
    ];

    test('(d) granted to exactly 3 request-path roles + 1 deploy-time role, and nothing else', () => {
        // Corrected contract (operator decision `test4-invalidation-role-contract`, 2026-07-28):
        // the synthesized template is the evidence and it wins. Four roles hold the action; the
        // two categories above say which three are the security-relevant set. Asserted as four
        // separate expectations so a red run says WHICH kind of grant moved: a request-path role
        // lost it, the deploy tooling changed, an unclassified role gained it, or a known role
        // gained it twice.
        //
        // The scan covers the parent stack AND both API NestedStacks, so "and nothing else" is a
        // claim about the whole stack tree, not just the template `Template.fromStack` returned.
        // Grants are collected WITHOUT de-duplication, so a role acquiring the action a second
        // time through a second policy also fails.
        const grantedTo: string[] = [];
        for (const t of allTemplates) {
            const policies = t.findResources('AWS::IAM::Policy');
            for (const [, policy] of Object.entries(policies)) {
                const statements = (policy as any).Properties.PolicyDocument.Statement as any[];
                const grants = statements.some((s) => {
                    const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
                    return actions.includes('cloudfront:CreateInvalidation');
                });
                if (!grants) continue;
                for (const role of (policy as any).Properties.Roles as any[]) {
                    grantedTo.push(String(role.Ref));
                }
            }
        }

        // Logical ids carry a CDK-generated hash suffix, so classification is by stable prefix.
        const held = (prefixes: string[]) =>
            prefixes.filter((p) => grantedTo.some((id) => id.startsWith(p)));

        // 1. A request-path grant that DISAPPEARED — the failure names the missing role.
        //    Adding one here is a blast-radius change: re-read § "Key Architectural Decision".
        expect(held(REQUEST_PATH_INVALIDATORS)).toEqual(REQUEST_PATH_INVALIDATORS);
        // 2. The deploy-time grant, same treatment.
        expect(held(DEPLOY_TIME_INVALIDATORS)).toEqual(DEPLOY_TIME_INVALIDATORS);
        // 3. A FIFTH grant — reported BY ROLE NAME, not as a count.
        expect(
            grantedTo.filter(
                (id) =>
                    ![...REQUEST_PATH_INVALIDATORS, ...DEPLOY_TIME_INVALIDATORS].some((p) =>
                        id.startsWith(p),
                    ),
            ),
        ).toEqual([]);
        // 4. Total, which is what catches a KNOWN role acquiring the action a second time
        //    through a second policy — invisible to 1-3, which only test membership.
        expect(grantedTo.length).toBe(
            REQUEST_PATH_INVALIDATORS.length + DEPLOY_TIME_INVALIDATORS.length,
        );
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (e) EventBridge schedules
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('Cache-flush schedules', () => {
    /** The single rule whose target is the function with `functionLogicalIdPart` in its id. */
    function ruleTargeting(functionLogicalIdPart: string): any {
        const rules = template.findResources('AWS::Events::Rule');
        const found = Object.values(rules).filter((r) =>
            ((r as any).Properties.Targets as any[]).some((t) =>
                String(JSON.stringify(t.Arn)).includes(functionLogicalIdPart),
            ),
        );
        if (found.length !== 1) {
            throw new Error(
                `expected 1 rule targeting ${functionLogicalIdPart}, found ${found.length}`,
            );
        }
        return (found[0] as any).Properties;
    }

    test('(e1) the debounce flush runs every minute', () => {
        // The Lambda loops internally at 10 s resolution inside this 1-minute schedule and fires
        // the CloudFront invalidation once 15 minutes have elapsed since the last mutation
        // (DEBOUNCE_WINDOW_MS). Slowing the rule silently lengthens every editor's
        // time-to-live-site; docs/caching-architecture.md § "Debounce Flush Lambda".
        const rule = ruleTargeting('DebounceFlushFunc');
        expect(rule.ScheduleExpression).toBe('rate(1 minute)');
        expect(rule.State).toBe('ENABLED');
    });

    test('(e2) the nightly cache flush runs at 02:00 UTC', () => {
        // Change-gated safety net that clears BOTH layers (CloudFront /* and the OpenNext ISR
        // cache under `_cache/` in S3). It is the backstop for a missed debounce;
        // docs/caching-architecture.md § "Nightly Safety Net".
        const rule = ruleTargeting('NightlyCacheFlushFunc');
        expect(rule.ScheduleExpression).toBe('cron(0 2 * * ? *)');
        expect(rule.State).toBe('ENABLED');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// Isolation self-checks — the suite's credential-free claim, measured rather than argued.
// docs/testing-strategy.md § Invariants.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('credential-free isolation', () => {
    test('(iso1) the .env blindfold reached the processes the synth spawned', () => {
        // Not "the hook was configured" — that is argument. This reads back the journal the hook
        // appends to from inside every process it loads into, AFTER the real `next build` and
        // `vite build` have run. A `block` record proves the hook was installed in a process that
        // then went looking for a `.env*` file and was told ENOENT.
        //
        // `block` records appear even on a checkout with no `.env*` files (CI): both loaders stat
        // their candidate paths unconditionally and swallow ENOENT, so the detector fires on the
        // ATTEMPT, not on the file existing. That is what makes this assertion deterministic.
        const records = readAudit();
        const loads = records.filter((r) => r.ev === 'load');
        const blocks = records.filter((r) => r.ev === 'block');
        const dirs = new Set(blocks.map((b) => String(b.dir)));

        // Printed, not just asserted: the coverage NUMBER is the evidence a reviewer needs and
        // it is machine-dependent (it tracks the build's worker count), so it cannot be pinned
        // to a constant without making the suite flaky on a different core count.
        const processes = new Set(loads.map((r) => r.pid)).size;
        const bySyscall = [...new Set(blocks.map((b) => String(b.syscall)))].sort().join(',');
        console.log(
            `(iso1) .env blindfold: ${processes} processes covered, ` +
                `${blocks.length} reads blocked in [${[...dirs].sort().join(', ')}] ` +
                `via [${bySyscall}]`,
        );

        // More than one process => the hook survived at least one fork, which is the property
        // argv-delivered `--require` does NOT have (test-2's measurement).
        expect(processes).toBeGreaterThan(1);
        expect(blocks.length).toBeGreaterThan(0);
        expect([...dirs].sort()).toEqual(['admin', 'renderer']);
    });

    test('(iso2) positive control: the same detector blocks a real .env and passes everything else', () => {
        // Required by docs/testing-strategy.md § Invariants: an absence assertion ships with a
        // positive control that exercises the same detector, or a broken detector reads as a pass
        // — which is precisely the deleted stub's failure mode in another costume.
        //
        // The control runs the SAME `no-dotenv.cjs`, delivered the SAME way, in a child process,
        // pointed by `AMODX_INFRA_DOTENV_DIRS` at a scratch directory holding a REAL `.env` — so
        // "blocked" and "absent" are distinguishable, and no repository file is touched.
        const dir = fs.mkdtempSync(path.join(scratchDir, 'control-'));
        fs.writeFileSync(path.join(dir, '.env'), 'SECRET=must-not-be-readable\n');
        fs.writeFileSync(path.join(dir, 'plain.txt'), 'readable\n');

        const probe = `
            const fs = require('node:fs'), p = require('node:path');
            const dir = process.argv[1];
            const attempt = (f) => { try { return fs.readFileSync(p.join(dir, f), 'utf8').trim(); }
                                     catch (e) { return e.code; } };
            console.log(JSON.stringify({ env: attempt('.env'), plain: attempt('plain.txt') }));
        `;
        const child = spawnSync(process.execPath, ['-e', probe, dir], {
            encoding: 'utf8',
            env: {
                ...process.env,
                AMODX_INFRA_DOTENV_DIRS: dir,
                AMODX_INFRA_DOTENV_AUDIT: path.join(dir, 'audit.jsonl'),
            },
        });

        expect(child.status).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ env: 'ENOENT', plain: 'readable' });
    });

    test('(iso3) no credential source is reachable from this process tree', () => {
        // The environment the constructors hand to `next build` / `vite build` is
        // `{...process.env}`, so this IS that environment. Covers all three legs of the AWS
        // credential chain: environment variables, the shared config/credentials files, and IMDS.
        const leaked = Object.keys(process.env).filter(
            (k) => /^(AWS_|AMODX_)/.test(k) && !['AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE', 'AWS_EC2_METADATA_DISABLED', 'AMODX_INFRA_DOTENV_AUDIT'].includes(k),
        );
        expect(leaked).toEqual([]);
        expect(fs.existsSync(String(process.env.AWS_SHARED_CREDENTIALS_FILE))).toBe(false);
        expect(fs.existsSync(String(process.env.AWS_CONFIG_FILE))).toBe(false);
        expect(process.env.AWS_EC2_METADATA_DISABLED).toBe('true');
        expect(process.env.TABLE_NAME).toBeUndefined();
    });
});
