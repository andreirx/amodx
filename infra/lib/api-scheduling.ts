import * as cdk from 'aws-cdk-lib';
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * SCHED-1D1/1D2/1E1 (docs/slices/sched-1.md § 10.2, § 10.3, § 11.2, § 17) — the scheduling API nested stack: the ADMIN
 * routes of `sched-1d` (bookings with history, customers incl. erasure, resources, feed secret, mail templates;
 * SCHED-1D1), the VISITOR routes (offer, slots, runs, hold, view, confirm, cancel, move; SCHED-1D2; the calendar
 * feed, SCHED-1G1) and the APPOINTMENT admin routes of `sched-1e` (services, default availability, week planner
 * read, day edits, copy-week, all-resource appointments read, manual appointment, slot move; SCHED-1E1) and the GROUP
 * admin routes of `sched-1f` (courses list/create/update/delete, runs list/create/update/move/cancel, roster, unplaced
 * list, manual entry, person move; SCHED-1F1), and the ONE scheduled function of SCHED-1G1 (`reminders.ts`: reminders,
 * the daily expired-hold cleanup, the Sunday planner mail) with its ONE rule `rate(15 minutes)` (§ 11.3, § 11.4, § 14.1).
 *
 * Pattern of `api-commerce.ts`: L1 `CfnRoute` / `CfnIntegration` (routes created by `httpApi.addRoutes()` would land
 * in the parent), its own `CfnAuthorizer` on the parent's authorizer function. Unlike CommerceApi, the event bus is
 * NOT granted to every function: only the functions that publish a main-table audit event get `EVENT_BUS_NAME` and
 * `events:PutEvents` (§ 11.2, SCHED-AUDIT-PII = C) — the admin booking routes publish none, so they cannot.
 *
 * Wiring per function (§ 11.2): every function gets `SCHEDULING_TABLE_NAME`, `TABLE_NAME` and read on the main table
 * (the tenant record); on the scheduling table, read for functions that only read (the GET routes, the customer
 * lookup and the visitor view), read-write for the others, none for the templates route (it never reads the table).
 * The mailing functions (admin booking cancel, manual appointment, slot move, run move, run cancel, manual seat, person
 * move; visitor hold, confirm, cancel, move) get
 * `SES_FROM_EMAIL`, one
 * `ses:SendEmail` on the sending identity, and `RENDERER_CLOUDFRONT_ORIGIN`; the feed-secret route gets
 * `RENDERER_CLOUDFRONT_ORIGIN` (it builds the feed URL). The visitor hold gets `RECAPTCHA_SECRET_KEY` exactly as the
 * commerce order function (`api-commerce.ts`: the deployment secret the parent reads from SSM, passed in as a prop;
 * § 9.1 fail-open guard, row I3). Every handler calls `requireRole` itself (`backend/src/scheduling/admin/common.ts`,
 * `backend/src/scheduling/visitor/common.ts`). The visitor routes use the same authorizer as the admin routes: the
 * renderer key resolves to `RENDERER`; no route is anonymous (§ 16.3).
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
    /** Deployment-level reCAPTCHA secret (as `api-commerce.ts`): `RECAPTCHA_SECRET_KEY` of the visitor hold (§ 9.1). */
    recaptchaSecretKey?: string;
    /**
     * § 11.2 / row G16: the value of the parent's `AdminUrl` output (`https://admin.<rootDomain>`, else `https://<admin
     * distribution domain>`). `ADMIN_URL` of the scheduled job only: the weekly mail's planner link (§ 11.4).
     */
    adminUrl: string;
}

/** How a function may use the scheduling table. */
type SchedulingAccess = 'none' | 'read' | 'readWrite';

export class SchedulingApi extends NestedStack {
    constructor(scope: Construct, id: string, props: SchedulingApiProps) {
        super(scope, id, {
            ...props,
            description: 'AMODX Scheduling API — visitor booking routes; admin bookings, customers, resources, mail templates, appointments, week planner and groups',
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

        /** One function with the § 11.2 wiring. `entry` is relative to `backend/src/scheduling` (`admin/…`, `visitor/…`). */
        const fn = (constructId: string, entry: string, wiring: {
            scheduling: SchedulingAccess; audit?: boolean; mail?: boolean; linkBase?: boolean; recaptcha?: boolean;
            /** `ADMIN_URL` (the scheduled job only, § 11.2). */ adminUrl?: boolean;
            /** Default 29 s (the API Gateway limit); the scheduled job is not behind the API. */ timeoutSeconds?: number;
        }): nodejs.NodejsFunction => {
            const f = new nodejs.NodejsFunction(this, constructId, {
                runtime: lambda.Runtime.NODEJS_22_X,
                entry: path.join(__dirname, '../../backend/src/scheduling', entry),
                handler: 'handler',
                environment: {
                    TABLE_NAME: table.tableName,
                    SCHEDULING_TABLE_NAME: schedulingTable.tableName,
                    ...(wiring.audit ? { EVENT_BUS_NAME: eventBus.eventBusName } : {}),
                    ...(wiring.mail ? { SES_FROM_EMAIL: sesEmail } : {}),
                    ...(wiring.mail || wiring.linkBase ? { RENDERER_CLOUDFRONT_ORIGIN: props.rendererCloudFrontOrigin } : {}),
                    ...(wiring.recaptcha && props.recaptchaSecretKey ? { RECAPTCHA_SECRET_KEY: props.recaptchaSecretKey } : {}),
                    ...(wiring.adminUrl ? { ADMIN_URL: props.adminUrl } : {}),
                },
                bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
                memorySize: 1024,
                timeout: cdk.Duration.seconds(wiring.timeoutSeconds ?? 29),
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
            fn('AdminGetBookingFunc', 'admin/bookings-get.ts', { scheduling: 'read' }));
        addRoute('AdminCancelBooking', 'POST /scheduling/admin/bookings/{bookingId}/cancel',
            fn('AdminCancelBookingFunc', 'admin/bookings-cancel.ts', { scheduling: 'readWrite', mail: true }));

        // ===================== CUSTOMERS =====================
        addRoute('AdminLookupCustomer', 'POST /scheduling/admin/customers/lookup',
            fn('AdminLookupCustomerFunc', 'admin/customers-lookup.ts', { scheduling: 'read' }));
        addRoute('AdminEraseCustomer', 'POST /scheduling/admin/customers/erase',
            fn('AdminEraseCustomerFunc', 'admin/customers-erase.ts', { scheduling: 'readWrite', audit: true }));

        // ===================== RESOURCES =====================
        addRoute('AdminListResources', 'GET /scheduling/admin/resources',
            fn('AdminListResourcesFunc', 'admin/resources-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateResource', 'POST /scheduling/admin/resources',
            fn('AdminCreateResourceFunc', 'admin/resources-create.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminUpdateResource', 'PUT /scheduling/admin/resources/{resourceId}',
            fn('AdminUpdateResourceFunc', 'admin/resources-update.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminDeleteResource', 'DELETE /scheduling/admin/resources/{resourceId}',
            fn('AdminDeleteResourceFunc', 'admin/resources-delete.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminFeedSecret', 'POST /scheduling/admin/resources/{resourceId}/feed-secret',
            fn('AdminFeedSecretFunc', 'admin/resources-feed-secret.ts', { scheduling: 'readWrite', audit: true, linkBase: true }));

        // ===================== MAIL TEMPLATES (overrides are written by the existing PUT /settings) =====================
        addRoute('AdminEmailTemplates', 'GET /scheduling/admin/email-templates',
            fn('AdminEmailTemplatesFunc', 'admin/email-templates.ts', { scheduling: 'none' }));

        // ===================== VISITOR (SCHED-1D2, § 10.2; renderer-proxied; no audit event, SCHED-AUDIT-PII = C) =====================
        // Public derived reads (§ 16.3 class 1): read-only on the scheduling table.
        addRoute('VisitorOffer', 'GET /scheduling/visitor/offer',
            fn('VisitorOfferFunc', 'visitor/offer.ts', { scheduling: 'read' }));
        addRoute('VisitorSlots', 'GET /scheduling/visitor/slots',
            fn('VisitorSlotsFunc', 'visitor/slots.ts', { scheduling: 'read' }));
        addRoute('VisitorRuns', 'GET /scheduling/visitor/courses/{courseId}/runs',
            fn('VisitorRunsFunc', 'visitor/runs.ts', { scheduling: 'read' }));
        // The initial hold (§ 16.3 class 2): reCAPTCHA, limits, the hold mail.
        addRoute('VisitorHold', 'POST /scheduling/visitor/holds',
            fn('VisitorHoldFunc', 'visitor/holds.ts', { scheduling: 'readWrite', mail: true, recaptcha: true }));
        // Token-authorized booking actions (§ 16.3 class 3). The view changes nothing: read-only.
        addRoute('VisitorView', 'POST /scheduling/visitor/bookings/view',
            fn('VisitorViewFunc', 'visitor/bookings-view.ts', { scheduling: 'read' }));
        addRoute('VisitorConfirm', 'POST /scheduling/visitor/bookings/confirm',
            fn('VisitorConfirmFunc', 'visitor/bookings-confirm.ts', { scheduling: 'readWrite', mail: true }));
        addRoute('VisitorCancel', 'POST /scheduling/visitor/bookings/cancel',
            fn('VisitorCancelFunc', 'visitor/bookings-cancel.ts', { scheduling: 'readWrite', mail: true }));
        addRoute('VisitorMove', 'POST /scheduling/visitor/bookings/move',
            fn('VisitorMoveFunc', 'visitor/bookings-move.ts', { scheduling: 'readWrite', mail: true }));
        // Calendar feed (SCHED-1G1, § 12; § 16.3 class 4: a per-resource secret, compared by hash). Renderer-proxied like
        // every visitor route (the renderer handler is `sched-1g2`). It only reads; no mail, no link base, no audit.
        addRoute('VisitorFeed', 'POST /scheduling/visitor/feed',
            fn('VisitorFeedFunc', 'visitor/feed.ts', { scheduling: 'read' }));

        // ===================== APPOINTMENTS (admin, SCHED-1E1, § 10.3 routes of `sched-1e`) =====================
        // Configuration writes (services, default availability, day edits, copy-week) publish one main-table audit event
        // (§ 6.5 point 2): read-write + audit. The GET routes only read. The two booking routes (manual appointment, slot
        // move) append `history` and publish no audit event (SCHED-AUDIT-PII = C); they mail (§ 11.2): read-write + mail.
        addRoute('AdminListServices', 'GET /scheduling/admin/services',
            fn('AdminListServicesFunc', 'admin/appt-services-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateService', 'POST /scheduling/admin/services',
            fn('AdminCreateServiceFunc', 'admin/appt-services-create.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminUpdateService', 'PUT /scheduling/admin/services/{serviceId}',
            fn('AdminUpdateServiceFunc', 'admin/appt-services-update.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminDeleteService', 'DELETE /scheduling/admin/services/{serviceId}',
            fn('AdminDeleteServiceFunc', 'admin/appt-services-delete.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminGetAvailability', 'GET /scheduling/admin/resources/{resourceId}/availability',
            fn('AdminGetAvailabilityFunc', 'admin/appt-availability-get.ts', { scheduling: 'read' }));
        addRoute('AdminPutAvailability', 'PUT /scheduling/admin/resources/{resourceId}/availability',
            fn('AdminPutAvailabilityFunc', 'admin/appt-availability-put.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminWeek', 'GET /scheduling/admin/resources/{resourceId}/week',
            fn('AdminWeekFunc', 'admin/appt-week.ts', { scheduling: 'read' }));
        addRoute('AdminEditDays', 'PUT /scheduling/admin/resources/{resourceId}/days',
            fn('AdminEditDaysFunc', 'admin/appt-days-edit.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminCopyWeek', 'POST /scheduling/admin/resources/{resourceId}/days/copy-week',
            fn('AdminCopyWeekFunc', 'admin/appt-days-copy-week.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminListAppointments', 'GET /scheduling/admin/appointments',
            fn('AdminListAppointmentsFunc', 'admin/appt-appointments-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateAppointment', 'POST /scheduling/admin/appointments',
            fn('AdminCreateAppointmentFunc', 'admin/appt-appointments-create.ts', { scheduling: 'readWrite', mail: true }));
        addRoute('AdminMoveSlot', 'POST /scheduling/admin/bookings/{bookingId}/move-slot',
            fn('AdminMoveSlotFunc', 'admin/appt-move-slot.ts', { scheduling: 'readWrite', mail: true }));

        // ===================== GROUPS (admin, SCHED-1F1, § 10.3 routes of `sched-1f`) =====================
        // Configuration writes (course create/update/delete, run create/update/move/cancel) publish one main-table audit event
        // (§ 6.5 point 2): read-write + audit. Run move and run cancel also mail every person (§ 11.1): + mail. The GET
        // routes only read (the roster and the unplaced list carry customer data: E+T only, checked in the handlers).
        // The two person routes (manual entry, move a person) append `history` and publish no audit event
        // (SCHED-AUDIT-PII = C); they mail: read-write + mail.
        addRoute('AdminListCourses', 'GET /scheduling/admin/courses',
            fn('AdminListCoursesFunc', 'admin/group-courses-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateCourse', 'POST /scheduling/admin/courses',
            fn('AdminCreateCourseFunc', 'admin/group-courses-create.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminUpdateCourse', 'PUT /scheduling/admin/courses/{courseId}',
            fn('AdminUpdateCourseFunc', 'admin/group-courses-update.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminDeleteCourse', 'DELETE /scheduling/admin/courses/{courseId}',
            fn('AdminDeleteCourseFunc', 'admin/group-courses-delete.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminListRuns', 'GET /scheduling/admin/courses/{courseId}/runs',
            fn('AdminListRunsFunc', 'admin/group-runs-list.ts', { scheduling: 'read' }));
        addRoute('AdminCreateRun', 'POST /scheduling/admin/courses/{courseId}/runs',
            fn('AdminCreateRunFunc', 'admin/group-runs-create.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminUpdateRun', 'PUT /scheduling/admin/courses/{courseId}/runs/{runId}',
            fn('AdminUpdateRunFunc', 'admin/group-runs-update.ts', { scheduling: 'readWrite', audit: true }));
        addRoute('AdminMoveRun', 'POST /scheduling/admin/courses/{courseId}/runs/{runId}/move',
            fn('AdminMoveRunFunc', 'admin/group-runs-move.ts', { scheduling: 'readWrite', audit: true, mail: true }));
        addRoute('AdminCancelRun', 'POST /scheduling/admin/courses/{courseId}/runs/{runId}/cancel',
            fn('AdminCancelRunFunc', 'admin/group-runs-cancel.ts', { scheduling: 'readWrite', audit: true, mail: true }));
        addRoute('AdminRoster', 'GET /scheduling/admin/courses/{courseId}/runs/{runId}/roster',
            fn('AdminRosterFunc', 'admin/group-roster.ts', { scheduling: 'read' }));
        addRoute('AdminListUnplaced', 'GET /scheduling/admin/courses/{courseId}/unplaced',
            fn('AdminListUnplacedFunc', 'admin/group-unplaced.ts', { scheduling: 'read' }));
        addRoute('AdminCreateSeat', 'POST /scheduling/admin/seats',
            fn('AdminCreateSeatFunc', 'admin/group-seats-create.ts', { scheduling: 'readWrite', mail: true }));
        addRoute('AdminMoveSeat', 'POST /scheduling/admin/bookings/{bookingId}/move-seat',
            fn('AdminMoveSeatFunc', 'admin/group-move-seat.ts', { scheduling: 'readWrite', mail: true }));

        // ===================== SCHEDULED JOB (SCHED-1G1, § 11.3, § 11.4, § 14.1) =====================
        // ONE function, ONE rule, no route. Named gain: reminders, the expired-hold cleanup and the Sunday mail cannot run
        // without a schedule. Wiring (§ 11.2, least privilege): read on the main table (AP12 tenant Query); read-write on
        // the scheduling table (reminder marks, token mints, cleanup transactions, WEEKMAIL# claim and sentAt); SES on the
        // sender identity + RENDERER_CLOUDFRONT_ORIGIN (the reminder link base); ADMIN_URL (the planner link). No audit
        // event (SCHED-AUDIT-PII = C): no event-bus grant. Timeout 5 minutes: up to 99 tenants per run, sequential.
        // This does NOT prevent two invocations at once (an EventBridge retry, a slow run): reminders stay one per start
        // (conditional mark), the cleanup is idempotent, the weekly mail can be sent twice (documented, § 11.4).
        const job = fn('SchedulingJobFunc', 'reminders.ts', { scheduling: 'readWrite', mail: true, adminUrl: true, timeoutSeconds: 300 });
        new events.Rule(this, 'SchedulingJobSchedule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
            targets: [new eventTargets.LambdaFunction(job)],
        });
    }
}
