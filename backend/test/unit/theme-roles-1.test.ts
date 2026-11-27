import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table";

/**
 * THEME-ROLES-1 (docs/slices/theme-roles-1.md § The rule, § Proofs) — who may write the shared theme library.
 * The real handlers of backend/src/themes/manage.ts (wrapped in withInvalidation, as deployed) against the in-memory
 * table; only `db.js` is replaced. The reserved-word guard comes from the setup file (vitest.unit.config.ts).
 * One row per caller × operation. Callers: the contexts the Lambda authorizer gives (backend/src/auth/authorizer.ts);
 * SERVICE is refused by the authorizer before any Lambda runs (SERVICE_ROUTE_SCOPES has no theme route), so its rows
 * pin the handler-level defence only. Rows marked "preservation" pin today's behaviour of an allowed call.
 * Credential-free.
 */

const h = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));

import { createHandler, deleteHandler, listHandler } from "../../src/themes/manage.js";

const NOW = "2026-11-28T09:00:00.000Z";
const UUID = "00000000-0000-4000-8000-000000000001";
const STORED = { PK: "SYSTEM", SK: "THEME#stored-1", id: "stored-1", name: "Autumn", theme: { primaryColor: "#123456" }, createdBy: "u-other", createdAt: "2026-11-01T00:00:00.000Z", Type: "Theme" };

type Caller = { name: string; ctx: Record<string, string> };
const CALLERS: Record<string, Caller> = {
    GLOBAL_ADMIN: { name: "GLOBAL_ADMIN", ctx: { sub: "u-global", email: "g@agency.test", role: "GLOBAL_ADMIN", tenantId: "" } },
    MASTER_KEY: { name: "MASTER_KEY", ctx: { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" } },
    TENANT_ADMIN: { name: "TENANT_ADMIN", ctx: { sub: "u-admin", email: "a@site.test", role: "TENANT_ADMIN", tenantId: "t1" } },
    EDITOR: { name: "EDITOR", ctx: { sub: "u-editor", email: "e@site.test", role: "EDITOR", tenantId: "t1" } },
    NO_ROLE: { name: "NO_ROLE", ctx: { sub: "u-norole", tenantId: "t1" } },
    RENDERER: { name: "RENDERER", ctx: { sub: "renderer", role: "RENDERER", tenantId: "ALL" } },
    CUSTOMER: { name: "CUSTOMER", ctx: { sub: "c-1", email: "c@buyer.test", role: "CUSTOMER", tenantId: "t1" } },
    SERVICE: { name: "SERVICE", ctx: { sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read,catalog:write,leads:read", keyId: "k1" } },
};

/** The refusal message `requireRole` (backend/src/auth/policy.ts) throws, per caller and allowed list. */
const refusal = (caller: string, list: string) =>
    caller === "SERVICE" ? "Access Denied: this route is not available to service keys"
        : `Access Denied: Role '${caller === "NO_ROLE" ? "EDITOR" : caller}' is not in [${list}]`;

const event = (ctx: Record<string, string>, extra: Record<string, unknown> = {}) =>
    ({ requestContext: { authorizer: { lambda: ctx } }, headers: { "x-tenant-id": "t1" }, ...extra }) as any;
const call = (handler: any, ev: any) => handler(ev, {} as any, () => {});

let table: MemoryTable;
beforeEach(() => {
    table = new MemoryTable();
    h.table = table;
    table.put(STORED);
    table.commands = [];
    table.writes = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(UUID);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("THEME-ROLES-1 — GET /themes (list): every caller, as today", () => {
    for (const c of Object.values(CALLERS)) {
        it(`TR1-B-LIST-${c.name} (preservation): 200 and the stored items`, async () => {
            const res = await call(listHandler, event(c.ctx));
            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ items: [STORED] }));
        });
    }
});

describe("THEME-ROLES-1 — POST /themes (save): GLOBAL_ADMIN and TENANT_ADMIN", () => {
    const body = JSON.stringify({ name: "Winter", theme: { primaryColor: "#0044aa", fontHeading: "Prata" } });

    for (const name of ["GLOBAL_ADMIN", "MASTER_KEY", "TENANT_ADMIN"]) {
        it(`TR1-B-SAVE-${name} (preservation): 201; the item written and the body are byte-equal to today's shape`, async () => {
            const c = CALLERS[name];
            const res = await call(createHandler, event(c.ctx, { body }));
            const expected = {
                PK: "SYSTEM", SK: `THEME#${UUID}`, id: UUID, name: "Winter", theme: { primaryColor: "#0044aa", fontHeading: "Prata" },
                createdBy: c.ctx.sub, createdAt: NOW, Type: "Theme",
            };
            expect(res.statusCode).toBe(201);
            expect(res.body).toBe(JSON.stringify(expected));
            const themeWrites = table.writes.filter((w) => String(w.SK).startsWith("THEME#"));
            expect(themeWrites.map((w) => JSON.stringify(w))).toEqual([JSON.stringify(expected)]);
            expect(table.get("SYSTEM", "CDN_PENDING"), "the bulk CDN marker (withInvalidation, as today)").toBeTruthy();
        });
    }

    for (const name of ["EDITOR", "NO_ROLE", "RENDERER", "CUSTOMER", "SERVICE"]) {
        it(`TR1-B-SAVE-${name}: 403 with the role-refusal body; no command sent`, async () => {
            const res = await call(createHandler, event(CALLERS[name].ctx, { body }));
            expect(res.statusCode).toBe(403);
            expect(res.body).toBe(JSON.stringify({ error: refusal(name, "GLOBAL_ADMIN, TENANT_ADMIN") }));
            expect(table.commands, "no read, no write, no CDN marker").toEqual([]);
            expect(table.all("THEME#")).toEqual([STORED]);
        });
    }

    it("TR1-B-REFUSAL-NOT-500: a refused save with a body that is not JSON answers 403, not 500", async () => {
        const res = await call(createHandler, event(CALLERS.EDITOR.ctx, { body: "{not json" }));
        expect(res.statusCode).toBe(403);
        expect(table.commands).toEqual([]);
    });
});

describe("THEME-ROLES-1 — DELETE /themes/{id}: GLOBAL_ADMIN only", () => {
    for (const name of ["GLOBAL_ADMIN", "MASTER_KEY"]) {
        it(`TR1-B-DELETE-${name} (preservation): 200; the key SYSTEM / THEME#<id> deleted`, async () => {
            const res = await call(deleteHandler, event(CALLERS[name].ctx, { pathParameters: { id: "stored-1" } }));
            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ message: "Deleted" }));
            const deletes = table.commands.filter((c) => c instanceof DeleteCommand);
            expect(deletes.map((d) => d.input)).toEqual([{ TableName: "test-table", Key: { PK: "SYSTEM", SK: "THEME#stored-1" } }]);
            expect(table.get("SYSTEM", "THEME#stored-1")).toBeUndefined();
        });
    }

    for (const name of ["TENANT_ADMIN", "EDITOR", "NO_ROLE", "RENDERER", "CUSTOMER", "SERVICE"]) {
        it(`TR1-B-DELETE-${name}: 403 with the role-refusal body; no command sent; the theme still stored`, async () => {
            const res = await call(deleteHandler, event(CALLERS[name].ctx, { pathParameters: { id: "stored-1" } }));
            expect(res.statusCode).toBe(403);
            expect(res.body).toBe(JSON.stringify({ error: refusal(name, "GLOBAL_ADMIN") }));
            expect(table.commands, "no delete, no CDN marker").toEqual([]);
            expect(table.get("SYSTEM", "THEME#stored-1")).toEqual(STORED);
        });
    }
});
