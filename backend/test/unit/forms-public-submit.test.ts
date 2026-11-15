import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — `POST /public/forms/{slug}/submit`, the custom-form submit.
 *
 * The REAL handler over a mocked DynamoDB document client and SES client (aws-sdk-client-mock). The origin check is
 * the REAL `verifyTenantFromOrigin`: its `GSI_Domain` query is answered per origin host (`site.test` → t1,
 * `other.test` → t2). No reCAPTCHA env var; a tenant item without keys → `resolveRecaptchaConfig` returns null (the
 * local branch), except in the one row that gives the tenant keys. Credential-free.
 *
 * The stored form is the shape the admin writes (`FormFieldSchema`: `{ id, label, type, required, placeholder?,
 * options? }`, no `name`); the payload is the shape the block's form component sends (`data` keyed by field LABEL,
 * `submitterEmail` at the top level, `recaptchaToken`).
 */

process.env.TABLE_NAME = "amodx-table";
process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.TENANT_VERIFY_PERMISSIVE;

const ddb = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

const { handler } = await import("../../src/forms/public-submit.js");

type Field = { id: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] };
const field = (id: string, label: string, type: string, extra: Partial<Field> = {}): Field => ({ id, label, type, required: false, ...extra });

/** The reference form of section 9: Name, E-mail, a select "Primary interest", a textarea. */
const REFERENCE_FIELDS: Field[] = [
    field("f-name", "Name", "text", { required: true }),
    field("f-email", "E-mail", "email", { required: true }),
    field("f-interest", "Primary interest", "select", { options: ["Hardwood", "Carpet", "Tile"] }),
    field("f-msg", "Message", "textarea"),
];

function form(tenant: string, slug: string, formId: string, fields: Field[], over: Record<string, unknown> = {}) {
    ddb.on(GetCommand, { Key: { PK: `TENANT#${tenant}`, SK: `FORMSLUG#${slug}` } }).resolves({ Item: { formId, formName: "F" } });
    ddb.on(GetCommand, { Key: { PK: `TENANT#${tenant}`, SK: `FORM#${formId}` } }).resolves({ Item: {
        PK: `TENANT#${tenant}`, SK: `FORM#${formId}`, id: formId, tenantId: tenant, name: `Form ${formId}`, slug, fields,
        submitButtonText: "Send", successMessage: "Thanks, we will call you.", notifyEmail: "owner@site.test", status: "active", ...over,
    } });
}

const call = async (body: unknown, opts: { slug?: string; tenant?: string; origin?: string | null; raw?: string } = {}) => {
    const headers: Record<string, string> = { "x-tenant-id": opts.tenant ?? "t1" };
    if (opts.origin !== null) headers.origin = opts.origin ?? "https://site.test";
    const res = (await handler({
        headers,
        pathParameters: { slug: opts.slug ?? "contact" },
        requestContext: { http: { sourceIp: "127.0.0.1" } },
        body: opts.raw ?? JSON.stringify(body),
    } as any, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

const puts = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!);
const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
const formReads = () => ddb.commandCalls(GetCommand).map((c) => c.args[0].input.Key as { PK: string; SK: string }).filter((k) => k.SK.startsWith("FORM"));
const mailText = () => mails()[0].Message!.Body!.Text!.Data!;

/** The payload the block's component builds: every field by label, checkbox false / others "" when untouched. */
const payload = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ data, recaptchaToken: null, ...extra });

beforeEach(() => {
    ddb.reset();
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "m1" });
    // DynamoDB answers a GetCommand for a key it does not hold with no `Item` (not with nothing at all).
    ddb.on(GetCommand).resolves({});
    ddb.on(QueryCommand, { IndexName: "GSI_Domain", ExpressionAttributeValues: { ":domain": "site.test" } }).resolves({ Items: [{ id: "t1" }] });
    ddb.on(QueryCommand, { IndexName: "GSI_Domain", ExpressionAttributeValues: { ":domain": "other.test" } }).resolves({ Items: [{ id: "t2" }] });
    ddb.on(GetCommand, { Key: { PK: "SYSTEM", SK: "TENANT#t1" } }).resolves({ Item: { id: "t1", name: "Glamour Floors" } });
    ddb.on(PutCommand).resolves({});
    form("t1", "contact", "form-1", REFERENCE_FIELDS);
});

describe("the three defects of the handler as found (reproduced red on 5b3c1be, § 3 of the record)", () => {
    it("defect 1 — the component's payload for a stored form with a required text field is ACCEPTED (was 400 \"Missing required fields\": the handler read data[field.name], and a stored field has no name)", async () => {
        form("t1", "one", "form-one", [field("f1", "Name", "text", { required: true })]);
        const res = await call(payload({ Name: "Ana" }), { slug: "one" });
        expect(res.status).toBe(201);
        expect(puts()[0].data).toEqual({ Name: "Ana" });
    });

    it("defect 1 — the mail lines carry the labels and the values (were \"(empty)\" for every field)", async () => {
        await call(payload({ Name: "Ana", "E-mail": "ana@example.com", "Primary interest": "Carpet", Message: "Hello" }, { submitterEmail: "ana@example.com" }));
        expect(mailText()).toContain("Name: Ana\nE-mail: ana@example.com\nPrimary interest: Carpet\nMessage: Hello");
        expect(mailText()).not.toContain("(empty)");
    });

    it("defect 2 — the top-level submitterEmail is stored and used as reply-to (was null: the handler read data.email || body.email)", async () => {
        await call(payload({ Name: "Ana", "E-mail": "ana@example.com" }, { submitterEmail: "ana@example.com" }));
        expect(puts()[0].submitterEmail).toBe("ana@example.com");
        expect(mails()[0].ReplyToAddresses).toEqual(["ana@example.com"]);
    });

    it("defect 3 — keys that are not labels of the form are dropped; nothing else of the request is stored (was: body.data stored as sent)", async () => {
        await call(payload({ Name: "Ana", "E-mail": "a@b.co", injected: { deep: ["x".repeat(1000)] }, "__proto__": "p", constructor: "c" }, { extra: "top", submitterEmail: "a@b.co" }));
        const item = puts()[0];
        expect(item.data).toEqual({ Name: "Ana", "E-mail": "a@b.co", "Primary interest": "", Message: "" });
        expect(Object.keys(item).sort()).toEqual(["PK", "SK", "Type", "createdAt", "data", "formId", "formName", "id", "status", "submitterEmail", "tenantId"]);
    });

    it("a malformed body → 400, nothing read past the origin check, nothing stored (was 500)", async () => {
        for (const raw of ["{not json", "null", "[1,2]", "\"text\"", "42"]) {
            ddb.resetHistory();
            const res = await call(undefined, { raw });
            expect({ raw, status: res.status, error: res.body.error }).toEqual({ raw, status: 400, error: "Invalid request body" });
            expect(formReads()).toEqual([]);
            expect(puts()).toEqual([]);
        }
    });
});

describe("each field type, a valid value → stored under its label, cleaned", () => {
    const ALL: Field[] = [
        field("a", "Text", "text"), field("b", "Mail", "email"), field("c", "Phone", "phone"), field("d", "Long", "textarea"),
        field("e", "Count", "number"), field("f", "Agree", "checkbox"), field("g", "Pick", "select", { options: ["One", "Two"] }),
    ];
    beforeEach(() => form("t1", "all", "form-all", ALL));

    it("strings trimmed (email also CR/LF removed); number from a number or a numeric text; checkbox boolean; select one option", async () => {
        const res = await call(payload({ Text: "  hi  ", Mail: " a@b.co\r\n", Phone: " 0700 ", Long: "  line 1\nline 2  ", Count: " 42 ", Agree: true, Pick: "Two" }), { slug: "all" });
        expect(res.status).toBe(201);
        expect(puts()[0].data).toEqual({ Text: "hi", Mail: "a@b.co", Phone: "0700", Long: "line 1\nline 2", Count: 42, Agree: true, Pick: "Two" });
    });

    it("a number value given as a number; -1.5 and 1e3 as texts; blank number → \"\"", async () => {
        await call(payload({ Count: -1.5 }), { slug: "all" });
        await call(payload({ Count: "1e3" }), { slug: "all" });
        await call(payload({ Count: "  " }), { slug: "all" });
        expect(puts().map((p) => p.data.Count)).toEqual([-1.5, 1000, ""]);
    });

    it("an absent key → blank (\"\" / false); every field of the form is stored", async () => {
        await call(payload({}), { slug: "all" });
        expect(puts()[0].data).toEqual({ Text: "", Mail: "", Phone: "", Long: "", Count: "", Agree: false, Pick: "" });
        expect(puts()[0].submitterEmail).toBeNull();
    });

    it("a value of the wrong type (object, array, null, number for a text, text for a checkbox) → 400 \"Invalid value\" naming the field; nothing stored", async () => {
        for (const [label, value] of [["Text", { a: 1 }], ["Text", ["x"]], ["Text", null], ["Text", 5], ["Agree", "yes"], ["Count", "abc"], ["Count", "Infinity"], ["Count", "1e999"], ["Count", true], ["Pick", 1]] as const) {
            const res = await call(payload({ [label]: value }), { slug: "all" });
            expect({ label, value, status: res.status, body: res.body }).toEqual({ label, value, status: 400, body: { error: "Invalid value", fields: [label] } });
        }
        expect(puts()).toEqual([]);
        expect(mails()).toEqual([]);
    });

    it("data that is not an object (array, string, null) → 400 \"Invalid form data\"; data absent → every field blank", async () => {
        for (const data of [["a"], "a", null, 3]) {
            const res = await call({ data, recaptchaToken: null }, { slug: "all" });
            expect({ data, status: res.status, error: res.body.error }).toEqual({ data, status: 400, error: "Invalid form data" });
        }
        expect(puts()).toEqual([]);
        expect((await call({ recaptchaToken: null }, { slug: "all" })).status).toBe(201);
    });
});

describe("limits, select options, required fields", () => {
    const LIMITS: Field[] = [field("a", "Short", "text"), field("b", "Mail", "email"), field("c", "Phone", "phone"), field("d", "Long", "textarea")];
    beforeEach(() => form("t1", "lim", "form-lim", LIMITS));

    it("text, email, phone at 500 and textarea at 5 000 characters are accepted; one more → 400 naming the field (after trimming)", async () => {
        const mail500 = `${"a".repeat(500 - "@b.co".length)}@b.co`;
        const ok = await call(payload({ Short: "x".repeat(500), Mail: mail500, Phone: "1".repeat(500), Long: "y".repeat(5000) }), { slug: "lim" });
        expect(ok.status).toBe(201);
        expect((await call(payload({ Short: ` ${"x".repeat(500)} ` }), { slug: "lim" })).status).toBe(201);
        for (const [label, value] of [["Short", "x".repeat(501)], ["Mail", `a${mail500}`], ["Phone", "1".repeat(501)], ["Long", "y".repeat(5001)]] as const) {
            const res = await call(payload({ [label]: value }), { slug: "lim" });
            expect({ label, status: res.status, body: res.body }).toEqual({ label, status: 400, body: { error: "Value too long", fields: [label] } });
        }
        expect(puts()).toHaveLength(2);
    });

    it("select: a value not in the field's options → 400; exact match (case and spaces count); \"\" is the blank choice", async () => {
        for (const value of ["Vinyl", "carpet", " Carpet", "Carpet "]) {
            const res = await call(payload({ Name: "A", "E-mail": "a@b.co", "Primary interest": value }));
            expect({ value, status: res.status, body: res.body }).toEqual({ value, status: 400, body: { error: "Invalid value", fields: ["Primary interest"] } });
        }
        expect((await call(payload({ Name: "A", "E-mail": "a@b.co", "Primary interest": "" }))).status).toBe(201);
        expect(puts()[0].data["Primary interest"]).toBe("");
    });

    it("required blank (empty, spaces only, absent) and required checkbox unticked → 400 with the labels", async () => {
        form("t1", "req", "form-req", [
            field("a", "Name", "text", { required: true }), field("b", "Terms", "checkbox", { required: true }),
            field("c", "Size", "number", { required: true }), field("d", "Kind", "select", { required: true, options: ["X"] }),
            field("e", "Note", "textarea"),
        ]);
        for (const data of [{ Name: "", Terms: false, Size: "", Kind: "" }, { Name: "   ", Size: " " }, {}]) {
            const res = await call(payload(data), { slug: "req" });
            expect(res).toEqual({ status: 400, body: { error: "Missing required fields", fields: ["Name", "Terms", "Size", "Kind"] } });
        }
        expect((await call(payload({ Name: "A", Terms: true, Size: 0, Kind: "X" }), { slug: "req" })).status).toBe(201);
        expect(puts()[0].data).toEqual({ Name: "A", Terms: true, Size: 0, Kind: "X", Note: "" });
    });
});

describe("the submitter email", () => {
    it("top level only → stored and reply-to", async () => {
        form("t1", "noemail", "form-ne", [field("a", "Name", "text")]);
        await call(payload({ Name: "A" }, { submitterEmail: "top@b.co" }), { slug: "noemail" });
        expect(puts()[0].submitterEmail).toBe("top@b.co");
        expect(mails()[0].ReplyToAddresses).toEqual(["top@b.co"]);
    });

    it("only an email field → its cleaned value is the submitter email", async () => {
        await call(payload({ Name: "A", "E-mail": "  field@b.co " }));
        expect(puts()[0].submitterEmail).toBe("field@b.co");
        expect(mails()[0].ReplyToAddresses).toEqual(["field@b.co"]);
    });

    it("both → the top level wins; the field keeps its own value", async () => {
        await call(payload({ Name: "A", "E-mail": "field@b.co" }, { submitterEmail: "top@b.co" }));
        expect(puts()[0].submitterEmail).toBe("top@b.co");
        expect(puts()[0].data["E-mail"]).toBe("field@b.co");
    });

    it("the FIRST email field of the form is the fallback", async () => {
        form("t1", "two", "form-two", [field("a", "Work", "email"), field("b", "Home", "email")]);
        await call(payload({ Work: "", Home: "home@b.co" }), { slug: "two" });
        expect(puts()[0].submitterEmail).toBeNull();
        await call(payload({ Work: "work@b.co", Home: "home@b.co" }), { slug: "two" });
        expect(puts()[1].submitterEmail).toBe("work@b.co");
    });

    it("invalid → 400 (top level, or the field's own value), nothing stored; a blank top level falls back to the field", async () => {
        const bad = [
            [payload({ Name: "A", "E-mail": "a@b.co" }, { submitterEmail: "not-an-email" }), { error: "Invalid email format" }],
            [payload({ Name: "A", "E-mail": "a@b.co" }, { submitterEmail: { a: 1 } }), { error: "Invalid email format" }],
            [payload({ Name: "A", "E-mail": "a@b.co" }, { submitterEmail: `${"a".repeat(500)}@b.co` }), { error: "Invalid email format" }],
            [payload({ Name: "A", "E-mail": "bad mail@x" }), { error: "Invalid email format", fields: ["E-mail"] }],
        ] as const;
        for (const [body, answer] of bad) {
            const res = await call(body);
            expect(res).toEqual({ status: 400, body: answer });
        }
        expect(puts()).toEqual([]);
        await call(payload({ Name: "A", "E-mail": "f@b.co" }, { submitterEmail: "   " }));
        expect(puts()[0].submitterEmail).toBe("f@b.co");
    });

    it("CR/LF are removed from the submitter email (header injection), at the top level and in the field", async () => {
        await call(payload({ Name: "A", "E-mail": "x@b.co" }, { submitterEmail: "a@b.co\r\nBcc: evil@x.co" }));
        expect(puts()).toEqual([]); // "a@b.coBcc: evil@x.co" holds a space → invalid
        await call(payload({ Name: "A", "E-mail": "x@b.co" }, { submitterEmail: "a@b.co\r\n" }));
        await call(payload({ Name: "A", "E-mail": "fi\r\neld@b.co" }));
        expect(puts().map((p) => [p.submitterEmail, p.data["E-mail"]])).toEqual([["a@b.co", "x@b.co"], ["field@b.co", "field@b.co"]]);
        expect(mails().map((m) => m.ReplyToAddresses)).toEqual([["a@b.co"], ["field@b.co"]]);
    });
});

describe("the mail lines", () => {
    it("label and cleaned value per field; \"(empty)\" only for a blank value; CR/LF in a value → a space; the subject unchanged", async () => {
        form("t1", "mail", "form-mail", [field("a", "Name", "text"), field("b", "Note", "textarea"), field("c", "Agree", "checkbox"), field("d", "Count", "number"), field("e", "Empty", "text")]);
        await call(payload({ Name: "Ana", Note: "line 1\r\nline 2\nFake: header", Agree: false, Count: 0, Empty: "" }), { slug: "mail" });
        const text = mailText();
        expect(text).toContain("Name: Ana\nNote: line 1  line 2 Fake: header\nAgree: false\nCount: 0\nEmpty: (empty)\n");
        expect(mails()[0].Message!.Subject!.Data).toBe("New submission: Form form-mail");
        expect(mails()[0].Destination!.ToAddresses).toEqual(["owner@site.test"]);
        expect(puts()[0].data.Note).toBe("line 1\r\nline 2\nFake: header"); // stored as typed (trimmed); only the mail line is flattened
    });

    it("no notifyEmail → no mail; the submission is stored", async () => {
        form("t1", "quiet", "form-quiet", [field("a", "Name", "text")], { notifyEmail: undefined });
        expect((await call(payload({ Name: "A" }), { slug: "quiet" })).status).toBe(201);
        expect(mails()).toEqual([]);
        expect(puts()).toHaveLength(1);
    });
});

describe("the answer, statuses and key shapes stay as they were", () => {
    it("201 { message: the form's success text, submissionId }, no-store; the record under TENANT#<tenant> FORMSUB#<formId>#<id>", async () => {
        const res = await call(payload({ Name: "A", "E-mail": "a@b.co" }));
        expect(res.status).toBe(201);
        expect(Object.keys(res.body).sort()).toEqual(["message", "submissionId"]);
        expect(res.body.message).toBe("Thanks, we will call you.");
        const item = puts()[0];
        expect(item).toMatchObject({ PK: "TENANT#t1", SK: `FORMSUB#form-1#${res.body.submissionId}`, Type: "FormSubmission", id: res.body.submissionId, tenantId: "t1", formId: "form-1", formName: "Form form-1", status: "new" });
    });
});

describe("isolation and the existing guards (as today)", () => {
    it("form disabled → 403; slug of no form → 404; nothing stored, no mail", async () => {
        form("t1", "off", "form-off", [field("a", "Name", "text")], { status: "disabled" });
        expect(await call(payload({ Name: "A" }), { slug: "off" })).toEqual({ status: 403, body: { error: "This form is not currently accepting submissions" } });
        expect(await call(payload({ Name: "A" }), { slug: "nothing" })).toEqual({ status: 404, body: { error: "Form not found" } });
        expect(puts()).toEqual([]);
        expect(mails()).toEqual([]);
    });

    it("another tenant's slug → 404: the lookup is only under TENANT#<verified tenant>, nothing stored", async () => {
        form("t2", "theirs", "form-t2", [field("a", "Name", "text")]);
        expect(await call(payload({ Name: "A" }), { slug: "theirs" })).toEqual({ status: 404, body: { error: "Form not found" } });
        expect(formReads()).toEqual([{ PK: "TENANT#t1", SK: "FORMSLUG#theirs" }]);
        expect(puts()).toEqual([]);
    });

    it("an origin of another tenant, or no origin → 403; no form read for any tenant, nothing stored", async () => {
        form("t2", "contact", "form-t2", [field("a", "Name", "text")]);
        expect(await call(payload({ Name: "A" }), { origin: "https://other.test" })).toEqual({ status: 403, body: { error: "Invalid request origin" } });
        expect(await call(payload({ Name: "A" }), { origin: null })).toEqual({ status: 403, body: { error: "Invalid request origin" } });
        expect(formReads()).toEqual([]);
        expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
        expect(puts()).toEqual([]);
    });

    it("the tenant requires reCAPTCHA and the request has no token → 400; no form read, nothing stored", async () => {
        ddb.on(GetCommand, { Key: { PK: "SYSTEM", SK: "TENANT#t1" } }).resolves({ Item: { id: "t1", recaptcha: { siteKey: "site-key", secretKey: "secret-key" } } });
        expect(await call(payload({ Name: "A" }))).toEqual({ status: 400, body: { error: "CAPTCHA verification required" } });
        expect(await call(payload({ Name: "A" }, { recaptchaToken: { not: "a string" } }))).toEqual({ status: 400, body: { error: "CAPTCHA verification required" } });
        expect(formReads()).toEqual([]);
        expect(puts()).toEqual([]);
    });

    it("missing x-tenant-id → 400 before any read", async () => {
        const res = (await handler({ headers: { origin: "https://site.test" }, pathParameters: { slug: "contact" }, body: "{}" } as any, {} as any, () => {})) as any;
        expect(res.statusCode).toBe(400);
        expect(ddb.calls()).toHaveLength(0);
    });
});

describe("labels are the key", () => {
    it("two forms with fields of the same label: each submission is checked against and stored under ITS form only", async () => {
        form("t1", "a", "form-a", [field("a1", "Name", "text", { required: true }), field("a2", "Size", "number")]);
        form("t1", "b", "form-b", [field("b1", "Name", "textarea"), field("b2", "Colour", "text")]);
        await call(payload({ Name: "One", Size: "3", Colour: "red" }), { slug: "a" });
        await call(payload({ Name: "Two", Size: "3", Colour: "red" }), { slug: "b" });
        expect(puts().map((p) => [p.SK.split("#")[1], p.data])).toEqual([["form-a", { Name: "One", Size: 3 }], ["form-b", { Name: "Two", Colour: "red" }]]);
    });

    it("one form with two fields of the same label: the FIRST field of the label defines it; the later one is not stored, checked or mailed (finding F-1E-DUPLICATE-LABEL)", async () => {
        form("t1", "dup", "form-dup", [field("d1", "Name", "text"), field("d2", "Name", "checkbox", { required: true }), field("d3", "City", "text")]);
        const res = await call(payload({ Name: "Ana", City: "Iasi" }), { slug: "dup" });
        expect(res.status).toBe(201);
        expect(puts()[0].data).toEqual({ Name: "Ana", City: "Iasi" });
        expect(mailText()).toContain("Name: Ana\nCity: Iasi\n");
        expect(mailText().match(/Name:/g)).toHaveLength(1);
    });

    it("only the request's own keys are read: a field labelled \"constructor\" or \"__proto__\" with no value is blank, and is stored as an own key", async () => {
        form("t1", "proto", "form-proto", [field("p1", "constructor", "text"), field("p2", "__proto__", "text")]);
        const res = await call(payload({}), { slug: "proto" });
        expect(res.status).toBe(201);
        const data = puts()[0].data;
        expect(Object.keys(data)).toEqual(["constructor", "__proto__"]);
        expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
        expect([data.constructor, Object.getOwnPropertyDescriptor(data, "__proto__")!.value]).toEqual(["", ""]);
    });

    it("a stored field that is not a valid field (no label, unknown type) is not part of the form", async () => {
        form("t1", "odd", "form-odd", [{ id: "x", type: "text" } as any, field("y", "Kind", "radio"), field("z", "Name", "text")]);
        await call(payload({ Name: "A", Kind: "k", undefined: "u" }), { slug: "odd" });
        expect(puts()[0].data).toEqual({ Name: "A" });
    });
});
