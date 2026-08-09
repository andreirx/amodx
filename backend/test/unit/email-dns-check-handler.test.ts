import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

/**
 * slice email-2 — handler contract test for POST /email/dns-check.
 *
 * Asserts the two safety-critical invariants without AWS or a network:
 *   1. TENANT-SCOPING — a request with no x-tenant-id is rejected; the queried domain is
 *      DERIVED from the tenant record (never the request body).
 *   2. READ-ONLY — every DynamoDB command the handler issues is a GetCommand. Nothing it
 *      does can write DNS or the table.
 *
 * `../../src/lib/db.js` and `node:dns/promises` are mocked so this runs under
 * `npm run test:unit` (no credentials, no live resolver).
 */

const sendSpy = vi.fn();

vi.mock("../../src/lib/db.js", () => ({
    db: { send: (...args: any[]) => sendSpy(...args) },
    TABLE_NAME: "test-table",
}));

// Deterministic resolver: MX matches Google, TXT/CNAME empty (missing).
const resolveMx = vi.fn(async () => [{ exchange: "smtp.google.com.", priority: 1 }]);
const resolveTxt = vi.fn(async () => { const e: any = new Error("no data"); e.code = "ENODATA"; throw e; });
const resolveCname = vi.fn(async () => { const e: any = new Error("nx"); e.code = "ENOTFOUND"; throw e; });

vi.mock("node:dns/promises", () => ({
    Resolver: class {
        setServers() { /* no-op */ }
        resolveMx = resolveMx;
        resolveTxt = resolveTxt;
        resolveCname = resolveCname;
    },
}));

// Imported AFTER the mocks are registered.
const { handler } = await import("../../src/email/dns-check.js");

function makeEvent(opts: { tenantId?: string; role?: string; body?: unknown }) {
    return {
        headers: opts.tenantId ? { "x-tenant-id": opts.tenantId } : {},
        requestContext: {
            authorizer: { lambda: { role: opts.role ?? "TENANT_ADMIN", tenantId: opts.tenantId, sub: "u1", email: "a@b.c" } },
            http: { sourceIp: "1.2.3.4" },
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    } as any;
}

beforeEach(() => {
    sendSpy.mockReset();
    // Re-establish default resolver behaviour each test so a per-test override
    // (mockResolvedValue in the Zoho/M365 cases) cannot leak into the next test.
    resolveMx.mockReset();
    resolveTxt.mockReset();
    resolveCname.mockReset();
    resolveMx.mockResolvedValue([{ exchange: "smtp.google.com.", priority: 1 }]);
    resolveTxt.mockImplementation(async () => { const e: any = new Error("no data"); e.code = "ENODATA"; throw e; });
    resolveCname.mockImplementation(async () => { const e: any = new Error("nx"); e.code = "ENOTFOUND"; throw e; });
    // Default: tenant record with a domain.
    sendSpy.mockResolvedValue({ Item: { domain: "example.com" } });
});

describe("dns-check handler — tenant-scoping", () => {
    it("rejects a request with no x-tenant-id (400) and touches neither DB nor DNS", async () => {
        const res = await handler(makeEvent({ tenantId: undefined, body: { provider: "google-workspace" } }), {} as any, {} as any) as any;
        expect(res.statusCode).toBe(400);
        expect(sendSpy).not.toHaveBeenCalled();
        expect(resolveMx).not.toHaveBeenCalled();
    });

    it("rejects a caller scoped to a different tenant (403)", async () => {
        const ev = makeEvent({ tenantId: "t1", body: { provider: "google-workspace" } });
        ev.requestContext.authorizer.lambda.tenantId = "OTHER"; // token scope != x-tenant-id
        const res = await handler(ev, {} as any, {} as any) as any;
        expect(res.statusCode).toBe(403);
    });

    it("rejects an unknown provider (400) before any DB read", async () => {
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "nope" } }), {} as any, {} as any) as any;
        expect(res.statusCode).toBe(400);
        expect(sendSpy).not.toHaveBeenCalled();
    });

    it("derives the queried domain from the tenant record, not the body", async () => {
        // Body carries a hostile 'domain' that must be ignored.
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "google-workspace", domain: "attacker.example" } }), {} as any, {} as any) as any;
        expect(res.statusCode).toBe(200);
        const key = sendSpy.mock.calls[0][0].input.Key;
        expect(key).toEqual({ PK: "SYSTEM", SK: "TENANT#t1" });
        const body = JSON.parse(res.body);
        expect(body.domain).toBe("example.com");
        // MX row was resolved against the DERIVED domain.
        expect(resolveMx).toHaveBeenCalledWith("example.com");
    });

    it("returns 404 when the tenant has no configured domain", async () => {
        sendSpy.mockResolvedValueOnce({ Item: {} });
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "google-workspace" } }), {} as any, {} as any) as any;
        expect(res.statusCode).toBe(404);
    });
});

describe("dns-check handler — read-only + result mapping", () => {
    it("only ever issues GetCommand against DynamoDB (never a write)", async () => {
        await handler(makeEvent({ tenantId: "t1", body: { provider: "google-workspace" } }), {} as any, {} as any);
        expect(sendSpy).toHaveBeenCalledTimes(1);
        for (const call of sendSpy.mock.calls) {
            expect(call[0]).toBeInstanceOf(GetCommand);
        }
    });

    it("maps a matching MX and a missing TXT, and omits checkable:false rows", async () => {
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "google-workspace" } }), {} as any, {} as any) as any;
        const body = JSON.parse(res.body);
        const mx = body.records.find((r: any) => r.type === "MX");
        const spf = body.records.find((r: any) => r.type === "TXT" && r.host === "@");
        expect(mx.status).toBe("match");
        expect(spf.status).toBe("missing");
        // The DKIM row (checkable:false) is never queried nor returned.
        expect(body.records.some((r: any) => r.host === "google._domainkey")).toBe(false);
        expect(body.queriedAt).toBeTruthy();
        expect(body.ambiguityNote).toMatch(/not a permanent verdict/i);
    });

    it("carries a per-row recordIndex and observed MX (exchange+priority) on the result DTO", async () => {
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "google-workspace" } }), {} as any, {} as any) as any;
        const body = JSON.parse(res.body);
        for (const r of body.records) expect(typeof r.recordIndex).toBe("number");
        const mx = body.records.find((r: any) => r.type === "MX");
        expect(mx.expectedPriority).toBe(1);
        expect(mx.observedMx).toEqual([{ exchange: "smtp.google.com.", priority: 1 }]);
        expect(mx.observedTtl).toBeNull();
    });
});

describe("dns-check handler — Zoho's three MX rows are assessed independently", () => {
    it("returns three MX results with distinct recordIndex, each matched to its own priority", async () => {
        // One DNS query for `@` returns all three MX; each recipe MX row is judged on its own.
        resolveMx.mockResolvedValue([
            { exchange: "mx.zoho.com.", priority: 10 },
            { exchange: "mx2.zoho.com.", priority: 20 },
            { exchange: "mx3.zoho.com.", priority: 50 },
        ]);
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "zoho-mail" } }), {} as any, {} as any) as any;
        const body = JSON.parse(res.body);
        const mxRows = body.records.filter((r: any) => r.type === "MX");
        expect(mxRows).toHaveLength(3);
        // Collision-free identity: three distinct recordIndex values, not one collapsed row.
        expect(new Set(mxRows.map((r: any) => r.recordIndex)).size).toBe(3);
        for (const row of mxRows) expect(row.status).toBe("match");
        expect(mxRows.map((r: any) => r.expected).sort()).toEqual(["mx.zoho.com", "mx2.zoho.com", "mx3.zoho.com"]);
    });
});

describe("dns-check handler — Microsoft 365 derived MX is server-authoritative", () => {
    it("queries and expects the domain-derived M365 MX target, not a blank value", async () => {
        // For example.com the derived target is example-com.mail.protection.outlook.com.
        resolveMx.mockResolvedValue([{ exchange: "example-com.mail.protection.outlook.com.", priority: 0 }]);
        const res = await handler(makeEvent({ tenantId: "t1", body: { provider: "microsoft-365" } }), {} as any, {} as any) as any;
        const body = JSON.parse(res.body);
        const mx = body.records.find((r: any) => r.type === "MX");
        expect(mx.expected).toBe("example-com.mail.protection.outlook.com");
        expect(mx.status).toBe("match");
        // The DKIM CNAME selectors (checkable:false) are guidance-only — never queried/returned.
        expect(body.records.some((r: any) => r.host.includes("_domainkey"))).toBe(false);
        expect(resolveCname).toHaveBeenCalledWith("autodiscover.example.com");
    });
});
