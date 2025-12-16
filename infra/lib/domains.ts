import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

interface AmodxDomainsProps {
    domainName: string;
}

export class AmodxDomains extends Construct {
    public readonly zone: route53.IHostedZone;
    public readonly globalCertificate: acm.ICertificate;   // For CloudFront (us-east-1)
    public readonly regionalCertificate: acm.ICertificate; // For API Gateway (eu-central-1)

    constructor(scope: Construct, id: string, props: AmodxDomainsProps) {
        super(scope, id);

        // 1. Lookup Hosted Zone
        this.zone = route53.HostedZone.fromLookup(this, 'Zone', {
            domainName: props.domainName,
        });

        // 2. Global Certificate (US-EAST-1) -> For CloudFront
        this.globalCertificate = new acm.DnsValidatedCertificate(this, 'GlobalCertificate', {
            domainName: props.domainName,
            subjectAlternativeNames: [`*.${props.domainName}`],
            hostedZone: this.zone,
            region: 'us-east-1', // <--- Explicit for CloudFront
        });

        // 3. Regional Certificate (Current Region) -> For API Gateway
        // We use the standard Certificate construct which defaults to the stack's region
        this.regionalCertificate = new acm.Certificate(this, 'RegionalCertificate', {
            domainName: props.domainName,
            subjectAlternativeNames: [`*.${props.domainName}`],
            validation: acm.CertificateValidation.fromDns(this.zone),
        });

        new cdk.CfnOutput(this, 'GlobalCertArn', { value: this.globalCertificate.certificateArn });
        new cdk.CfnOutput(this, 'RegionalCertArn', { value: this.regionalCertificate.certificateArn });
    }
}
