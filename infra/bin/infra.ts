#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmodxStack } from '../lib/amodx-stack';
import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

// 1. Read Context Flag (-c stage=staging)
// Default to 'prod' if not specified
const stage = app.node.tryGetContext('stage') || 'prod';

console.log(`🚀 Synthesizing for stage: ${stage}`);

// 2. Select Config File
// prod -> amodx.config.json
// staging -> amodx.staging.json
const configFileName = stage === 'prod' ? 'amodx.config.json' : `amodx.${stage}.json`;
const configPath = path.join(__dirname, `../../${configFileName}`);

if (!fs.existsSync(configPath)) {
    console.error(`❌ Configuration file not found: ${configFileName}`);
    console.error(`   Please create '${configFileName}' in the root directory.`);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 3. Determine Stack Name
// Use config name if present, otherwise append stage (e.g., AmodxStack-staging)
const stackName = config.stackName || (stage === 'prod' ? 'AmodxStack' : `AmodxStack-${stage}`);

// 4. Deploy
new AmodxStack(app, stackName, {
    env: {
        account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
        region: config.region || process.env.CDK_DEFAULT_REGION
    },
    config: config,
    stage: stage // Pass stage to stack for internal logic if needed
});
