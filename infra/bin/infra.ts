#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmodxStack } from '../lib/amodx-stack';

const app = new cdk.App();
new AmodxStack(app, 'AmodxStack', {
    /* Specialize this stack for the AWS Account and Region
     * implied by the current CLI configuration. */
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
});
