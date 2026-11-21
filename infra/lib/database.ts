import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface AmodxDatabaseProps {
    tableSuffix?: string;
}

export class AmodxDatabase extends Construct {
    public readonly table: dynamodb.Table;
    /**
     * Scheduling-private table (docs/slices/sched-1.md § 6.1, SCHED-TABLE = A). Holds customer booking data, so
     * the renderer's role gets no statement on it. Inert since `sched-1b`: no function has its name or a grant;
     * `sched-1c`/`1d` wire it into the scheduling functions only.
     */
    public readonly schedulingTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props?: AmodxDatabaseProps) {
        super(scope, id);

        const suffix = props?.tableSuffix || '';

        this.table = new dynamodb.Table(scope, 'AmodxTable', {
            tableName: `AmodxTable${suffix}`,
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Serverless pricing
            removalPolicy: cdk.RemovalPolicy.RETAIN, // For Dev: deletes table if stack is destroyed
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        });

        // 1. GSI for Routing (Find Tenant by Domain)
        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI_Domain',
            partitionKey: { name: 'Domain', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // Returns TenantID
        });

        // 2. GSI for Listing by Type (e.g. "Get all Blog Posts")
        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI_Type',
            partitionKey: { name: 'Type', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'CreatedAt', type: dynamodb.AttributeType.STRING },
        });

        // 3. GSI for Work Items (Inbox)
        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI_Status',
            partitionKey: { name: 'Status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'ScheduledFor', type: dynamodb.AttributeType.STRING },
        });

        // 4. GSI for Slug-based lookups (Commerce: Products & Categories by slug)
        this.table.addGlobalSecondaryIndex({
            indexName: 'GSI_Slug',
            partitionKey: { name: 'TenantSlug', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // Scheduling-private table (sched-1.md § 6.1). Same scope and name pattern as AmodxTable. No GSI and no
        // stream: every access pattern is a Get/Query on PK = TENANT#<tenantId> (§ 6.3). TTL attribute `ttl` is
        // set only on items with no customer data (§ 6.1 TTL rule). RETAIN emits DeletionPolicy and
        // UpdateReplacePolicy Retain, so neither a stack delete nor a revert of this declaration deletes bookings.
        this.schedulingTable = new dynamodb.Table(scope, 'SchedulingTable', {
            tableName: `AmodxSchedulingTable${suffix}`,
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            timeToLiveAttribute: 'ttl',
        });
    }
}
