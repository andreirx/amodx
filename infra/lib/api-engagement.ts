import * as cdk from 'aws-cdk-lib';
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface EngagementApiProps extends NestedStackProps {
    httpApiId: string;
    authorizerFuncArn: string;
    table: dynamodb.ITable;
    eventBus: events.IEventBus;
    sesEmail: string;
}

export class EngagementApi extends NestedStack {
    constructor(scope: Construct, id: string, props: EngagementApiProps) {
        super(scope, id, {
            ...props,
            description: 'AMODX Engagement API — popups, forms',
        });

        cdk.Tags.of(this).add('Project', 'AMODX');
        cdk.Tags.of(this).add('Module', 'Engagement');

        const { httpApiId, authorizerFuncArn, table, eventBus, sesEmail } = props;

        const nodeProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            environment: {
                TABLE_NAME: table.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
            },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
            memorySize: 1024,
            timeout: cdk.Duration.seconds(29),
        };

        // Create authorizer for this nested stack (reuses parent's auth Lambda)
        const authorizer = new apigw.CfnAuthorizer(this, 'Authorizer', {
            apiId: httpApiId,
            authorizerType: 'REQUEST',
            name: 'EngagementAuthorizer',
            authorizerUri: `arn:aws:apigateway:${cdk.Stack.of(this).region}:lambda:path/2015-03-31/functions/${authorizerFuncArn}/invocations`,
            authorizerResultTtlInSeconds: 0,
            authorizerPayloadFormatVersion: '2.0',
            enableSimpleResponses: true,
        });

        // Grant API Gateway permission to invoke the authorizer Lambda
        new lambda.CfnPermission(this, 'AuthorizerInvokePerm', {
            action: 'lambda:InvokeFunction',
            functionName: authorizerFuncArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${httpApiId}/authorizers/${authorizer.ref}`,
        });

        const apiArn = `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${httpApiId}`;

        // Helper: create Lambda + integration + route + invoke permission
        const addRoute = (
            routeId: string,
            routeKey: string,
            func: nodejs.NodejsFunction,
            options?: { noAuth?: boolean },
        ) => {
            const integration = new apigw.CfnIntegration(this, `${routeId}Int`, {
                apiId: httpApiId,
                integrationType: 'AWS_PROXY',
                integrationUri: func.functionArn,
                payloadFormatVersion: '2.0',
            });
            new apigw.CfnRoute(this, `${routeId}Route`, {
                apiId: httpApiId,
                routeKey,
                target: `integrations/${integration.ref}`,
                ...(options?.noAuth
                    ? { authorizationType: 'NONE' }
                    : { authorizationType: 'CUSTOM', authorizerId: authorizer.ref }),
            });
            func.addPermission(`${routeId}ApiPerm`, {
                principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
                sourceArn: `${apiArn}/*`,
            });
        };

        // ===================== POPUPS =====================
        const createPopupFunc = new nodejs.NodejsFunction(this, 'CreatePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/create.ts'),
            handler: 'handler',
        });
        table.grantWriteData(createPopupFunc);

        const listPopupsFunc = new nodejs.NodejsFunction(this, 'ListPopupsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listPopupsFunc);

        const getPopupFunc = new nodejs.NodejsFunction(this, 'GetPopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getPopupFunc);

        const updatePopupFunc = new nodejs.NodejsFunction(this, 'UpdatePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updatePopupFunc);

        const deletePopupFunc = new nodejs.NodejsFunction(this, 'DeletePopupFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/delete.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(deletePopupFunc);

        const publicListPopupsFunc = new nodejs.NodejsFunction(this, 'PublicListPopupsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/popups/public-list.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicListPopupsFunc);

        addRoute('CreatePopup', 'POST /popups', createPopupFunc);
        addRoute('ListPopups', 'GET /popups', listPopupsFunc);
        addRoute('GetPopup', 'GET /popups/{id}', getPopupFunc);
        addRoute('UpdatePopup', 'PUT /popups/{id}', updatePopupFunc);
        addRoute('DeletePopup', 'DELETE /popups/{id}', deletePopupFunc);
        addRoute('PublicListPopups', 'GET /public/popups', publicListPopupsFunc, { noAuth: true });

        // ===================== FORMS =====================
        const createFormFunc = new nodejs.NodejsFunction(this, 'CreateFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/create.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(createFormFunc);

        const listFormsFunc = new nodejs.NodejsFunction(this, 'ListFormsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listFormsFunc);

        const getFormFunc = new nodejs.NodejsFunction(this, 'GetFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getFormFunc);

        const updateFormFunc = new nodejs.NodejsFunction(this, 'UpdateFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateFormFunc);

        const deleteFormFunc = new nodejs.NodejsFunction(this, 'DeleteFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/delete.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(deleteFormFunc);

        const formSubmissionsFunc = new nodejs.NodejsFunction(this, 'FormSubmissionsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/submissions.ts'),
            handler: 'handler',
        });
        table.grantReadData(formSubmissionsFunc);

        const publicSubmitFormFunc = new nodejs.NodejsFunction(this, 'PublicSubmitFormFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/forms/public-submit.ts'),
            handler: 'handler',
            environment: {
                ...nodeProps.environment,
                SES_FROM_EMAIL: sesEmail,
            },
        });
        table.grantReadWriteData(publicSubmitFormFunc);
        publicSubmitFormFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
        }));

        addRoute('CreateForm', 'POST /forms', createFormFunc);
        addRoute('ListForms', 'GET /forms', listFormsFunc);
        addRoute('GetForm', 'GET /forms/{id}', getFormFunc);
        addRoute('UpdateForm', 'PUT /forms/{id}', updateFormFunc);
        addRoute('DeleteForm', 'DELETE /forms/{id}', deleteFormFunc);
        addRoute('FormSubmissions', 'GET /forms/{id}/submissions', formSubmissionsFunc);
        addRoute('PublicSubmitForm', 'POST /public/forms/{slug}/submit', publicSubmitFormFunc, { noAuth: true });

        // Grant EventBus permissions to all Lambdas in this stack
        this.node.children.forEach(child => {
            if (child instanceof nodejs.NodejsFunction) {
                eventBus.grantPutEventsTo(child);
            }
        });
    }
}
