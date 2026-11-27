import { describe, it, expect, vi } from "vitest";

/**
 * CMRC-1A, test T2 (docs/slices/cmrc-1a.md § Proofs; docs/slices/cmrc-1.md § 5.9) — `lib/commerce-db.ts`: each
 * reference yields exactly the key the handlers wrote before the module existed, with the table the module is bound
 * to. In CMRC-1A that table is `TABLE_NAME` of `lib/db.js` (the main table). The expected keys are written here as
 * literals on purpose: this file is the independent statement of the stored key format.
 *
 * Credential-free: `db.js` is replaced, so no DynamoDB client is created.
 */

vi.mock("../../src/lib/db.js", () => ({ db: {}, TABLE_NAME: "main-table-of-the-test" }));

import {
    COMMERCE_PRIVATE_PREFIXES, orderRef, customerRef, customerOrderRef, orderCounterRef,
    ordersQuery, customersQuery, customerOrdersQuery,
} from "../../src/lib/commerce-db.js";

const TABLE = "main-table-of-the-test";
const KEY_CONDITION = "PK = :pk AND begins_with(SK, :sk)";

describe("CMRC-1A T2 — item references: the table and the full key", () => {
    it.each([
        ["orderRef", orderRef("t1", "o-1"), "ORDER#o-1"],
        ["customerRef", customerRef("t1", "buyer@example.com"), "CUSTOMER#buyer@example.com"],
        ["customerOrderRef", customerOrderRef("t1", "buyer@example.com", "o-1"), "CUSTORDER#buyer@example.com#o-1"],
        ["orderCounterRef", orderCounterRef("t1"), "COUNTER#ORDER"],
    ])("%s → exactly { TableName, Key: { PK, SK } }", (_name, ref, sk) => {
        expect(ref).toEqual({ TableName: TABLE, Key: { PK: "TENANT#t1", SK: sk } });
    });

    it("inputs are used as given: no trim, no case change, no second normalization", () => {
        expect(customerRef("T 1", " Buyer@Example.COM ").Key).toEqual({ PK: "TENANT#T 1", SK: "CUSTOMER# Buyer@Example.COM " });
        expect(orderRef("t1", "a#b").Key.SK).toBe("ORDER#a#b");
    });

    it("each call returns a new object: a handler that changes one reference changes no other", () => {
        const first = orderRef("t1", "o-1");
        (first.Key as Record<string, string>).SK = "changed";
        expect(orderRef("t1", "o-1").Key.SK).toBe("ORDER#o-1");
    });
});

describe("CMRC-1A T2 — prefix queries: the table and the key condition of one tenant", () => {
    it.each([
        ["ordersQuery", ordersQuery("t1"), "ORDER#"],
        ["customersQuery", customersQuery("t1"), "CUSTOMER#"],
        ["customerOrdersQuery", customerOrdersQuery("t1", "buyer@example.com"), "CUSTORDER#buyer@example.com#"],
    ])("%s → exactly { TableName, KeyConditionExpression, ExpressionAttributeValues }", (_name, query, prefix) => {
        expect(query).toEqual({
            TableName: TABLE,
            KeyConditionExpression: KEY_CONDITION,
            ExpressionAttributeValues: { ":pk": "TENANT#t1", ":sk": prefix },
        });
    });

    it("customerOrdersQuery ends with '#': the rows of buyer@example.com, not those of buyer@example.com.au", () => {
        const prefix = customerOrdersQuery("t1", "buyer@example.com").ExpressionAttributeValues[":sk"];
        expect("CUSTORDER#buyer@example.com#o-1".startsWith(prefix)).toBe(true);
        expect("CUSTORDER#buyer@example.com.au#o-2".startsWith(prefix)).toBe(false);
    });

    it("a handler's own values merge after the reference's and do not change the next reference", () => {
        const query = ordersQuery("t1");
        const values: Record<string, unknown> = { ...query.ExpressionAttributeValues, ":statusVal": "placed" };
        expect(values).toEqual({ ":pk": "TENANT#t1", ":sk": "ORDER#", ":statusVal": "placed" });
        expect(ordersQuery("t1").ExpressionAttributeValues).toEqual({ ":pk": "TENANT#t1", ":sk": "ORDER#" });
    });
});

describe("CMRC-1A T2 — the prefix list", () => {
    it("lists exactly the four commerce-private prefixes", () => {
        expect([...COMMERCE_PRIVATE_PREFIXES]).toEqual(["ORDER#", "CUSTORDER#", "CUSTOMER#", "COUNTER#ORDER"]);
    });

    it("every reference function builds a sort key that starts with a listed prefix", () => {
        const sortKeys = [
            orderRef("t", "x").Key.SK, customerRef("t", "x").Key.SK, customerOrderRef("t", "x", "y").Key.SK, orderCounterRef("t").Key.SK,
            ordersQuery("t").ExpressionAttributeValues[":sk"], customersQuery("t").ExpressionAttributeValues[":sk"],
            customerOrdersQuery("t", "x").ExpressionAttributeValues[":sk"],
        ];
        for (const sk of sortKeys) expect(COMMERCE_PRIVATE_PREFIXES.some((prefix) => sk.startsWith(prefix))).toBe(true);
    });
});
