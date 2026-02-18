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

interface CommerceApiProps extends NestedStackProps {
    httpApiId: string;
    authorizerFuncArn: string;
    table: dynamodb.ITable;
    eventBus: events.IEventBus;
    sesEmail: string;
}

export class CommerceApi extends NestedStack {
    constructor(scope: Construct, id: string, props: CommerceApiProps) {
        super(scope, id, {
            ...props,
            description: 'AMODX Commerce API — categories, orders, customers, delivery, coupons, reviews',
        });

        cdk.Tags.of(this).add('Project', 'AMODX');
        cdk.Tags.of(this).add('Module', 'Commerce');

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
            name: 'CommerceAuthorizer',
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

        // ===================== CATEGORIES =====================
        const createCategoryFunc = new nodejs.NodejsFunction(this, 'CreateCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/create.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(createCategoryFunc);

        const listCategoriesFunc = new nodejs.NodejsFunction(this, 'ListCategoriesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listCategoriesFunc);

        const getCategoryFunc = new nodejs.NodejsFunction(this, 'GetCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getCategoryFunc);

        const updateCategoryFunc = new nodejs.NodejsFunction(this, 'UpdateCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateCategoryFunc);

        const deleteCategoryFunc = new nodejs.NodejsFunction(this, 'DeleteCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/delete.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(deleteCategoryFunc);

        addRoute('CreateCategory', 'POST /categories', createCategoryFunc);
        addRoute('ListCategories', 'GET /categories', listCategoriesFunc);
        addRoute('GetCategory', 'GET /categories/{id}', getCategoryFunc);
        addRoute('UpdateCategory', 'PUT /categories/{id}', updateCategoryFunc);
        addRoute('DeleteCategory', 'DELETE /categories/{id}', deleteCategoryFunc);

        // ===================== PUBLIC PRODUCTS + CATEGORIES =====================
        const publicListProductsFunc = new nodejs.NodejsFunction(this, 'PublicListProductsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/public-list.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicListProductsFunc);

        const publicGetProductFunc = new nodejs.NodejsFunction(this, 'PublicGetProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/public-get.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicGetProductFunc);

        const publicListCategoriesFunc = new nodejs.NodejsFunction(this, 'PublicListCategoriesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/public-list.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicListCategoriesFunc);

        const publicGetCategoryFunc = new nodejs.NodejsFunction(this, 'PublicGetCategoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/categories/public-get.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicGetCategoryFunc);

        addRoute('PublicListProducts', 'GET /public/products', publicListProductsFunc, { noAuth: true });
        addRoute('PublicGetProduct', 'GET /public/products/{slug}', publicGetProductFunc, { noAuth: true });
        addRoute('PublicListCategories', 'GET /public/categories', publicListCategoriesFunc, { noAuth: true });
        addRoute('PublicGetCategory', 'GET /public/categories/{slug}', publicGetCategoryFunc, { noAuth: true });

        // ===================== ORDERS =====================
        const createOrderFunc = new nodejs.NodejsFunction(this, 'CreateOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/create.ts'),
            handler: 'handler',
            environment: {
                ...nodeProps.environment,
                SES_FROM_EMAIL: sesEmail,
            },
        });
        table.grantReadWriteData(createOrderFunc);
        createOrderFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
        }));

        const listOrdersFunc = new nodejs.NodejsFunction(this, 'ListOrdersFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listOrdersFunc);

        const getOrderFunc = new nodejs.NodejsFunction(this, 'GetOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getOrderFunc);

        const updateOrderStatusFunc = new nodejs.NodejsFunction(this, 'UpdateOrderStatusFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/update-status.ts'),
            handler: 'handler',
            environment: {
                ...nodeProps.environment,
                SES_FROM_EMAIL: sesEmail,
            },
        });
        table.grantReadWriteData(updateOrderStatusFunc);
        updateOrderStatusFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
        }));

        const updateOrderFunc = new nodejs.NodejsFunction(this, 'UpdateOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateOrderFunc);

        const publicGetOrderFunc = new nodejs.NodejsFunction(this, 'PublicGetOrderFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/orders/public-get.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicGetOrderFunc);

        addRoute('ListOrders', 'GET /orders', listOrdersFunc);
        addRoute('GetOrder', 'GET /orders/{id}', getOrderFunc);
        addRoute('UpdateOrderStatus', 'PUT /orders/{id}/status', updateOrderStatusFunc);
        addRoute('UpdateOrder', 'PUT /orders/{id}', updateOrderFunc);
        addRoute('CreateOrder', 'POST /public/orders', createOrderFunc, { noAuth: true });
        addRoute('PublicGetOrder', 'GET /public/orders/{id}', publicGetOrderFunc, { noAuth: true });

        // ===================== CUSTOMERS =====================
        const listCustomersFunc = new nodejs.NodejsFunction(this, 'ListCustomersFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listCustomersFunc);

        const getCustomerFunc = new nodejs.NodejsFunction(this, 'GetCustomerFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getCustomerFunc);

        const updateCustomerFunc = new nodejs.NodejsFunction(this, 'UpdateCustomerFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/customers/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateCustomerFunc);

        addRoute('ListCustomers', 'GET /customers', listCustomersFunc);
        addRoute('GetCustomer', 'GET /customers/{email}', getCustomerFunc);
        addRoute('UpdateCustomer', 'PUT /customers/{email}', updateCustomerFunc);

        // ===================== DELIVERY =====================
        const getDeliveryConfigFunc = new nodejs.NodejsFunction(this, 'GetDeliveryConfigFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getDeliveryConfigFunc);

        const updateDeliveryConfigFunc = new nodejs.NodejsFunction(this, 'UpdateDeliveryConfigFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateDeliveryConfigFunc);

        const availableDatesFunc = new nodejs.NodejsFunction(this, 'AvailableDatesFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/delivery/available-dates.ts'),
            handler: 'handler',
        });
        table.grantReadData(availableDatesFunc);

        addRoute('GetDeliveryConfig', 'GET /delivery/config', getDeliveryConfigFunc);
        addRoute('UpdateDeliveryConfig', 'PUT /delivery/config', updateDeliveryConfigFunc);
        addRoute('AvailableDates', 'GET /public/delivery/dates', availableDatesFunc, { noAuth: true });

        // ===================== COUPONS =====================
        const createCouponFunc = new nodejs.NodejsFunction(this, 'CreateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/create.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(createCouponFunc);

        const listCouponsFunc = new nodejs.NodejsFunction(this, 'ListCouponsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listCouponsFunc);

        const getCouponFunc = new nodejs.NodejsFunction(this, 'GetCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(getCouponFunc);

        const updateCouponFunc = new nodejs.NodejsFunction(this, 'UpdateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateCouponFunc);

        const deleteCouponFunc = new nodejs.NodejsFunction(this, 'DeleteCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/delete.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(deleteCouponFunc);

        const validateCouponFunc = new nodejs.NodejsFunction(this, 'ValidateCouponFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/coupons/public-validate.ts'),
            handler: 'handler',
        });
        table.grantReadData(validateCouponFunc);

        addRoute('CreateCoupon', 'POST /coupons', createCouponFunc);
        addRoute('ListCoupons', 'GET /coupons', listCouponsFunc);
        addRoute('GetCoupon', 'GET /coupons/{id}', getCouponFunc);
        addRoute('UpdateCoupon', 'PUT /coupons/{id}', updateCouponFunc);
        addRoute('DeleteCoupon', 'DELETE /coupons/{id}', deleteCouponFunc);
        addRoute('ValidateCoupon', 'POST /public/coupons/validate', validateCouponFunc, { noAuth: true });

        // ===================== REVIEWS =====================
        const createReviewFunc = new nodejs.NodejsFunction(this, 'CreateReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/create.ts'),
            handler: 'handler',
        });
        table.grantWriteData(createReviewFunc);

        const listReviewsFunc = new nodejs.NodejsFunction(this, 'ListReviewsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(listReviewsFunc);

        const updateReviewFunc = new nodejs.NodejsFunction(this, 'UpdateReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(updateReviewFunc);

        const deleteReviewFunc = new nodejs.NodejsFunction(this, 'DeleteReviewFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/delete.ts'),
            handler: 'handler',
        });
        table.grantWriteData(deleteReviewFunc);

        const publicListReviewsFunc = new nodejs.NodejsFunction(this, 'PublicListReviewsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reviews/public-list.ts'),
            handler: 'handler',
        });
        table.grantReadData(publicListReviewsFunc);

        addRoute('CreateReview', 'POST /reviews', createReviewFunc);
        addRoute('ListReviews', 'GET /reviews', listReviewsFunc);
        addRoute('UpdateReview', 'PUT /reviews/{id}', updateReviewFunc);
        addRoute('DeleteReview', 'DELETE /reviews/{id}', deleteReviewFunc);
        addRoute('PublicListReviews', 'GET /public/reviews/{productId}', publicListReviewsFunc, { noAuth: true });

        // ===================== REPORTS =====================
        const reportsSummaryFunc = new nodejs.NodejsFunction(this, 'ReportsSummaryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/reports/summary.ts'),
            handler: 'handler',
        });
        table.grantReadData(reportsSummaryFunc);

        addRoute('ReportsSummary', 'GET /reports/summary', reportsSummaryFunc);

        // ===================== BULK PRICE ADJUSTMENT =====================
        const bulkPriceFunc = new nodejs.NodejsFunction(this, 'BulkPriceFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/bulk-price.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
        });
        table.grantReadWriteData(bulkPriceFunc);

        addRoute('BulkPrice', 'POST /products/bulk-price', bulkPriceFunc);

        // ===================== WOOCOMMERCE IMPORT =====================
        const wooImportFunc = new nodejs.NodejsFunction(this, 'WooImportFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/import/woocommerce.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
        });
        table.grantReadWriteData(wooImportFunc);

        addRoute('WooImport', 'POST /import/woocommerce', wooImportFunc);

        // Grant EventBus permissions to all Lambdas in this stack
        this.node.children.forEach(child => {
            if (child instanceof nodejs.NodejsFunction) {
                eventBus.grantPutEventsTo(child);
            }
        });
    }
}
