import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface ConfigGeneratorProps {
    bucket: s3.Bucket;
    config: Record<string, string>;
}

export class ConfigGenerator extends Construct {
    constructor(scope: Construct, id: string, props: ConfigGeneratorProps) {
        super(scope, id);

        new cr.AwsCustomResource(this, 'WriteConfigJson', {
            onUpdate: {
                service: 'S3',
                action: 'putObject',
                parameters: {
                    Body: JSON.stringify(props.config),
                    Bucket: props.bucket.bucketName,
                    Key: 'config.json',
                    ContentType: 'application/json',
                    CacheControl: 'max-age=0, no-cache, no-store, must-revalidate', // Never cache config
                },
                physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update every deploy
            },
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                resources: [props.bucket.bucketArn, `${props.bucket.bucketArn}/*`],
            }),
        });
    }
}
