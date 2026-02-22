import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// Define Props Interface
interface AmodxAuthProps {
    nameSuffix: string;
    sesEmail?: string;     // Verified SES email for Cognito to send from
    sesRegion?: string;    // Region where SES identity is verified
    adminUrl?: string;     // Admin panel URL for invite emails
}

export class AmodxAuth extends Construct {
    public readonly adminPool: cognito.UserPool;
    public readonly adminClient: cognito.UserPoolClient;

    public readonly publicPool: cognito.UserPool;
    public readonly publicClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string, props?: AmodxAuthProps) {
        super(scope, id);

        const suffix = props?.nameSuffix || '';
        const sesEmail = props?.sesEmail;
        const sesRegion = props?.sesRegion;
        const adminUrl = props?.adminUrl || 'the admin panel';

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

            // Custom invite email (replaces Cognito's bare default)
            userInvitation: {
                emailSubject: 'You have been invited to the AMODX Admin Panel',
                emailBody: [
                    'Hello,',
                    '',
                    'You have been invited to manage your website on the AMODX platform.',
                    '',
                    'Your login credentials:',
                    'Email: {username}',
                    'Temporary password: {####}',
                    '',
                    `Sign in at: ${adminUrl}`,
                    '',
                    'You will be asked to set a new password on your first login.',
                    '',
                    'Best regards,',
                    'The AMODX Team',
                ].join('\n'),
            },

            // Send from verified SES identity instead of Cognito default
            ...(sesEmail && sesRegion ? {
                email: cognito.UserPoolEmail.withSES({
                    fromEmail: sesEmail,
                    fromName: 'AMODX',
                    sesRegion: sesRegion,
                }),
            } : {}),
        });

        this.adminClient = this.adminPool.addClient('AmodxAdminClient', {
            userPoolClientName: `amodx-admin-client${suffix}`,
            generateSecret: false,
            authFlows: {
                userSrp: true,
                custom: true,
            },
            // NEW: Security Hardening
            accessTokenValidity: cdk.Duration.minutes(60), // Short-lived access
            idTokenValidity: cdk.Duration.minutes(60),     // Short-lived identity
            refreshTokenValidity: cdk.Duration.days(7),    // Force re-login every 7 days
            enableTokenRevocation: true,                   // Allow admin to kill sessions remotely
            preventUserExistenceErrors: true               // Don't reveal if email exists on failed login
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
