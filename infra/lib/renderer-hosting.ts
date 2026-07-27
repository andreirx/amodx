import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface RendererHostingProps {
    table: dynamodb.Table;
    apiUrl: string;
    rendererKeySecret: secretsmanager.ISecret;  // Phase 2.3: Restricted key (replaces masterKeySecret)
    revalidationSecret: secretsmanager.ISecret; // Phase 2.5: Cache purge endpoint auth
    nextAuthSecret: secretsmanager.ISecret;
    originVerifySecret: string;  // Phase 6.1: CloudFront origin verification (plain string, baked into CF Function)
    certificate?: acm.ICertificate;
    domainNames?: string[];
    enableCaching?: boolean;  // Phase 4: Toggle CloudFront caching (default false for safety)
    recaptchaSiteKey?: string; // Deployment-level reCAPTCHA public site key
}

export class RendererHosting extends Construct {
    public readonly distribution: cloudfront.Distribution;
    public readonly assetBucket: s3.Bucket;
    public readonly serverFunction: lambda.Function;
    public readonly revalidationQueue: sqs.Queue;

    constructor(scope: Construct, id: string, props: RendererHostingProps) {
        super(scope, id);

        const stackName = cdk.Stack.of(this).stackName;
        const region = cdk.Stack.of(this).region;

        // 1. Build Next.js with OpenNext
        const rendererPath = path.join(__dirname, '../../renderer');
        const openNextPath = path.join(rendererPath, '.open-next');

        console.log("Building Renderer with OpenNext...");
        // Clean .open-next before build — shell rm + retry loop because macOS Spotlight/Finder
        // can recreate .DS_Store mid-deletion, causing both rm -rf and fs.rmSync to fail
        if (fs.existsSync(openNextPath)) {
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    execSync(`rm -rf "${openNextPath}"`, { stdio: 'inherit' });
                    if (!fs.existsSync(openNextPath)) break;
                } catch { /* retry */ }
                execSync('sleep 1');
            }
        }
        try {
            execSync('npm run build:open', {
                cwd: rendererPath,
                stdio: 'inherit',
                env: { ...process.env }
            });
        } catch (e) {
            console.error("Failed to build Renderer");
            throw e;
        }

        // 2. Asset Bucket (Public files + ISR cache)
        this.assetBucket = new s3.Bucket(this, 'RendererAssets', {
            autoDeleteObjects: false,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            publicReadAccess: false,
        });

        // ============================================================
        // Phase 4: OpenNext Caching Infrastructure
        // ============================================================

        // 4.1 Tag Cache DynamoDB Table (for revalidateTag support)
        const tagCacheTable = new dynamodb.Table(this, 'TagCacheTable', {
            tableName: `${stackName}-tag-cache`,
            partitionKey: { name: 'tag', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'path', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,  // Tag cache can be rebuilt
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
        });

        // GSI for path-based lookups (which tags apply to a path)
        tagCacheTable.addGlobalSecondaryIndex({
            indexName: 'by-path',
            partitionKey: { name: 'path', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'revalidatedAt', type: dynamodb.AttributeType.NUMBER },
        });

        // 4.2 SQS FIFO Queue for background revalidation
        this.revalidationQueue = new sqs.Queue(this, 'RevalidationQueue', {
            queueName: `${stackName}-revalidation.fifo`,
            fifo: true,
            contentBasedDeduplication: true,  // Prevents duplicate revalidations
            visibilityTimeout: cdk.Duration.seconds(30),
            retentionPeriod: cdk.Duration.hours(1),  // Stale pages expire anyway
        });

        // 4.3 Revalidation Lambda (polls SQS, sends HEAD requests to regenerate pages)
        const revalidationFuncPath = path.join(openNextPath, 'revalidation-function');
        let revalidationFunc: lambda.Function | undefined;

        if (fs.existsSync(revalidationFuncPath)) {
            revalidationFunc = new lambda.Function(this, 'RevalidationFunction', {
                runtime: lambda.Runtime.NODEJS_22_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(revalidationFuncPath),
                architecture: lambda.Architecture.ARM_64,
                memorySize: 256,
                timeout: cdk.Duration.seconds(30),
            });

            // Wire SQS to revalidation Lambda
            // Note: FIFO queues don't support maxBatchingWindow
            revalidationFunc.addEventSource(new lambdaEventSources.SqsEventSource(this.revalidationQueue, {
                batchSize: 5,
            }));
        } else {
            console.warn("OpenNext revalidation-function not found. Skipping revalidation Lambda.");
        }

        // 4.4 Image Optimization Lambda
        const imageOptFuncPath = path.join(openNextPath, 'image-optimization-function');
        let imageOptFunc: lambda.Function | undefined;
        let imageOptUrl: lambda.FunctionUrl | undefined;

        if (fs.existsSync(imageOptFuncPath)) {
            imageOptFunc = new lambda.Function(this, 'ImageOptFunction', {
                runtime: lambda.Runtime.NODEJS_22_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(imageOptFuncPath),
                architecture: lambda.Architecture.ARM_64,
                memorySize: 1536,  // Image processing needs more memory
                timeout: cdk.Duration.seconds(25),
                environment: {
                    BUCKET_NAME: this.assetBucket.bucketName,
                    BUCKET_KEY_PREFIX: '_assets',
                },
            });
            this.assetBucket.grantRead(imageOptFunc);

            imageOptUrl = imageOptFunc.addFunctionUrl({
                authType: lambda.FunctionUrlAuthType.NONE,
            });
        } else {
            console.warn("OpenNext image-optimization-function not found. Skipping image optimization Lambda.");
        }

        // 3. The Server Lambda
        // Phase 2.3: Uses restricted rendererKeySecret instead of masterKeySecret
        this.serverFunction = new lambda.Function(this, 'RendererServer', {
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(openNextPath, 'server-functions/default')),
            architecture: lambda.Architecture.ARM_64,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(15),
            environment: {
                NODE_ENV: 'production',
                TABLE_NAME: props.table.tableName,
                API_URL: props.apiUrl,
                CACHE_BUCKET_NAME: this.assetBucket.bucketName,
                CACHE_BUCKET_KEY_PREFIX: '_cache',
                CACHE_BUCKET_REGION: region,
                // Phase 2.3: Restricted renderer key (comments, customer profile, contact/leads/consent proxies)
                AMODX_API_KEY_SECRET: props.rendererKeySecret.secretName,
                // Phase 2.5: Secret for cache revalidation endpoint
                REVALIDATION_SECRET: props.revalidationSecret.secretValue.unsafeUnwrap(),
                // PRODUCTION CONFIGURATION FOR NEXTAUTH
                NEXTAUTH_SECRET: props.nextAuthSecret.secretValue.unsafeUnwrap(),
                NEXTAUTH_URL: `https://${props.domainNames ? props.domainNames[0] : 'localhost'}`,
                // Phase 4: Caching infrastructure
                REVALIDATION_QUEUE_URL: this.revalidationQueue.queueUrl,
                REVALIDATION_QUEUE_REGION: region,
                CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
                // Phase 6.1: Origin verification - reject requests not from CloudFront
                ORIGIN_VERIFY_SECRET: props.originVerifySecret,
                // Deployment-level reCAPTCHA site key (public — injected into HTML for all tenants)
                ...(props.recaptchaSiteKey ? { RECAPTCHA_SITE_KEY: props.recaptchaSiteKey } : {}),
            },
        });
        props.rendererKeySecret.grantRead(this.serverFunction);

        // Grant Permissions
        props.table.grantReadData(this.serverFunction);
        this.assetBucket.grantReadWrite(this.serverFunction);
        this.revalidationQueue.grantSendMessages(this.serverFunction);  // Server can queue revalidation
        tagCacheTable.grantReadWriteData(this.serverFunction);     // Server reads/writes tag cache

        // 4.5 Warmer Lambda (prevents cold starts)
        const warmerFuncPath = path.join(openNextPath, 'warmer-function');

        if (fs.existsSync(warmerFuncPath)) {
            const warmerFunc = new lambda.Function(this, 'WarmerFunction', {
                runtime: lambda.Runtime.NODEJS_22_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(warmerFuncPath),
                architecture: lambda.Architecture.ARM_64,
                memorySize: 128,
                timeout: cdk.Duration.seconds(15),
                environment: {
                    FUNCTION_NAME: this.serverFunction.functionName,
                    CONCURRENCY: '1',
                },
            });
            this.serverFunction.grantInvoke(warmerFunc);

            // Schedule warmer every 5 minutes
            new events.Rule(this, 'WarmerSchedule', {
                schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
                targets: [new targets.LambdaFunction(warmerFunc)],
            });
        } else {
            console.warn("OpenNext warmer-function not found. Skipping warmer Lambda.");
        }

        // 4. Lambda Function URL
        const fnUrl = this.serverFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
        });

        // 5. CloudFront Function (viewer request). Three jobs, all of them cache-key or
        //    origin-trust concerns — see the cache policy below for how the outputs are used.
        //
        //    a) `x-forwarded-host` — the original Host, so the origin can resolve the tenant
        //       (Phase 4). Keyed, so tenants never share an entry.
        //    b) `x-origin-verify` — proves the request came through CloudFront (Phase 6.1).
        //       NOT keyed; it is a constant.
        //    c) `x-has-session` — cache-3 revision 3, decision CACHE3-SESSION-KEY option B.
        //
        //    (c) exists because the cache policy keys on NO cookies. Without it, a
        //    logged-in visitor's request has the SAME cache key as an anonymous one: once
        //    the anonymous entry for an access-gated page is warm, CloudFront answers it at
        //    the edge and the origin never runs — so `renderer/middleware.ts` never gets to
        //    route the request to the `no-store` dynamic twin, and the visitor is served the
        //    "Restricted Access" shell that the cacheable route renders for `sessionToken:
        //    null` (`renderer/src/components/SitePage.tsx`, ACCESS GATEKEEPER). Keying on a
        //    one-bit derivative of the cookie jar forces that request to miss.
        //
        //    Why a derived BOOLEAN rather than adding the cookie to the cache key: the token
        //    value is per-visitor, so keying on it would give every logged-in visitor a
        //    private set of entries — unbounded fragmentation — and would put a credential
        //    into the cache key. One bit adds at most one partition, and in practice adds
        //    zero stored entries: every `x-has-session: 1` request is routed to the
        //    force-dynamic twin, whose `no-store` response `minTtl: 0` refuses to store.
        //
        //    Why it is set UNCONDITIONALLY (both '1' and '0') rather than only on a match:
        //    the header is in the cache key, and a viewer can send any header they like. If
        //    the function only wrote the header on a match, an attacker-supplied
        //    `x-has-session: <random>` would survive into the key and mint an entry per
        //    value — reintroducing exactly the fragmentation vector the query allowlist
        //    below removes. Overwriting on every request bounds the key to two values.
        //
        //    Cookie-name matching — the SHARED SOURCE OF TRUTH is the NextAuth cookie
        //    configuration at `renderer/src/app/api/auth/[...nextauth]/route.ts:36-46`,
        //    which sets `cookies.sessionToken.name = 'next-auth.session-token'`. next-auth
        //    4.24.14 merges that object OVER its defaults with a top-level spread
        //    (`node_modules/next-auth/core/init.js:59-61`), replacing the whole
        //    `sessionToken` entry — so the `__Secure-` prefix that `defaultCookies()` would
        //    apply on https does NOT apply while that config stands. What is actually
        //    emitted today is:
        //
        //      next-auth.session-token                 (unchunked)
        //      next-auth.session-token.0, .1, …        (chunked: core/lib/cookie.js:152
        //                                               names chunks `<configured>.<i>`)
        //
        //    `__Secure-next-auth.session-token` and its chunks are matched as
        //    COMPATIBILITY/LEGACY coverage — the name next-auth would emit if the explicit
        //    `cookies` block were ever removed, and the name any cookie issued before that
        //    block existed still carries in a visitor's jar. No repo evidence shows it being
        //    emitted now; matching it costs nothing and a missed session cookie is the
        //    expensive direction.
        //
        //    The match is by PREFIX over exactly those two base names: `name === base` or
        //    `name` starts with `base + '.'` (the chunk separator). NOT a substring test —
        //    a substring test also matches unrelated names that merely embed the literal
        //    (`x-next-auth.session-token-decoy`, `next-auth.session-tokenX`), which is an
        //    unnecessary cache-bypass surface. `renderer/middleware.ts`
        //    (`SESSION_COOKIE_BASES` / `hasSessionCookie()`) applies the identical predicate
        //    to the identical base list, so the two detectors classify every possible cookie
        //    name identically — the property that matters, because a request this function
        //    calls anonymous but middleware calls authenticated would hit the warm anonymous
        //    entry and reopen the hole. `probe-cache3-cffunc.mjs` §C pins that equality.
        //
        //    Comparison is case-insensitive (hence the lowercase base literals): cookie
        //    names are case-sensitive per RFC 6265, so this over-matches slightly. Over-match
        //    is the safe direction — it routes a request to the uncached twin, which renders
        //    correctly and merely misses the cache — and middleware over-matches identically.
        //
        //    ES5 only: CloudFront Functions runtime 1.0 is ECMAScript 5.1. No let/const, no
        //    arrow functions, no template literals (which would also collide with the CDK
        //    template literal this source is embedded in).
        const hostRewriteFunction = new cloudfront.Function(this, 'HostRewriteFunction', {
            functionName: `${stackName}-HostRewrite`,
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    request.headers['x-origin-verify'] = { value: '${props.originVerifySecret}' };

    var SESSION_COOKIE_BASES = ['next-auth.session-token', '__secure-next-auth.session-token'];
    var hasSession = '0';
    var jar = request.cookies || {};
    for (var name in jar) {
        var lower = name.toLowerCase();
        for (var i = 0; i < SESSION_COOKIE_BASES.length; i++) {
            var base = SESSION_COOKIE_BASES[i];
            if (lower === base || lower.indexOf(base + '.') === 0) {
                hasSession = '1';
                break;
            }
        }
        if (hasSession === '1') {
            break;
        }
    }
    request.headers['x-has-session'] = { value: hasSession };

    return request;
}
            `),
        });

        // 6. Custom Origin Request Policy that forwards X-Forwarded-Host + origin verification
        const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'RendererOriginPolicy', {
            originRequestPolicyName: `${stackName}-RendererOriginPolicy`,
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
                'Accept',
                'Accept-Language',
                'Content-Type',
                'X-Forwarded-Host',
                'x-origin-verify',  // Phase 6.1: Origin verification header
                'x-tenant-id',
                'x-automation-key'
            ),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        });

        // Phase 4 / slice cache-3: cache key for the multi-tenant ISR default behavior.
        //
        // The cache key decides two things: which stored response a viewer gets, and
        // whether the origin is consulted AT ALL. A header or parameter left out of this
        // key collapses onto the bare key, and if that entry is warm CloudFront answers
        // from it — the origin, the middleware and the render never run.
        //
        // The origin request policy above (which forwards `Accept`, all cookies and the
        // FULL query string) only comes into play on an edge MISS. So "anything left out
        // of the key still reaches the render" is a cache-MISS property, not a general
        // one, and it is never the reason an omission is safe. See the two-half safety
        // argument on the query allowlist below for what the reason actually is.
        //
        // Rationale and the per-parameter justification live in
        // docs/caching-architecture.md § "Cache Policy (Default Behavior)".
        const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
            cachePolicyName: `${stackName}-RendererCache`,
            defaultTtl: cdk.Duration.seconds(0),  // Respect origin Cache-Control headers
            maxTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.seconds(0),      // 0 => a `no-store` origin response is not stored

            // HEADERS: tenant isolation + the RSC content-negotiation family.
            //
            // `X-Forwarded-Host` (set by the viewer-request CloudFront Function from the
            // incoming Host) keeps `shop-a.example.com/about` and `shop-b.example.com/about`
            // in separate entries.
            //
            // The four `RSC`/`Next-Router-*` headers mirror the origin's own `Vary`.
            // CloudFront does not honour origin `Vary`, and `RSC: 1` flips the response body
            // from an HTML document to a React flight payload (measured, cache-1). Without
            // them one unauthenticated `curl -H 'RSC: 1'` pins `text/x-component` at the
            // edge under a page's HTML URL and every later visitor gets raw flight text
            // (hazard H1 — this is the whole reason cache-1 was not deployable before this).
            // Only `RSC` changes the body today; the other three are keyed anyway so that a
            // future Next version that starts negotiating on them cannot reintroduce H1.
            //
            // `x-has-session` is the one-bit session discriminator the viewer-request
            // Function above derives from the cookie jar (hazard H3, closed in revision 3 of
            // this slice). It is what stops an authenticated request from matching a warm
            // ANONYMOUS entry — cookies are deliberately absent from this key, so without it
            // the two requests are indistinguishable at the edge and an access-gated page
            // would serve its cached "Restricted Access" shell to a logged-in visitor. The
            // Function overwrites the header on every request, so it can only ever take the
            // values '0' and '1'; a viewer cannot inject a third.
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
                'X-Forwarded-Host',
                'RSC',
                'Next-Router-Prefetch',
                'Next-Router-State-Tree',
                'Next-Router-Segment-Prefetch',
                'x-has-session',
            ),

            // QUERY STRINGS: explicit allowlist (was `all()`).
            //
            // `all()` let any `?utm_*`, `?fbclid`, or attacker-chosen junk parameter mint a
            // distinct entry — a guaranteed miss and an SSR Lambda invocation per unique
            // value. A parameter NOT listed here collapses onto the bare-path entry and,
            // once that entry is warm, is answered at the edge WITHOUT REACHING THE LAMBDA.
            //
            // Safety argument — read this before editing the list. It has two halves and
            // NEITHER of them is about the middleware: on a warm entry CloudFront answers
            // before middleware runs, so nothing middleware does can rescue the key.
            //
            //   (a) A parameter that changes the rendered representation MUST be in this
            //       list. Being in the key is what forces an edge miss and gets the request
            //       to the origin at all. Nothing downstream can rescue a parameter that was
            //       stripped here: the origin never sees the request. (`?page=2` served the
            //       page-1 entry is the concrete failure this prevents.)
            //   (b) A parameter that is NOT in this list is safe only because no code reads
            //       it, so the origin would render the bare-path representation for it
            //       anyway. That is a code-inspection claim, verified in
            //       renderer/src: the complete set of `query.*` reads in the render body is
            //       `page`, `q`, `availability`, `id`, `email` (components/SitePage.tsx),
            //       `preview` (both %5Fdyn twins) and `nf` (lib/not-found-handoff.ts) — i.e.
            //       exactly this list. The cacheable route itself passes `query={{}}`
            //       literally (it is in ISR mode and cannot await searchParams), so the
            //       stored representation is a pure function of host + path + the RSC
            //       headers above. `_rsc` is the one non-listed parameter that reaches that
            //       route, and it is measured not to change the body — the `RSC` header
            //       does, and that header is now keyed.
            //
            // cache-1's property that middleware routes every query-string request to the
            // `no-store` %5Fdyn twin is NOT the safety argument (a warm bare-path entry is
            // served before middleware runs). What it buys is narrower and still useful: a
            // request carrying a query string can never POPULATE an entry, so a junk
            // parameter cannot warm a bogus one, and a listed parameter always renders
            // fresh rather than from a stale variant.
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList(
                // Pagination on category / shop / search listings (SitePage.tsx: `query.page`).
                'page',
                // Search term (SitePage.tsx: `query.q`, also read in generateMetadata).
                'q',
                // Shop in-stock filter (SitePage.tsx: `query.availability`).
                'availability',
                // Order-confirmation lookup pair (SitePage.tsx: `query.id` + `query.email`).
                'id',
                'email',
                // Draft preview on the tenant's own domain (%5Fdyn pages: `query.preview`).
                // Must bypass the edge or an editor would be served the published entry.
                'preview',
                // MANDATORY — not an optimisation. The not-found handoff redirects
                // `/p` -> `/p?nf=1` and that 307 IS cacheable (lib/not-found-handoff.ts).
                // Without `nf` in the key, `/p?nf=1` collapses onto `/p`, hits the stored
                // 307 and redirects to itself: an infinite client redirect loop on every
                // 404.
                'nf',
            ),

            // COOKIES: deliberately not in the key. Cookie VALUES are per-visitor, so keying
            // on any of them (the session token above all) would give each visitor a private
            // set of entries and put a credential in the cache key. The one cookie-derived
            // fact the key needs — "does this request carry a session?" — arrives as the
            // `x-has-session` header instead. `RendererOriginPolicy` still forwards all
            // cookies to the origin, so the render sees the real jar on a miss.
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
        });

        // 7. CloudFront Distribution
        // Phase 4: Use rendererCachePolicy when enableCaching is true
        const cachePolicy = props.enableCaching
            ? rendererCachePolicy
            : cloudfront.CachePolicy.CACHING_DISABLED;

        const defaultBehavior: cloudfront.BehaviorOptions = {
            origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(fnUrl.url)),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cachePolicy,
            originRequestPolicy: originRequestPolicy,
            functionAssociations: [{
                function: hostRewriteFunction,
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            }],
        };

        // Build additional behaviors
        const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {
            // API routes (comments, account, revalidation) must NOT be cached.
            // They go to the same server Lambda but bypass the cache layer.
            'api/*': {
                origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(fnUrl.url)),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: originRequestPolicy,
                functionAssociations: [{
                    function: hostRewriteFunction,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                }],
            },
            '_next/static/*': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,  // Static assets cache forever
            },
            'assets/*': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            'favicon.ico': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
        };

        // Add image optimization behavior if available
        if (imageOptUrl) {
            additionalBehaviors['_next/image*'] = {
                origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(imageOptUrl.url)),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            };
        }

        this.distribution = new cloudfront.Distribution(this, 'RendererDistribution', {
            defaultBehavior,
            domainNames: props.domainNames,
            certificate: props.certificate,
            additionalBehaviors,
        });

        // 8. Upload Assets to S3
        new s3deploy.BucketDeployment(this, 'DeployRendererAssets', {
            sources: [s3deploy.Source.asset(path.join(openNextPath, 'assets'))],
            destinationBucket: this.assetBucket,
            distribution: this.distribution,
            prune: false,
        });

        // 9. CloudWatch Alarms (Phase 5.4: Operational Security)

        // 9.1 Revalidation queue depth alarm (pages piling up = renderer not keeping up)
        new cloudwatch.Alarm(this, 'RevalidationQueueDepthAlarm', {
            alarmName: `${stackName}-revalidation-queue-depth`,
            alarmDescription: 'Revalidation queue has more than 100 pending messages',
            metric: this.revalidationQueue.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: 'Maximum',
            }),
            threshold: 100,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });

        // 9.2 Server Lambda errors alarm
        new cloudwatch.Alarm(this, 'ServerLambdaErrorsAlarm', {
            alarmName: `${stackName}-server-lambda-errors`,
            alarmDescription: 'Server Lambda has more than 10 errors in 5 minutes',
            metric: this.serverFunction.metricErrors({
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 10,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        });

        // 9.3 Revalidation Lambda errors alarm (if exists)
        if (revalidationFunc) {
            new cloudwatch.Alarm(this, 'RevalidationLambdaErrorsAlarm', {
                alarmName: `${stackName}-revalidation-lambda-errors`,
                alarmDescription: 'Revalidation Lambda has errors',
                metric: revalidationFunc.metricErrors({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Sum',
                }),
                threshold: 5,
                evaluationPeriods: 2,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            });
        }

        // Outputs
        new cdk.CfnOutput(this, 'RendererUrl', { value: `https://${this.distribution.distributionDomainName}` });
        new cdk.CfnOutput(this, 'TagCacheTableName', { value: tagCacheTable.tableName });
        new cdk.CfnOutput(this, 'RevalidationQueueUrlOutput', { value: this.revalidationQueue.queueUrl });
        new cdk.CfnOutput(this, 'CachingEnabledOutput', { value: props.enableCaching ? 'true' : 'false' });
    }
}
