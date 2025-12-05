import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AmodxAuth extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // 1. The User Pool (Directory of Users)
        this.userPool = new cognito.UserPool(scope, 'AmodxUserPool', {
            selfSignUpEnabled: false, // You invite Agency Owners manually
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                minLength: 8,
                requireSymbols: false,
            },
            customAttributes: {
                'tenant_id': new cognito.StringAttribute({ mutable: true }),
                'role': new cognito.StringAttribute({ mutable: true }),
            },
        });

        // 2. The Client (What the Admin UI uses to talk to Cognito)
        this.userPoolClient = this.userPool.addClient('AmodxAdminClient', {
            oAuth: {
                flows: {
                    implicitCodeGrant: true, // For SPA
                },
            },
            authFlows: {
                userSrp: true,
            },
        });
    }
}
