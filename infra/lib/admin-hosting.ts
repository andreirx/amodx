import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
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
    certificate?: acm.ICertificate;
    domainName?: string;
}

export class AdminHosting extends Construct {
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: AdminHostingProps) {
        super(scope, id);

        // 1. Build Admin
        console.log("Building Admin Panel...");
        try {
            execSync('npm run build', {
                cwd: path.join(__dirname, '../../admin'),
                stdio: 'inherit',
                env: { ...process.env }
            });
        } catch (e) {
            console.error("Failed to build Admin Panel");
            throw e;
        }

        // 2. S3 Bucket
        const bucket = new s3.Bucket(this, 'AdminBucket', {
            accessControl: s3.BucketAccessControl.PRIVATE,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Secure
        });

        // 3. CloudFront Distribution
        // Explicitly use S3BucketOrigin with OAC logic implied or manual if needed
        this.distribution = new cloudfront.Distribution(this, 'AdminDistribution', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(bucket), // <--- USE THIS STATIC METHOD
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            domainNames: props.domainName ? [props.domainName] : undefined,
            certificate: props.certificate,

            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
                {
                    httpStatus: 403, // Catch 403s from S3 and serve app (for client-side routing)
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
            ],
        });

        // 4. Upload Assets
        new s3deploy.BucketDeployment(this, 'DeployAdmin', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../admin/dist'))],
            destinationBucket: bucket,
            distribution: this.distribution,
            distributionPaths: ['/*'],
            prune: false,
        });

        // 5. Config
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
