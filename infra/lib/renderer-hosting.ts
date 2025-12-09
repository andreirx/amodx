import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';
import { execSync } from 'child_process';

interface RendererHostingProps {
    table: dynamodb.Table;
}

export class RendererHosting extends Construct {
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: RendererHostingProps) {
        super(scope, id);

        // 1. Build Next.js with OpenNext
        const rendererPath = path.join(__dirname, '../../renderer');
        const openNextPath = path.join(rendererPath, '.open-next');

        console.log("Building Renderer with OpenNext...");
        try {
            execSync('npm run build:open', {
                cwd: rendererPath,
                stdio: 'inherit',
                env: { ...process.env }
            });
        } catch (e) {
            console.error("Failed to build Renderer");
            throw e;
        }

        // 2. Asset Bucket (Public files)
        const assetBucket = new s3.Bucket(this, 'RendererAssets', {
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            publicReadAccess: false,
        });

        // 3. The Server Lambda
        const serverFunction = new lambda.Function(this, 'RendererServer', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(openNextPath, 'server-functions/default')),
            architecture: lambda.Architecture.ARM_64,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(15),
            environment: {
                NODE_ENV: 'production',
                TABLE_NAME: props.table.tableName,
                CACHE_BUCKET_NAME: assetBucket.bucketName,
                CACHE_BUCKET_KEY_PREFIX: '_cache',
                CACHE_BUCKET_REGION: cdk.Stack.of(this).region,
            },
        });

        // Grant Permissions
        props.table.grantReadData(serverFunction);
        assetBucket.grantReadWrite(serverFunction);

        // 4. Lambda Function URL
        const fnUrl = serverFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,
        });

        // 5. CloudFront Function to preserve original Host header
        // This copies the viewer's Host header to X-Forwarded-Host before CloudFront replaces it
        const hostRewriteFunction = new cloudfront.Function(this, 'HostRewriteFunction', {
            functionName: `${cdk.Stack.of(this).stackName}-HostRewrite`,
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    request.headers['x-forwarded-host'] = { value: host };
    return request;
}
            `),
        });

        // 6. Custom Origin Request Policy that forwards X-Forwarded-Host
        const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'RendererOriginPolicy', {
            originRequestPolicyName: `${cdk.Stack.of(this).stackName}-RendererOriginPolicy`,
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
                'Accept',
                'Accept-Language',
                'Content-Type',
                'X-Forwarded-Host'
            ),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        });

        // 7. CloudFront Distribution
        this.distribution = new cloudfront.Distribution(this, 'RendererDistribution', {
            defaultBehavior: {
                origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(fnUrl.url)),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: originRequestPolicy,  // <-- Custom policy
                functionAssociations: [{
                    function: hostRewriteFunction,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,  // <-- Runs before origin
                }],
            },
            additionalBehaviors: {
                '_next/static/*': {
                    origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                },
                'assets/*': {
                    origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                },
                'favicon.ico': {
                    origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                }
            }
        });

        // 8. Upload Assets to S3
        new s3deploy.BucketDeployment(this, 'DeployRendererAssets', {
            sources: [s3deploy.Source.asset(path.join(openNextPath, 'assets'))],
            destinationBucket: assetBucket,
            distribution: this.distribution,
            prune: false,
        });

        // Output
        new cdk.CfnOutput(this, 'RendererUrl', { value: `https://${this.distribution.distributionDomainName}` });
    }
}
