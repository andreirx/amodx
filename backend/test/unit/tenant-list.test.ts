import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

// Real handler and SDK command objects; only the database transport is replaced. No AWS call.
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send }, TABLE_NAME: "sched-menu-test" }));
import { handler } from "../../src/tenant/list.js";

const stored = {
    id: "site-a", name: "Site A", domain: "a.test", status: "active", commerceEnabled: true,
    catalogMode: false, currency: "RON", locale: "ro-RO", countryCode: "RO",
};
const invoke = (role: string, tenantId: string) => handler({
    requestContext: { authorizer: { lambda: { role, tenantId, sub: "admin" } } },
} as any, {} as any, () => {});

beforeEach(() => send.mockReset());

describe("SCHED-MENU-1 — tenant list schedulingEnabled is strictly boolean", () => {
    for (const role of ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"]) {
        for (const [name, fields, expected] of [
            ["absent", {}, false],
            ["true", { schedulingEnabled: true }, true],
            ["false", { schedulingEnabled: false }, false],
            ["non-boolean string", { schedulingEnabled: "true" }, false],
            ["non-boolean number", { schedulingEnabled: 1 }, false],
            ["null", { schedulingEnabled: null }, false],
        ] as const) {
            it(`${role}: stored ${name} → ${expected}; only the one new field is returned`, async () => {
                const item = { ...stored, ...fields, integrations: { private: "not returned" }, scheduling: { timezone: "UTC" } };
                send.mockResolvedValue(role === "GLOBAL_ADMIN" ? { Items: [item] } : { Item: item });
                const response = await invoke(role, "site-a");
                expect(response).toMatchObject({ statusCode: 200 });
                expect(JSON.parse((response as any).body)).toEqual({ items: [{ ...stored, schedulingEnabled: expected }] });
                expect(send).toHaveBeenCalledTimes(1);
                const command = send.mock.calls[0][0];
                if (role === "GLOBAL_ADMIN") {
                    expect(command).toBeInstanceOf(QueryCommand);
                    expect(command.input.KeyConditionExpression).toBe("PK = :pk AND begins_with(SK, :sk)");
                    expect(command.input.ExpressionAttributeValues).toEqual({ ":pk": "SYSTEM", ":sk": "TENANT#" });
                    expect(command.input.ProjectionExpression).toBe("id, #name, #domain, #status, commerceEnabled, schedulingEnabled, catalogMode, currency, locale, countryCode");
                    expect(command.input.ExpressionAttributeNames).toEqual({ "#name": "name", "#domain": "domain", "#status": "status" });
                } else {
                    expect(command).toBeInstanceOf(GetCommand);
                    expect(command.input.Key).toEqual({ PK: "SYSTEM", SK: "TENANT#site-a" });
                }
            });
        }
    }

    it("missing tenant → empty list; no tenant binding → no database request", async () => {
        send.mockResolvedValue({});
        expect(JSON.parse((await invoke("EDITOR", "site-a") as any).body)).toEqual({ items: [] });
        send.mockClear();
        expect(JSON.parse((await invoke("EDITOR", "GLOBAL") as any).body)).toEqual({ items: [] });
        expect(send).not.toHaveBeenCalled();
    });
});
