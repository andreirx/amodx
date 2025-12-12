import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export class AmodxUploads extends Construct {
    public readonly bucket: s3.Bucket;
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // 1. Storage
        this.bucket = new s3.Bucket(this, 'AssetsBucket', {
            cors: [{
                allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
                allowedOrigins: ['*'], // Locked down via Presigned URL signature logic
                allowedHeaders: ['*'],
            }],
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for prod
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });

        // 2. Delivery (CDN)
        this.distribution = new cloudfront.Distribution(this, 'AssetsDistribution', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            },
        });

        new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.bucket.bucketName });
        new cdk.CfnOutput(this, 'AssetsCdnUrl', { value: `https://${this.distribution.distributionDomainName}` });
    }
}
