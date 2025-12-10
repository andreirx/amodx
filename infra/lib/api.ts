import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'; // Import Secrets Manager
// Import the Authorizer and the ResponseType Enum
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

interface AmodxApiProps {
    table: dynamodb.Table;
    userPoolId: string;
    userPoolClientId: string;
    masterKeySecret: secretsmanager.ISecret;
}

export class AmodxApi extends Construct {
    public readonly httpApi: apigw.HttpApi;

    constructor(scope: Construct, id: string, props: AmodxApiProps) {
        super(scope, id);

        // 1. Authorizer Lambda
        const authorizerFunc = new nodejs.NodejsFunction(this, 'AuthorizerFunc', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../backend/src/auth/authorizer.ts'),
            handler: 'handler',
            environment: {
                USER_POOL_ID: props.userPoolId,
                USER_POOL_CLIENT_ID: props.userPoolClientId,
                MASTER_KEY_SECRET_NAME: props.masterKeySecret.secretName,
            },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });

        // Grant Lambda permission to read the secret
        props.masterKeySecret.grantRead(authorizerFunc);

        // 2. Define Authorizer
        // FIXED: Used HttpLambdaResponseType
        const authorizer = new HttpLambdaAuthorizer('AmodxAuthorizer', authorizerFunc, {
            responseTypes: [HttpLambdaResponseType.SIMPLE],
            resultsCacheTtl: cdk.Duration.minutes(0), // Set to 0 for debugging, 5 for prod
            identitySource: ['$request.header.Authorization', '$request.header.x-api-key'],
        });

        // 3. HTTP API
        this.httpApi = new apigw.HttpApi(this, 'AmodxHttpApi', {
            defaultAuthorizer: authorizer,
            corsPreflight: {
                allowOrigins: ['*'], // Temporary wildcard until Custom Domains
                allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
                allowHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-api-key'],
            },
        });

        // --- SHARED PROPS ---
        const nodeProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        };

        // =========================================================
        // 1. CONTENT API
        // =========================================================
        const createContentFunc = new nodejs.NodejsFunction(this, 'CreateContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createContentFunc);

        const listContentFunc = new nodejs.NodejsFunction(this, 'ListContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listContentFunc);

        const getContentFunc = new nodejs.NodejsFunction(this, 'GetContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getContentFunc);

        const updateContentFunc = new nodejs.NodejsFunction(this, 'UpdateContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateContentFunc);

        this.httpApi.addRoutes({
            path: '/content',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateContentInt', createContentFunc),
        });
        this.httpApi.addRoutes({
            path: '/content',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListContentInt', listContentFunc),
        });
        this.httpApi.addRoutes({
            path: '/content/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetContentInt', getContentFunc),
        });
        this.httpApi.addRoutes({
            path: '/content/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateContentInt', updateContentFunc),
        });

        // =========================================================
        // 2. CONTEXT API (Strategy)
        // =========================================================
        const createContextFunc = new nodejs.NodejsFunction(this, 'CreateContextFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/context/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createContextFunc);

        const listContextFunc = new nodejs.NodejsFunction(this, 'ListContextFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/context/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listContextFunc);

        // MISSING: Update/Delete Context - Adding placeholders or actual implementations
        // Note: You need to create these files in backend/src/context/
        const updateContextFunc = new nodejs.NodejsFunction(this, 'UpdateContextFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/context/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateContextFunc);

        const deleteContextFunc = new nodejs.NodejsFunction(this, 'DeleteContextFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/context/delete.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(deleteContextFunc);

        const getContextFunc = new nodejs.NodejsFunction(this, 'GetContextFunc', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../backend/src/context/get.ts'),
            handler: 'handler',
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });
        props.table.grantReadData(getContextFunc);


        this.httpApi.addRoutes({
            path: '/context',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateContextInt', createContextFunc),
        });
        this.httpApi.addRoutes({
            path: '/context',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListContextInt', listContextFunc),
        });
        this.httpApi.addRoutes({
            path: '/context/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateContextInt', updateContextFunc),
        });
        this.httpApi.addRoutes({
            path: '/context/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteContextInt', deleteContextFunc),
        });
        this.httpApi.addRoutes({
            path: '/context/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetContextInt', getContextFunc),
        });

        // =========================================================
        // 3. SETTINGS & TENANTS API
        // =========================================================
        const getSettingsFunc = new nodejs.NodejsFunction(this, 'GetSettingsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/tenant/settings.ts'),
            handler: 'getHandler',
        });
        props.table.grantReadData(getSettingsFunc);

        const updateSettingsFunc = new nodejs.NodejsFunction(this, 'UpdateSettingsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/tenant/settings.ts'),
            handler: 'updateHandler',
        });
        props.table.grantReadWriteData(updateSettingsFunc);

        this.httpApi.addRoutes({
            path: '/settings',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetSettingsInt', getSettingsFunc),
        });
        this.httpApi.addRoutes({
            path: '/settings',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateSettingsInt', updateSettingsFunc),
        });

        // Tenant Management (Create New Site, List Sites)
        const createTenantFunc = new nodejs.NodejsFunction(this, 'CreateTenantFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/tenant/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createTenantFunc);

        const listTenantFunc = new nodejs.NodejsFunction(this, 'ListTenantFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/tenant/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listTenantFunc);

        this.httpApi.addRoutes({
            path: '/tenants',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateTenantInt', createTenantFunc),
        });
        this.httpApi.addRoutes({
            path: '/tenants',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListTenantInt', listTenantFunc),
        });

        new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.url || '' });
    }
}
