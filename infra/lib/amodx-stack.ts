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

interface AmodxStackProps extends cdk.StackProps {
  domainName?: string;
  stackName?: string;
}

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AmodxStackProps) {
    super(scope, id, props);

    const domainName = props?.domainName;

    // 0. Domains
    let domains: AmodxDomains | undefined;
    if (domainName) {
      domains = new AmodxDomains(this, 'Domains', {
        domainName: domainName,
      });
    }

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
    if (domains) {
      apiDomain = new apigw.DomainName(this, 'ApiDomain', {
        domainName: `api.${domainName}`,
        certificate: domains.regionalCertificate,
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
      certificate: domains?.globalCertificate,
      domainNames: domainName ? [domainName, `*.${domainName}`] : undefined,
    });

    // WIRE RENDERER DNS (This was missing!)
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
    }

    const rendererUrl = domainName ? `https://${domainName}` : `https://${renderer.distribution.distributionDomainName}`;

    // 5. Admin Layer
    const admin = new AdminHosting(this, 'AdminHosting', {
      apiUrl: domainName ? `https://api.${domainName}/` : api.httpApi.url!,
      userPoolId: auth.adminPool.userPoolId,
      userPoolClientId: auth.adminClient.userPoolClientId,
      region: this.region,
      rendererUrl: rendererUrl,
      certificate: domains?.globalCertificate,
      domainName: domainName ? `admin.${domainName}` : undefined,
    });

    // WIRE ADMIN DNS (This was missing!)
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
    new cdk.CfnOutput(this, 'AdminUrl', { value: domainName ? `https://admin.${domainName}` : `https://${admin.distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'MasterKeySecretName', { value: masterKeySecret.secretName });
  }
}
