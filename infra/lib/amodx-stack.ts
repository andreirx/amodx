import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AmodxDatabase } from './database';
import { AmodxAuth } from './auth';
import { AmodxApi } from './api';
import { AdminHosting } from './admin-hosting';

export class AmodxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Database
    const db = new AmodxDatabase(this, 'Database');

    // 2. Auth
    const auth = new AmodxAuth(this, 'Auth');

    // Wire up the API
    const api = new AmodxApi(this, 'Api', { table: db.table });

    // --- DEPLOY ADMIN ---
    new AdminHosting(this, 'AdminHosting', {
      apiUrl: api.httpApi.url!,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      region: this.region,
    });

    // Outputs (We will need these later for the Frontend!)
    new cdk.CfnOutput(this, 'TableName', { value: db.table.tableName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: auth.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
  }
}
