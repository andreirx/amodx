import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { MemoryTable } from "./memory-table.js";

/**
 * CAT-INTEREST-1 — integration rows (slice docs/slices/cat-interest-1.md § 5 "Integration"; contract
 * docs/slices/catalog-mode-1.md § 3.5). The real `interest/public.ts` with the real `readTenantMode`, the
 * real schema and the real form/record writes, against the IN-MEMORY table (memory-table.ts: conditional Put,
 * consistent BatchGet with projection). Replaced: `db.js` (the table), the origin check (`tenant-verify.js`, the
 * forms helper reused unchanged — it needs `GSI_Domain`, which the memory table does not model), and SES
 * (aws-sdk-client-mock). The forms protection rows drive `forms/update.ts`, `forms/delete.ts`, `forms/list.ts`
 * over the same table. Credential-free, no network.
 */

process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;

const { holder, mockAudit } = vi.hoisted(() => ({ holder: { table: null as any }, mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: vi.fn(async () => true) }));

const sesMock = mockClient(SESClient);

const { handler } = await import("../../src/interest/public.js");
const { handler: updateForm } = await import("../../src/forms/update.js");
const { handler: deleteForm } = await import("../../src/forms/delete.js");
const { handler: listForms } = await import("../../src/forms/list.js");

const T1 = "t1";
const TOKEN_A = "3f1c2a4e-8b7d-4c1e-9a2b-1d2e3f4a5b6c";
const TOKEN_B = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const product = (id: string, extra: Record<string, any> = {}) => ({
    PK: `TENANT#${T1}`, SK: `PRODUCT#${id}`, Type: "Product", id, tenantId: T1, status: "active",
    title: `Title ${id}`, slug: `slug-${id}`, imageLink: `https://img.test/${id}.jpg`, price: "SECRET-NOT-PROJECTED", ...extra,
});

let table: MemoryTable;

const submit = async (body: Record<string, any>) => {
    const res = (await handler({
        routeKey: "POST /public/interest",
        headers: { "x-tenant-id": T1, origin: "https://glam.test" },
        requestContext: { http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify({ name: "Ana Pop", email: "Ana@Example.com", recaptchaToken: null, submissionToken: TOKEN_A, ...body }),
    } as any, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const records = () => table.all(`FORMSUB#interest-list#`);
const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input);

const ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: T1 };
const adminEvent = (id: string, body?: unknown) => ({
    headers: { "x-tenant-id": T1 },
    pathParameters: { id },
    requestContext: { authorizer: { lambda: ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: body === undefined ? undefined : JSON.stringify(body),
}) as any;
const run = async (h: any, e: any) => {
    const res = await h(e, {} as any, () => {});
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    table.put({ PK: "SYSTEM", SK: `TENANT#${T1}`, id: T1, name: "Glam", domain: "glam.test", catalogMode: true, integrations: { contactEmail: "office@glam.test" } });
    table.put(product("p1", { variants: [{ id: "format", name: "Format", options: [
        { value: "120x20", imageLink: "https://img.test/p1-120.jpg" }, { value: "140x20" },
    ] }] }));
    table.put(product("p2"));
    table.put(product("p3", { status: "draft" }));
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "m1" });
    mockAudit.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("CAT-INTEREST-1 integration (in-memory store)", () => {
    it("one submission → exactly ONE FORMSUB#interest-list# record, items with SERVER-captured title/slug/option/image, the system form created", async () => {
        const res = await submit({ phone: "0700", message: "Salut", items: [
            { productId: "p1", optionValue: "120x20" }, { productId: "p1", optionValue: "140x20" }, { productId: "p2" },
        ] });
        expect(res.status).toBe(201);
        expect(res.body.outcome).toBe("recorded");
        expect(res.body.dropped).toEqual([]);
        const [record] = records();
        expect(records()).toHaveLength(1);
        expect(record).toMatchObject({
            Type: "FormSubmission", id: res.body.submissionId, tenantId: T1, formId: "interest-list", formName: "Listă de interes",
            submitterEmail: "ana@example.com", status: "new",
        });
        expect(record.SK).toBe(`FORMSUB#interest-list#${res.body.submissionId}`);
        expect(res.body.submissionId).toMatch(/^[0-9a-f]{64}$/);
        expect(record.data).toEqual({
            name: "Ana Pop", email: "ana@example.com", phone: "0700", message: "Salut",
            items: [
                { productId: "p1", title: "Title p1", slug: "slug-p1", optionValue: "120x20", imageLink: "https://img.test/p1-120.jpg" },
                { productId: "p1", title: "Title p1", slug: "slug-p1", optionValue: "140x20", imageLink: "https://img.test/p1.jpg" },
                { productId: "p2", title: "Title p2", slug: "slug-p2", imageLink: "https://img.test/p2.jpg" },
            ],
        });
        expect(JSON.stringify(record)).not.toContain("SECRET-NOT-PROJECTED");
        // The system form: fixed id, no slug, no FORMSLUG# pointer.
        expect(table.get(`TENANT#${T1}`, "FORM#interest-list")).toMatchObject({ Type: "Form", id: "interest-list", name: "Listă de interes", status: "active" });
        expect(table.get(`TENANT#${T1}`, "FORM#interest-list")!.slug).toBeUndefined();
        expect(table.all("FORMSLUG#")).toEqual([]);
    });

    it("unknown ids and inactive products are dropped and reported; the rest is recorded", async () => {
        const res = await submit({ items: [{ productId: "gone" }, { productId: "p3" }, { productId: "p2" }] });
        expect(res.status).toBe(201);
        expect(res.body.dropped).toEqual([
            { productId: "gone", reason: "unknown" },
            { productId: "p3", reason: "not-available" },
        ]);
        expect(records()[0].data.items.map((i: any) => i.productId)).toEqual(["p2"]);
    });

    it("the same token again → 200, the same id, no second record, no second mail; a new token → a second record", async () => {
        const first = await submit({ items: [{ productId: "p2" }] });
        const again = await submit({ items: [{ productId: "p2" }] });
        expect([first.status, again.status]).toEqual([201, 200]);
        expect(again.body).toEqual({ outcome: "already-recorded", submissionId: first.body.submissionId, recorded: [{ productId: "p2" }] });
        expect(records()).toHaveLength(1);
        expect(mails()).toHaveLength(1);
        const other = await submit({ submissionToken: TOKEN_B, items: [{ productId: "p2" }] });
        expect(other.status).toBe(201);
        expect(records()).toHaveLength(2);
    });

    // review-0 F2: a resend is recognised by its token hash BEFORE the catalogue is read, so a catalogue change or a
    // read failure between the first send (response lost) and the resend never turns a recorded list into a failure.
    describe("replay of a recorded list while the catalogue changed (review-0 F2)", () => {
        const LIST = [{ productId: "p1", optionValue: "120x20" }, { productId: "p2" }];
        const firstSend = async () => {
            const first = await submit({ items: LIST });
            expect(first.status).toBe(201);
            return first.body.submissionId as string;
        };
        const expectReplay = async (id: string) => {
            const again = await submit({ items: LIST });
            expect(again.status).toBe(200);
            expect(again.body).toEqual({ outcome: "already-recorded", submissionId: id, recorded: LIST });
            expect(records()).toHaveLength(1);
            expect(mails()).toHaveLength(1);
        };

        it("a listed product was removed → 200 already-recorded, the stored items, no second record or mail", async () => {
            const id = await firstSend();
            table.items.delete(`TENANT#${T1}\u0000PRODUCT#p2`);
            expect(table.get(`TENANT#${T1}`, "PRODUCT#p2")).toBeUndefined();
            await expectReplay(id);
        });

        it("the chosen option was removed from its product → 200 already-recorded with the option as recorded", async () => {
            const id = await firstSend();
            table.put(product("p1", { variants: [{ id: "format", name: "Format", options: [{ value: "140x20" }] }] }));
            await expectReplay(id);
        });

        it("the catalogue read would fail (UnprocessedKeys) → 200 already-recorded; no BatchGet is issued", async () => {
            const id = await firstSend();
            table.unprocessedKeys = (keys) => keys;
            table.commands = [];
            await expectReplay(id);
            expect(table.commands.some((c: any) => c.constructor.name === "BatchGetCommand")).toBe(false);
        });

        it("a NEW list while the read fails → 503, nothing written (the rule for new submissions is kept)", async () => {
            await firstSend();
            table.unprocessedKeys = (keys) => keys;
            const other = await submit({ submissionToken: TOKEN_B, items: LIST });
            expect(other.status).toBe(503);
            expect(records()).toHaveLength(1);
            expect(mails()).toHaveLength(1);
        });
    });

    it("the notification goes to integrations.contactEmail, Reply-To the visitor, one line per item with its public URL", async () => {
        await submit({ items: [{ productId: "p1", optionValue: "120x20" }, { productId: "p2" }] });
        expect(mails()).toHaveLength(1);
        const mail = mails()[0];
        expect(mail.Destination!.ToAddresses).toEqual(["office@glam.test"]);
        expect(mail.ReplyToAddresses).toEqual(["ana@example.com"]);
        expect(mail.Source).toContain("noreply@platform.test");
        expect(mail.Message!.Subject!.Data).toBe("Listă de interes — Ana Pop");
        const text = mail.Message!.Body!.Text!.Data!;
        expect(text).toContain("- Title p1 — 120x20 — https://glam.test/product/slug-p1");
        expect(text).toContain("- Title p2 — https://glam.test/product/slug-p2");
    });

    it("no integrations.contactEmail: the record is stored, NO mail is sent (no platform fallback), the absence is reported", async () => {
        table.put({ PK: "SYSTEM", SK: `TENANT#${T1}`, id: T1, name: "Glam", domain: "glam.test", catalogMode: true, integrations: {} });
        const res = await submit({ items: [{ productId: "p2" }] });
        expect(res.status).toBe(201);
        expect(records()).toHaveLength(1);
        expect(mails()).toHaveLength(0);
        expect((console.warn as any).mock.calls.map((c: any[]) => c[0]).join("\n"))
            .toContain(`notification not sent: tenant ${T1} has no integrations.contactEmail`);
    });
});

describe("CAT-INTEREST-1 — the system form's protection in the forms routes", () => {
    beforeEach(async () => {
        await submit({ items: [{ productId: "p2" }] });
        table.put({ PK: `TENANT#${T1}`, SK: "FORM#user-form", Type: "Form", id: "user-form", tenantId: T1, name: "Contact", slug: "contact", status: "active", createdAt: "2026-10-01T00:00:00.000Z" });
        table.commands = [];
    });

    it("PUT /forms/interest-list → 409 before any read or write (no FORMSLUG#undefined)", async () => {
        const res = await run(updateForm, adminEvent("interest-list", { name: "Renamed" }));
        expect(res.status).toBe(409);
        expect(table.commands).toEqual([]);
        expect(table.all("FORMSLUG#")).toEqual([]);
    });

    it("DELETE /forms/interest-list → 409 before any read or write; the form and its submissions stay", async () => {
        const res = await run(deleteForm, adminEvent("interest-list"));
        expect(res.status).toBe(409);
        expect(table.commands).toEqual([]);
        expect(table.get(`TENANT#${T1}`, "FORM#interest-list")).toBeDefined();
        expect(records()).toHaveLength(1);
    });

    it("GET /forms omits the system form and still lists the user's forms", async () => {
        const res = await run(listForms, adminEvent(""));
        expect(res.status).toBe(200);
        expect(res.body.items.map((f: any) => f.id)).toEqual(["user-form"]);
    });
});
