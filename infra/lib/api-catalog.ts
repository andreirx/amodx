import * as cdk from 'aws-cdk-lib';
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * INFRA-SPLIT-1 (v2, FUNCTIONS-ONLY). Props mirror the CommerceApi/EngagementApi precedent:
 * the composition root (amodx-stack.ts) passes the shared table/eventBus/secrets/buckets
 * in by value. Unlike those two, CatalogApi carries NO `httpApiId`/`authorizerFuncArn` — it does
 * NOT create routes. The parent keeps every catalog Route + Integration + Permission (unchanged
 * route keys) and points its integrations at the functions this stack EXPORTS. See the class
 * doc-comment for why.
 */
interface CatalogApiProps extends NestedStackProps {
    table: dynamodb.ITable;
    eventBus: events.IEventBus;
    // Cache revalidation (content/product mutations purge ISR)
    revalidationSecret: secretsmanager.ISecret;
    rendererUrl?: string;
    // WordPress + media importers stage assets into the public uploads bucket
    uploadsBucket: s3.IBucket;
    uploadsCdnUrl: string;
    // Review bulk-import stages raw originals into the PRIVATE quarantine bucket
    privateBucket: s3.IBucket;
}

/**
 * CatalogApi — a CloudFormation NestedStack holding ONLY the catalog group's Lambda Functions
 * (+ their CDK-generated Role/Policy), for the content (6), products (5) and import (3:
 * wordpress/media/reviews) handlers = 14 functions.
 *
 * WHY THIS EXISTS (the single earned axis of variation): AmodxStack reached CloudFormation's hard
 * 500-resource-per-template ceiling (email-2 synth = 501), which BLOCKS every backend deploy that
 * adds a resource. A NestedStack is a separate CFN template with its own 500 budget, so moving
 * these functions out of the parent template is the mechanism that restores headroom. This is the
 * same pre-ratified deploy-unit boundary already used by CommerceApi and EngagementApi.
 *
 * WHY FUNCTIONS-ONLY (not the whole route, as v1 tried): moving an existing ApiGatewayV2 Route to
 * another stack changes its logical id, so CloudFormation CREATEs the new `POST /products` before
 * DELETEing the old one — two routes with the same key on the shared HttpApi → the nested stack
 * CREATE_FAILED and rolled back (PROVEN on staging, 2026-08-10). v2 leaves every Route +
 * Integration + Permission in the PARENT template with its key and logical id UNCHANGED; only the
 * heavy Function/Role/Policy move here. The parent's integration target ref updates in place to a
 * cross-stack reference (Fn::GetAtt on this stack's auto-generated output) — no route recreation,
 * no key collision, zero downtime.
 *
 * Simpler alternative rejected: keep the catalog functions in the parent template. Impossible —
 * that is the 501-resource state the 500 ceiling forbids from deploying.
 *
 * Dispatch axis: this is a deploy-unit (template) boundary, NOT a polymorphism seam. The functions
 * are declared directly; no interface/registry is introduced because there is exactly one concrete
 * consumer (AmodxApi) and no demonstrated variation beyond the resource-count split.
 */
export class CatalogApi extends NestedStack {
    // --- CONTENT (6) ---
    public readonly createContentFunc: nodejs.NodejsFunction;
    public readonly listContentFunc: nodejs.NodejsFunction;
    public readonly getContentFunc: nodejs.NodejsFunction;
    public readonly updateContentFunc: nodejs.NodejsFunction;
    public readonly listHistoryFunc: nodejs.NodejsFunction;
    public readonly restoreContentFunc: nodejs.NodejsFunction;
    // --- PRODUCTS (5) ---
    public readonly createProductFunc: nodejs.NodejsFunction;
    public readonly listProductsFunc: nodejs.NodejsFunction;
    public readonly getProductFunc: nodejs.NodejsFunction;
    public readonly updateProductFunc: nodejs.NodejsFunction;
    public readonly deleteProductFunc: nodejs.NodejsFunction;
    // --- IMPORT (3) ---
    public readonly importFunc: nodejs.NodejsFunction;
    public readonly mediaImportFunc: nodejs.NodejsFunction;
    public readonly reviewImportFunc: nodejs.NodejsFunction;

    constructor(scope: Construct, id: string, props: CatalogApiProps) {
        super(scope, id, {
            ...props,
            description: 'AMODX Catalog API — content, products, import handlers (functions only; routes stay in the parent)',
        });

        cdk.Tags.of(this).add('Project', 'AMODX');
        cdk.Tags.of(this).add('Module', 'Catalog');

        const { table, eventBus } = props;

        // Identical to AmodxApi's nodeProps (api.ts) so the moved functions behave byte-for-byte as
        // before — same runtime, env, memory, timeout, bundling. NO handler logic changes.
        const nodeProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            environment: {
                TABLE_NAME: table.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                RENDERER_URL: props.rendererUrl || '',
                REVALIDATION_SECRET_NAME: props.revalidationSecret.secretName,
            },
            bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
            memorySize: 1024,
            timeout: cdk.Duration.seconds(29),
        };

        // --- CONTENT API ---
        this.createContentFunc = new nodejs.NodejsFunction(this, 'CreateContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/create.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(this.createContentFunc);
        props.revalidationSecret.grantRead(this.createContentFunc);  // cache-2: ISR purge on page create

        this.listContentFunc = new nodejs.NodejsFunction(this, 'ListContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(this.listContentFunc);

        this.getContentFunc = new nodejs.NodejsFunction(this, 'GetContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(this.getContentFunc);

        this.updateContentFunc = new nodejs.NodejsFunction(this, 'UpdateContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(this.updateContentFunc);
        props.revalidationSecret.grantRead(this.updateContentFunc);  // Phase 4: Cache invalidation

        // History & Restore
        this.listHistoryFunc = new nodejs.NodejsFunction(this, 'ListHistoryFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/history.ts'),
            handler: 'listVersionsHandler',
        });
        table.grantReadData(this.listHistoryFunc);

        this.restoreContentFunc = new nodejs.NodejsFunction(this, 'RestoreContentFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/content/restore.ts'),
            handler: 'restoreHandler',
        });
        table.grantReadWriteData(this.restoreContentFunc);

        // --- PRODUCTS ---
        this.createProductFunc = new nodejs.NodejsFunction(this, 'CreateProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/create.ts'),
            handler: 'handler',
        });
        table.grantWriteData(this.createProductFunc);

        this.listProductsFunc = new nodejs.NodejsFunction(this, 'ListProductsFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/list.ts'),
            handler: 'handler',
        });
        table.grantReadData(this.listProductsFunc);

        this.getProductFunc = new nodejs.NodejsFunction(this, 'GetProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/get.ts'),
            handler: 'handler',
        });
        table.grantReadData(this.getProductFunc);

        this.updateProductFunc = new nodejs.NodejsFunction(this, 'UpdateProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/update.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(this.updateProductFunc);
        props.revalidationSecret.grantRead(this.updateProductFunc);  // Cache invalidation

        this.deleteProductFunc = new nodejs.NodejsFunction(this, 'DeleteProductFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/products/delete.ts'),
            handler: 'handler',
        });
        table.grantReadWriteData(this.deleteProductFunc);
        props.revalidationSecret.grantRead(this.deleteProductFunc);  // Cache invalidation

        // --- IMPORT ---
        this.importFunc = new nodejs.NodejsFunction(this, 'ImportFunc', {
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
        table.grantReadWriteData(this.importFunc);
        props.uploadsBucket.grantReadWrite(this.importFunc);

        // --- MEDIA IMPORT ---
        this.mediaImportFunc = new nodejs.NodejsFunction(this, 'MediaImportFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/import/media.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(15),
            memorySize: 3008,
            environment: {
                ...nodeProps.environment,
                UPLOADS_BUCKET: props.uploadsBucket.bucketName,
                UPLOADS_CDN_URL: props.uploadsCdnUrl,
            }
        });
        table.grantReadWriteData(this.mediaImportFunc);
        props.uploadsBucket.grantReadWrite(this.mediaImportFunc);

        // --- REVIEW IMPORT (rev-2b) ---
        // Instance #3 of the import-family pattern — siblings ImportFunc + MediaImportFunc above (and
        // WooImportFunc in the commerce nested stack). PLAIN NodejsFunction — no native binary. Its
        // least-privilege S3 grant (below) and PRIVATE_BUCKET env are unchanged by INFRA-SPLIT-1;
        // they move here verbatim. Pinned by infra/test/amodx-stack.test.ts (rev2b-iam), which
        // searches the whole stack tree and so finds this function in the CatalogApi template.
        this.reviewImportFunc = new nodejs.NodejsFunction(this, 'ReviewImportFunc', {
            ...nodeProps,
            entry: path.join(__dirname, '../../backend/src/import/reviews.ts'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(15),
            memorySize: 3008,
            environment: {
                ...nodeProps.environment,
                PRIVATE_BUCKET: props.privateBucket.bucketName,
            },
        });
        table.grantReadWriteData(this.reviewImportFunc);
        // EXACTLY `s3:PutObject`, ONLY under the `review-staging/` quarantine prefix (rev-2b review-1
        // least-privilege finding). `grantPut()` was REFUSED: it scopes to the whole bucket AND grants
        // the wider put-family. One action, prefix-scoped. Verbatim from the pre-split api.ts.
        this.reviewImportFunc.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [`${props.privateBucket.bucketArn}/review-staging/*`],
        }));

        // Grant EventBus PutEvents to every Lambda in THIS stack (publishAudit). The parent's
        // identical loop over its own children (api.ts) no longer reaches these functions once they
        // move here, so this loop is what keeps their audit trail working. Mirrors CommerceApi.
        this.node.children.forEach(child => {
            if (child instanceof nodejs.NodejsFunction) {
                eventBus.grantPutEventsTo(child);
            }
        });
    }
}
