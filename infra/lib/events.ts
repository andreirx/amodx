import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface AmodxEventsProps {
    auditFunction: lambda.IFunction;
    busName: string;
}

export class AmodxEvents extends Construct {
    public readonly bus: events.EventBus;

    constructor(scope: Construct, id: string, props: AmodxEventsProps) {
        super(scope, id);

        // 1. The Event Bus
        this.bus = new events.EventBus(this, 'AmodxBus', {
            eventBusName: props.busName, // <--- USE PROP
        });

        // 2. Rule: Catch All Audit Events
        const auditRule = new events.Rule(this, 'AuditRule', {
            eventBus: this.bus,
            eventPattern: {
                source: ['amodx.system'],
                detailType: ['AUDIT_LOG'],
            },
        });

        // 3. Target: The Audit Worker Lambda
        auditRule.addTarget(new targets.LambdaFunction(props.auditFunction));

        new cdk.CfnOutput(this, 'EventBusName', { value: this.bus.eventBusName });
    }
}