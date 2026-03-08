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
}

export class RendererHosting extends Construct {
    public readonly distribution: cloudfront.Distribution;

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
        const assetBucket = new s3.Bucket(this, 'RendererAssets', {
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
        const revalidationQueue = new sqs.Queue(this, 'RevalidationQueue', {
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
            revalidationFunc.addEventSource(new lambdaEventSources.SqsEventSource(revalidationQueue, {
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
                    BUCKET_NAME: assetBucket.bucketName,
                    BUCKET_KEY_PREFIX: '_assets',
                },
            });
            assetBucket.grantRead(imageOptFunc);

            imageOptUrl = imageOptFunc.addFunctionUrl({
                authType: lambda.FunctionUrlAuthType.NONE,
            });
        } else {
            console.warn("OpenNext image-optimization-function not found. Skipping image optimization Lambda.");
        }

        // 3. The Server Lambda
        // Phase 2.3: Uses restricted rendererKeySecret instead of masterKeySecret
        const serverFunction = new lambda.Function(this, 'RendererServer', {
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
                CACHE_BUCKET_NAME: assetBucket.bucketName,
                CACHE_BUCKET_KEY_PREFIX: '_cache',
                CACHE_BUCKET_REGION: region,
                // Phase 2.3: Restricted key - can only POST/DELETE comments, not full admin access
                AMODX_API_KEY_SECRET: props.rendererKeySecret.secretName,
                // Phase 2.5: Secret for cache revalidation endpoint
                REVALIDATION_SECRET: props.revalidationSecret.secretValue.unsafeUnwrap(),
                // PRODUCTION CONFIGURATION FOR NEXTAUTH
                NEXTAUTH_SECRET: props.nextAuthSecret.secretValue.unsafeUnwrap(),
                NEXTAUTH_URL: `https://${props.domainNames ? props.domainNames[0] : 'localhost'}`,
                // Phase 4: Caching infrastructure
                REVALIDATION_QUEUE_URL: revalidationQueue.queueUrl,
                REVALIDATION_QUEUE_REGION: region,
                CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
                // Phase 6.1: Origin verification - reject requests not from CloudFront
                ORIGIN_VERIFY_SECRET: props.originVerifySecret,
            },
        });
        props.rendererKeySecret.grantRead(serverFunction);

        // Grant Permissions
        props.table.grantReadData(serverFunction);
        assetBucket.grantReadWrite(serverFunction);
        revalidationQueue.grantSendMessages(serverFunction);  // Server can queue revalidation
        tagCacheTable.grantReadWriteData(serverFunction);     // Server reads/writes tag cache

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
                    FUNCTION_NAME: serverFunction.functionName,
                    CONCURRENCY: '1',
                },
            });
            serverFunction.grantInvoke(warmerFunc);

            // Schedule warmer every 5 minutes
            new events.Rule(this, 'WarmerSchedule', {
                schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
                targets: [new targets.LambdaFunction(warmerFunc)],
            });
        } else {
            console.warn("OpenNext warmer-function not found. Skipping warmer Lambda.");
        }

        // 4. Lambda Function URL
        const fnUrl = serverFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
        });

        // 5. CloudFront Function to preserve original Host header + inject origin verification
        // Phase 6.1: Injects x-origin-verify header so Lambda can verify request came through CloudFront
        const hostRewriteFunction = new cloudfront.Function(this, 'HostRewriteFunction', {
            functionName: `${stackName}-HostRewrite`,
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    request.headers['x-origin-verify'] = { value: '${props.originVerifySecret}' };
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

        // Phase 4: Custom cache policy for multi-tenant ISR
        // CRITICAL: Cache key MUST include X-Forwarded-Host for tenant isolation
        const rendererCachePolicy = new cloudfront.CachePolicy(this, 'RendererCachePolicy', {
            cachePolicyName: `${stackName}-RendererCache`,
            defaultTtl: cdk.Duration.seconds(0),  // Respect origin Cache-Control headers
            maxTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.seconds(0),
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList('X-Forwarded-Host'),  // Tenant isolation
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),  // Don't cache by cookie
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
            '_next/static/*': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,  // Static assets cache forever
            },
            'assets/*': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            'favicon.ico': {
                origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
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
            destinationBucket: assetBucket,
            distribution: this.distribution,
            prune: false,
        });

        // Outputs
        new cdk.CfnOutput(this, 'RendererUrl', { value: `https://${this.distribution.distributionDomainName}` });
        new cdk.CfnOutput(this, 'TagCacheTableName', { value: tagCacheTable.tableName });
        new cdk.CfnOutput(this, 'RevalidationQueueUrlOutput', { value: revalidationQueue.queueUrl });
        new cdk.CfnOutput(this, 'CachingEnabledOutput', { value: props.enableCaching ? 'true' : 'false' });
    }
}
