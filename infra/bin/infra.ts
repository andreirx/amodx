#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmodxStack } from '../lib/amodx-stack';

const app = new cdk.App();

// Read domain from context: npx cdk deploy -c domainName=amodx.net
// If missing, it defaults to undefined (CloudFront URLs only)
const domainName = app.node.tryGetContext('domainName');
const stackName = app.node.tryGetContext('stackName') || 'AmodxStack';


new AmodxStack(app, stackName, {
    /* Specialize this stack for the AWS Account and Region
     * implied by the current CLI configuration. */
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
    // Pass the custom property
    domainName: domainName,
    stackName: stackName,
});
