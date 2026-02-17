import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

interface AmodxApiProps {
    table: dynamodb.Table;
    userPoolId: string;
    userPoolClientId: string;
    masterKeySecret: secretsmanager.ISecret;
    uploadsBucket: s3.IBucket;
    privateBucket: s3.IBucket;
    uploadsCdnUrl: string;
    eventBus: events.IEventBus;
    sesEmail: string;
    adminDomain?: string;
}

export class AmodxApi extends Construct {
    public readonly httpApi: apigw.HttpApi;
    public readonly authorizerFuncArn: string;

    constructor(scope: Construct, id: string, props: AmodxApiProps) {
        super(scope, id);

        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5173'
        ];

        if (props.adminDomain) {
            allowedOrigins.push(`https://${props.adminDomain}`);
        } else {
            allowedOrigins.push('*');
        }

        // 1. Authorizer
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
        props.masterKeySecret.grantRead(authorizerFunc);

        const authorizer = new HttpLambdaAuthorizer('AmodxAuthorizer', authorizerFunc, {
            responseTypes: [HttpLambdaResponseType.SIMPLE],
            resultsCacheTtl: cdk.Duration.minutes(0),
            identitySource: ['$request.header.Authorization', '$request.header.x-api-key'],
        });
        this.authorizerFuncArn = authorizerFunc.functionArn;

        // 2. HTTP API
        this.httpApi = new apigw.HttpApi(this, 'AmodxHttpApi', {
            defaultAuthorizer: authorizer,
            corsPreflight: {
                allowOrigins: allowedOrigins,
                allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
                allowHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-api-key'],
            },
        });

        // --- SHARED PROPS (THE FIX) ---
        const nodeProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            environment: {
                TABLE_NAME: props.table.tableName,
                EVENT_BUS_NAME: props.eventBus.eventBusName
            },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
            memorySize: 1024,           // <--- 1024MB RAM
            timeout: cdk.Duration.seconds(29), // <--- 29s Timeout
        };

        // --- CONTENT API ---
        const createContentFunc = new nodejs.NodejsFunction(this, 'CreateContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createContentFunc);

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

        // History & Restore
        const listHistoryFunc = new nodejs.NodejsFunction(this, 'ListHistoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/history.ts'),
            handler: 'listVersionsHandler',
        });
        props.table.grantReadData(listHistoryFunc);

        const restoreContentFunc = new nodejs.NodejsFunction(this, 'RestoreContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/restore.ts'),
            handler: 'restoreHandler',
        });
        props.table.grantReadWriteData(restoreContentFunc);

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
        this.httpApi.addRoutes({
            path: '/content/{id}/versions',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListHistoryInt', listHistoryFunc),
        });
        this.httpApi.addRoutes({
            path: '/content/{id}/restore',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('RestoreContentInt', restoreContentFunc),
        });

        // --- CONTEXT API ---
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
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/context/get.ts'),
            handler: 'handler',
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

        // --- SETTINGS ---
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

        // --- CONTACT ---
        const contactFunc = new nodejs.NodejsFunction(this, 'ContactFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/contact/send.ts'),
            handler: 'handler',
            environment: {
                ...nodeProps.environment,
                SES_FROM_EMAIL: props.sesEmail,
            }
        });
        contactFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
        }));
        props.table.grantReadData(contactFunc);

        this.httpApi.addRoutes({
            path: '/contact',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('ContactInt', contactFunc),
        });

        // --- CONSENT ---
        const consentFunc = new nodejs.NodejsFunction(this, 'ConsentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/consent/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(consentFunc);

        this.httpApi.addRoutes({
            path: '/consent',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('ConsentInt', consentFunc),
        });

        // --- IMPORT ---
        const importFunc = new nodejs.NodejsFunction(this, 'ImportFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/import/wordpress.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(15),
            memorySize: 3008,
            environment: {
                ...nodeProps.environment,
                UPLOADS_BUCKET: props.uploadsBucket.bucketName,
                UPLOADS_CDN_URL: props.uploadsCdnUrl,
            }
        });
        props.table.grantReadWriteData(importFunc);
        props.uploadsBucket.grantReadWrite(importFunc);

        this.httpApi.addRoutes({
            path: '/import/wordpress',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('ImportInt', importFunc),
        });

        // --- TENANTS ---
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

        // --- ASSETS ---
        const createAssetFunc = new nodejs.NodejsFunction(this, 'CreateAssetFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/assets/create.ts'),
            handler: 'handler',
            environment: {
                ...nodeProps.environment,
                UPLOADS_BUCKET: props.uploadsBucket.bucketName,
                UPLOADS_CDN_URL: props.uploadsCdnUrl,
            }
        });
        props.table.grantWriteData(createAssetFunc);
        props.uploadsBucket.grantPut(createAssetFunc);

        const listAssetFunc = new nodejs.NodejsFunction(this, 'ListAssetFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/assets/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listAssetFunc);

        this.httpApi.addRoutes({
            path: '/assets',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateAssetInt', createAssetFunc),
        });
        this.httpApi.addRoutes({
            path: '/assets',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListAssetInt', listAssetFunc),
        });

        // --- AUDIT ---
        const listAuditFunc = new nodejs.NodejsFunction(this, 'ListAuditFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/audit/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listAuditFunc);

        // --- CONTENT GRAPH ---
        // Ensure this uses nodeProps with the 1024MB RAM
        const graphFunc = new nodejs.NodejsFunction(this, 'ContentGraphFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/audit/graph.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(graphFunc);

        this.httpApi.addRoutes({
            path: '/audit',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListAuditInt', listAuditFunc),
        });
        this.httpApi.addRoutes({
            path: '/audit/graph',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ContentGraphInt', graphFunc),
        });

        // --- RESOURCES ---
        const resourceEnv = {
            TABLE_NAME: props.table.tableName,
            PRIVATE_BUCKET: props.privateBucket.bucketName,
        };

        const createResourceFunc = new nodejs.NodejsFunction(this, 'CreateResourceFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/resources/presign.ts'),
            handler: 'uploadHandler',
            environment: resourceEnv,
        });
        props.privateBucket.grantPut(createResourceFunc);
        props.table.grantWriteData(createResourceFunc);

        const getResourceFunc = new nodejs.NodejsFunction(this, 'GetResourceFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/resources/presign.ts'),
            handler: 'downloadHandler',
            environment: resourceEnv,
        });
        props.privateBucket.grantRead(getResourceFunc);
        props.table.grantReadData(getResourceFunc);

        const listResourcesFunc = new nodejs.NodejsFunction(this, 'ListResourcesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/resources/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listResourcesFunc);

        this.httpApi.addRoutes({
            path: '/resources/list',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListResourcesInt', listResourcesFunc),
        });
        this.httpApi.addRoutes({
            path: '/resources/upload',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('UploadResourceInt', createResourceFunc),
        });
        this.httpApi.addRoutes({
            path: '/resources/{id}/download',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('DownloadResourceInt', getResourceFunc),
        });

        // --- LEADS ---
        const createLeadFunc = new nodejs.NodejsFunction(this, 'CreateLeadFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/leads/create.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.table.tableName,
                PRIVATE_BUCKET: props.privateBucket.bucketName,
            }
        });
        props.table.grantWriteData(createLeadFunc);
        props.table.grantReadData(createLeadFunc);
        props.privateBucket.grantRead(createLeadFunc);

        const listLeadsFunc = new nodejs.NodejsFunction(this, 'ListLeadsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/leads/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listLeadsFunc);

        this.httpApi.addRoutes({
            path: '/leads',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateLeadInt', createLeadFunc),
        });
        this.httpApi.addRoutes({
            path: '/leads',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListLeadsInt', listLeadsFunc),
        });

        // --- COMMENTS ---
        const listCommentsFunc = new nodejs.NodejsFunction(this, 'ListCommentsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/comments/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listCommentsFunc);

        const createCommentFunc = new nodejs.NodejsFunction(this, 'CreateCommentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/comments/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createCommentFunc);

        const moderateCommentFunc = new nodejs.NodejsFunction(this, 'ModerateCommentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/comments/moderate.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(moderateCommentFunc);

        this.httpApi.addRoutes({
            path: '/comments',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListCommentsInt', listCommentsFunc),
        });
        this.httpApi.addRoutes({
            path: '/comments',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateCommentInt', createCommentFunc),
        });
        this.httpApi.addRoutes({
            path: '/comments',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('ModerateCommentInt', moderateCommentFunc),
        });

        // --- PRODUCTS ---
        const createProductFunc = new nodejs.NodejsFunction(this, 'CreateProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createProductFunc);

        const listProductsFunc = new nodejs.NodejsFunction(this, 'ListProductsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listProductsFunc);

        const getProductFunc = new nodejs.NodejsFunction(this, 'GetProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getProductFunc);

        const updateProductFunc = new nodejs.NodejsFunction(this, 'UpdateProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateProductFunc);

        const deleteProductFunc = new nodejs.NodejsFunction(this, 'DeleteProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/delete.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(deleteProductFunc);

        this.httpApi.addRoutes({
            path: '/products',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateProductInt', createProductFunc),
        });
        this.httpApi.addRoutes({
            path: '/products',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListProductsInt', listProductsFunc),
        });
        this.httpApi.addRoutes({
            path: '/products/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetProductInt', getProductFunc),
        });
        this.httpApi.addRoutes({
            path: '/products/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateProductInt', updateProductFunc),
        });
        this.httpApi.addRoutes({
            path: '/products/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteProductInt', deleteProductFunc),
        });

        // --- USERS ---
        const listUsersFunc = new nodejs.NodejsFunction(this, 'ListUsersFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/users/list.ts'),
            handler: 'handler',
            environment: {
                USER_POOL_ID: props.userPoolId,
            }
        });
        listUsersFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:ListUsers'],
            resources: [`arn:aws:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/${props.userPoolId}`],
        }));

        const inviteUserFunc = new nodejs.NodejsFunction(this, 'InviteUserFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/users/invite.ts'),
            handler: 'handler',
            environment: {
                USER_POOL_ID: props.userPoolId,
            }
        });
        inviteUserFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cognito-idp:AdminCreateUser'],
            resources: [`arn:aws:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/${props.userPoolId}`],
        }));

        this.httpApi.addRoutes({
            path: '/users',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListUsersInt', listUsersFunc),
        });
        this.httpApi.addRoutes({
            path: '/users',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('InviteUserInt', inviteUserFunc),
        });

        // --- WEBHOOKS ---
        const paddleFunc = new nodejs.NodejsFunction(this, 'PaddleWebhookFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/webhooks/paddle.ts'),
            handler: 'handler',
            environment: {
                SES_FROM_EMAIL: props.sesEmail,
                PRIVATE_BUCKET: props.privateBucket.bucketName
            }
        });
        props.privateBucket.grantRead(paddleFunc);
        props.table.grantReadData(paddleFunc);
        paddleFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
        }));

        this.httpApi.addRoutes({
            path: '/webhooks/paddle',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('PaddleInt', paddleFunc),
        });

        // --- SIGNALS ---
        const createSignalFunc = new nodejs.NodejsFunction(this, 'CreateSignalFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/signals/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createSignalFunc);

        const listSignalFunc = new nodejs.NodejsFunction(this, 'ListSignalFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/signals/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listSignalFunc);

        const updateSignalFunc = new nodejs.NodejsFunction(this, 'UpdateSignalFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/signals/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateSignalFunc);

        this.httpApi.addRoutes({
            path: '/signals',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateSignalInt', createSignalFunc),
        });
        this.httpApi.addRoutes({
            path: '/signals',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListSignalInt', listSignalFunc),
        });
        this.httpApi.addRoutes({
            path: '/signals/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateSignalInt', updateSignalFunc),
        });

        // --- RESEARCH ---
        const researchSearchFunc = new nodejs.NodejsFunction(this, 'ResearchSearchFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/research/search.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(researchSearchFunc);

        this.httpApi.addRoutes({
            path: '/research/search',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('ResearchSearchInt', researchSearchFunc),
        });

        // --- THEMES ---
        const createThemeFunc = new nodejs.NodejsFunction(this, 'CreateThemeFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/themes/manage.ts'),
            handler: 'createHandler',
        });
        props.table.grantWriteData(createThemeFunc);

        const listThemesFunc = new nodejs.NodejsFunction(this, 'ListThemesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/themes/manage.ts'),
            handler: 'listHandler',
        });
        props.table.grantReadData(listThemesFunc);

        const deleteThemeFunc = new nodejs.NodejsFunction(this, 'DeleteThemeFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/themes/manage.ts'),
            handler: 'deleteHandler',
        });
        props.table.grantWriteData(deleteThemeFunc);

        this.httpApi.addRoutes({
            path: '/themes',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateThemeInt', createThemeFunc),
        });
        this.httpApi.addRoutes({
            path: '/themes',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListThemeInt', listThemesFunc),
        });
        this.httpApi.addRoutes({
            path: '/themes/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteThemeInt', deleteThemeFunc),
        });

        // Grant EventBus Permissions to ALL Lambdas
        this.node.children.forEach(child => {
            if (child instanceof nodejs.NodejsFunction) {
                props.eventBus.grantPutEventsTo(child);
            }
        });

        new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.url || '' });
    }
}
