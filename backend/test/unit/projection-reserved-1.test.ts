import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { BatchGetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DYNAMO_RESERVED_WORDS } from "../../src/lib/dynamo-reserved-words.js";
import { assertNoBareReservedWord, bareReservedWords, scanExpressionSites, type ExpressionSite } from "./dynamo-expression-guard.js";
import { MemoryTable } from "./memory-table.js";

/**
 * PROJECTION-RESERVED-1 (docs/slices/projection-reserved-1.md). DynamoDB refuses an expression that names a reserved
 * word bare; `GET /orders` and `GET /reviews` answered 500 on staging for that. Three layers here:
 *  1. the rule itself (`bareReservedWords`, `assertNoBareReservedWord`) against DynamoDB's documented behaviour;
 *  2. the four backend handlers the audit fixed, run against MemoryTable — the `dynamo-reserved-setup.ts` guard
 *     makes each answer 500 with DynamoDB's message when its expression names `total` / `items` / `source` bare;
 *  3. the static scan of every expression written in the repository's DynamoDB-reaching code.
 */

const holder = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "fake-signed-link" }));

import { handler as listOrders } from "../../src/orders/list.js";
import { handler as listReviews } from "../../src/reviews/list.js";
import { handler as reportSummary } from "../../src/reports/summary.js";
import { downloadHandler } from "../../src/resources/presign.js";

const ROOT = path.resolve(__dirname, "../../..");
const T = "t1";
const PK = `TENANT#${T}`;
const call = async (h: any, event: any) => {
    const res = await h(event, {} as any, () => {});
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};
const event = (role: string, extra: Record<string, unknown> = {}) => ({
    headers: { "x-tenant-id": T },
    requestContext: { authorizer: { lambda: { sub: "u1", email: "owner@example.com", role, tenantId: T } } },
    ...extra,
});

describe("the reserved-word rule", () => {
    it("the list is the official one: 573 upper-case words, including the three of the defect", () => {
        expect(DYNAMO_RESERVED_WORDS.size).toBe(573);
        expect([...DYNAMO_RESERVED_WORDS].every((w) => /^[A-Z_]+$/.test(w))).toBe(true);
        for (const w of ["TOTAL", "SOURCE", "ITEMS", "STATUS", "NAME", "DATA"]) expect(DYNAMO_RESERVED_WORDS.has(w)).toBe(true);
    });

    it("flags a bare reserved name, compared without regard to case, in a nested path too", () => {
        expect(bareReservedWords("id, orderNumber, #s, total, currency", "ProjectionExpression")).toEqual(["total"]);
        expect(bareReservedWords("Status, who.name, #images[0].source", "ProjectionExpression")).toEqual(["Status", "name", "source"]);
    });

    it("does not flag an alias, a value placeholder, a function, an operator, or an update clause keyword", () => {
        expect(bareReservedWords("#total, #source, #items", "ProjectionExpression")).toEqual([]);
        expect(bareReservedWords("PK = :pk AND begins_with(SK, :sk)", "KeyConditionExpression")).toEqual([]);
        expect(bareReservedWords("attribute_not_exists(SK) OR NOT contains(tags, :t) AND size(tags) BETWEEN :a AND :b", "ConditionExpression")).toEqual([]);
        expect(bareReservedWords("SET a = if_not_exists(a, :z) + :one, l = list_append(l, :x) REMOVE b ADD c :c DELETE d :d", "UpdateExpression")).toEqual([]);
    });

    it("a keyword of one expression kind is a name in another (SET in a projection is a bare reserved name)", () => {
        expect(bareReservedWords("set", "ProjectionExpression")).toEqual(["set"]);
        expect(bareReservedWords("#a = :a AND size > :n", "FilterExpression")).toEqual(["size"]);
    });

    it("assertNoBareReservedWord throws DynamoDB's ValidationException text, for each command shape", () => {
        const refused = (input: unknown) => { try { assertNoBareReservedWord(input); return null; } catch (e: any) { return `${e.name}: ${e.message}`; } };
        expect(refused({ ProjectionExpression: "id, total" }))
            .toBe("ValidationException: Invalid ProjectionExpression: Attribute name is a reserved keyword; reserved keyword: total");
        expect(refused({ RequestItems: { t: { Keys: [], ProjectionExpression: "items" } } }))
            .toBe("ValidationException: Invalid ProjectionExpression: Attribute name is a reserved keyword; reserved keyword: items");
        expect(refused({ TransactItems: [{ Update: { UpdateExpression: "SET data = :d" } }] }))
            .toBe("ValidationException: Invalid UpdateExpression: Attribute name is a reserved keyword; reserved keyword: data");
        // Item data is not an expression: an attribute VALUE may be any word.
        expect(refused({ Item: { ProjectionExpression: "total" }, ExpressionAttributeValues: { ":x": "total" } })).toBeNull();
    });

    it("every unit test file gets the guard: constructing a command with a bare reserved word throws (dynamo-reserved-setup.ts)", () => {
        expect(() => new QueryCommand({ TableName: "x", KeyConditionExpression: "PK = :pk", ProjectionExpression: "total" } as any))
            .toThrow("Invalid ProjectionExpression: Attribute name is a reserved keyword; reserved keyword: total");
        expect(() => new UpdateCommand({ TableName: "x", Key: {}, UpdateExpression: "SET #total = :t", ConditionExpression: "source = :s" } as any))
            .toThrow("Invalid ConditionExpression: Attribute name is a reserved keyword; reserved keyword: source");
        expect(() => new BatchGetCommand({ RequestItems: { x: { Keys: [{}], ProjectionExpression: "#items" } } } as any)).not.toThrow();
        expect(() => new TransactWriteCommand({ TransactItems: [{ ConditionCheck: { TableName: "x", Key: {}, ConditionExpression: "attribute_exists(SK)" } }] } as any)).not.toThrow();
        // The guard keeps the class name and instanceof (the doubles dispatch on both).
        const cmd = new QueryCommand({ TableName: "x", KeyConditionExpression: "PK = :pk" } as any);
        expect(cmd.constructor.name).toBe("QueryCommand");
        expect(cmd).toBeInstanceOf(QueryCommand);
    });
});

describe("the handlers the audit fixed answer with the reserved-word attributes (MemoryTable + the guard)", () => {
    beforeEach(() => { holder.table = new MemoryTable(); });

    it("GET /orders (orders/list.ts, `total`): 200, each order with its total", async () => {
        holder.table.put({ PK, SK: "ORDER#o1", id: "o1", orderNumber: "PPB-0001", status: "placed", total: 120, currency: "RON", createdAt: "2026-11-01T10:00:00.000Z", items: [{ productId: "p1" }] });
        holder.table.put({ PK, SK: "ORDER#o2", id: "o2", orderNumber: "PPB-0002", status: "confirmed", total: 80, currency: "RON", createdAt: "2026-11-02T10:00:00.000Z" });
        expect(await call(listOrders, event("TENANT_ADMIN"))).toEqual({
            statusCode: 200,
            body: { items: [
                { id: "o2", orderNumber: "PPB-0002", status: "confirmed", total: 80, currency: "RON", createdAt: "2026-11-02T10:00:00.000Z" },
                { id: "o1", orderNumber: "PPB-0001", status: "placed", total: 120, currency: "RON", createdAt: "2026-11-01T10:00:00.000Z" },
            ] },
        });
    });

    it("GET /reviews (reviews/list.ts, `source`): 200, each review with its source", async () => {
        holder.table.put({ PK, SK: "REVIEW#p1#r1", id: "r1", productId: "p1", scope: "product", authorName: "Ana", rating: 5, content: "ok", source: "google", status: "approved", createdAt: "2026-11-01T10:00:00.000Z" });
        holder.table.put({ PK, SK: "SITEREVIEW#r2", id: "r2", scope: "site", authorName: "Ion", rating: 4, content: "fine", source: "manual", status: "pending", createdAt: "2026-11-03T10:00:00.000Z" });
        expect(await call(listReviews, event("TENANT_ADMIN"))).toEqual({
            statusCode: 200,
            body: { items: [
                { id: "r2", scope: "site", authorName: "Ion", rating: 4, content: "fine", source: "manual", status: "pending", createdAt: "2026-11-03T10:00:00.000Z" },
                { id: "r1", productId: "p1", scope: "product", authorName: "Ana", rating: 5, content: "ok", source: "google", status: "approved", createdAt: "2026-11-01T10:00:00.000Z" },
            ] },
        });
    });

    it("GET /reports/summary (reports/summary.ts, `total` and `items`): 200, revenue and top products from them", async () => {
        holder.table.put({ PK, SK: "ORDER#o1", id: "o1", status: "delivered", total: 120, currency: "RON", paymentMethod: "cod", paymentStatus: "paid", createdAt: "2026-11-01T10:00:00.000Z", items: [{ productId: "p1", productTitle: "Ring", quantity: 2, unitPrice: 60, totalPrice: 120 }] });
        const res = await call(reportSummary, event("TENANT_ADMIN"));
        expect(res).toMatchObject({ statusCode: 200 });
        expect(JSON.stringify(res.body)).toContain("120");
        expect(JSON.stringify(res.body)).toContain("p1");
    });

    const download = () => {
        const customer = event("CUSTOMER", { pathParameters: { id: "res1" } });
        customer.requestContext.authorizer.lambda.email = "buyer@example.com";
        return call(downloadHandler, customer);
    };
    const seedResource = () => {
        holder.table.put({ PK, SK: "RESOURCE#res1", id: "res1", s3Key: `${T}/res1-file.pdf` });
        holder.table.put({ PK, SK: "PRODUCT#p1", id: "p1", resourceId: "res1" });
    };

    it("GET /resources/{id}/download-url (resources/presign.ts, `items`): the CUSTORDER# item as orders/create.ts stores it (no `items`) → 403 purchase, not 500", async () => {
        seedResource();
        holder.table.put({ PK, SK: "CUSTORDER#buyer@example.com#o1", orderNumber: "PPB-0001", total: 50, status: "placed", createdAt: "2026-11-01T10:00:00.000Z", Type: "CustomerOrder" });
        // The live answer after the fix: F-CMRC1-PRESIGN-ENTITLEMENT (docs/TECH-DEBT.md) — the stored item has no `items`.
        expect(await download()).toEqual({ statusCode: 403, body: { error: "Purchase required to download this resource" } });
    });

    it("GET /resources/{id}/download-url: the `#items` alias maps to `items` (an item that HAS `items` with the product → 200)", async () => {
        seedResource();
        holder.table.put({ PK, SK: "CUSTORDER#buyer@example.com#o1", items: [{ productId: "p1" }] });
        expect(await download()).toEqual({ statusCode: 200, body: { downloadUrl: "fake-signed-link" } });
    });
});

describe("the rule for every replacement of @aws-sdk/lib-dynamodb in the unit tests", () => {
    it("each test file that replaces the module returns it through guardCommandClasses (no bypass of the guard)", () => {
        const dir = path.join(ROOT, "backend/test/unit");
        const replacing = readdirSync(dir).filter((f) => f.endsWith(".ts"))
            .filter((f) => /vi\.(do)?[mM]ock\(\s*["'`]@aws-sdk\/lib-dynamodb["'`]/.test(readFileSync(path.join(dir, f), "utf-8")));
        const unguarded = replacing.filter((f) => !readFileSync(path.join(dir, f), "utf-8").includes("guardCommandClasses("));
        expect(unguarded).toEqual([]);
        // The setup file and the four files of review finding PR1-GUARD-BYPASS; a new replacement joins this list.
        expect(replacing.sort()).toEqual([
            "debounce-flush.test.ts", "debounce-maxwait.test.ts", "dynamo-reserved-setup.ts", "invalidate-cdn.test.ts",
            "lang-1b-deferred-flush.test.ts",
        ]);
    });
});

// ─── The static scan ────────────────────────────────────────────────────────────────────────────────────────────

/** The code that reaches DynamoDB: handlers, the renderer, the operator scripts, the MCP server, the staging tests. */
const SCANNED = ["backend/src", "renderer/src", "scripts", "tools/mcp-server/src", "tools/mcp-server/scripts", "tests"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".open-next"]);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const p = path.join(dir, entry);
        if (SKIPPED_DIRS.has(entry)) return [];
        if (statSync(p).isDirectory()) return sourceFiles(p);
        return /\.(ts|tsx|mjs)$/.test(entry) && !entry.endsWith(".d.ts") ? [p] : [];
    });
}

/**
 * The sites whose expression has a part only known at run time in a position where a BARE name can stand, by
 * `file kind` → count. Each is audited by hand in docs/slices/projection-reserved-1.md § "Run-time sites": content
 * (`keyAsRead` → `translationKey` only), glam-images (`set` holds `#alias = :value` only), scheduling-db (every name
 * goes through `Expr.path`, which returns `#n<i>`). A new or extra such site fails this test until it is audited and
 * added here.
 */
const AUDITED_RUNTIME_SITES: Record<string, number> = {
    "backend/src/content/create.ts ConditionExpression": 1,
    "backend/src/content/update.ts ConditionExpression": 2,
    "backend/src/import/glam-images.ts UpdateExpression": 1,
    "backend/src/lib/scheduling-db.ts ProjectionExpression": 2,
    "backend/src/lib/scheduling-db.ts UpdateExpression": 3,
    "backend/src/lib/scheduling-db.ts ConditionExpression": 3,
};

/**
 * Review finding PR1-STATIC-FALSE-CLEAN: the scan must never call an expression clean when the code changes it in a way
 * the scan does not model, nor miss a site because of how its key is written. Each probe must end as "reserved found"
 * or "unresolved" (never silently clean); each control is a form the scan models and must stay resolved and clean.
 */
describe("the scan fails closed (sources scanned from text)", () => {
    const verdict = (src: string) => scanExpressionSites("/virtual/probe.ts", src).map((s) => ({
        kind: s.kind,
        reserved: [...new Set(s.texts.flatMap((t) => bareReservedWords(t, s.kind)))],
        unresolved: s.unresolved.length > 0,
    }));
    const P = "ProjectionExpression";

    it("a `+=` tail that could join a token (`\"tot\" += \"al\"`) → unresolved", () => {
        expect(verdict(`let p = "tot"; p += "al"; send({ ProjectionExpression: p });`)).toEqual([{ kind: P, reserved: [], unresolved: true }]);
    });
    it("a reassigned `let` array → unresolved", () => {
        expect(verdict(`let p = ["id"]; p = ["total"]; send({ ProjectionExpression: p.join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
    });
    it("a property written after its initializer → both values are checked (`total` found)", () => {
        expect(verdict(`const p = { expression: "id" }; p.expression = "total"; send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
    });
    it("a computed key, literal or a resolvable `const`, is a site", () => {
        expect(verdict(`send({ ["ProjectionExpression"]: "total" });`)).toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
        expect(verdict(`const K = "ProjectionExpression"; send({ [K]: "total" });`)).toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
    });
    it("an element assignment `input[\"ProjectionExpression\"] = …` is a site", () => {
        expect(verdict(`const input: any = {}; input["ProjectionExpression"] = "total";`)).toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
    });
    it("an array or object passed to a call, aliased or exported, a `splice`, or a computed-key write → unresolved", () => {
        expect(verdict(`const parts = ["id"]; addMore(parts); send({ ProjectionExpression: parts.join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
        expect(verdict(`const parts = ["id"]; parts.splice(0, 0, "x"); send({ ProjectionExpression: parts.join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
        expect(verdict(`const p = { expression: "id" }; mutate(p); send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
        expect(verdict(`const p: any = { expression: "id" }; p[k] = "total"; send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);        // Exported: a file the scan does not read may write it.
        expect(verdict(`export const p = { expression: "id" }; send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
        expect(verdict(`export const parts = ["id"]; send({ ProjectionExpression: parts.join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
        // An alias: the write goes through `q`, the read through `p`.
        expect(verdict(`const p = { expression: "id" }; const q = p; q.expression = "total"; send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: [], unresolved: true }]);
    });
    it.each([
        ["a call through a bracket (`p[\"push\"]`)", `const p = ["id"]; p["push"]("total"); send({ ProjectionExpression: p.join(", ") });`],
        ["`splice` through a bracket", `const p = ["id"]; p["splice"](0, 1, "total"); send({ ProjectionExpression: p.join(", ") });`],
        ["a method that writes through `this`", `const p = { expression: "id", change() { this.expression = "total"; } }; p.change(); send({ ProjectionExpression: p.expression });`],
        ["a callback with an `array` parameter", `const p = ["id"]; p.forEach((v, i, a) => { a[i] = "total"; }); send({ ProjectionExpression: p.join(", ") });`],
        ["a separate `export { p }`", `const p = { expression: "id" }; export { p }; send({ ProjectionExpression: p.expression });`],
        ["`export default p`", `const p = ["id"]; export default p; send({ ProjectionExpression: p.join(", ") });`],
        ["a getter (computes the value in code the scan does not follow)", `const p = { get expression() { return "total"; } }; send({ ProjectionExpression: p.expression });`],
    ])("review-1 case → unresolved: %s", (_label, src) => {
        expect(verdict(src)).toEqual([{ kind: P, reserved: [], unresolved: true }]);
    });
    it("review-1 controls: read-only calls with a two-parameter arrow callback stay resolved", () => {
        expect(verdict(`const p = ["id", "#s"]; p.forEach((v, i) => log(v, i)); send({ ProjectionExpression: p.join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: false }]);
        expect(verdict(`const f = ["a", "b"]; send({ ProjectionExpression: f.map((x) => \`#\${x}\`).join(", ") });`))
            .toEqual([{ kind: P, reserved: [], unresolved: false }]);
        expect(verdict(`const p = ["id"]; if (p.includes("id")) p.push("total"); send({ ProjectionExpression: p.join(", ") });`))
            .toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
        expect(verdict(`const p = { expression: "id, #s" }; send({ ProjectionExpression: p.expression });`))
            .toEqual([{ kind: P, reserved: [], unresolved: false }]);
    });
    it("controls: the modelled forms stay resolved and clean, and a bare word in them is still found", () => {
        expect(verdict(`let e = "SET #s = :s"; if (x) e += ", trackingNumber = :t"; send({ UpdateExpression: e });`))
            .toEqual([{ kind: "UpdateExpression", reserved: [], unresolved: false }]);
        expect(verdict(`let e = "SET #s = :s"; if (x) e += ", total = :t"; send({ UpdateExpression: e });`))
            .toEqual([{ kind: "UpdateExpression", reserved: ["total"], unresolved: false }]);
        expect(verdict(`const parts = ["#a = :a"]; parts.push("b = :b"); send({ UpdateExpression: "SET " + parts.join(", ") });`))
            .toEqual([{ kind: "UpdateExpression", reserved: [], unresolved: false }]);
        expect(verdict(`const params: any = { FilterExpression: "#s = :p" }; params.FilterExpression += " AND contains(tags, :t)"; new QueryCommand(params);`))
            .toEqual([{ kind: "FilterExpression", reserved: [], unresolved: false }, { kind: "FilterExpression", reserved: [], unresolved: false }]);
        expect(verdict(`send({ ProjectionExpression: "total" });`)).toEqual([{ kind: P, reserved: ["total"], unresolved: false }]);
    });
});

describe("the static scan of every DynamoDB expression in the repository", () => {
    const files = [
        ...SCANNED.flatMap((d) => sourceFiles(path.join(ROOT, d))),
        // backend/test/*.ts (not unit/): the staging integration suites send real commands.
        ...readdirSync(path.join(ROOT, "backend/test")).filter((f) => f.endsWith(".ts")).map((f) => path.join(ROOT, "backend/test", f)),
    ];
    const sites: ExpressionSite[] = files.flatMap((f) => scanExpressionSites(f))
        .map((s) => ({ ...s, file: path.relative(ROOT, s.file) }));

    it("finds the expressions (the audit counted 301 sites; a much smaller number means the scan broke)", () => {
        expect(sites.length).toBeGreaterThanOrEqual(290);
    });

    it("no expression names a reserved word bare", () => {
        const found = sites.flatMap((s) => [...new Set(s.texts.flatMap((t) => bareReservedWords(t, s.kind)))]
            .map((w) => `${s.file}:${s.line} ${s.kind}: ${w}`));
        expect(found).toEqual([]);
    });

    it("every site with a run-time part in name position is one the slice audited by hand", () => {
        const counts: Record<string, number> = {};
        for (const s of sites.filter((x) => x.unresolved.length > 0)) {
            const key = `${s.file} ${s.kind}`;
            counts[key] = (counts[key] ?? 0) + 1;
        }
        expect(counts).toEqual(AUDITED_RUNTIME_SITES);
    });
});
