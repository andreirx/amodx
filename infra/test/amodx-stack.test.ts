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
 *      behavior, no revalidation function — which is the opposite of what a slice called
 *      "infra truth" should assert. The clean fix is to lift build orchestration out of the constructs, and
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
 * policy, all six behaviors, the CloudFront Function, the four invalidation grants and the two
 * cache-flush EventBridge rules asserted at that time were byte-identical there.
 *
 * That diff predates `cache-6`, so it says nothing about the two properties `cache-6` added —
 * `ImageCachePolicy` and the eighth `RendererOriginPolicy` header — nor about the ninth and
 * tenth `RendererOriginPolicy` headers `cache-7` added (`x-prerender-revalidate`, `x-isr`).
 * (`STATIC-EP` added NO ORP header: its CYCLE-1 `Origin` addition failed deploy on CloudFront's
 * 10-header cap and was reverted — the origin guard moved to the viewer-request Function instead,
 * pinned by `(i)` below.) None is domain-shaped (a query-string key and header allowlist entries),
 * so the same argument covers them, but it is an argument here rather than a measurement. Labelled
 * INFERRED, not OBSERVED.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AmodxStack } from '../lib/amodx-stack';
import { STATIC_EP_EDGE_ORIGIN_GUARD } from '../lib/renderer-hosting';

/** AWS-managed cache policy ids (stable, documented, and what the CDK enum resolves to). */
const MANAGED_CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const MANAGED_CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

const NO_DOTENV_PRELOAD = path.join(__dirname, 'no-dotenv.cjs');

/**
 * Fixed per-stage overhead the domains:{} test synth omits but a real stage adds: the
 * Route53/ACM/DomainName/ApiMapping domain resources, the parent's own CDK::Metadata, and the
 * domain custom-resource satellites (fn/role/policy/log-group). Calibrated whole at the split
 * commit, when deployedParent equalled the real staging synth (infra/cdk.out parent = 446);
 * the overhead is fixed, the parent count is not (see the counts in (split1-5)). Not pure domain
 * — hence not named DOMAIN_OVERHEAD. Used by (split1-5) and (sched1b-4).
 */
const PARENT_STAGE_OVERHEAD = 13;

let auditPath: string;
let scratchDir: string;

/** Parent-stack template. */
let template: Template;
/** Parent + every NestedStack, so "and no other role" claims are stack-tree-wide. */
let allTemplates: Template[];
/** The CatalogApi NestedStack template alone (INFRA-SPLIT-1 v2 safety-invariant assertions). */
let catalogTemplate: Template;
/** The EngagementApi NestedStack template alone (CAT-INTEREST-1 route assertion). */
let engagementTemplate: Template;
/** The SchedulingApi NestedStack template alone (SCHED-1D1 rows I1, I2, I5; the amended (sched1b-3)). */
let schedulingTemplate: Template;

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

    const nestedStacks = stack.node
        .findAll()
        .filter((c): c is cdk.NestedStack => c instanceof cdk.NestedStack);
    const byId = new Map(nestedStacks.map((n) => [n.node.id, Template.fromStack(n)]));

    const catalogNested = byId.get('CatalogApi');
    if (!catalogNested) throw new Error('CatalogApi NestedStack not found in the stack tree');
    catalogTemplate = catalogNested;
    const engagementNested = byId.get('EngagementApi');
    if (!engagementNested) throw new Error('EngagementApi NestedStack not found in the stack tree');
    engagementTemplate = engagementNested;
    // The instance INSIDE `allTemplates` (built from the same `findAll()` order), so `allTemplates.indexOf(schedulingTemplate)`
    // is its position in the stack tree (the IAM reading rule of the SCHED-1B block addresses templates by position).
    const schedulingAt = nestedStacks.findIndex((n) => n.node.id === 'SchedulingApi');
    if (schedulingAt < 0) throw new Error('SchedulingApi NestedStack not found in the stack tree');
    schedulingTemplate = allTemplates[1 + schedulingAt];

    // Labeled per-template resource counts, logged once as INFRA-SPLIT-1 evidence. The parent count
    // is the CFN-500 gate; the nested counts let a reviewer see at a glance that CommerceApi/
    // EngagementApi were NOT restructured by this slice (only the new CatalogApi appears).
    const count = (t: Template) => Object.keys(t.toJSON().Resources ?? {}).length;
    const fns = (t: Template) => Object.keys(t.findResources('AWS::Lambda::Function')).length;
    const parts = [`AmodxStack(parent)=${count(template)}/${fns(template)}fn`];
    for (const id of ['CatalogApi', 'CommerceApi', 'EngagementApi', 'SchedulingApi']) {
        const t = byId.get(id);
        if (t) parts.push(`${id}=${count(t)}/${fns(t)}fn`);
    }
    // Raw counts from THIS synth omit the managed LogGroup per Lambda (cdk.json's
    // useCdkManagedLogGroup flag is not loaded by `new cdk.App()`), so the deployed count of each
    // template is its raw count + its function count. See (split1-5) for the full offset accounting.
    console.log(`(split1) template resources/functions (credential-free domains:{} synth, log groups omitted): ${parts.join(', ')}`);
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

    test('(a2) query allowlist is EXACTLY the eight read parameters, in order', () => {
        // `cache-3` replaced `queryStringBehavior: all()` with this allowlist: `all()` let any
        // `?utm_*`/`?fbclid`/attacker-chosen junk parameter mint a distinct entry and an SSR
        // Lambda invocation per unique value.
        //
        // The list is exactly the set of `query.*` reads in renderer/src — `page`, `q`,
        // `availability`, `id`, `email`, `f` (components/SitePage.tsx; `f` = catalog storefront
        // filters, cat-facets-1), `preview` (the %5Fdyn twins) and `nf` (lib/not-found-handoff.ts). A parameter that changes the rendered
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
            'f',
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
        // `x-prerender-revalidate` + `x-isr` (cache-7) were REMOVED 2026-10-13 (security fix,
        // human-ratified): open-next@3.1.3 skipped tenant middleware for any request carrying `x-isr`
        // (3.1.3 `dist/core/routing/middleware.js:27`; @opennextjs/aws 4.1.9 also requires the
        // preview-mode secret in `x-prerender-revalidate`, `dist/core/routing/middleware.js:28-31`,
        // and both stay un-forwarded on 4.x — OPENNEXT1-XISR = A), so a forwarded viewer `x-isr: 1` on an edge MISS
        // cached a 1-year `307 → /?nf=1` under a real page's key for every visitor (reproduced on
        // staging). Their absence is pinned below — re-adding either is a regression; the cost
        // (OpenNext background-ISR revalidation can no longer persist) is recorded in
        // `renderer-hosting.ts`. This frees two of the ten ORP header slots.
        //
        // `Origin` is DELIBERATELY ABSENT (STATIC-EP / D-STATIC-EP-ORIGIN). The CYCLE-1 attempt to
        // add it as an eleventh header failed deploy on CloudFront's hard 10-header ORP cap (staging
        // caught it, rolled back; prod untouched), so the anonymous-write origin barrier moved to
        // the viewer-request CloudFront Function, which sees `Origin` regardless of that cap. This
        // list was ten headers when STATIC-EP shipped; it is eight since the 2026-10-13 x-isr removal; the edge guard is
        // pinned by `(i)` below, not here.
        //
        // `Next-Url` (RSC-NAV-1, 2026-10-16) is the ninth: Next 16's `validateRSCRequestHeaders`
        // hashes it into the client's `_rsc` param and 307s every RSC navigation whose hash the
        // origin cannot reproduce — with the header stripped at the edge that was every client-side
        // navigation on every tenant (prod: click → 404 under the leaked rewritten path). Transport
        // only; it is pinned ABSENT from the cache key in (a) — no interception routes, so no
        // response varies on it. One ORP slot stays free.
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
            'Next-Url',
        ]);
        expect(headers.Headers.length).toBeLessThanOrEqual(10); // CloudFront's hard ORP cap
        expect(headers.Headers).not.toContain('x-isr');
        expect(headers.Headers).not.toContain('x-prerender-revalidate');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (i) STATIC-EP / D-STATIC-EP-ORIGIN — the edge origin-guard in the viewer-request Function
//     The anonymous-write origin barrier could not live on the ORP (its 10-header cap is full —
//     see the note in `(h)`), so it moved INTO the viewer-request CloudFront Function, which sees
//     `Origin` regardless of the cap. This block is that barrier's regression fence. It has two
//     halves that together prove the DEPLOYED function enforces the verified decision table:
//       1. the shared source `STATIC_EP_EDGE_ORIGIN_GUARD` (the exact ES5 spliced into the
//          function) is driven as the pure function it is, over the full decision table; and
//       2. the deployed function body (`FunctionCode`, joined out of its Fn::Join — it interpolates
//          the origin-verify secret token, so it is not a bare string) CONTAINS that same source.
//     Together: the deployed edge function runs logic (1), because its body contains (1).
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('viewer-request Function — STATIC-EP edge origin-guard (D-STATIC-EP-ORIGIN)', () => {
    const HARDENED = ['/api/consent', '/api/contact', '/api/leads'];
    const PUBLIC_HOST = 'acme.test';

    // Reconstruct the deployed FunctionCode as text. CDK renders it as an `Fn::Join` because the
    // function template literal interpolates `originVerifySecret` (a Secrets Manager token); the
    // literal string segments joined back together contain everything except that secret — which
    // the guard does not reference — so `.includes()` over it is exact for our assertions.
    function deployedFunctionCode(): string {
        const code = onlyResource('AWS::CloudFront::Function').Properties.FunctionCode;
        if (typeof code === 'string') return code;
        const join = code['Fn::Join'];
        if (join && Array.isArray(join[1])) {
            return join[1].map((p: unknown) => (typeof p === 'string' ? p : '')).join('');
        }
        throw new Error(`unexpected FunctionCode shape: ${JSON.stringify(code).slice(0, 120)}`);
    }

    // Drive the SHARED guard source as a pure function. It runs with `request` and `host` in scope
    // in the real function; the harness supplies exactly those two, mirroring the deployed prelude
    // (`var host = request.headers.host ? request.headers.host.value : ''`).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const guard = new Function(
        'event',
        `var request = event.request;
         var host = request.headers.host ? request.headers.host.value : '';
         ${STATIC_EP_EDGE_ORIGIN_GUARD}
         return request;`,
    ) as (event: any) => any;

    function run(o: { method: string; uri: string; host?: string; origin?: string }): any {
        const headers: any = {};
        if (o.host !== undefined) headers.host = { value: o.host };
        if (o.origin !== undefined) headers.origin = { value: o.origin };
        return guard({ request: { method: o.method, uri: o.uri, headers } });
    }

    for (const uri of HARDENED) {
        test(`(i) ${uri}: same-origin POST passes to the origin (not a 403)`, () => {
            // Pass-through returns the request object (no statusCode); a 403 returns a response.
            const res = run({ method: 'POST', uri, host: PUBLIC_HOST, origin: `https://${PUBLIC_HOST}` });
            expect(res.statusCode).toBeUndefined();
        });

        test(`(i) ${uri}: null-origin POST (sandboxed opaque frame) is rejected 403 at the edge`, () => {
            const res = run({ method: 'POST', uri, host: PUBLIC_HOST, origin: 'null' });
            expect(res.statusCode).toBe(403);
        });

        test(`(i) ${uri}: cross-site POST is rejected 403 at the edge`, () => {
            const res = run({ method: 'POST', uri, host: PUBLIC_HOST, origin: 'https://evil.example' });
            expect(res.statusCode).toBe(403);
        });

        test(`(i) ${uri}: POST with no Origin header is rejected 403 (browsers always send Origin on POST)`, () => {
            const res = run({ method: 'POST', uri, host: PUBLIC_HOST });
            expect(res.statusCode).toBe(403);
        });

        test(`(i) ${uri}: a scheme downgrade (http, not the https public origin) is rejected 403`, () => {
            const res = run({ method: 'POST', uri, host: PUBLIC_HOST, origin: `http://${PUBLIC_HOST}` });
            expect(res.statusCode).toBe(403);
        });

        test(`(i) ${uri}: GET passes through untouched even with a null Origin (only POST is gated)`, () => {
            const res = run({ method: 'GET', uri, host: PUBLIC_HOST, origin: 'null' });
            expect(res.statusCode).toBeUndefined();
        });
    }

    test('(i) a non-hardened path POST (/api/ref, intentionally-open) is NOT gated by the edge guard', () => {
        const res = run({ method: 'POST', uri: '/api/ref', host: PUBLIC_HOST, origin: 'null' });
        expect(res.statusCode).toBeUndefined();
    });

    test('(i) the DEPLOYED viewer-request function body contains the exact shared guard + all three paths', () => {
        const code = deployedFunctionCode();
        expect(code).toContain(STATIC_EP_EDGE_ORIGIN_GUARD);
        for (const uri of HARDENED) expect(code).toContain(`'${uri}'`);
        expect(code).toContain('403');
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
// (rev2a) Private-bucket quarantine lifecycle
//     Ratified by `rev-2a` (D-REV-2 mitigation, plan-reviews-import.md). Raw imported review
//     media is staged under the `review-staging/` prefix on the PRIVATE assets bucket; this ONE
//     lifecycle rule is the abandoned-import cleanup. Pinned here so a synth that drops or
//     re-scopes the rule fails by name rather than silently letting untrusted third-party bytes
//     accumulate forever. Prefix is a hard contract with backend/src/lib/review-media.ts.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('PrivateAssetsBucket — review-staging quarantine lifecycle', () => {
    /** The one S3 bucket whose logical id contains `PrivateAssetsBucket`. */
    function privateBucketProps(): any {
        const found = Object.entries(template.findResources('AWS::S3::Bucket')).filter(([id]) =>
            id.includes('PrivateAssetsBucket'),
        );
        if (found.length !== 1) {
            throw new Error(`expected 1 PrivateAssetsBucket, found ${found.length}`);
        }
        return (found[0][1] as any).Properties;
    }

    test('(rev2a) EXACTLY one 30-day expiry rule on the review-staging/ prefix, enabled', () => {
        // Bounded on purpose: exactly one rule, on exactly the quarantine prefix, so this cannot
        // be read as blessing a blanket bucket expiry (product PDFs/zips must NOT expire).
        const rules = privateBucketProps().LifecycleConfiguration?.Rules as any[] | undefined;
        expect(rules).toBeDefined();
        expect(rules).toHaveLength(1);

        const rule = rules![0];
        expect(rule.Status).toBe('Enabled');
        expect(rule.Prefix).toBe('review-staging/');
        expect(rule.ExpirationInDays).toBe(30);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (o) RendererAssets — ISR cache expiry (old-build orphans)
//     Ratified as OPENNEXT1-ORPHANS = C (docs/slices/opennext-1-upgrade.md § Ratification),
//     built by `opennext-1d` (docs/slices/opennext-1c-1d.md). The renderer's ISR cache lives
//     under `_cache/<buildId>/` in this bucket; every deploy starts a new build id and nothing
//     else ever deletes the old prefix unless an edit triggers the nightly flush. This ONE rule
//     expires `_cache/` objects 30 days after their last write. The static site assets and the
//     `BUILD_ID` object live at the bucket ROOT and must never expire, which is why (o1) is
//     bounded to exactly one rule on exactly that prefix, and why (o2) ties the prefix to the
//     server function's CACHE_BUCKET_KEY_PREFIX — the string the cache adapter actually writes.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('RendererAssets — _cache/ ISR expiry (opennext-1d)', () => {
    /** The one S3 bucket whose logical id contains `RendererAssets`. */
    function rendererAssetsBucketProps(): any {
        const found = Object.entries(template.findResources('AWS::S3::Bucket')).filter(([id]) =>
            id.includes('RendererAssets'),
        );
        if (found.length !== 1) {
            throw new Error(`expected 1 RendererAssets bucket, found ${found.length}`);
        }
        return (found[0][1] as any).Properties;
    }

    /** The one Lambda function whose logical id contains `RendererHostingRendererServer`. */
    function rendererServerEnv(): Record<string, unknown> {
        const found = Object.entries(template.findResources('AWS::Lambda::Function')).filter(
            ([id]) => id.includes('RendererHostingRendererServer'),
        );
        if (found.length !== 1) {
            throw new Error(`expected 1 RendererServer function, found ${found.length}`);
        }
        return (found[0][1] as any).Properties.Environment.Variables;
    }

    test('(o1) EXACTLY one 30-day expiry rule on the _cache/ prefix, enabled', () => {
        // Bounded on purpose, as (rev2a) is: exactly one rule, on exactly the ISR prefix, so this
        // cannot be read as a blanket expiry over the static assets at the bucket root.
        const rules = rendererAssetsBucketProps().LifecycleConfiguration?.Rules as any[] | undefined;
        expect(rules).toBeDefined();
        expect(rules).toHaveLength(1);

        const rule = rules![0];
        expect(rule.Status).toBe('Enabled');
        expect(rule.Prefix).toBe('_cache/');
        expect(rule.ExpirationInDays).toBe(30);
    });

    test("(o2) the rule's prefix is the RendererServer CACHE_BUCKET_KEY_PREFIX + '/'", () => {
        // The contract tie. open-next writes cache keys as `<CACHE_BUCKET_KEY_PREFIX>/<buildId>/...`;
        // if either side drifts, the rule expires nothing (or something else) and this fails.
        const rules = rendererAssetsBucketProps().LifecycleConfiguration?.Rules as any[] | undefined;
        expect(rules).toHaveLength(1);
        const envPrefix = rendererServerEnv().CACHE_BUCKET_KEY_PREFIX;
        expect(typeof envPrefix).toBe('string');
        expect(rules![0].Prefix).toBe(`${envPrefix}/`);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (rev2a-iam) UpdateReviewFunc — least-privilege S3 for the promotion path + env wiring
//     Ratified by `rev-2a` (REV2A-INFRA-SURFACE = option B) and review-2's blocking least-privilege
//     finding. The review moderation handler's `action: "approve-image"` path promotes the
//     staged ORIGINAL PRIVATE→PUBLIC (moderation-only pipeline, D-REV-4 SUPERSEDED — no
//     byte-screened derivative; backend/src/lib/review-media.ts). It issues EXACTLY
//     three public-bucket object operations — CopyObject (`s3:PutObject`), HeadObject (`s3:GetObject`)
//     and the rollback DeleteObject (`s3:DeleteObject`) — and ONE private read, `s3:GetObject` on the
//     CopyObject source under `review-staging/`. It must hold those and NOTHING WIDER. The prior
//     `grantReadWrite`/`grantRead` convenience calls also conferred bucket-list, GetBucket*, multipart
//     abort, tagging, retention, legal-hold and version-delete — a blast radius over every tenant's
//     assets if this handler is ever exploited. These assertions pin the boundary by NAME so a future
//     convenience grant fails HERE rather than silently reopening it.
//     Prose: docs/slices/rev-2a-staged-media-pipeline.md § "DoD / evidence".
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('UpdateReviewFunc — rev-2a promotion least-privilege', () => {
    /** The one review-moderation Lambda across the stack tree (it lives in the CommerceApi nested stack). */
    function updateReviewFunc(): { template: Template; roleLogicalId: string; props: any } {
        for (const t of allTemplates) {
            const fns = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) =>
                id.includes('UpdateReviewFunc'),
            );
            if (fns.length === 0) continue;
            if (fns.length !== 1) throw new Error(`expected 1 UpdateReviewFunc, found ${fns.length}`);
            const props = (fns[0][1] as any).Properties;
            // `Role` is `Fn::GetAtt [<RoleLogicalId>, Arn]`; the default policy references it by Ref.
            const roleLogicalId = props.Role['Fn::GetAtt'][0] as string;
            return { template: t, roleLogicalId, props };
        }
        throw new Error('UpdateReviewFunc not found in any template');
    }

    /** Every S3 statement (action/resource normalized) on the UpdateReviewFunc role, in its own template. */
    function s3Statements(): Array<{ actions: string[]; resources: string[] }> {
        const { template: t, roleLogicalId } = updateReviewFunc();
        const out: Array<{ actions: string[]; resources: string[] }> = [];
        for (const [, policy] of Object.entries(t.findResources('AWS::IAM::Policy'))) {
            const roles = ((policy as any).Properties.Roles as any[]).map((r) => String(r.Ref));
            if (!roles.includes(roleLogicalId)) continue;
            for (const s of (policy as any).Properties.PolicyDocument.Statement as any[]) {
                const actions: string[] = (Array.isArray(s.Action) ? s.Action : [s.Action]).map(String);
                if (!actions.some((a) => a.startsWith('s3:'))) continue;
                const resources = (Array.isArray(s.Resource) ? s.Resource : [s.Resource]).map(
                    (r: unknown) => JSON.stringify(r),
                );
                out.push({ actions, resources });
            }
        }
        return out;
    }

    test('(rev2a-iam-1) the ONLY S3 actions on this role are GetObject/PutObject/DeleteObject', () => {
        // The strongest single check: the UNION of every S3 action across every statement attached to
        // this role. A future `grantReadWrite`/`grantRead` — or a fourth hand-written statement adding
        // `s3:ListBucket` — grows this set and fails here. Collected WITHOUT de-dup across statements
        // first, then set-reduced, so the assertion is about the granted VOCABULARY, not statement count.
        const granted = [
            ...new Set(s3Statements().flatMap((s) => s.actions).filter((a) => a.startsWith('s3:'))),
        ].sort();
        expect(granted).toEqual(['s3:DeleteObject', 's3:GetObject', 's3:PutObject']);
    });

    test('(rev2a-iam-2) private read is a lone s3:GetObject scoped to the review-staging/ prefix', () => {
        // CopyObject's SOURCE. One action, and prefix-scoped so a defect here cannot read the private
        // bucket's product PDFs/zips — only quarantined review media.
        const priv = s3Statements().filter(
            (s) => s.actions.length === 1 && s.actions[0] === 's3:GetObject',
        );
        expect(priv).toHaveLength(1);
        expect(priv[0].resources).toHaveLength(1);
        expect(priv[0].resources[0]).toContain('review-staging/*');
    });

    test('(rev2a-iam-3) public grant is EXACTLY Put/Get/Delete, object-scoped, NOT under review-staging', () => {
        // CopyObject dest (Put), HeadObject (Get), rollback (Delete). Object-scoped (`/*`) because the
        // promoted key is `<tenantId>/<assetId>.jpg`, not under the staging prefix.
        const pub = s3Statements().filter((s) => s.actions.length === 3);
        expect(pub).toHaveLength(1);
        expect([...pub[0].actions].sort()).toEqual(['s3:DeleteObject', 's3:GetObject', 's3:PutObject']);
        expect(pub[0].resources).toHaveLength(1);
        expect(pub[0].resources[0]).toContain('/*');
        expect(pub[0].resources[0]).not.toContain('review-staging');
    });

    test('(rev2a-iam-4) PRIVATE_BUCKET, UPLOADS_BUCKET and UPLOADS_CDN_URL are wired on the function', () => {
        // The promotion code reads all three from process.env (backend/src/reviews/update.ts:37-39);
        // a missing one is a runtime crash, invisible to the IAM checks above.
        const vars = updateReviewFunc().props.Environment.Variables;
        for (const key of ['PRIVATE_BUCKET', 'UPLOADS_BUCKET', 'UPLOADS_CDN_URL']) {
            expect(Object.prototype.hasOwnProperty.call(vars, key)).toBe(true);
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (rev2b-iam) ReviewImportFunc — least-privilege S3 for the bulk-import staging path
//     Ratified by `rev-2b` (import-family instance #3) and review-1's blocking least-privilege
//     finding. The bulk-import handler (backend/src/import/reviews.ts) issues EXACTLY ONE S3
//     operation — `PutObjectCommand` staging each raw `/original` under the `review-staging/`
//     quarantine prefix (backend/src/lib/review-media.ts `stageReviewImage`). It must hold
//     `s3:PutObject` and NOTHING WIDER, prefix-scoped. The prior `grantPut(fn)` convenience call
//     scoped to the WHOLE bucket (`<bucketArn>/*`) and also conferred the put-family
//     (PutObjectLegalHold/Retention/*Tagging, Abort*) — a blast radius over every tenant's private
//     objects (product PDFs, zips) if this handler is exploited. These assertions pin the boundary
//     by NAME so a future convenience grant fails HERE. Mirrors (rev2a-iam) for UpdateReviewFunc.
//     Prose: docs/slices/rev-2b-bulk-import.md § "Infra".
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('ReviewImportFunc — rev-2b import least-privilege', () => {
    /** The one bulk-review-import Lambda across the stack tree (it lives in the CatalogApi nested stack since INFRA-SPLIT-1). */
    function reviewImportFunc(): { template: Template; roleLogicalId: string; props: any } {
        for (const t of allTemplates) {
            const fns = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) =>
                id.includes('ReviewImportFunc'),
            );
            if (fns.length === 0) continue;
            if (fns.length !== 1) throw new Error(`expected 1 ReviewImportFunc, found ${fns.length}`);
            const props = (fns[0][1] as any).Properties;
            const roleLogicalId = props.Role['Fn::GetAtt'][0] as string;
            return { template: t, roleLogicalId, props };
        }
        throw new Error('ReviewImportFunc not found in any template');
    }

    /** Every S3 statement (action/resource normalized) on the ReviewImportFunc role, in its template. */
    function s3Statements(): Array<{ actions: string[]; resources: string[] }> {
        const { template: t, roleLogicalId } = reviewImportFunc();
        const out: Array<{ actions: string[]; resources: string[] }> = [];
        for (const [, policy] of Object.entries(t.findResources('AWS::IAM::Policy'))) {
            const roles = ((policy as any).Properties.Roles as any[]).map((r) => String(r.Ref));
            if (!roles.includes(roleLogicalId)) continue;
            for (const s of (policy as any).Properties.PolicyDocument.Statement as any[]) {
                const actions: string[] = (Array.isArray(s.Action) ? s.Action : [s.Action]).map(String);
                if (!actions.some((a) => a.startsWith('s3:'))) continue;
                const resources = (Array.isArray(s.Resource) ? s.Resource : [s.Resource]).map(
                    (r: unknown) => JSON.stringify(r),
                );
                out.push({ actions, resources });
            }
        }
        return out;
    }

    test('(rev2b-iam-1) the ONLY S3 action on this role is s3:PutObject', () => {
        // The whole S3 vocabulary granted to this role. A future `grantPut`/`grantReadWrite` — which
        // adds the put-family and/or bucket-list — grows this set and fails here.
        const granted = [
            ...new Set(s3Statements().flatMap((s) => s.actions).filter((a) => a.startsWith('s3:'))),
        ].sort();
        expect(granted).toEqual(['s3:PutObject']);
    });

    test('(rev2b-iam-2) the s3:PutObject grant is a single statement scoped to review-staging/', () => {
        // One statement, one action, and prefix-scoped so a defect here cannot write anywhere in the
        // private bucket except the quarantine — never a product PDF/zip, never the bucket root.
        const puts = s3Statements().filter(
            (s) => s.actions.length === 1 && s.actions[0] === 's3:PutObject',
        );
        expect(puts).toHaveLength(1);
        expect(puts[0].resources).toHaveLength(1);
        expect(puts[0].resources[0]).toContain('review-staging/*');
    });

    test('(rev2b-iam-3) PRIVATE_BUCKET is wired on the function', () => {
        // The handler reads process.env.PRIVATE_BUCKET to target the staging PUT; a missing var is a
        // runtime failure invisible to the IAM checks above.
        const vars = reviewImportFunc().props.Environment.Variables;
        expect(Object.prototype.hasOwnProperty.call(vars, 'PRIVATE_BUCKET')).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (pay1) UpdateOrderFunc — PAY-1 "paid" order mail
//     PUT /orders/{id} (backend/src/orders/update.ts) sends the "paid" mail on pending → paid. The handler
//     sends no mail when SES_FROM_EMAIL is absent, and SES refuses the send without ses:SendEmail. These
//     assertions pin both on the function, with the grant scoped to the sender identity (not `*`) and
//     equal to the neighbour UpdateOrderStatusFunc's. They prove the template, not a delivered mail.
//     Prose: docs/slices/pay-1.md § Build record — revision 1.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('UpdateOrderFunc — PAY-1 paid-mail wiring', () => {
    /** The one Lambda whose logical id holds `UpdateOrderFunc` (not `UpdateOrderStatusFunc`), across the stack tree. */
    function orderFunc(name: 'UpdateOrderFunc' | 'UpdateOrderStatusFunc'): { template: Template; roleLogicalId: string; props: any } {
        for (const t of allTemplates) {
            const fns = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) => id.includes(name));
            if (fns.length === 0) continue;
            if (fns.length !== 1) throw new Error(`expected 1 ${name}, found ${fns.length}`);
            const props = (fns[0][1] as any).Properties;
            return { template: t, roleLogicalId: props.Role['Fn::GetAtt'][0] as string, props };
        }
        throw new Error(`${name} not found in any template`);
    }

    /** Every statement naming an `ses:` action on the function's role, resources serialized. */
    function sesStatements(name: 'UpdateOrderFunc' | 'UpdateOrderStatusFunc'): Array<{ actions: string[]; resources: string[] }> {
        const { template: t, roleLogicalId } = orderFunc(name);
        const out: Array<{ actions: string[]; resources: string[] }> = [];
        for (const [, policy] of Object.entries(t.findResources('AWS::IAM::Policy'))) {
            const roles = ((policy as any).Properties.Roles as any[]).map((r) => String(r.Ref));
            if (!roles.includes(roleLogicalId)) continue;
            for (const st of (policy as any).Properties.PolicyDocument.Statement as any[]) {
                const actions: string[] = (Array.isArray(st.Action) ? st.Action : [st.Action]).map(String);
                if (!actions.some((a) => a.startsWith('ses:'))) continue;
                const resources = (Array.isArray(st.Resource) ? st.Resource : [st.Resource]).map((r: unknown) => JSON.stringify(r));
                out.push({ actions, resources });
            }
        }
        return out;
    }

    test('(pay1-1) SES_FROM_EMAIL is wired on UpdateOrderFunc, with the value of UpdateOrderStatusFunc', () => {
        const vars = orderFunc('UpdateOrderFunc').props.Environment.Variables;
        expect(Object.prototype.hasOwnProperty.call(vars, 'SES_FROM_EMAIL')).toBe(true);
        expect(vars.SES_FROM_EMAIL).toEqual(orderFunc('UpdateOrderStatusFunc').props.Environment.Variables.SES_FROM_EMAIL);
    });

    test('(pay1-2) one ses:SendEmail statement, scoped to the sender identity (not *), equal to the neighbour\'s', () => {
        const ses = sesStatements('UpdateOrderFunc');
        expect(ses).toHaveLength(1);
        expect(ses[0].actions).toEqual(['ses:SendEmail']);
        expect(ses[0].resources).toHaveLength(1);
        expect(ses[0].resources[0]).not.toBe(JSON.stringify('*'));
        expect(ses[0].resources[0]).toContain(':identity/');
        expect(ses).toEqual(sesStatements('UpdateOrderStatusFunc'));
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (split1) INFRA-SPLIT-1 v2 — the catalog FUNCTIONS-ONLY move, as a synthesized-template invariant
//     Ratified by docs/slices/infra-split-1-catalog-nested-stack.md § "Design v2". The move exists
//     to relieve CloudFormation's hard 500-resource ceiling by relocating the catalog group's heavy
//     Lambda Functions into their own NestedStack template. v2 (not v1) is load-bearing: v1 moved the
//     ROUTES too and CREATE_FAILED on staging because relocating a route changes its logical id, so
//     CloudFormation created the new route key on the shared HttpApi before deleting the old one — a
//     duplicate-key collision. These assertions pin the exact shape that avoids it: FUNCTIONS move to
//     CatalogApi; ROUTES + INTEGRATIONS + PERMISSIONS stay in the parent with unchanged keys, their
//     integrations retargeted in place to the moved functions via a cross-stack Fn::GetAtt.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('INFRA-SPLIT-1 v2 — catalog functions-only move (the deploy-safety invariant)', () => {
    // The 16 catalog route keys that MUST remain in the PARENT with unchanged keys. Enumerated, not
    // counted, so a dropped or renamed route fails by NAME. content 6 + products 5 + import 5 (the 4th,
    // POST /import/glam-pricelist, added by CAT-IMPORT-1 with its function in CatalogApi; the 5th,
    // POST /import/glam-pricelist/images, added by CAT-IMAGES-1 on the SAME function — 15 functions, 16 routes).
    const CATALOG_ROUTE_KEYS = [
        'POST /content',
        'GET /content',
        'GET /content/{id}',
        'PUT /content/{id}',
        'GET /content/{id}/versions',
        'POST /content/{id}/restore',
        'POST /products',
        'GET /products',
        'GET /products/{id}',
        'PUT /products/{id}',
        'DELETE /products/{id}',
        'POST /import/wordpress',
        'POST /import/media',
        'POST /import/reviews',
        'POST /import/glam-pricelist',
        'POST /import/glam-pricelist/images',
    ];

    test('(split1-1) CatalogApi holds EXACTLY the 15 catalog Lambda functions', () => {
        // The heavy resources that moved out of the parent template to buy headroom under the 500
        // ceiling. Exactly 15 — content 6 + products 5 + import 4 (CAT-IMPORT-1 added the glam
        // pricelist import; CAT-IMAGES-1 added a ROUTE to that function, no function) — so a stray
        // function moved in (count > 15) or one left behind re-inflating the parent (count < 15) both fail here.
        expect(Object.keys(catalogTemplate.findResources('AWS::Lambda::Function'))).toHaveLength(15);
    });

    test('(cat-import-1) POST /import/glam-pricelist integrates GlamPricelistImportFunc, whose timeout ≤ the 15-min import lock', () => {
        // The route lives in the parent (split1-4 checks key + CatalogApi wiring); this pins WHICH function it
        // reaches, and the timeout invariant of spec catalog-mode-1 § 3.4: a lock past `expiresAt` (15 min,
        // LOCK_DURATION_MS in backend/src/import/glam-pricelist.ts) belongs to a job that can no longer run.
        const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
            .filter((r: any) => r.Properties.RouteKey === 'POST /import/glam-pricelist');
        expect(routes).toHaveLength(1);
        const integrationId = JSON.stringify((routes[0] as any).Properties.Target).match(/"Ref":"([^"]+)"/)![1];
        const integration = template.findResources('AWS::ApiGatewayV2::Integration')[integrationId] as any;
        expect(JSON.stringify(integration.Properties.IntegrationUri)).toMatch(/GlamPricelistImportFunc/);

        const fns = Object.entries(catalogTemplate.findResources('AWS::Lambda::Function'))
            .filter(([id]) => id.includes('GlamPricelistImportFunc'));
        expect(fns).toHaveLength(1);
        expect((fns[0][1] as any).Properties.Timeout).toBeLessThanOrEqual(15 * 60);
    });

    test('(cat-images-1) POST /import/glam-pricelist/images integrates the SAME GlamPricelistImportFunc, which has the uploads bucket grant + UPLOADS_* env of MediaImportFunc', () => {
        // Slice cat-images-1 § 7 CIM-A1-1: no new function; the import function serves the image copy (it dispatches
        // on routeKey) and writes to the uploads bucket. The reference shape is MediaImportFunc (same bucket, same
        // grantReadWrite, same two variables), compared rather than restated so the two cannot drift apart silently.
        const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
            .filter((r: any) => r.Properties.RouteKey === 'POST /import/glam-pricelist/images');
        expect(routes).toHaveLength(1);
        const integrationId = JSON.stringify((routes[0] as any).Properties.Target).match(/"Ref":"([^"]+)"/)![1];
        const integration = template.findResources('AWS::ApiGatewayV2::Integration')[integrationId] as any;
        expect(JSON.stringify(integration.Properties.IntegrationUri)).toMatch(/GlamPricelistImportFunc/);

        const fn = (part: string) => {
            const found = Object.entries(catalogTemplate.findResources('AWS::Lambda::Function')).filter(([id]) => id.includes(part));
            expect(found).toHaveLength(1);
            return (found[0][1] as any).Properties;
        };
        const s3Statements = (part: string) => {
            const role = fn(part).Role['Fn::GetAtt'][0] as string;
            return Object.values(catalogTemplate.findResources('AWS::IAM::Policy'))
                .filter((p: any) => (p.Properties.Roles as any[]).some((r) => r.Ref === role))
                .flatMap((p: any) => p.Properties.PolicyDocument.Statement as any[])
                .filter((st) => (Array.isArray(st.Action) ? st.Action : [st.Action]).some((a: string) => a.startsWith('s3:')));
        };
        const glam = fn('GlamPricelistImportFunc');
        const media = fn('MediaImportFunc');
        for (const name of ['UPLOADS_BUCKET', 'UPLOADS_CDN_URL']) {
            expect({ name, value: glam.Environment.Variables[name] }).toEqual({ name, value: media.Environment.Variables[name] });
        }
        const glamS3 = s3Statements('GlamPricelistImportFunc');
        expect(glamS3.length).toBeGreaterThan(0);
        expect(glamS3).toEqual(s3Statements('MediaImportFunc'));
    });

    test('(split1-2) CatalogApi contains NO route, integration, or Lambda permission — those stay in the parent', () => {
        // The v2 boundary itself: ONLY Function/Role/Policy move. A route/integration/permission
        // synthesized HERE would be the v1 mistake returning — a route recreated in another stack,
        // which is the shared-HttpApi key collision that failed staging.
        expect(catalogTemplate.findResources('AWS::ApiGatewayV2::Route')).toEqual({});
        expect(catalogTemplate.findResources('AWS::ApiGatewayV2::Integration')).toEqual({});
        expect(catalogTemplate.findResources('AWS::Lambda::Permission')).toEqual({});
    });

    test('(split1-3) CatalogApi contains NO stateful resource — no table, bucket, or user pool moved', () => {
        // Hard slice constraint (§ "Resource-recreation reality"): moving a stateful resource changes
        // its logical id → CloudFormation DELETEs then CREATEs it = data loss. The shared
        // table/buckets/pools stay in the parent and are passed in by reference; none may be here.
        expect(catalogTemplate.findResources('AWS::DynamoDB::Table')).toEqual({});
        expect(catalogTemplate.findResources('AWS::DynamoDB::GlobalTable')).toEqual({});
        expect(catalogTemplate.findResources('AWS::S3::Bucket')).toEqual({});
        expect(catalogTemplate.findResources('AWS::Cognito::UserPool')).toEqual({});
    });

    test('(split1-4) the PARENT keeps all 16 catalog route keys, each wired INTO a CatalogApi function', () => {
        // Both halves of the v2 fix, together: (a) every catalog route key is still in the PARENT
        // template with its key unchanged — no collision on redeploy — and (b) each of those routes
        // now integrates a function that lives in the CatalogApi NestedStack. (b) is what proves the
        // functions actually moved: the integration's target is a cross-stack Fn::GetAtt on the
        // CatalogApi nested-stack resource (whose logical id contains "CatalogApi"), NOT a bare
        // Fn::GetAtt on a parent-local function. A function left behind in the parent would fail (b).
        const routes = template.findResources('AWS::ApiGatewayV2::Route');
        const integrations = template.findResources('AWS::ApiGatewayV2::Integration');

        for (const key of CATALOG_ROUTE_KEYS) {
            const match = Object.values(routes).filter((r) => (r as any).Properties.RouteKey === key);
            expect({ key, count: match.length }).toEqual({ key, count: 1 });

            // Route Target = `Fn::Join ['', ['integrations/', { Ref: <integrationLogicalId> }]]`.
            const targetJson = JSON.stringify((match[0] as any).Properties.Target);
            const refMatch = targetJson.match(/"Ref":"([^"]+)"/);
            expect({ key, hasIntegrationRef: refMatch !== null }).toEqual({ key, hasIntegrationRef: true });

            const integ = integrations[refMatch![1]];
            expect({ key, integrationInParent: integ !== undefined }).toEqual({ key, integrationInParent: true });

            const uriJson = JSON.stringify((integ as any).Properties.IntegrationUri);
            expect({ key, wiredIntoCatalog: uriJson.includes('CatalogApi') }).toEqual({
                key,
                wiredIntoCatalog: true,
            });
        }
    });

    test('(split1-5) the DEPLOYED parent template is back under CloudFormation\'s 500-resource ceiling', () => {
        // The reason the whole slice exists: email-2 pushed the single parent template to 501, over
        // CFN's hard 500-per-template limit, blocking every backend deploy. Moving the catalog
        // functions into their own template must bring the parent back under 500 AND keep the new
        // nested template well under it too.
        //
        // THREE SYNTH-vs-DEPLOY OFFSETS this assertion corrects for, so it gates the number that
        // actually deploys rather than the raw test synth. All three are VERIFIED against the real
        // credentialed staging synth checked into infra/cdk.out (2026-08-10):
        //   1. MANAGED LOG GROUPS. cdk.json sets `@aws-cdk/aws-lambda:useCdkManagedLogGroup=true`,
        //      which makes the real `cdk synth` emit one AWS::Logs::LogGroup per Lambda. This test's
        //      `new cdk.App()` does NOT load cdk.json's context, so its synth omits them. So each
        //      template's log-group offset = its Lambda-function count.
        //   2. AWS::CDK::Metadata. The real credentialed synth emits one CLI-analytics
        //      AWS::CDK::Metadata per template; the credential-free `new cdk.App()` omits it. Proven
        //      by cdk.out: CatalogApi = 42 core + 14 log groups + 1 CDK::Metadata = 57 (the test raw
        //      is 42, so raw + fns = 56 undercounts the deployed template by this one). Added below as
        //      NESTED_METADATA for the nested template; the parent's copy is folded into offset 3.
        //   3. STAGE OVERHEAD. The credential-free `config:{domains:{}}` synth (see file header) omits
        //      the fixed Route53/ACM/DomainName/ApiMapping resources, their domain custom-resource
        //      satellites, and the parent's own CDK::Metadata that a real stage adds (13 total).
        //      Calibrated whole against cdk.out's real parent (446) so the gate is not falsely
        //      generous. Only the parent carries it — a nested template has no domain resources.
        const rawParent = Object.keys(template.toJSON().Resources ?? {}).length;
        const rawCatalog = Object.keys(catalogTemplate.toJSON().Resources ?? {}).length;
        const parentFns = Object.keys(template.findResources('AWS::Lambda::Function')).length;
        const catalogFns = Object.keys(catalogTemplate.findResources('AWS::Lambda::Function')).length;

        // Per-template synthetic the credential-free `new cdk.App()` OMITS but the real credentialed
        // `cdk synth` EMITS once per template: AWS::CDK::Metadata (CLI analytics). VERIFIED against
        // infra/cdk.out (2026-08-10): the real staging CatalogApi template is 57 = 42 core (14 Fn +
        // 14 Role + 14 Policy) + 14 managed log groups + 1 CDK::Metadata. The FIRST offset model here
        // added only the log groups (catalogFns) and so undercounted the deployed nested template by
        // exactly this one AWS::CDK::Metadata — the bug that made the (since removed, see below)
        // pre-split reconstruction read 500 instead of the documented 501. The parent's own CDK::Metadata is likewise omitted by
        // the test synth but is folded into PARENT_STAGE_OVERHEAD (module scope; calibrated whole).
        const NESTED_METADATA = 1;
        // PARENT_STAGE_OVERHEAD (module scope, shared with (sched1b-4)): the fixed per-stage overhead
        // this synth omits; its accounting is at its declaration.

        // Counts in this synth (opennext-1c, 2026-10-15): 377 + 50 + 13 = 440 and 42 + 14 + 1 = 57.
        // The cdk.out staging template still shows 446 until the opennext-1c deploy; expected 440
        // after it — INFERRED until the operator's deploy synth confirms.
        // Counts in this synth (CAT-IMPORT-1, 2026-10-30): 398 + 53 + 13 = 464 and 45 + 15 + 1 = 61 — the
        // glam import added Route + Integration + Permission to the parent and Function + Role + Policy
        // (+ its managed log group) to CatalogApi; the parent's growth since opennext-1c is earlier slices'.
        // Counts in this synth (CAT-IMAGES-1, 2026-10-30): 401 + 53 + 13 = 467 and 45 + 15 + 1 = 61 — the image
        // copy route added Route + Integration + Permission to the parent; CatalogApi gained no resource (the bucket
        // grant is statements in the function's existing Policy, the variables are function properties).
        // Counts in this synth (SCHED-1B, 2026-11-21): 402 + 53 + 13 = 468 and 45 + 15 + 1 = 61 — the scheduling-private
        // table added one AWS::DynamoDB::Table to the parent and nothing else (see (sched1b-3), (sched1b-4)).
        // Counts in this synth (SCHED-1D1, 2026-11-22): 403 + 53 + 13 = 469 — the SchedulingApi nested stack added its one
        // AWS::CloudFormation::Stack to the parent; its own template is 62 raw + 10 log groups + 1 = 73 (see (I5)).
        const deployedParent = rawParent + parentFns + PARENT_STAGE_OVERHEAD; // 403 + 53 + 13 = 469
        const deployedCatalog = rawCatalog + catalogFns + NESTED_METADATA;    // 45 + 15 + 1 = 61

        // Pre-split parent (email-2, measured 2026-08-10 against the real staging synth) = 501 = 446
        // (post-split deployed parent at the split commit) − 1 (the new CFN::Stack pointer) + 56
        // (14 handlers × {Function, Role, Policy, LogGroup}). That derivation holds only at the split
        // commit; the parent count changes with later slices — first: opennext-1c removed 6 (warmer
        // Function, Role, Policy, LogGroup, Rule, Permission), 2026-10-15 — so it is recorded here, not
        // re-derived from the current synth.
        console.log(
            `(split1-5) DEPLOYED parent ≈ ${deployedParent} (raw ${rawParent} + ${parentFns} managed log groups + ${PARENT_STAGE_OVERHEAD} stage overhead); ` +
                `DEPLOYED CatalogApi ≈ ${deployedCatalog} (raw ${rawCatalog} + ${catalogFns} log groups + ${NESTED_METADATA} CDK::Metadata). Both < 500.`,
        );
        expect(deployedParent).toBeLessThan(500);
        expect(deployedCatalog).toBeLessThan(500);
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
// (w) The renderer warmer is gone (opennext-1c)
//     Ratified as OPENNEXT1-WARMER = B (docs/slices/opennext-1-upgrade.md § Ratification),
//     built by `opennext-1c` (docs/slices/opennext-1c-1d.md). The warmer Lambda ran every
//     5 minutes and failed on every invocation (open-next 3.1.3 reads WARM_PARAMS; the stack
//     set FUNCTION_NAME/CONCURRENCY). The human ruled removal, not repair. Revisit trigger: a
//     measured cold-start latency problem. (w3) pins the whole parent-template rule inventory
//     so a new schedule cannot appear without a deliberate edit here.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('Renderer warmer removed (opennext-1c)', () => {
    test('(w1) no Lambda function in the parent template has a logical id containing Warmer', () => {
        const warmers = Object.keys(template.findResources('AWS::Lambda::Function')).filter((id) =>
            id.includes('Warmer'),
        );
        expect(warmers).toEqual([]);
    });

    test('(w2) no EventBridge rule in the parent template runs at rate(5 minutes)', () => {
        const fiveMinute = Object.entries(template.findResources('AWS::Events::Rule')).filter(
            ([, r]) => (r as any).Properties.ScheduleExpression === 'rate(5 minutes)',
        );
        expect(fiveMinute.map(([id]) => id)).toEqual([]);
    });

    test('(w3) EXACTLY three EventBridge rules: audit pattern, 1-minute debounce, 02:00 nightly', () => {
        const rules = Object.values(template.findResources('AWS::Events::Rule')).map(
            (r) => (r as any).Properties,
        );
        expect(rules).toHaveLength(3);

        const patternOnly = rules.filter(
            (p) => p.EventPattern !== undefined && p.ScheduleExpression === undefined,
        );
        expect(patternOnly).toHaveLength(1);

        const schedules = rules
            .map((p) => p.ScheduleExpression)
            .filter((e): e is string => e !== undefined)
            .sort();
        expect(schedules).toEqual(['cron(0 2 * * ? *)', 'rate(1 minute)']);
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

// ────────────────────────────────────────────────────────────────────────────────────────────
// (cache9) Event-driven fast lane — the ordinary content-mutating handlers can async-invoke the
//     DebounceFlush function so an edit's own edge drain runs in ~1s (CACHE-9, ratified
//     2026-09-02, restoring "visible in seconds" after the idle-exit cost fix).
//
//     The wiring is deliberately CYCLE-FREE: DebounceFlushFunc lives in the PARENT stack and is
//     created AFTER the CatalogApi/CommerceApi NESTED stacks (it needs the renderer distribution
//     id), and the parent already references those nested stacks for its route integrations. A
//     construct/token reference from the nested handlers back to DebounceFlushFunc would be a
//     mutual stack dependency → CloudFormation rejects it. So the handlers are wired against the
//     function's EXPLICIT physical NAME (a plain string), and the whole point of THIS test is that
//     the name they invoke MATCHES the function's real name — a mismatch is otherwise an
//     undetectable silent no-op (the invoke 404s, the minute sweeper quietly covers it, and the
//     "~1s" promise is silently lost). Pins name-match, least-privilege scope, and exact caller set.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('CACHE-9 event-driven fast lane — mutation handlers invoke the flusher', () => {
    // The ordinary handlers that reach enqueueEdgeInvalidation() via revalidateTenantPaths()
    // (backend: content/create+update, products/update+delete, categories/update+delete). Matched
    // by stable logical-id prefix across the whole stack tree. A SEVENTH entry, or a MISSING one,
    // is a caller-set change: re-read docs/caching-architecture.md § "Invalidation model".
    const ORDINARY_MUTATORS = [
        'CreateContentFunc', 'UpdateContentFunc',   // CatalogApi nested stack
        'UpdateProductFunc', 'DeleteProductFunc',   // CatalogApi nested stack
        'UpdateCategoryFunc', 'DeleteCategoryFunc', // CommerceApi nested stack
    ];

    /** The parent's single DebounceFlush function name — the source of truth for the wiring. */
    function debounceFlushName(): string {
        const fns = Object.entries(template.findResources('AWS::Lambda::Function')).filter(([id]) =>
            id.startsWith('DebounceFlushFunc'),
        );
        expect(fns).toHaveLength(1);
        const name = (fns[0][1] as any).Properties.FunctionName;
        // Explicit physical name (a literal), NOT a CDK token — that is what lets the nested
        // handlers reference it without a cross-stack cycle.
        expect(typeof name).toBe('string');
        return name as string;
    }

    /** Locate exactly one function by logical-id prefix, anywhere in the stack tree. */
    function findFn(prefix: string): { t: Template; props: any } {
        for (const t of allTemplates) {
            const hits = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([id]) =>
                id.startsWith(prefix),
            );
            if (hits.length === 1) return { t, props: (hits[0][1] as any).Properties };
            if (hits.length > 1) throw new Error(`expected 1 ${prefix}, found ${hits.length}`);
        }
        throw new Error(`${prefix} not found in any template`);
    }

    test('(cache9-name) DebounceFlushFunc has the explicit deterministic physical name', () => {
        // stage 'test' → suffix '-test' → the single source of truth computed in amodx-stack.ts.
        expect(debounceFlushName()).toBe('amodx-debounce-flush-test');
    });

    test('(cache9-env) each ordinary mutator carries DEBOUNCE_FLUSH_FUNCTION_NAME = the flusher name', () => {
        const name = debounceFlushName();
        for (const prefix of ORDINARY_MUTATORS) {
            const vars = findFn(prefix).props.Environment?.Variables ?? {};
            expect(vars.DEBOUNCE_FLUSH_FUNCTION_NAME).toBe(name);
        }
    });

    test('(cache9-iam) each ordinary mutator role holds lambda:InvokeFunction on exactly the flusher ARN, nothing wider', () => {
        const name = debounceFlushName();
        for (const prefix of ORDINARY_MUTATORS) {
            const { t, props } = findFn(prefix);
            const roleId = props.Role['Fn::GetAtt'][0] as string;

            const invokeResources: unknown[] = [];
            for (const [, policy] of Object.entries(t.findResources('AWS::IAM::Policy'))) {
                const p = policy as any;
                const roles = (p.Properties.Roles ?? []).map((r: any) => r.Ref);
                if (!roles.includes(roleId)) continue;
                for (const s of p.Properties.PolicyDocument.Statement as any[]) {
                    const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
                    if (actions.includes('lambda:InvokeFunction')) invokeResources.push(s.Resource);
                }
            }
            // Exactly one InvokeFunction grant, scoped to the flusher's own ARN (least privilege —
            // never a wildcard). A second grant, or a missing one, fails HERE by prefix name.
            expect(invokeResources).toHaveLength(1);
            expect(JSON.stringify(invokeResources[0])).toContain(`:function:${name}`);
            expect(JSON.stringify(invokeResources[0])).not.toContain(':function:*');
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// CAT-INTEREST-1 — the interest list's two public routes (spec docs/slices/catalog-mode-1.md § 3.5; slice
// docs/slices/cat-interest-1.md § 2.4 and § 8 F3): the submit and the list page's identity read (resolve), one
// function, on the engagement group beside PublicSubmitForm.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('CAT-INTEREST-1 — POST /public/interest and POST /public/interest/resolve', () => {
    test('(cat-interest-1) both routes exist once in the stack tree, in EngagementApi, with NO authorizer, integrating PublicInterestFunc (SES scoped like PublicSubmitFormFunc)', () => {
        for (const key of ['POST /public/interest', 'POST /public/interest/resolve']) {
            const routes = Object.values(engagementTemplate.findResources('AWS::ApiGatewayV2::Route'))
                .filter((r: any) => r.Properties.RouteKey === key);
            expect({ key, count: routes.length }).toEqual({ key, count: 1 });
            const route = (routes[0] as any).Properties;
            expect({ key, auth: route.AuthorizationType, authorizer: route.AuthorizerId }).toEqual({ key, auth: 'NONE', authorizer: undefined });
            // Not anywhere else in the stack tree (a duplicate key on the shared HttpApi fails the deploy).
            const everywhere = allTemplates.flatMap((t) => Object.values(t.findResources('AWS::ApiGatewayV2::Route')))
                .filter((r: any) => r.Properties.RouteKey === key);
            expect({ key, count: everywhere.length }).toEqual({ key, count: 1 });

            const integrationId = JSON.stringify(route.Target).match(/"Ref":"([^"]+)"/)![1];
            const integration = engagementTemplate.findResources('AWS::ApiGatewayV2::Integration')[integrationId] as any;
            expect({ key, uri: /PublicInterestFunc/.test(JSON.stringify(integration.Properties.IntegrationUri)) }).toEqual({ key, uri: true });
        }

        const sesStatements = (part: string) => {
            const fn = Object.entries(engagementTemplate.findResources('AWS::Lambda::Function')).filter(([id]) => id.includes(part));
            expect(fn).toHaveLength(1);
            const role = (fn[0][1] as any).Properties.Role['Fn::GetAtt'][0] as string;
            return Object.values(engagementTemplate.findResources('AWS::IAM::Policy'))
                .filter((p: any) => (p.Properties.Roles as any[]).some((r) => r.Ref === role))
                .flatMap((p: any) => p.Properties.PolicyDocument.Statement as any[])
                .filter((st) => (Array.isArray(st.Action) ? st.Action : [st.Action]).some((a: string) => a.startsWith('ses:')));
        };
        const interestSes = sesStatements('PublicInterestFunc');
        expect(interestSes.length).toBe(1);
        expect(interestSes).toEqual(sesStatements('PublicSubmitFormFunc'));
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// (sched1b) SCHED-1B — the inert scheduling-private table (docs/slices/sched-1.md § 6.1; § 17.3 rows B1…B4).
//     Customer booking data gets a table that the renderer's role cannot read; `sched-1c` tests against it.
//     "Inert" in `sched-1b`: no function had the table's name or a grant on it. SCHED-1D1 wires it into the functions
//     of the SchedulingApi nested stack and nowhere else; (sched1b-3) is amended to that rule (its name says so), and
//     the rows I1, I2, I4, I5 of `sched-1d` are in the nested describe at the end of this block.
//
//     B2 and B3 are absence claims, so their checks must never pass by not understanding a value. One rule:
//       Every IAM value the checks read is matched AS A WHOLE against a closed list of exact shapes; a value of any
//       other shape is a violation — never skipped, never interpreted by what it contains. No intrinsic function
//       is accepted except in the shapes listed below, so a conditional (Fn::If, Fn::Select, …) anywhere the
//       checks read is a violation, whatever its branches hold.
//     The shapes:
//       policy       PolicyDocument = { Statement: [statement…] | statement }; each statement a plain object
//                    (no intrinsic) with Effect "Allow" | "Deny" and Action / NotAction a string or a string list.
//       attachment   Roles = [{ Ref: <role> }…]; inline Policies = [{ PolicyDocument }…]; each ManagedPolicyArns
//                    entry is { Ref: <ManagedPolicy of the same template> } or EXACTLY one of KNOWN_NO_DYNAMODB.
//       table        an Allow statement whose Action can name DynamoDB (NotAction, or a service glob matching
//                    `dynamodb`) must have each Resource EXACTLY one of the shapes CDK emits for a table grant:
//                    { "Fn::GetAtt": [<table>, "Arn"] }; in a nested template { Ref: <parameter> } that the parent
//                    fills with exactly that GetAtt; either one alone or as { "Fn::Join": ["", [<it>, "/index/*"]] }.
//                    The table it denotes must not be the scheduling table. NotResource is a violation.
//     Positive controls (docs/testing-strategy.md § Invariants): on the real tree the rule resolves the main table
//     where amodx-stack.ts and renderer-hosting.ts grant it; on fixtures it flags every unrecognised shape listed in
//     the tests, including a conditional whose other branch is the main table, and accepts the two table shapes.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('SCHED-1B — the inert scheduling-private table', () => {
    // stage 'test' → suffix '-test' (amodx-stack.ts); names from infra/lib/database.ts.
    const SCHEDULING = 'AmodxSchedulingTable-test';
    const MAIN = 'AmodxTable-test';
    /**
     * AWS-managed policy attachments the test cannot read, matched EXACTLY (the value CDK emits), each with the
     * reason it grants no DynamoDB action. AWSLambdaBasicExecutionRole: logs:CreateLogGroup, logs:CreateLogStream,
     * logs:PutLogEvents (AWS managed-policy reference; INFERRED, not read from the template).
     */
    const KNOWN_NO_DYNAMODB: unknown[] = [
        { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']] },
    ];

    /** CloudFormation templates as JSON: index 0 is the parent, the rest are its nested stacks. */
    type Tree = Array<Record<string, any>>;
    /** A table: its parent logical id and, when the template holds it as a literal, its physical name. */
    type TableRef = { logicalId: string; name?: string };
    /** A statement, where it is, its template index, and the roles of that template it reaches by attachment. */
    type Located = { where: string; template: number; roles: string[]; statement: any };

    const realTree = (): Tree => allTemplates.map((t) => t.toJSON());
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
    /** An intrinsic function or a Ref: an object one of whose keys is `Ref` or starts with `Fn::`. */
    const isIntrinsic = (v: unknown) => isObject(v) && Object.keys(v).some((k) => k === 'Ref' || k.startsWith('Fn::'));
    /** `{ [key]: value }` with exactly that one key. */
    const only = (v: unknown, key: string): v is Record<string, any> =>
        isObject(v) && Object.keys(v).length === 1 && Object.keys(v)[0] === key;
    const isRefTo = (v: unknown): v is { Ref: string } => only(v, 'Ref') && typeof v.Ref === 'string';

    /** The one table with physical name `name`, which must be in the PARENT template and in no nested one. */
    function parentTable(name: string): TableRef & { resource: any } {
        const everywhere = allTemplates
            .flatMap((t) => Object.values(t.findResources('AWS::DynamoDB::Table')))
            .filter((r: any) => r.Properties.TableName === name);
        expect({ name, inStackTree: everywhere.length }).toEqual({ name, inStackTree: 1 });
        const inParent = Object.entries(template.findResources('AWS::DynamoDB::Table'))
            .filter(([, r]) => (r as any).Properties.TableName === name);
        expect({ name, inParent: inParent.length }).toEqual({ name, inParent: 1 });
        return { logicalId: inParent[0][0], name, resource: inParent[0][1] };
    }

    /**
     * MENTION detector, used only where a mention FAILS the check (the referrer scan of (sched1b-3)), never to accept:
     * the logical id as a whole token (Ref, Fn::GetAtt in both forms, Fn::Sub `${Id}` / `${Id.Arn}`, DependsOn) or
     * the physical name.
     */
    function namesTable(value: unknown, table: TableRef): boolean {
        const json = JSON.stringify(value) ?? '';
        const token = new RegExp(`(^|[^A-Za-z0-9])${table.logicalId}([^A-Za-z0-9]|$)`).test(json);
        return token || (table.name !== undefined && json.includes(table.name));
    }

    /** Nested-stack parameter name → the value the parent passes (across every AWS::CloudFormation::Stack). */
    function parentParameterValues(tree: Tree): Map<string, unknown> {
        const values = new Map<string, unknown>();
        for (const r of Object.values(tree[0].Resources ?? {}) as any[]) {
            if (r.Type !== 'AWS::CloudFormation::Stack') continue;
            for (const [param, value] of Object.entries(r.Properties?.Parameters ?? {})) {
                if (values.has(param) && !same(values.get(param), value)) {
                    throw new Error(`nested-stack parameter ${param} has two different values in the parent`);
                }
                values.set(param, value);
            }
        }
        return values;
    }

    /** The table logical id `resource` denotes as a WHOLE, or undefined when it is not one of the table shapes. */
    function tableOf(resource: unknown, templateIndex: number, tree: Tree): string | undefined {
        const tableIds = Object.entries(tree[0].Resources ?? {})
            .filter(([, r]: [string, any]) => r.Type === 'AWS::DynamoDB::Table')
            .map(([id]) => id);
        const getAttArn = (v: unknown) =>
            only(v, 'Fn::GetAtt') && Array.isArray(v['Fn::GetAtt']) && v['Fn::GetAtt'].length === 2 &&
            v['Fn::GetAtt'][1] === 'Arn' && tableIds.includes(v['Fn::GetAtt'][0]) ? (v['Fn::GetAtt'][0] as string) : undefined;
        const tableArn = (v: unknown) => {
            if (templateIndex === 0) return getAttArn(v);
            return isRefTo(v) ? getAttArn(parentParameterValues(tree).get(v.Ref)) : undefined;
        };
        const direct = tableArn(resource);
        if (direct !== undefined) return direct;
        if (!only(resource, 'Fn::Join')) return undefined;
        const join = resource['Fn::Join'];
        const indexes = Array.isArray(join) && join.length === 2 && join[0] === '' && Array.isArray(join[1]) &&
            join[1].length === 2 && join[1][1] === '/index/*';
        return indexes ? tableArn(join[1][0]) : undefined;
    }

    const actionsOf = (statement: any, key: 'Action' | 'NotAction'): string[] | undefined => {
        const v = statement[key];
        if (typeof v === 'string') return [v];
        return Array.isArray(v) && v.every((a) => typeof a === 'string') ? v : undefined;
    };
    const serviceMatchesDynamodb = (action: string) => {
        const glob = action.split(':')[0].toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp(`^${glob}$`).test('dynamodb');
    };

    /**
     * Read every policy of the tree by the shapes of the rule. Returns the statements (with the roles each reaches by
     * attachment in its own template) and every shape violation.
     */
    function readIam(tree: Tree): { located: Located[]; violations: string[] } {
        const located: Located[] = [];
        const violations: string[] = [];
        const statementsOf = (document: unknown, where: string): any[] => {
            if (!isObject(document) || isIntrinsic(document) || document.Statement === undefined) {
                violations.push(`${where}: PolicyDocument is not a plain document`);
                return [];
            }
            const list = Array.isArray(document.Statement) ? document.Statement : [document.Statement];
            return list.filter((s: unknown) => {
                const plain = isObject(s) && !isIntrinsic(s);
                if (!plain) violations.push(`${where}: a statement is not a plain object: ${JSON.stringify(s)}`);
                return plain;
            });
        };
        tree.forEach((t, i) => {
            const resources = Object.entries(t.Resources ?? {}) as Array<[string, any]>;
            for (const [id, r] of resources) {
                const where = `template[${i}].${id}`;
                const isPrincipal = ['AWS::IAM::Role', 'AWS::IAM::User', 'AWS::IAM::Group'].includes(r.Type);
                if (isPrincipal) {
                    const arns = r.Properties?.ManagedPolicyArns ?? [];
                    if (!Array.isArray(arns)) violations.push(`${where}: ManagedPolicyArns is not a list`);
                    else for (const arn of arns) {
                        const local = isRefTo(arn) && t.Resources?.[arn.Ref]?.Type === 'AWS::IAM::ManagedPolicy';
                        if (!local && !KNOWN_NO_DYNAMODB.some((known) => same(known, arn))) {
                            violations.push(`${where}: unread ManagedPolicyArns entry ${JSON.stringify(arn)}`);
                        }
                    }
                    const inline = r.Properties?.Policies ?? [];
                    if (!Array.isArray(inline)) violations.push(`${where}: Policies is not a list`);
                    else for (const p of inline) {
                        const roles = r.Type === 'AWS::IAM::Role' ? [id] : [];
                        statementsOf(isObject(p) && !isIntrinsic(p) ? p.PolicyDocument : p, `${where}.Policies`)
                            .forEach((statement) => located.push({ where: `${where}.Policies`, template: i, roles, statement }));
                    }
                }
                if (r.Type !== 'AWS::IAM::Policy' && r.Type !== 'AWS::IAM::ManagedPolicy') continue;
                const byRoles = r.Properties?.Roles ?? [];
                if (!Array.isArray(byRoles) || !byRoles.every(isRefTo)) {
                    violations.push(`${where}: Roles is not a list of { Ref }: ${JSON.stringify(byRoles)}`);
                }
                const roles = Array.isArray(byRoles) ? byRoles.filter(isRefTo).map((x) => x.Ref) : [];
                for (const [roleId, role] of resources) {
                    const arns = role.Properties?.ManagedPolicyArns;
                    if (Array.isArray(arns) && arns.some((a: unknown) => isRefTo(a) && a.Ref === id)) roles.push(roleId);
                }
                statementsOf(r.Properties?.PolicyDocument, where)
                    .forEach((statement) => located.push({ where, template: i, roles, statement }));
            }
        });
        return { located, violations };
    }

    /** Apply the table shapes to every statement. `resolved` lists the tables the grants denote (control signal). */
    function checkDynamodbGrants(located: Located[], tree: Tree, scheduling: TableRef): { violations: string[]; resolved: string[] } {
        const violations: string[] = [];
        const resolved = new Set<string>();
        for (const { where, template: i, statement } of located) {
            if (statement.Effect !== 'Allow' && statement.Effect !== 'Deny') {
                violations.push(`${where}: Effect is not "Allow" or "Deny": ${JSON.stringify(statement.Effect)}`);
                continue;
            }
            if (statement.Effect === 'Deny') continue;
            let canGrantDynamodb = statement.NotAction !== undefined;
            if (!canGrantDynamodb) {
                const actions = actionsOf(statement, 'Action');
                if (actions === undefined) {
                    violations.push(`${where}: Action is not a string or a string list: ${JSON.stringify(statement.Action)}`);
                    continue;
                }
                canGrantDynamodb = actions.some(serviceMatchesDynamodb);
            }
            if (!canGrantDynamodb) continue;
            if (statement.NotResource !== undefined) violations.push(`${where}: NotResource`);
            for (const resource of ([] as unknown[]).concat(statement.Resource ?? [])) {
                const table = tableOf(resource, i, tree);
                if (table === undefined) violations.push(`${where}: not a table ARN shape: ${JSON.stringify(resource)}`);
                else if (table === scheduling.logicalId) violations.push(`${where}: denotes the scheduling table`);
                else resolved.add(table);
            }
        }
        return { violations, resolved: [...resolved].sort() };
    }

    /** Both checks on a tree: shape violations of the IAM reading, then of the table grants of `located`. */
    function violationsOf(tree: Tree, scheduling: TableRef, select: (l: Located) => boolean = () => true): string[] {
        const read = readIam(tree);
        return [...read.violations, ...checkDynamodbGrants(read.located.filter(select), tree, scheduling).violations];
    }

    /**
     * A one-template fixture: the two real tables, a role `FixtureRole` that reaches `statement` through a
     * ManagedPolicy attached ONLY by the role's ManagedPolicyArns (the form CDK emits for `role.addManagedPolicy`:
     * no `Roles` on the policy), the extra `ManagedPolicyArns` entries given, and `policyOverride` merged into the
     * ManagedPolicy's properties.
     */
    function fixture(statement: any, extraArns: unknown[] = [], policyOverride: Record<string, unknown> = {}): Tree {
        const scheduling = parentTable(SCHEDULING);
        const main = parentTable(MAIN);
        return [{
            Resources: {
                [scheduling.logicalId]: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: SCHEDULING } },
                [main.logicalId]: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: MAIN } },
                FixturePolicy: { Type: 'AWS::IAM::ManagedPolicy', Properties: { PolicyDocument: { Statement: [statement] }, ...policyOverride } },
                FixtureRole: { Type: 'AWS::IAM::Role', Properties: { ManagedPolicyArns: [{ Ref: 'FixturePolicy' }, ...extraArns] } },
            },
        }];
    }

    test('(sched1b-1) B1: one parent table, PAY_PER_REQUEST, PITR, TTL `ttl`, Retain on delete and replace, PK/SK strings, no index, no stream', () => {
        const { resource } = parentTable(SCHEDULING);
        const p = resource.Properties;
        expect(p.BillingMode).toBe('PAY_PER_REQUEST');
        expect(p.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
        expect(p.TimeToLiveSpecification).toEqual({ AttributeName: 'ttl', Enabled: true });
        expect(p.KeySchema).toEqual([
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
        ]);
        expect(p.AttributeDefinitions).toEqual([
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
        ]);
        expect(p.GlobalSecondaryIndexes).toBeUndefined();
        expect(p.LocalSecondaryIndexes).toBeUndefined();
        expect(p.StreamSpecification).toBeUndefined();
        expect(resource.DeletionPolicy).toBe('Retain');
        expect(resource.UpdateReplacePolicy).toBe('Retain');
    });

    test("(sched1b-2) B2: every DynamoDB grant reaching the renderer server function's role has a table shape, and none is the scheduling table", () => {
        const tree = realTree();
        const scheduling = parentTable(SCHEDULING);
        const main = parentTable(MAIN);
        const fns = Object.entries(template.findResources('AWS::Lambda::Function'))
            .filter(([id]) => id.includes('RendererHostingRendererServer'));
        expect(fns).toHaveLength(1);
        const roleId = (fns[0][1] as any).Properties.Role['Fn::GetAtt'][0] as string;

        const read = readIam(tree);
        // Every attachment in the tree has a recognised shape, so the role's statements below are all of them.
        expect(read.violations).toEqual([]);
        const reaching = read.located.filter((l) => l.template === 0 && l.roles.includes(roleId));
        const result = checkDynamodbGrants(reaching, tree, scheduling);
        // Positive control: the rule resolves the main table in this role (renderer-hosting.ts grantReadData).
        expect(result.resolved).toContain(main.logicalId);
        expect(result.violations).toEqual([]);

        // Positive controls on the attachment forms of FixtureRole.
        const toFixtureRole = (l: Located) => l.roles.includes('FixtureRole');
        const getAtt = (t: TableRef) => ({ 'Fn::GetAtt': [t.logicalId, 'Arn'] });
        const grant = (resource: unknown) => ({ Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: resource });
        // A ManagedPolicy reached only through the role's ManagedPolicyArns is read.
        expect(violationsOf(fixture(grant(getAtt(scheduling))), scheduling, toFixtureRole))
            .toEqual(['template[0].FixturePolicy: denotes the scheduling table']);
        // The same attachment with the main table passes (the rule does not flag everything).
        expect(violationsOf(fixture(grant(getAtt(main))), scheduling, toFixtureRole)).toEqual([]);
        // An AWS-managed policy the test cannot read, and a conditional attachment whose OTHER branch is the known
        // policy (review-1's case), are each one violation; the known policy alone is not.
        const arn = (name: string) => ({ 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::aws:policy/${name}`]] });
        const unknown = arn('AmazonDynamoDBReadOnlyAccess');
        const conditional = { 'Fn::If': ['UseMainTable', KNOWN_NO_DYNAMODB[0], unknown] };
        for (const extra of [unknown, conditional]) {
            expect(violationsOf(fixture(grant(getAtt(main)), [extra, KNOWN_NO_DYNAMODB[0]]), scheduling, toFixtureRole))
                .toEqual([`template[0].FixtureRole: unread ManagedPolicyArns entry ${JSON.stringify(extra)}`]);
        }
        // A Roles entry that is not { Ref } is a violation (B2 could not see the attachment otherwise).
        const roles = { Roles: [{ 'Fn::If': ['C', { Ref: 'FixtureRole' }, { Ref: 'AWS::NoValue' }] }] };
        expect(violationsOf(fixture(grant(getAtt(main)), [], roles), scheduling).some((v) => v.includes('Roles is not a list of { Ref }'))).toBe(true);
    });

    test('(sched1b-3) B3 as amended by SCHED-1D1: SCHEDULING_TABLE_NAME and every grant on the scheduling table only in the SchedulingApi nested stack; outside it nothing names the table but itself and the pointer to that stack; every DynamoDB grant has a table shape', () => {
        const tree = realTree();
        const scheduling = parentTable(SCHEDULING);
        const main = parentTable(MAIN);
        const schedIndex = allTemplates.indexOf(schedulingTemplate);
        expect(schedIndex).toBeGreaterThan(0);

        const variables = allTemplates
            .flatMap((t, i) => Object.entries(t.findResources('AWS::Lambda::Function')).map(([id, fn]) => ({ template: i, id, fn })))
            .map(({ template: i, id, fn }) => ({ template: i, id, vars: (fn as any).Properties.Environment?.Variables ?? {} }));
        // Positive control for the key lookup: TABLE_NAME (the main table) is found on functions.
        expect(variables.some((f) => Object.prototype.hasOwnProperty.call(f.vars, 'TABLE_NAME'))).toBe(true);
        const named = variables.filter((f) => Object.prototype.hasOwnProperty.call(f.vars, 'SCHEDULING_TABLE_NAME'));
        // Outside the SchedulingApi nested stack: none. Inside it: every function (§ 11.2 "every scheduling function").
        expect(named.filter((f) => f.template !== schedIndex).map((f) => f.id)).toEqual([]);
        const inScheduling = variables.filter((f) => f.template === schedIndex).map((f) => f.id).sort();
        expect(inScheduling.length).toBeGreaterThan(0);
        expect(named.map((f) => f.id).sort()).toEqual(inScheduling);

        // Referrer scan: a MENTION fails. Every resource, output and parameter of every template except the table.
        const referrers = (table: TableRef): string[] =>
            tree.flatMap((t, i) =>
                (['Resources', 'Outputs', 'Parameters'] as const).flatMap((section) =>
                    Object.entries(t[section] ?? {})
                        .filter(([id, value]) => !(i === 0 && section === 'Resources' && id === table.logicalId) && namesTable(value, table))
                        .map(([id]) => `template[${i}].${section}.${id}`),
                ),
            );
        // Positive control: the same scan finds the main table's referrers (grants, TABLE_NAME, the TableName output).
        expect(referrers(main).length).toBeGreaterThan(0);
        // The one referrer outside the table: the parent's resource of the SchedulingApi nested stack, which passes the
        // table's name and ARN as nested-stack parameters (inside the nested template they are parameter Refs).
        const schedulingStackIds = Object.entries(tree[0].Resources ?? {})
            .filter(([id, r]: [string, any]) => r.Type === 'AWS::CloudFormation::Stack' && id.startsWith('SchedulingApi'))
            .map(([id]) => id);
        expect(schedulingStackIds).toHaveLength(1);
        expect(referrers(scheduling)).toEqual([`template[0].Resources.${schedulingStackIds[0]}`]);
        // ...and it finds the Fn::Sub form outside any policy (for example a variable).
        const subVariable = { Type: 'AWS::Lambda::Function', Properties: { Environment: { Variables: { X: { 'Fn::Sub': `\${${scheduling.logicalId}}` } } } } };
        expect(namesTable(subVariable, scheduling)).toBe(true);

        // The rule over every policy of the stack tree: outside the SchedulingApi nested stack no grant denotes the
        // scheduling table; inside it every DynamoDB grant has a table shape and denotes one of the two tables.
        const read = readIam(tree);
        expect(read.violations).toEqual([]);
        const result = checkDynamodbGrants(read.located.filter((l) => l.template !== schedIndex), tree, scheduling);
        // Positive control: grants in the nested stacks resolve to the main table through their parameters.
        expect(result.resolved).toContain(main.logicalId);
        expect(result.violations).toEqual([]);
        const inside = checkDynamodbGrants(read.located.filter((l) => l.template === schedIndex), tree, scheduling);
        expect(inside.resolved).toEqual([main.logicalId]);
        expect(inside.violations.filter((v) => !v.endsWith(': denotes the scheduling table'))).toEqual([]);
        expect(inside.violations.length).toBeGreaterThan(0);   // positive: the scheduling functions ARE granted the table
        // No grant on the table's own side either.
        expect(scheduling.resource.Properties.ResourcePolicy).toBeUndefined();

        // Positive controls, statement level: each unrecognised shape is flagged with each action form.
        const id = scheduling.logicalId;
        const mainArn = { 'Fn::GetAtt': [main.logicalId, 'Arn'] };
        const resources: Array<[string, Record<string, unknown>]> = [
            ['GetAtt of the scheduling table', { Resource: { 'Fn::GetAtt': [id, 'Arn'] } }],
            ['its /index/*', { Resource: { 'Fn::Join': ['', [{ 'Fn::GetAtt': [id, 'Arn'] }, '/index/*']] } }],
            ['Fn::Sub ${Id.Arn}', { Resource: { 'Fn::Sub': `\${${id}.Arn}` } }],
            ['Fn::Sub ${Id}', { Resource: { 'Fn::Sub': `arn:aws:dynamodb:eu-central-1:111111111111:table/\${${id}}` } }],
            ['Fn::GetAtt string form', { Resource: { 'Fn::GetAtt': `${id}.Arn` } }],
            ['literal ARN', { Resource: `arn:aws:dynamodb:eu-central-1:111111111111:table/${SCHEDULING}` }],
            ['wildcard *', { Resource: '*' }],
            ['wildcard table/*', { Resource: 'arn:aws:dynamodb:*:*:table/*' }],
            ['NotResource', { NotResource: 'arn:aws:s3:::x' }],
            ['Fn::If(main table, "*") (review-1)', { Resource: { 'Fn::If': ['UseMainTable', mainArn, '*'] } }],
            ['Fn::If(main table, main table)', { Resource: { 'Fn::If': ['C', mainArn, mainArn] } }],
            ['main ARN joined to another suffix', { Resource: { 'Fn::Join': ['', [mainArn, '*']] } }],
        ];
        for (const [label, part] of resources) {
            for (const action of ['dynamodb:Query', 'dynamodb:*', '*', 'dynamo*:Get*']) {
                const flagged = violationsOf(fixture({ Effect: 'Allow', Action: action, ...part }), scheduling).length > 0;
                expect({ label, action, flagged }).toEqual({ label, action, flagged: true });
            }
        }
        const statements: Array<[string, unknown]> = [
            ['Effect as Fn::If', { Effect: { 'Fn::If': ['C', 'Allow', 'Deny'] }, Action: 'dynamodb:GetItem', Resource: '*' }],
            ['Action as Ref', { Effect: 'Allow', Action: { Ref: 'ActionParam' }, Resource: '*' }],
            ['NotAction', { Effect: 'Allow', NotAction: 's3:*', Resource: '*' }],
            ['statement as Fn::If', { 'Fn::If': ['C', { Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }, { Ref: 'AWS::NoValue' }] }],
        ];
        for (const [label, statement] of statements) {
            expect({ label, flagged: violationsOf(fixture(statement), scheduling).length > 0 }).toEqual({ label, flagged: true });
        }
        const documentIf = { PolicyDocument: { 'Fn::If': ['C', { Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] }, {}] } };
        expect(violationsOf(fixture({}, [], documentIf), scheduling)).toEqual(['template[0].FixturePolicy: PolicyDocument is not a plain document']);
        // Accepted shapes (the rule does not flag everything): the main table and its indexes, and a non-DynamoDB grant.
        for (const resource of [mainArn, { 'Fn::Join': ['', [mainArn, '/index/*']] }]) {
            expect(violationsOf(fixture({ Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query'], Resource: resource }), scheduling)).toEqual([]);
        }
        expect(violationsOf(fixture({ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }), scheduling)).toEqual([]);
        // A nested-stack parameter that the parent fills with the table denotes it inside the nested template.
        const nestedTree = (passed: unknown): Tree => [
            { Resources: { [id]: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: SCHEDULING } },
                           [main.logicalId]: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: MAIN } },
                           N: { Type: 'AWS::CloudFormation::Stack', Properties: { Parameters: { referencetoXArn: passed } } } } },
            { Resources: { P: { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { Ref: 'referencetoXArn' } }] } } } } },
        ];
        expect(violationsOf(nestedTree({ 'Fn::GetAtt': [id, 'Arn'] }), scheduling)).toEqual(['template[1].P: denotes the scheduling table']);
        expect(violationsOf(nestedTree(mainArn), scheduling)).toEqual([]);
        expect(violationsOf(nestedTree({ 'Fn::If': ['C', mainArn, '*'] }), scheduling)).toEqual([`template[1].P: not a table ARN shape: {"Ref":"referencetoXArn"}`]);
    });

    test('(sched1b-4) B4: the DEPLOYED parent count with the table is logged and < 500 (as (split1-5))', () => {
        const rawParent = Object.keys(template.toJSON().Resources ?? {}).length;
        const parentFns = Object.keys(template.findResources('AWS::Lambda::Function')).length;
        const deployedParent = rawParent + parentFns + PARENT_STAGE_OVERHEAD;
        console.log(
            `(sched1b-4) DEPLOYED parent ≈ ${deployedParent} (raw ${rawParent} + ${parentFns} managed log groups + ` +
                `${PARENT_STAGE_OVERHEAD} stage overhead), scheduling table included. < 500.`,
        );
        expect(deployedParent).toBeLessThan(500);
    });

    // ────────────────────────────────────────────────────────────────────────────────────────────
    // SCHED-1D1 — rows I1, I2, I4, I5 of `sched-1d` (docs/slices/sched-1.md § 11.2, § 17.3) for the functions this
    // slice creates (the admin routes). The visitor functions of `sched-1d2` (and I3, the hold's reCAPTCHA secret) are
    // added to these lists by that slice. Inside the SCHED-1B block so the IAM reading rule above is the one used.
    // ────────────────────────────────────────────────────────────────────────────────────────────
    describe('SCHED-1D1 — the SchedulingApi nested stack (admin routes)', () => {
        /** Construct ids of this slice's functions, by role in § 11.2. */
        const MAILING = ['AdminCancelBookingFunc'];
        const AUDITING = ['AdminEraseCustomerFunc', 'AdminCreateResourceFunc', 'AdminUpdateResourceFunc', 'AdminDeleteResourceFunc', 'AdminFeedSecretFunc'];
        const READ_ONLY = ['AdminGetBookingFunc', 'AdminListResourcesFunc', 'AdminEmailTemplatesFunc', 'AdminLookupCustomerFunc'];
        const ALL = ['AdminGetBookingFunc', 'AdminCancelBookingFunc', 'AdminLookupCustomerFunc', 'AdminEraseCustomerFunc',
            'AdminListResourcesFunc', 'AdminCreateResourceFunc', 'AdminUpdateResourceFunc', 'AdminDeleteResourceFunc',
            'AdminFeedSecretFunc', 'AdminEmailTemplatesFunc'];
        const DYNAMODB_WRITE = /^dynamodb:(PutItem|UpdateItem|DeleteItem|BatchWriteItem|\*)$|^\*$/;

        type Fn = { construct: string; logicalId: string; vars: Record<string, unknown>; statements: any[] };
        /** The template's functions, each with its variables and every statement of a policy attached to its role. */
        function functions(t: Template): Fn[] {
            const json = t.toJSON();
            const policies = Object.values(json.Resources ?? {}).filter((r: any) => r.Type === 'AWS::IAM::Policy') as any[];
            return Object.entries(t.findResources('AWS::Lambda::Function')).map(([logicalId, fn]) => {
                const roleId = (fn as any).Properties.Role['Fn::GetAtt'][0] as string;
                const statements = policies
                    .filter((p) => (p.Properties.Roles ?? []).some((r: any) => r.Ref === roleId))
                    .flatMap((p) => [].concat(p.Properties.PolicyDocument.Statement));
                const construct = ALL.find((c) => logicalId.startsWith(c)) ?? logicalId;
                return { construct, logicalId, vars: (fn as any).Properties.Environment?.Variables ?? {}, statements };
            });
        }
        const actions = (st: any): string[] => [].concat(st.Action ?? []);
        const byConstruct = (name: string) => {
            const found = functions(schedulingTemplate).filter((f) => f.construct === name);
            expect({ name, found: found.length }).toEqual({ name, found: 1 });
            return found[0];
        };
        const parameterOf = (v: unknown) => (isRefTo(v) ? parentParameterValues(realTree()).get(v.Ref) : undefined);

        test('I2 (inventory) the nested stack holds exactly the ten admin functions of this slice, each behind a route with the authorizer', () => {
            expect(functions(schedulingTemplate).map((f) => f.construct).sort()).toEqual([...ALL].sort());
            const routes = Object.values(schedulingTemplate.findResources('AWS::ApiGatewayV2::Route')).map((r: any) => r.Properties);
            expect(routes.map((r) => r.RouteKey).sort()).toEqual([
                'DELETE /scheduling/admin/resources/{resourceId}',
                'GET /scheduling/admin/bookings/{bookingId}',
                'GET /scheduling/admin/email-templates',
                'GET /scheduling/admin/resources',
                'POST /scheduling/admin/bookings/{bookingId}/cancel',
                'POST /scheduling/admin/customers/erase',
                'POST /scheduling/admin/customers/lookup',
                'POST /scheduling/admin/resources',
                'POST /scheduling/admin/resources/{resourceId}/feed-secret',
                'PUT /scheduling/admin/resources/{resourceId}',
            ]);
            for (const r of routes) expect({ key: r.RouteKey, auth: r.AuthorizationType }).toEqual({ key: r.RouteKey, auth: 'CUSTOM' });
            // No visitor route in this slice (`sched-1d2`).
            expect(routes.some((r) => String(r.RouteKey).includes('/scheduling/visitor'))).toBe(false);
        });

        test('I1 every mailing function: SES_FROM_EMAIL and exactly one ses:SendEmail, on the sending identity (not *); no other function has an SES action', () => {
            for (const name of MAILING) {
                const f = byConstruct(name);
                expect(f.vars.SES_FROM_EMAIL).toBe('contact@bijuterie.software');
                const ses = f.statements.filter((st) => actions(st).some((a) => a.toLowerCase().startsWith('ses:')));
                expect({ name, ses: ses.length }).toEqual({ name, ses: 1 });
                expect(actions(ses[0])).toEqual(['ses:SendEmail']);
                expect(ses[0].Resource).not.toBe('*');
                expect(JSON.stringify(ses[0].Resource)).toContain(':identity/contact@bijuterie.software');
                expect(Object.hasOwn(f.vars, 'RENDERER_CLOUDFRONT_ORIGIN')).toBe(true);
            }
            for (const f of functions(schedulingTemplate).filter((x) => !MAILING.includes(x.construct))) {
                expect({ fn: f.construct, ses: f.statements.some((st) => actions(st).some((a) => a.toLowerCase().startsWith('ses:'))) })
                    .toEqual({ fn: f.construct, ses: false });
                expect({ fn: f.construct, from: Object.hasOwn(f.vars, 'SES_FROM_EMAIL') }).toEqual({ fn: f.construct, from: false });
            }
        });

        test('I2 every scheduling function: SCHEDULING_TABLE_NAME = the scheduling table, TABLE_NAME = the main table with read', () => {
            const scheduling = parentTable(SCHEDULING);
            const main = parentTable(MAIN);
            for (const f of functions(schedulingTemplate)) {
                expect({ fn: f.construct, value: parameterOf(f.vars.SCHEDULING_TABLE_NAME) }).toEqual({ fn: f.construct, value: { Ref: scheduling.logicalId } });
                expect({ fn: f.construct, value: parameterOf(f.vars.TABLE_NAME) }).toEqual({ fn: f.construct, value: { Ref: main.logicalId } });
            }
        });

        test('I2 the GET functions and the customer lookup have no write action; the writers have one on the scheduling table; the templates route has no grant on it', () => {
            const tree = realTree();
            const schedIndex = allTemplates.indexOf(schedulingTemplate);
            expect(schedIndex).toBeGreaterThan(0);
            const scheduling = parentTable(SCHEDULING);
            const denotes = (st: any) => ([] as unknown[]).concat(st.Resource ?? []).map((r) => tableOf(r, schedIndex, tree));
            for (const name of READ_ONLY) {
                const writes = byConstruct(name).statements.filter((st) => actions(st).some((a) => DYNAMODB_WRITE.test(a)));
                expect({ name, writes }).toEqual({ name, writes: [] });
            }
            for (const name of ALL.filter((n) => !READ_ONLY.includes(n))) {
                const writesScheduling = byConstruct(name).statements.some((st) =>
                    actions(st).some((a) => DYNAMODB_WRITE.test(a)) && denotes(st).includes(scheduling.logicalId));
                expect({ name, writesScheduling }).toEqual({ name, writesScheduling: true });
            }
            const templates = byConstruct('AdminEmailTemplatesFunc');
            expect(templates.statements.some((st) => denotes(st).includes(scheduling.logicalId))).toBe(false);
            // Positive control of the reading: a read-only function still reads the scheduling table.
            expect(byConstruct('AdminGetBookingFunc').statements.some((st) =>
                actions(st).includes('dynamodb:GetItem') && denotes(st).includes(scheduling.logicalId))).toBe(true);
        });

        test('I2 events:PutEvents and EVENT_BUS_NAME exactly on the functions that publish a main-table audit event; none on a booking function', () => {
            for (const f of functions(schedulingTemplate)) {
                const puts = f.statements.some((st) => actions(st).includes('events:PutEvents'));
                const bus = Object.hasOwn(f.vars, 'EVENT_BUS_NAME');
                const expected = AUDITING.includes(f.construct);
                expect({ fn: f.construct, puts, bus }).toEqual({ fn: f.construct, puts: expected, bus: expected });
            }
            for (const name of ['AdminGetBookingFunc', 'AdminCancelBookingFunc', 'AdminLookupCustomerFunc']) {
                expect(byConstruct(name).statements.some((st) => actions(st).some((a) => a.startsWith('events:')))).toBe(false);
            }
        });

        test("I4 the renderer server function's role has no statement on the scheduling table (with the scheduling functions present)", () => {
            const tree = realTree();
            const scheduling = parentTable(SCHEDULING);
            const fns = Object.entries(template.findResources('AWS::Lambda::Function')).filter(([id]) => id.includes('RendererHostingRendererServer'));
            expect(fns).toHaveLength(1);
            const roleId = (fns[0][1] as any).Properties.Role['Fn::GetAtt'][0] as string;
            const read = readIam(tree);
            expect(read.violations).toEqual([]);
            const reaching = read.located.filter((l) => l.template === 0 && l.roles.includes(roleId));
            expect(reaching.length).toBeGreaterThan(0);
            const result = checkDynamodbGrants(reaching, tree, scheduling);
            expect(result.violations).toEqual([]);
            expect(result.resolved).not.toContain(scheduling.logicalId);
            // No statement of that role names the table in any form (a mention fails, as in (sched1b-3)).
            expect(reaching.filter((l) => namesTable(l.statement, scheduling))).toEqual([]);
        });

        test('I5 template counts: the SchedulingApi nested stack count logged; the DEPLOYED parent count logged and < 500', () => {
            const rawParent = Object.keys(template.toJSON().Resources ?? {}).length;
            const parentFns = Object.keys(template.findResources('AWS::Lambda::Function')).length;
            const deployedParent = rawParent + parentFns + PARENT_STAGE_OVERHEAD;
            const rawNested = Object.keys(schedulingTemplate.toJSON().Resources ?? {}).length;
            const nestedFns = Object.keys(schedulingTemplate.findResources('AWS::Lambda::Function')).length;
            const deployedNested = rawNested + nestedFns + 1; // + managed log groups + CDK::Metadata, as (split1-5)
            console.log(
                `(I5) DEPLOYED parent ≈ ${deployedParent} (raw ${rawParent} + ${parentFns} managed log groups + ${PARENT_STAGE_OVERHEAD} stage overhead); ` +
                    `DEPLOYED SchedulingApi ≈ ${deployedNested} (raw ${rawNested} + ${nestedFns} log groups + 1 CDK::Metadata). Both < 500.`,
            );
            expect(deployedParent).toBeLessThan(500);
            expect(deployedNested).toBeLessThan(500);
        });
    });
});
