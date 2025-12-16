#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmodxStack } from '../lib/amodx-stack';
import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

// 1. Load Config
const configPath = path.join(__dirname, '../../amodx.config.json');

// Fallback for CI/First run if config doesn't exist
const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};

// CLI Overrides (Optional)
const domainName = app.node.tryGetContext('domainName') || config.domains?.root;
const stackName = app.node.tryGetContext('stackName') || config.stackName || 'AmodxStack';

// 2. Deploy
new AmodxStack(app, stackName, {
    env: {
        account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
        region: config.region || process.env.CDK_DEFAULT_REGION
    },
    config: config // Pass the full config object
});
