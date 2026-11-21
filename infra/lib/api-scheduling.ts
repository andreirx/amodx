import * as cdk from 'aws-cdk-lib';
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * SCHED-1D1 (docs/slices/sched-1.md § 10.3, § 11.2, § 17) — the scheduling API nested stack. This slice: the ADMIN
 * routes of `sched-1d` (bookings with history, customers incl. erasure, resources, feed secret, mail templates).
 * `sched-1d2` adds the visitor routes, `sched-1e`/`1f` their admin routes, `sched-1g` the reminder job — each appends
 * its own functions and routes here.
 *
 * Pattern of `api-commerce.ts`: L1 `CfnRoute` / `CfnIntegration` (routes created by `httpApi.addRoutes()` would land
 * in the parent), its own `CfnAuthorizer` on the parent's authorizer function. Unlike CommerceApi, the event bus is
 * NOT granted to every function: only the functions that publish a main-table audit event get `EVENT_BUS_NAME` and
 * `events:PutEvents` (§ 11.2, SCHED-AUDIT-PII = C) — the admin booking routes publish none, so they cannot.
 *
 * Wiring per function (§ 11.2): every function gets `SCHEDULING_TABLE_NAME`, `TABLE_NAME` and read on the main table
 * (the tenant record); on the scheduling table, read for functions that only read (the GET routes and the customer
 * lookup), read-write for the others, none for the templates route (it never reads the table). The mailing function
 * (admin booking cancel) gets `SES_FROM_EMAIL`, one `ses:SendEmail` on the sending identity, and
 * `RENDERER_CLOUDFRONT_ORIGIN`; the feed-secret route gets `RENDERER_CLOUDFRONT_ORIGIN` (it builds the feed URL).
 * Every handler calls `requireRole` itself (`backend/src/scheduling/admin/common.ts`).
 *
 * Abstraction line (§ 17): users — every scheduling function and route; axis — the CloudFormation 500-resource
 * ceiling of the parent template (demonstrated, F5); rejected — the routes in the parent.
 */
interface SchedulingApiProps extends NestedStackProps {
    httpApiId: string;
    authorizerFuncArn: string;
    /** The main table: read of the tenant record (settings, mail templates, domain). */
    table: dynamodb.ITable;
    /** The scheduling-private table (`infra/lib/database.ts`); no other function has a grant on it. */
    schedulingTable: dynamodb.ITable;
    eventBus: events.IEventBus;
    sesEmail: string;
    /** `https://<renderer distribution>.cloudfront.net` — the link base of a tenant without a domain (§ 8.2). */
    rendererCloudFrontOrigin: string;
}

/** How a function may use the scheduling table. */
type SchedulingAccess = 'none' | 'read' | 'readWrite';

export class SchedulingApi extends NestedStack {
    constructor(scope: Construct, id: string, props: SchedulingApiProps) {
        super(scope, id, {
            ...props,
            description: 'AMODX Scheduling API — admin bookings, customers, resources, mail templates',
        });

        cdk.Tags.of(this).add('Project', 'AMODX');
        cdk.Tags.of(this).add('Module', 'Scheduling');

        const { httpApiId, authorizerFuncArn, table, schedulingTable, eventBus, sesEmail } = props;
        const region = cdk.Stack.of(this).region;
        const account = cdk.Stack.of(this).account;

        const authorizer = new apigw.CfnAuthorizer(this, 'Authorizer', {
            apiId: httpApiId,
            authorizerType: 'REQUEST',
            name: 'SchedulingAuthorizer',
            authorizerUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${authorizerFuncArn}/invocations`,
            authorizerResultTtlInSeconds: 0,
            authorizerPayloadFormatVersion: '2.0',
            enableSimpleResponses: true,
        });
        new lambda.CfnPermission(this, 'AuthorizerInvokePerm', {
            action: 'lambda:InvokeFunction',
            functionName: authorizerFuncArn,
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${region}:${account}:${httpApiId}/authorizers/${authorizer.ref}`,
        });
        const apiArn = `arn:aws:execute-api:${region}:${account}:${httpApiId}`;
        const sesIdentityArn = `arn:aws:ses:${region}:${account}:identity/${sesEmail}`;

        /** One function with the § 11.2 wiring. */
        const fn = (constructId: string, entry: string, wiring: {
            scheduling: SchedulingAccess; audit?: boolean; mail?: boolean; linkBase?: boolean;
        }): nodejs.NodejsFunction => {
            const f = new nodejs.NodejsFunction(this, constructId, {
                runtime: lambda.Runtime.NODEJS_22_X,
                entry: path.join(__dirname, '../../backend/src/scheduling/admin', entry),
                handler: 'handler',
                environment: {
                    TABLE_NAME: table.tableName,
                    SCHEDULING_TABLE_NAME: schedulingTable.tableName,
                    ...(wiring.audit ? { EVENT_BUS_NAME: eventBus.eventBusName } : {}),
                    ...(wiring.mail ? { SES_FROM_EMAIL: sesEmail } : {}),
                    ...(wiring.mail || wiring.linkBase ? { RENDERER_CLOUDFRONT_ORIGIN: props.rendererCloudFrontOrigin } : {}),
                },
                bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
                memorySize: 1024,
                timeout: cdk.Duration.seconds(29),
            });
            table.grantReadData(f);
            switch (wiring.scheduling) {
                case 'none': break;
                case 'read': schedulingTable.grantReadData(f); break;
                case 'readWrite': schedulingTable.grantReadWriteData(f); break;
                default: {
                    const never: never = wiring.scheduling;
                    throw new Error(`unknown scheduling access ${String(never)}`);
                }
            }
            if (wiring.audit) eventBus.grantPutEventsTo(f);
            if (wiring.mail) {
                f.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [sesIdentityArn] }));
            }
            return f;
        };

        const addRoute = (routeId: string, routeKey: string, func: nodejs.NodejsFunction) => {
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
                authorizationType: 'CUSTOM',
                authorizerId: authorizer.ref,
            });
            func.addPermission(`${routeId}ApiPerm`, {
                principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
                sourceArn: `${apiArn}/*`,
            });
        };

        // ===================== BOOKINGS (admin; no audit event: history on BOOKING#, § 6.5) =====================
        addRoute('AdminGetBooking', 'GET /scheduling/admin/bookings/{bookingId}',
            fn('AdminGetBookingFunc', 'bookings-get.ts', { scheduling: 'read' }));
        addRoute('AdminCancelBooking', 'POST /scheduling/admin/bookings/{bookingId}/cancel',
            fn('AdminCancelBookingFunc', 'bookings-cancel.ts', { scheduling: 'readWrite', mail: true }));

        // ===================== CUSTOMERS =====================
        addRoute('AdminLookupCustomer', 'POST /scheduling/admin/customers/lookup',
            fn('AdminLookupCustomerFunc', 'customers-lookup.ts', { scheduling: 'read' }));
        addRoute('AdminEraseCustomer', 'POST /scheduling/admin/customers/erase',
            fn('AdminEraseCustomerFunc', 'customers-erase.ts', { scheduling: 'readWrite', audit: true }));

        // ===================== RESOURCES =====================
        addRoute('AdminListResources', 'GET /scheduling/admin/resources',
            fn('AdminListResourcesFunc', 'resources-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateResource', 'POST /scheduling/admin/resources',
            fn('AdminCreateResourceFunc', 'resources-create.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminUpdateResource', 'PUT /scheduling/admin/resources/{resourceId}',
            fn('AdminUpdateResourceFunc', 'resources-update.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminDeleteResource', 'DELETE /scheduling/admin/resources/{resourceId}',
            fn('AdminDeleteResourceFunc', 'resources-delete.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminFeedSecret', 'POST /scheduling/admin/resources/{resourceId}/feed-secret',
            fn('AdminFeedSecretFunc', 'resources-feed-secret.ts', { scheduling: 'readWrite', audit: true, linkBase: true }));

        // ===================== MAIL TEMPLATES (overrides are written by the existing PUT /settings) =====================
        addRoute('AdminEmailTemplates', 'GET /scheduling/admin/email-templates',
            fn('AdminEmailTemplatesFunc', 'email-templates.ts', { scheduling: 'none' }));
    }
}
