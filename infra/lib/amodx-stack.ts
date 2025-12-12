import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AmodxDatabase } from './database';
import { AmodxAuth } from './auth';
import { AmodxApi } from './api';
import { AdminHosting } from './admin-hosting';
import { RendererHosting } from './renderer-hosting';
import { AmodxUploads } from './uploads';

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Create Secret (Auto-generated if not exists)
    // This creates a secret in AWS Secrets Manager with a generated password
    const masterKeySecret = new secretsmanager.Secret(this, 'AmodxMasterKey', {
      description: 'Master API Key for AMODX MCP Tools',
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

    // Pass Secret to API
    const api = new AmodxApi(this, 'Api', {
      table: db.table,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      masterKeySecret: masterKeySecret,

      // NEW PROPS
      uploadsBucket: uploads.bucket,
      uploadsCdnUrl: `https://${uploads.distribution.distributionDomainName}`,
    });

    // 4. Renderer (Must be created BEFORE Admin to get the URL)
    const renderer = new RendererHosting(this, 'RendererHosting', {
      table: db.table,
      apiUrl: api.httpApi.url!,
    });

    const rendererUrl = `https://${renderer.distribution.distributionDomainName}`;

    // 5. Admin Panel (Receives Renderer URL)
    new AdminHosting(this, 'AdminHosting', {
      apiUrl: api.httpApi.url!,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      region: this.region,
      rendererUrl: rendererUrl,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TableName', { value: db.table.tableName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: auth.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'RendererUrl', { value: rendererUrl });
    // Output the Secret Name (Safe) so our script can find it
    new cdk.CfnOutput(this, 'MasterKeySecretName', { value: masterKeySecret.secretName });
  }
}
