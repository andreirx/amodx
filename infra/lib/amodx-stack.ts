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
import { AmodxEvents } from './events';
import * as path from "node:path";

interface AmodxStackProps extends cdk.StackProps {
  stage: string;
  config: {
    domains: {
      root?: string; // Optional now
      tenants?: string[];
      globalCertArn?: string;
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

    const uploads = new AmodxUploads(this, 'Uploads', { bucketSuffix: suffix });
    const db = new AmodxDatabase(this, 'Database', { tableSuffix: suffix });
    const auth = new AmodxAuth(this, 'Auth', { nameSuffix: suffix });

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
    const events = new AmodxEvents(this, 'Events', {
      auditFunction: auditWorker,
      busName: `AmodxSystemBus${suffix}`
    });

    // READ CONFIG (Fallback to your verified email for safety)
    const sesEmail = props.config.sesEmail || "contact@bijuterie.software";

    // 3. API Layer
    const api = new AmodxApi(this, 'Api', {
      table: db.table,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      masterKeySecret: masterKeySecret,
      uploadsBucket: uploads.bucket,
      privateBucket: uploads.privateBucket,
      uploadsCdnUrl: `https://${uploads.distribution.distributionDomainName}`,
      eventBus: events.bus,
      sesEmail: sesEmail,
      adminDomain: rootDomain ? `admin.${rootDomain}` : undefined,
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
    new CommerceApi(this, 'CommerceApi', {
      httpApiId: api.httpApi.apiId,
      authorizerFuncArn: api.authorizerFuncArn,
      table: db.table,
      eventBus: events.bus,
    });

    // 3c. Engagement API (NestedStack — popups, forms)
    new EngagementApi(this, 'EngagementApi', {
      httpApiId: api.httpApi.apiId,
      authorizerFuncArn: api.authorizerFuncArn,
      table: db.table,
      eventBus: events.bus,
    });

    // 4. Renderer Layer
    const renderer = new RendererHosting(this, 'RendererHosting', {
      table: db.table,
      apiUrl: api.httpApi.url!,
      masterKeySecret: masterKeySecret,
      nextAuthSecret: nextAuthSecret,
      certificate: globalCertificate,
      domainNames: allDomains.length > 0 ? allDomains : undefined, // <--- FIX: Pass tenants even if root is missing
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
