import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AmodxDatabase } from './database';
import { AmodxAuth } from './auth';
import { AmodxApi } from './api';
import { AdminHosting } from './admin-hosting';
import { RendererHosting } from './renderer-hosting';

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Database
    const db = new AmodxDatabase(this, 'Database');

    // 2. Auth
    const auth = new AmodxAuth(this, 'Auth');

    // 3. API
    const api = new AmodxApi(this, 'Api', {
      table: db.table
    });

    // 4. Renderer (Must be created BEFORE Admin to get the URL)
    const renderer = new RendererHosting(this, 'RendererHosting', {
      table: db.table
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
  }
}
