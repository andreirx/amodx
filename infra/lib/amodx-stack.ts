import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AmodxDatabase } from './database';
import { AmodxAuth } from './auth';
import { AmodxApi } from './api';
import { AdminHosting } from './admin-hosting';
import { RendererHosting } from './renderer-hosting';
import { AmodxUploads } from './uploads';
import { AmodxDomains } from './domains';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

// NEW PROPS INTERFACE
interface AmodxStackProps extends cdk.StackProps {
  config: {
    domains: {
      root: string;
      tenants?: string[];
      globalCertArn?: string;
    };
    [key: string]: any; // Allow other config fields
  };
}

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AmodxStackProps) {
    super(scope, id, props);

    const rootDomain = props.config.domains.root;
    const tenantDomains = props.config.domains.tenants || [];
    const globalCertArn = props.config.domains.globalCertArn;

    // 0. DOMAINS & CERTIFICATES STRATEGY
    let globalCertificate: acm.ICertificate | undefined;
    let regionalCertificate: acm.ICertificate | undefined;
    let domains: AmodxDomains | undefined;

    // Case A: We have a Root Domain (e.g. amodx.net)
    if (rootDomain) {
      domains = new AmodxDomains(this, 'Domains', {
        domainName: rootDomain,
      });

      // Regional Cert (EU-Central-1) for API Gateway
      // We always create this via the Construct because it's cheap/easy and specific to the stack region
      regionalCertificate = domains.regionalCertificate;

      // Global Cert (US-East-1) for CloudFront
      if (globalCertArn) {
        // Option 1: Use the Massive Cert managed by our script
        globalCertificate = acm.Certificate.fromCertificateArn(this, 'GlobalCert', globalCertArn);
      } else {
        // Option 2 (Fallback): Use the internal one (Only covers root + wildcard)
        globalCertificate = domains.globalCertificate;
      }
    }

    // Combine all domains for CloudFront
    // If we have a custom cert ARN, we assume it covers tenants.
    // If we rely on fallback, we only support root + wildcard.
    const allDomains = rootDomain
        ? [rootDomain, `*.${rootDomain}`, ...(globalCertArn ? tenantDomains : [])]
        : undefined;


    // 1. Secrets & Data
    const masterKeySecret = new secretsmanager.Secret(this, 'AmodxMasterKey', {
      description: 'Master API Key',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    const uploads = new AmodxUploads(this, 'Uploads');
    const db = new AmodxDatabase(this, 'Database');
    const auth = new AmodxAuth(this, 'Auth');

    // 2. API Domain Setup
    let apiDomain: apigw.DomainName | undefined;
    if (domains && regionalCertificate) {
      apiDomain = new apigw.DomainName(this, 'ApiDomain', {
        domainName: `api.${rootDomain}`,
        certificate: regionalCertificate,
      });
    }

    // 3. API Layer
    const api = new AmodxApi(this, 'Api', {
      table: db.table,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      masterKeySecret: masterKeySecret,
      uploadsBucket: uploads.bucket,
      uploadsCdnUrl: `https://${uploads.distribution.distributionDomainName}`,
    });

    // Wire API DNS
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

    // 4. Renderer Layer
    const renderer = new RendererHosting(this, 'RendererHosting', {
      table: db.table,
      apiUrl: api.httpApi.url!,
      masterKeySecret: masterKeySecret,
      certificate: globalCertificate,
      domainNames: allDomains,
    });

    // Wire Renderer DNS
    if (domains) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(renderer.distribution));

      // Root: amodx.net
      new route53.ARecord(this, 'RendererApexRecord', {
        zone: domains.zone,
        target: target,
      });

      // Wildcard: *.amodx.net
      new route53.ARecord(this, 'RendererWildcardRecord', {
        zone: domains.zone,
        recordName: '*',
        target: target,
      });

      // NOTE: We CANNOT create DNS records for Tenant Custom Domains (client.com) here.
      // Those are in external Hosted Zones. The client manages them.
    }

    const rendererUrl = rootDomain ? `https://${rootDomain}` : `https://${renderer.distribution.distributionDomainName}`;

    // 5. Admin Layer
    const admin = new AdminHosting(this, 'AdminHosting', {
      apiUrl: rootDomain ? `https://api.${rootDomain}/` : api.httpApi.url!,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      region: this.region,
      rendererUrl: rendererUrl,
      certificate: globalCertificate,
      domainName: rootDomain ? `admin.${rootDomain}` : undefined,
    });

    // Wire Admin DNS
    if (domains) {
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
    new cdk.CfnOutput(this, 'RendererUrl', { value: rendererUrl });
    new cdk.CfnOutput(this, 'AdminUrl', { value: rootDomain ? `https://admin.${rootDomain}` : `https://${admin.distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'MasterKeySecretName', { value: masterKeySecret.secretName });
  }
}
