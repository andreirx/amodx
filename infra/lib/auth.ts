import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// Define Props Interface
interface AmodxAuthProps {
    nameSuffix: string;
}

export class AmodxAuth extends Construct {
    public readonly adminPool: cognito.UserPool;
    public readonly adminClient: cognito.UserPoolClient;

    public readonly publicPool: cognito.UserPool;
    public readonly publicClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string, props?: AmodxAuthProps) {
        super(scope, id);

        const suffix = props?.nameSuffix || '';

        // ==========================================
        // 1. ADMIN POOL (Agency Owners)
        // ==========================================
        this.adminPool = new cognito.UserPool(scope, 'AmodxAdminPool', {
            userPoolName: `amodx-admin-pool${suffix}`,
            selfSignUpEnabled: false, // Strict Invite Only
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: { minLength: 8, requireSymbols: false },
            customAttributes: {
                'role': new cognito.StringAttribute({ mutable: true }),
                'tenantId': new cognito.StringAttribute({ mutable: true }),
            },
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.adminClient = this.adminPool.addClient('AmodxAdminClient', {
            userPoolClientName: `amodx-admin-client${suffix}`,
            generateSecret: false,
            authFlows: {
                userSrp: true,
                custom: true,
            },
        });

        // ==========================================
        // 2. PUBLIC POOL (Tenant Visitors)
        // ==========================================
        this.publicPool = new cognito.UserPool(scope, 'AmodxPublicPool', {
            userPoolName: `amodx-public-pool${suffix}`,
            selfSignUpEnabled: true, // Allow visitors to register
            signInAliases: { email: true, username: true }, // We will use custom usernames
            autoVerify: { email: true },
            passwordPolicy: { minLength: 6, requireSymbols: false },
            // We need custom attributes to know WHICH tenant they belong to
            customAttributes: {
                'tenant_id': new cognito.StringAttribute({ mutable: true }),
            },
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Change to RETAIN for prod
        });

        this.publicClient = this.publicPool.addClient('AmodxPublicClient', {
            userPoolClientName: `amodx-public-client${suffix}`,
            generateSecret: false, // NextAuth runs client-side/edge compatible
            authFlows: {
                userSrp: true,
                custom: true,
            },
        });
    }
}
