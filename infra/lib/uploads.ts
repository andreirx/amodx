import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export class AmodxUploads extends Construct {
    public readonly bucket: s3.Bucket;
    public readonly privateBucket: s3.Bucket; // <--- NEW
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // 1. Public Storage (Images)
        this.bucket = new s3.Bucket(this, 'AssetsBucket', {
            cors: [{
                allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
                allowedOrigins: ['*'],
                allowedHeaders: ['*'],
            }],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });

        // 2. Private Storage (PDFs, Zip files for products)
        this.privateBucket = new s3.Bucket(this, 'PrivateAssetsBucket', {
            cors: [{
                allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
                allowedOrigins: ['*'], // Admin panel needs to PUT
                allowedHeaders: ['*'],
            }],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // No Public Access
            // No CloudFront Origin Access - only Lambda Signed URLs
        });

        // 3. Delivery (CDN for Public Bucket ONLY)
        this.distribution = new cloudfront.Distribution(this, 'AssetsDistribution', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
        });

        new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.bucket.bucketName });
        new cdk.CfnOutput(this, 'PrivateBucketName', { value: this.privateBucket.bucketName }); // Output this
        new cdk.CfnOutput(this, 'AssetsCdnUrl', { value: `https://${this.distribution.distributionDomainName}` });
    }
}
