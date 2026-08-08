import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
    DynamoDBDocumentClient,
    QueryCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * REV-2b finding #1 — the site-scope moderation VERTICAL. rev-2b imports business reviews under the
 * DISJOINT `SITEREVIEW#` sort-key namespace (rev-1 D-REV-5), which does NOT match
 * `begins_with(SK, "REVIEW#")`. Before this fix an imported business review was invisible to the
 * admin moderation list and could not be deleted. These credential-free tests (DynamoDB document
 * client mocked, no AWS) pin:
 *   • GET /reviews with NO productId merges BOTH namespaces (two PK+begins_with queries, never a
 *     Scan) and returns them newest-first;
 *   • GET /reviews?productId=… stays a single targeted product query (site reviews excluded);
 *   • DELETE /reviews/{id} with NO productId targets the SITEREVIEW# key (not a 400).
 * `npm run test:unit`.
 */

process.env.TABLE_NAME = "amodx-table";

const ddbmock = mockClient(DynamoDBDocumentClient);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listHandler: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deleteHandler: any;
beforeAll(async () => {
    listHandler = (await import("../../src/reviews/list.js")).handler;
    deleteHandler = (await import("../../src/reviews/delete.js")).handler;
});

function listEvent(productId?: string) {
    return {
        headers: { "x-tenant-id": "t1" },
        queryStringParameters: productId ? { productId } : undefined,
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "mod@example.com", role: "TENANT_ADMIN", tenantId: "t1" } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function deleteEvent(id: string, productId?: string) {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: { id },
        queryStringParameters: productId ? { productId } : undefined,
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "mod@example.com", role: "TENANT_ADMIN", tenantId: "t1" } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

const productReview = { id: "pr1", productId: "p1", scope: "product", rating: 5, createdAt: "2026-08-01T00:00:00.000Z" };
const siteReview = { id: "sr1", scope: "site", rating: 4, createdAt: "2026-08-05T00:00:00.000Z" };

beforeEach(() => {
    ddbmock.reset();
});

describe("GET /reviews — site-scope moderation list (finding #1)", () => {
    it("merges REVIEW# and SITEREVIEW# when no productId, newest-first, without a Scan", async () => {
        // Branch the mocked query on the requested SK prefix.
        ddbmock.on(QueryCommand).callsFake((input) => {
            const sk = input.ExpressionAttributeValues[":sk"];
            if (sk === "REVIEW#") return { Items: [productReview] };
            if (sk === "SITEREVIEW#") return { Items: [siteReview] };
            return { Items: [] };
        });

        const res = await listHandler(listEvent());
        expect(res.statusCode).toBe(200);
        const items = JSON.parse(res.body).items;

        // BOTH namespaces surfaced.
        expect(items.map((r: any) => r.id).sort()).toEqual(["pr1", "sr1"]);
        // Newest-first merge (site review is newer).
        expect(items[0].id).toBe("sr1");

        // Two PK+begins_with queries, each a Query (never a Scan). No Scan command type is even
        // imported by the handler; assert the two prefixes were issued.
        const calls = ddbmock.commandCalls(QueryCommand);
        expect(calls).toHaveLength(2);
        const prefixes = calls.map((c) => (c.args[0].input as any).ExpressionAttributeValues[":sk"]).sort();
        expect(prefixes).toEqual(["REVIEW#", "SITEREVIEW#"]);
        for (const c of calls) {
            expect((c.args[0].input as any).KeyConditionExpression).toContain("begins_with(SK");
        }
    });

    it("stays a single product query when productId is given (site reviews excluded)", async () => {
        ddbmock.on(QueryCommand).resolves({ Items: [productReview] });

        const res = await listHandler(listEvent("p1"));
        expect(res.statusCode).toBe(200);

        const calls = ddbmock.commandCalls(QueryCommand);
        expect(calls).toHaveLength(1);
        expect((calls[0].args[0].input as any).ExpressionAttributeValues[":sk"]).toBe("REVIEW#p1#");
    });
});

describe("DELETE /reviews/{id} — site-scope routing (finding #1)", () => {
    it("targets the SITEREVIEW# key when no productId is supplied", async () => {
        ddbmock.on(DeleteCommand).resolves({});

        const res = await deleteHandler(deleteEvent("sr1"));
        expect(res.statusCode).toBe(200);

        const calls = ddbmock.commandCalls(DeleteCommand);
        expect(calls).toHaveLength(1);
        expect((calls[0].args[0].input as any).Key.SK).toBe("SITEREVIEW#sr1");
    });

    it("targets the product key when productId is supplied", async () => {
        ddbmock.on(DeleteCommand).resolves({});

        const res = await deleteHandler(deleteEvent("pr1", "p1"));
        expect(res.statusCode).toBe(200);

        const calls = ddbmock.commandCalls(DeleteCommand);
        expect((calls[0].args[0].input as any).Key.SK).toBe("REVIEW#p1#pr1");
    });
});
