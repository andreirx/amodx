import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ConfigGenerator } from './config-generator';

interface AdminHostingProps {
    apiUrl: string;
    userPoolId: string;
    userPoolClientId: string;
    region: string;
    rendererUrl: string;
}

export class AdminHosting extends Construct {
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: AdminHostingProps) {
        super(scope, id);

        // 1. Build the React App (Local Build)
        // We must pass the ENV variables during build time so Vite bakes them in.
        console.log("Building Admin Panel...");
        try {
            execSync('npm run build', {
                cwd: path.join(__dirname, '../../admin'),
                stdio: 'inherit',
                env: {
                    ...process.env,
                }
            });
        } catch (e) {
            console.error("Failed to build Admin Panel");
            throw e;
        }

        // 2. Create S3 Bucket (Private, encrypted)
        const bucket = new s3.Bucket(this, 'AdminBucket', {
            accessControl: s3.BucketAccessControl.PRIVATE,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev
            autoDeleteObjects: true,
        });

        // 3. Create CloudFront Distribution
        this.distribution = new cloudfront.Distribution(this, 'AdminDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(bucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html', // Required for SPA Routing (React Router)
                },
            ],
        });

        // 4. Upload Assets (WITHOUT config.json)
        new s3deploy.BucketDeployment(this, 'DeployAdmin', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../admin/dist'))],
            destinationBucket: bucket,
            distribution: this.distribution,
            distributionPaths: ['/*'],
            prune: false,
        });

        // 5. Generate Runtime Config (The Fix)
        new ConfigGenerator(this, 'RuntimeConfig', {
            bucket: bucket,
            config: {
                VITE_API_URL: props.apiUrl,
                VITE_USER_POOL_ID: props.userPoolId,
                VITE_USER_POOL_CLIENT_ID: props.userPoolClientId,
                VITE_REGION: props.region,
                VITE_RENDERER_URL: props.rendererUrl,
            }
        });

        new cdk.CfnOutput(this, 'AdminUrl', { value: `https://${this.distribution.distributionDomainName}` });
    }
}
