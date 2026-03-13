import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AmodxDatabase } from './database';
import { AmodxAuth } from './auth';
import { AmodxApi } from './api';
import { CommerceApi } from './api-commerce';
import { EngagementApi } from './api-engagement';
import { AdminHosting } from './admin-hosting';
import { RendererHosting } from './renderer-hosting';
import { AmodxUploads } from './uploads';
import { AmodxDomains } from './domains';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import { AmodxEvents } from './events';
import * as path from "node:path";

interface AmodxStackProps extends cdk.StackProps {
  stage: string;
  config: {
    domains: {
      root?: string; // Optional now
      tenants?: string[];
      globalCertArn?: string;
      cloudFrontUrl?: string; // Phase 6.2: Add after first deploy for CORS (previews)
    };
    [key: string]: any;
  };
}

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AmodxStackProps) {
    super(scope, id, props);

    // Optional: Add a tag to all resources so you can find costs easily in AWS Console
    cdk.Tags.of(this).add('Stage', props.stage);
    cdk.Tags.of(this).add('Project', 'AMODX');

    // Helper to suffix names: "AmodxBus" -> "AmodxBus-staging"
    const suffix = props.stage === 'prod' ? '' : `-${props.stage}`;

    const rootDomain = props.config.domains.root;
    const tenantDomains = props.config.domains.tenants || [];
    const globalCertArn = props.config.domains.globalCertArn;
    const corsCloudFrontUrl = props.config.domains.cloudFrontUrl; // Phase 6.2: For CORS (previews)

    // 0. DOMAINS STRATEGY
    let globalCertificate: acm.ICertificate | undefined;
    let regionalCertificate: acm.ICertificate | undefined;
    let domains: AmodxDomains | undefined;

    // A. Handle Root Domain (The Agency Domain)
    if (rootDomain) {
      domains = new AmodxDomains(this, 'Domains', {
        domainName: rootDomain,
      });
      // API Gateway uses Regional Cert (eu-central-1)
      regionalCertificate = domains.regionalCertificate;
    }

    // B. Handle Global Cert (CloudFront)
    // This covers Root (if exists) AND Tenants
    if (globalCertArn) {
      // Use the Massive Cert managed by script
      globalCertificate = acm.Certificate.fromCertificateArn(this, 'GlobalCert', globalCertArn);
    } else if (domains) {
      // Fallback: Use internal cert (Only covers root + wildcard)
      globalCertificate = domains.globalCertificate;
    }

    // C. Compile Domain List for CloudFront
    const allDomains: string[] = [];
    if (rootDomain) {
      allDomains.push(rootDomain, `*.${rootDomain}`);
    }
    // Only add tenants if we have a valid cert that (presumably) covers them
    if (globalCertArn && tenantDomains.length > 0) {
      allDomains.push(...tenantDomains);
    }

    // ... (Secrets, Uploads, DB, Auth) ... (Keep existing code)
    // A. Master API Key (For MCP/Robots)
    const masterKeySecret = new secretsmanager.Secret(this, 'AmodxMasterKey', {
      description: 'Master API Key for AMODX MCP Tools',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // B. NextAuth Secret (For Cookie Signing) - NEW PRODUCTION RESOURCE
    const nextAuthSecret = new secretsmanager.Secret(this, 'NextAuthSecret', {
      description: 'Signing key for NextAuth.js sessions',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      }
    });

    // C. Renderer API Key (Phase 2.1: Restricted key for renderer - can only POST/DELETE comments)
    const rendererKeySecret = new secretsmanager.Secret(this, 'RendererApiKey', {
      description: 'Restricted API key for renderer Lambda (comments only)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // D. Revalidation Secret (Phase 2.5: Secures cache purge endpoint)
    const revalidationSecret = new secretsmanager.Secret(this, 'RevalidationSecret', {
      description: 'Secret token for renderer cache revalidation endpoint',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    // E. Origin Verify Secret (Phase 6.1: Prove requests came through CloudFront)
    const originVerifySecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      description: 'Secret injected by CloudFront, verified by Lambda to block direct access',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    // READ CONFIG (Fallback to your verified email for safety)
    const sesEmail = props.config.sesEmail || "contact@bijuterie.software";

    const uploads = new AmodxUploads(this, 'Uploads', { bucketSuffix: suffix });
    const db = new AmodxDatabase(this, 'Database', { tableSuffix: suffix });
    const adminUrl = rootDomain ? `https://admin.${rootDomain}` : undefined;
    const auth = new AmodxAuth(this, 'Auth', {
      nameSuffix: suffix,
      sesEmail: sesEmail,
      sesRegion: this.region,
      adminUrl: adminUrl,
    });

    // 2. API Domain Setup (Only if Root Domain exists)
    let apiDomain: apigw.DomainName | undefined;
    if (domains && regionalCertificate && rootDomain) {
      apiDomain = new apigw.DomainName(this, 'ApiDomain', {
        domainName: `api.${rootDomain}`,
        certificate: regionalCertificate,
      });
    }

    // 1. Audit Worker (Consumer)
    // We define this here because the EventBus needs to point to it
    const auditWorker = new nodejs.NodejsFunction(this, 'AuditWorker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../backend/src/audit/worker.ts'),
      handler: 'handler',
      environment: { TABLE_NAME: db.table.tableName },
      bundling: { minify: true, sourceMap: true },
      deadLetterQueueEnabled: true // CDK creates the SQS queue automatically to prevent losing logs
    });
    db.table.grantWriteData(auditWorker);

    // 2. Events Infra (The Bus)
    const amodxEvents = new AmodxEvents(this, 'Events', {
      auditFunction: auditWorker,
      busName: `AmodxSystemBus${suffix}`
    });

    // 3. API Layer
    // Phase 4: Renderer URL for cache revalidation
    // Use the root domain if available, otherwise the CloudFront distribution domain
    const rendererBaseUrl = rootDomain ? `https://${rootDomain}` : undefined;

    const api = new AmodxApi(this, 'Api', {
      table: db.table,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      masterKeySecret: masterKeySecret,
      rendererKeySecret: rendererKeySecret, // Phase 2.1: Restricted key for renderer
      revalidationSecret: revalidationSecret, // Phase 4: Cache invalidation
      uploadsBucket: uploads.bucket,
      privateBucket: uploads.privateBucket,
      uploadsCdnUrl: `https://${uploads.distribution.distributionDomainName}`,
      eventBus: amodxEvents.bus,
      sesEmail: sesEmail,
      adminDomain: rootDomain ? `admin.${rootDomain}` : undefined,
      tenantDomains: tenantDomains, // Phase 6.2: For CORS
      additionalCorsOrigins: corsCloudFrontUrl ? [corsCloudFrontUrl] : undefined, // Phase 6.2: CloudFront URL for previews
      rendererUrl: rendererBaseUrl, // Phase 4: For cache revalidation
    });

    if (apiDomain && domains) {
      new apigw.ApiMapping(this, 'ApiMapping', {
        api: api.httpApi,
        domainName: apiDomain,
      });
      new route53.ARecord(this, 'ApiRecord', {
        zone: domains.zone,
        recordName: 'api',
        target: route53.RecordTarget.fromAlias(new targets.ApiGatewayv2DomainProperties(apiDomain.regionalDomainName, apiDomain.regionalHostedZoneId)),
      });
    }

    // 3b. Commerce API (NestedStack — categories, orders, customers, delivery, coupons, reviews, woo import)
    const commerceApi = new CommerceApi(this, 'CommerceApi', {
      httpApiId: api.httpApi.apiId,
      authorizerFuncArn: api.authorizerFuncArn,
      table: db.table,
      eventBus: amodxEvents.bus,
      sesEmail: sesEmail,
      uploadsBucketName: uploads.bucket.bucketName,
      uploadsCdnUrl: `https://${uploads.distribution.distributionDomainName}`,
      uploadsBucket: uploads.bucket,
      // Cache revalidation for product/category updates
      revalidationSecret: revalidationSecret,
      rendererUrl: rendererBaseUrl,
    });

    // 3c. Engagement API (NestedStack — popups, forms)
    const engagementApi = new EngagementApi(this, 'EngagementApi', {
      httpApiId: api.httpApi.apiId,
      authorizerFuncArn: api.authorizerFuncArn,
      table: db.table,
      eventBus: amodxEvents.bus,
      sesEmail: sesEmail,
    });

    // 4. Renderer Layer
    // Phase 2.3: Use restricted rendererKeySecret instead of masterKeySecret
    const renderer = new RendererHosting(this, 'RendererHosting', {
      table: db.table,
      apiUrl: api.httpApi.url!,
      rendererKeySecret: rendererKeySecret,  // Restricted: can only POST/DELETE comments
      revalidationSecret: revalidationSecret, // Phase 2.5: Secures cache purge
      nextAuthSecret: nextAuthSecret,
      originVerifySecret: originVerifySecret.secretValue.unsafeUnwrap(),  // Phase 6.1: Baked into CF Function
      certificate: globalCertificate,
      domainNames: allDomains.length > 0 ? allDomains : undefined,
      enableCaching: true,  // Phase 4: CloudFront caches pages, respects Cache-Control headers
    });

    // Wire DNS for Root (Agency) Domain only
    // Tenants manage their own DNS to point to this distribution
    if (domains && rootDomain) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(renderer.distribution));
      new route53.ARecord(this, 'RendererApexRecord', { zone: domains.zone, target });
      new route53.ARecord(this, 'RendererWildcardRecord', { zone: domains.zone, recordName: '*', target });
    }

    const cloudFrontUrl = `https://${renderer.distribution.distributionDomainName}`;
    const rendererUrl = rootDomain ? `https://${rootDomain}` : cloudFrontUrl;

    // ============================================================
    // 4b. Debounced CloudFront Invalidation
    // ============================================================
    // Mutation handlers write a DynamoDB marker (SYSTEM#CDN_PENDING)
    // via the withInvalidation() HOF. No CloudFront IAM needed on
    // mutation Lambdas — they only do DDB PutItem.
    //
    // The debounce flush Lambda polls every 10 seconds (inside a
    // 1-minute EventBridge schedule) and fires CloudFront /*
    // invalidation when 15 minutes have elapsed since the last mutation.
    const distId = renderer.distribution.distributionId;
    const distArn = `arn:aws:cloudfront::${this.account}:distribution/${distId}`;

    const debounceFlushFunc = new nodejs.NodejsFunction(this, 'DebounceFlushFunc', {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, '../../backend/src/scheduled/debounce-flush.ts'),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.minutes(2),  // Max 6 iterations * 10s = 60s, plus overhead
        environment: {
            TABLE_NAME: db.table.tableName,
            RENDERER_DISTRIBUTION_ID: distId,
            DEBOUNCE_WINDOW_MS: '900000', // 15 minutes
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
    });
    db.table.grantReadWriteData(debounceFlushFunc);
    debounceFlushFunc.addToRolePolicy(new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [distArn],
    }));

    // Schedule: every 1 minute (Lambda loops internally at 10s resolution)
    new events.Rule(this, 'DebounceFlushSchedule', {
        schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
        targets: [new eventTargets.LambdaFunction(debounceFlushFunc)],
    });

    // ============================================================
    // 4b-2. System API Routes — Invalidation Status + Manual Flush
    // ============================================================
    // These use api.httpApi directly from the stack (not api.ts)
    // because they need the renderer distribution ID, which isn't
    // available until after the renderer construct is created.
    const systemNodeProps = {
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: {
            TABLE_NAME: db.table.tableName,
            DEBOUNCE_WINDOW_MS: '900000',
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
    };

    // GET /system/invalidation — status check (polled by admin UI)
    const invalidationStatusFunc = new nodejs.NodejsFunction(this, 'InvalidationStatusFunc', {
        ...systemNodeProps,
        entry: path.join(__dirname, '../../backend/src/system/invalidation.ts'),
        handler: 'statusHandler',
    });
    db.table.grantReadData(invalidationStatusFunc);

    // POST /system/invalidation — "GO LIVE NOW" manual flush
    const invalidationFlushFunc = new nodejs.NodejsFunction(this, 'InvalidationFlushFunc', {
        ...systemNodeProps,
        entry: path.join(__dirname, '../../backend/src/system/invalidation.ts'),
        handler: 'flushHandler',
        environment: {
            ...systemNodeProps.environment,
            RENDERER_DISTRIBUTION_ID: distId,
        },
    });
    db.table.grantReadWriteData(invalidationFlushFunc);
    invalidationFlushFunc.addToRolePolicy(new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [distArn],
    }));

    api.httpApi.addRoutes({
        path: '/system/invalidation',
        methods: [apigw.HttpMethod.GET],
        integration: new integrations.HttpLambdaIntegration('InvalidationStatusInt', invalidationStatusFunc),
    });
    api.httpApi.addRoutes({
        path: '/system/invalidation',
        methods: [apigw.HttpMethod.POST],
        integration: new integrations.HttpLambdaIntegration('InvalidationFlushInt', invalidationFlushFunc),
    });

    // ============================================================
    // 4c. Nightly Cache Flush — safety net
    // ============================================================
    // Clears both CloudFront edge cache (/* invalidation) and
    // OpenNext ISR cache in S3 (delete _cache/ prefix).
    // Runs daily at 02:00 UTC via EventBridge scheduled rule.
    const nightlyFlushFunc = new nodejs.NodejsFunction(this, 'NightlyCacheFlushFunc', {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, '../../backend/src/scheduled/nightly-cache-flush.ts'),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.minutes(5),
        environment: {
            RENDERER_DISTRIBUTION_ID: distId,
            CACHE_BUCKET_NAME: renderer.assetBucket.bucketName,
            CACHE_BUCKET_KEY_PREFIX: '_cache',
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
    });

    // IAM: CloudFront invalidation
    nightlyFlushFunc.addToRolePolicy(new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [distArn],
    }));

    // IAM: S3 cache flush (list + delete under _cache/ prefix)
    renderer.assetBucket.grantRead(nightlyFlushFunc);
    renderer.assetBucket.grantDelete(nightlyFlushFunc);

    // Schedule: daily at 02:00 UTC
    new events.Rule(this, 'NightlyCacheFlushSchedule', {
        schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
        targets: [new eventTargets.LambdaFunction(nightlyFlushFunc)],
    });

    // 5. Admin Layer
    const admin = new AdminHosting(this, 'AdminHosting', {
      apiUrl: rootDomain ? `https://api.${rootDomain}/` : api.httpApi.url!,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      region: this.region,
      rendererUrl: cloudFrontUrl,
      certificate: globalCertificate,
      domainName: rootDomain ? `admin.${rootDomain}` : undefined,
    });

    if (domains && rootDomain) {
      new route53.ARecord(this, 'AdminRecord', {
        zone: domains.zone,
        recordName: 'admin',
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(admin.distribution)),
      });
    }


    // Outputs
    new cdk.CfnOutput(this, 'TableName', { value: db.table.tableName });
    new cdk.CfnOutput(this, 'AdminPoolId', { value: auth.adminPool.userPoolId });
    new cdk.CfnOutput(this, 'AdminClientId', { value: auth.adminClient.userPoolClientId });
    new cdk.CfnOutput(this, 'PublicPoolId', { value: auth.publicPool.userPoolId });
    new cdk.CfnOutput(this, 'PublicClientId', { value: auth.publicClient.userPoolClientId });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'AGENCY RendererUrl', { value: rendererUrl });
    new cdk.CfnOutput(this, 'CloudFrontRendererUrl', { value: cloudFrontUrl });
    new cdk.CfnOutput(this, 'AdminUrl', { value: rootDomain ? `https://admin.${rootDomain}` : `https://${admin.distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'MasterKeySecretName', { value: masterKeySecret.secretName });
  }
}
