import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

interface AmodxApiProps {
    table: dynamodb.Table;
}

export class AmodxApi extends Construct {
    public readonly httpApi: apigw.HttpApi;

    constructor(scope: Construct, id: string, props: AmodxApiProps) {
        super(scope, id);

        // 1. Create the HTTP API (Faster/Cheaper than REST API)
        this.httpApi = new apigw.HttpApi(this, 'AmodxHttpApi', {
            corsPreflight: {
                allowOrigins: ['*'], // For development. TODO Lock down in prod.
                allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });

        // 2. Define the Lambda Function
        const createContentFunction = new nodejs.NodejsFunction(this, 'CreateContentFunc', {
            runtime: lambda.Runtime.NODEJS_20_X, // Use latest LTS
            entry: path.join(__dirname, '../../backend/src/content/create.ts'), // Point to source
            handler: 'handler',
            environment: {
                TABLE_NAME: props.table.tableName,
            },
            bundling: {
                minify: true,
                sourceMap: true,
            },
        });

        // 3. Grant Permissions (Lambda needs to write to DB)
        props.table.grantWriteData(createContentFunction);

        // 4. Add Route to API Gateway
        this.httpApi.addRoutes({
            path: '/content',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateContentIntegration', createContentFunction),
        });

        // 5. Define the List Function
        const listContentFunction = new nodejs.NodejsFunction(this, 'ListContentFunc', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../backend/src/content/list.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.table.tableName,
            },
            bundling: {
                minify: true,
                sourceMap: true,
                externalModules: ['@aws-sdk/*'],
            },
        });

        // 6. Grant Read Permissions
        props.table.grantReadData(listContentFunction);

        // 7. Add Route (GET /content)
        this.httpApi.addRoutes({
            path: '/content',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListContentIntegration', listContentFunction),
        });


        // --- NEW: Get Content Function ---
        const getContentFunction = new nodejs.NodejsFunction(this, 'GetContentFunc', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../backend/src/content/get.ts'),
            handler: 'handler',
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });

        props.table.grantReadData(getContentFunction);

        this.httpApi.addRoutes({
            path: '/content/{id}',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('GetContentIntegration', getContentFunction),
        });

        // --- NEW: Update Content Function ---
        const updateContentFunction = new nodejs.NodejsFunction(this, 'UpdateContentFunc', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../backend/src/content/update.ts'),
            handler: 'handler',
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });

        props.table.grantReadWriteData(updateContentFunction);

        // --- CONTEXT API (Strategy & Personas) ---

        // 8. Define Create Context Function
        const createContextFunction = new nodejs.NodejsFunction(this, 'CreateContextFunc', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../backend/src/context/create.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.table.tableName,
            },
            bundling: {
                minify: true,
                sourceMap: true,
                externalModules: ['@aws-sdk/*'],
            },
        });

        // 9. Grant Permissions
        props.table.grantWriteData(createContextFunction);

        // 10. Add Route (POST /context)
        this.httpApi.addRoutes({
            path: '/context',
            methods: [apigw.HttpMethod.POST],
            integration: new integrations.HttpLambdaIntegration('CreateContextIntegration', createContextFunction),
        });

        // 11. Define List Context Function
        const listContextFunction = new nodejs.NodejsFunction(this, 'ListContextFunc', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../backend/src/context/list.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.table.tableName,
            },
            bundling: {
                minify: true,
                sourceMap: true,
                externalModules: ['@aws-sdk/*'],
            },
        });

        // 12. Grant Permissions
        props.table.grantReadData(listContextFunction);

        // 13. Add Route (GET /context)
        this.httpApi.addRoutes({
            path: '/context',
            methods: [apigw.HttpMethod.GET],
            integration: new integrations.HttpLambdaIntegration('ListContextIntegration', listContextFunction),
        });

        this.httpApi.addRoutes({
            path: '/content/{id}',
            methods: [apigw.HttpMethod.PUT],
            integration: new integrations.HttpLambdaIntegration('UpdateContentIntegration', updateContentFunction),
        });


        // --- SETTINGS API ---
        const getSettingsFunc = new nodejs.NodejsFunction(this, 'GetSettingsFunc', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../backend/src/tenant/settings.ts'),
            handler: 'getHandler', // Note the export name
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });

        const updateSettingsFunc = new nodejs.NodejsFunction(this, 'UpdateSettingsFunc', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../backend/src/tenant/settings.ts'),
            handler: 'updateHandler', // Note the export name
            environment: { TABLE_NAME: props.table.tableName },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        });

        props.table.grantReadData(getSettingsFunc);
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

        // 8. Output the URL
        new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.url || '' });
    }
}
