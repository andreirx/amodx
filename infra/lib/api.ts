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
        props.table.grantWriteData(deleteProductFunc);

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

        // --- CATEGORIES ---
        const createCategoryFunc = new nodejs.NodejsFunction(this, 'CreateCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createCategoryFunc);

        const listCategoriesFunc = new nodejs.NodejsFunction(this, 'ListCategoriesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listCategoriesFunc);

        const getCategoryFunc = new nodejs.NodejsFunction(this, 'GetCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getCategoryFunc);

        const updateCategoryFunc = new nodejs.NodejsFunction(this, 'UpdateCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateCategoryFunc);

        const deleteCategoryFunc = new nodejs.NodejsFunction(this, 'DeleteCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/delete.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(deleteCategoryFunc);

        this.httpApi.addRoutes({
            path: '/categories',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateCategoryInt', createCategoryFunc),
        });
        this.httpApi.addRoutes({
            path: '/categories',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListCategoriesInt', listCategoriesFunc),
        });
        this.httpApi.addRoutes({
            path: '/categories/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetCategoryInt', getCategoryFunc),
        });
        this.httpApi.addRoutes({
            path: '/categories/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateCategoryInt', updateCategoryFunc),
        });
        this.httpApi.addRoutes({
            path: '/categories/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteCategoryInt', deleteCategoryFunc),
        });

        // --- PUBLIC API (No Auth) ---
        const noAuth = new apigw.HttpNoneAuthorizer();

        const publicListProductsFunc = new nodejs.NodejsFunction(this, 'PublicListProductsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/public-list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicListProductsFunc);

        const publicGetProductFunc = new nodejs.NodejsFunction(this, 'PublicGetProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/public-get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicGetProductFunc);

        const publicListCategoriesFunc = new nodejs.NodejsFunction(this, 'PublicListCategoriesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/public-list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicListCategoriesFunc);

        const publicGetCategoryFunc = new nodejs.NodejsFunction(this, 'PublicGetCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/public-get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicGetCategoryFunc);

        this.httpApi.addRoutes({
            path: '/public/products',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicListProductsInt', publicListProductsFunc),
            authorizer: noAuth,
        });
        this.httpApi.addRoutes({
            path: '/public/products/{slug}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicGetProductInt', publicGetProductFunc),
            authorizer: noAuth,
        });
        this.httpApi.addRoutes({
            path: '/public/categories',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicListCategoriesInt', publicListCategoriesFunc),
            authorizer: noAuth,
        });
        this.httpApi.addRoutes({
            path: '/public/categories/{slug}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicGetCategoryInt', publicGetCategoryFunc),
            authorizer: noAuth,
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

        // --- ORDERS ---
        const createOrderFunc = new nodejs.NodejsFunction(this, 'CreateOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createOrderFunc);

        const listOrdersFunc = new nodejs.NodejsFunction(this, 'ListOrdersFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listOrdersFunc);

        const getOrderFunc = new nodejs.NodejsFunction(this, 'GetOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getOrderFunc);

        const updateOrderStatusFunc = new nodejs.NodejsFunction(this, 'UpdateOrderStatusFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/update-status.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateOrderStatusFunc);

        const updateOrderFunc = new nodejs.NodejsFunction(this, 'UpdateOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateOrderFunc);

        const publicGetOrderFunc = new nodejs.NodejsFunction(this, 'PublicGetOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/public-get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicGetOrderFunc);

        this.httpApi.addRoutes({
            path: '/orders',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListOrdersInt', listOrdersFunc),
        });
        this.httpApi.addRoutes({
            path: '/orders/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetOrderInt', getOrderFunc),
        });
        this.httpApi.addRoutes({
            path: '/orders/{id}/status',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateOrderStatusInt', updateOrderStatusFunc),
        });
        this.httpApi.addRoutes({
            path: '/orders/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateOrderInt', updateOrderFunc),
        });

        // Public order routes (no auth)
        this.httpApi.addRoutes({
            path: '/public/orders',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateOrderInt', createOrderFunc),
            authorizer: noAuth,
        });
        this.httpApi.addRoutes({
            path: '/public/orders/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicGetOrderInt', publicGetOrderFunc),
            authorizer: noAuth,
        });

        // --- CUSTOMERS ---
        const listCustomersFunc = new nodejs.NodejsFunction(this, 'ListCustomersFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listCustomersFunc);

        const getCustomerFunc = new nodejs.NodejsFunction(this, 'GetCustomerFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getCustomerFunc);

        const updateCustomerFunc = new nodejs.NodejsFunction(this, 'UpdateCustomerFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateCustomerFunc);

        this.httpApi.addRoutes({
            path: '/customers',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListCustomersInt', listCustomersFunc),
        });
        this.httpApi.addRoutes({
            path: '/customers/{email}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetCustomerInt', getCustomerFunc),
        });
        this.httpApi.addRoutes({
            path: '/customers/{email}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateCustomerInt', updateCustomerFunc),
        });

        // --- DELIVERY ---
        const getDeliveryConfigFunc = new nodejs.NodejsFunction(this, 'GetDeliveryConfigFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getDeliveryConfigFunc);

        const updateDeliveryConfigFunc = new nodejs.NodejsFunction(this, 'UpdateDeliveryConfigFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateDeliveryConfigFunc);

        const availableDatesFunc = new nodejs.NodejsFunction(this, 'AvailableDatesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/available-dates.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(availableDatesFunc);

        this.httpApi.addRoutes({
            path: '/delivery/config',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetDeliveryConfigInt', getDeliveryConfigFunc),
        });
        this.httpApi.addRoutes({
            path: '/delivery/config',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateDeliveryConfigInt', updateDeliveryConfigFunc),
        });
        this.httpApi.addRoutes({
            path: '/public/delivery/dates',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('AvailableDatesInt', availableDatesFunc),
            authorizer: noAuth,
        });

        // --- COUPONS ---
        const createCouponFunc = new nodejs.NodejsFunction(this, 'CreateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createCouponFunc);

        const listCouponsFunc = new nodejs.NodejsFunction(this, 'ListCouponsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listCouponsFunc);

        const getCouponFunc = new nodejs.NodejsFunction(this, 'GetCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getCouponFunc);

        const updateCouponFunc = new nodejs.NodejsFunction(this, 'UpdateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateCouponFunc);

        const deleteCouponFunc = new nodejs.NodejsFunction(this, 'DeleteCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/delete.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(deleteCouponFunc);

        const validateCouponFunc = new nodejs.NodejsFunction(this, 'ValidateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/public-validate.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(validateCouponFunc);

        this.httpApi.addRoutes({
            path: '/coupons',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateCouponInt', createCouponFunc),
        });
        this.httpApi.addRoutes({
            path: '/coupons',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListCouponsInt', listCouponsFunc),
        });
        this.httpApi.addRoutes({
            path: '/coupons/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetCouponInt', getCouponFunc),
        });
        this.httpApi.addRoutes({
            path: '/coupons/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateCouponInt', updateCouponFunc),
        });
        this.httpApi.addRoutes({
            path: '/coupons/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteCouponInt', deleteCouponFunc),
        });
        this.httpApi.addRoutes({
            path: '/public/coupons/validate',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('ValidateCouponInt', validateCouponFunc),
            authorizer: noAuth,
        });

        // --- REVIEWS ---
        const createReviewFunc = new nodejs.NodejsFunction(this, 'CreateReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createReviewFunc);

        const listReviewsFunc = new nodejs.NodejsFunction(this, 'ListReviewsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listReviewsFunc);

        const updateReviewFunc = new nodejs.NodejsFunction(this, 'UpdateReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateReviewFunc);

        const deleteReviewFunc = new nodejs.NodejsFunction(this, 'DeleteReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/delete.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(deleteReviewFunc);

        const publicListReviewsFunc = new nodejs.NodejsFunction(this, 'PublicListReviewsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/public-list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicListReviewsFunc);

        this.httpApi.addRoutes({
            path: '/reviews',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateReviewInt', createReviewFunc),
        });
        this.httpApi.addRoutes({
            path: '/reviews',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListReviewsInt', listReviewsFunc),
        });
        this.httpApi.addRoutes({
            path: '/reviews/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateReviewInt', updateReviewFunc),
        });
        this.httpApi.addRoutes({
            path: '/reviews/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteReviewInt', deleteReviewFunc),
        });
        this.httpApi.addRoutes({
            path: '/public/reviews/{productId}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicListReviewsInt', publicListReviewsFunc),
            authorizer: noAuth,
        });

        // --- POPUPS ---
        const createPopupFunc = new nodejs.NodejsFunction(this, 'CreatePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/create.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(createPopupFunc);

        const listPopupsFunc = new nodejs.NodejsFunction(this, 'ListPopupsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listPopupsFunc);

        const getPopupFunc = new nodejs.NodejsFunction(this, 'GetPopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getPopupFunc);

        const updatePopupFunc = new nodejs.NodejsFunction(this, 'UpdatePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updatePopupFunc);

        const deletePopupFunc = new nodejs.NodejsFunction(this, 'DeletePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/delete.ts'),
            handler: 'handler',
        });
        props.table.grantWriteData(deletePopupFunc);

        const publicListPopupsFunc = new nodejs.NodejsFunction(this, 'PublicListPopupsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/public-list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(publicListPopupsFunc);

        this.httpApi.addRoutes({
            path: '/popups',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreatePopupInt', createPopupFunc),
        });
        this.httpApi.addRoutes({
            path: '/popups',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListPopupsInt', listPopupsFunc),
        });
        this.httpApi.addRoutes({
            path: '/popups/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetPopupInt', getPopupFunc),
        });
        this.httpApi.addRoutes({
            path: '/popups/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdatePopupInt', updatePopupFunc),
        });
        this.httpApi.addRoutes({
            path: '/popups/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeletePopupInt', deletePopupFunc),
        });
        this.httpApi.addRoutes({
            path: '/public/popups',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('PublicListPopupsInt', publicListPopupsFunc),
            authorizer: noAuth,
        });

        // --- FORMS ---
        const createFormFunc = new nodejs.NodejsFunction(this, 'CreateFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/create.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(createFormFunc);

        const listFormsFunc = new nodejs.NodejsFunction(this, 'ListFormsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/list.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(listFormsFunc);

        const getFormFunc = new nodejs.NodejsFunction(this, 'GetFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/get.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(getFormFunc);

        const updateFormFunc = new nodejs.NodejsFunction(this, 'UpdateFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/update.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(updateFormFunc);

        const deleteFormFunc = new nodejs.NodejsFunction(this, 'DeleteFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/delete.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(deleteFormFunc);

        const formSubmissionsFunc = new nodejs.NodejsFunction(this, 'FormSubmissionsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/submissions.ts'),
            handler: 'handler',
        });
        props.table.grantReadData(formSubmissionsFunc);

        const publicSubmitFormFunc = new nodejs.NodejsFunction(this, 'PublicSubmitFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/public-submit.ts'),
            handler: 'handler',
        });
        props.table.grantReadWriteData(publicSubmitFormFunc);

        this.httpApi.addRoutes({
            path: '/forms',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateFormInt', createFormFunc),
        });
        this.httpApi.addRoutes({
            path: '/forms',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListFormsInt', listFormsFunc),
        });
        this.httpApi.addRoutes({
            path: '/forms/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetFormInt', getFormFunc),
        });
        this.httpApi.addRoutes({
            path: '/forms/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateFormInt', updateFormFunc),
        });
        this.httpApi.addRoutes({
            path: '/forms/{id}',
            methods: [apigw.HttpMethod.DELETE],
            integration: new integrations.HttpLambdaIntegration('DeleteFormInt', deleteFormFunc),
        });
        this.httpApi.addRoutes({
            path: '/forms/{id}/submissions',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('FormSubmissionsInt', formSubmissionsFunc),
        });
        this.httpApi.addRoutes({
            path: '/public/forms/{slug}/submit',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('PublicSubmitFormInt', publicSubmitFormFunc),
            authorizer: noAuth,
        });

        // --- WOOCOMMERCE IMPORT ---
        const wooImportFunc = new nodejs.NodejsFunction(this, 'WooImportFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/import/woocommerce.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
        });
        props.table.grantReadWriteData(wooImportFunc);

        this.httpApi.addRoutes({
            path: '/import/woocommerce',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('WooImportInt', wooImportFunc),
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
