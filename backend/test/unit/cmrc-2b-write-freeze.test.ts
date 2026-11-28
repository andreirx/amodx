import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { GOLDEN_FILE, SCENARIOS, canonical, runTrace, serialize, type ScenarioTrace } from "./cmrc-1-command-trace.js";

/**
 * CMRC-2B (docs/slices/cmrc-2b.md § Proofs) — the write freeze in the five writers W1-W5, and the readers.
 *
 * Method: the scenarios of the CMRC-1A command trace (`cmrc-1-command-trace.ts`, tenant `t1`) are run with
 * `COMMERCE_WRITE_FREEZE_TENANTS` set to different lists and compared with the CMRC-1A golden. The recorder notes every
 * DynamoDB command (read or write), every audit event and every mail. Two more effects are counted here, because the
 * trace replaces them without noting them: the origin check of `orders/create.ts` (`lib/tenant-verify.ts`, a DynamoDB
 * Query in production) and the reCAPTCHA decision (`lib/recaptcha.ts`). Their replacements behave exactly as the
 * trace's own (`true`; "not configured"), so the unlisted runs must equal the golden byte for byte.
 *
 * What it proves:
 *  - listed (`t1`): every scenario of a writer has NO effect of any kind; its answer is 503 `commerceFrozen`, except
 *    the scenarios refused BEFORE the guard position (KEPT_BEFORE_GUARD), which keep their golden answer — that list
 *    pins the position of each guard;
 *  - listed: every scenario of a reader equals the golden (readers are not frozen);
 *  - unreadable list: the same as listed (fail closed, D3);
 *  - unlisted, empty, absent: the whole trace equals the golden file byte for byte.
 */

const spies = vi.hoisted(() => ({ verify: 0, recaptcha: 0 }));

// Four replacement modules of the trace, as in `cmrc-1-command-trace.test.ts`; the other two are counted here.
vi.mock("../../src/lib/db.js", async () => (await import("./cmrc-1-command-trace.js")).dbModule);
vi.mock("../../src/lib/events.js", async () => (await import("./cmrc-1-command-trace.js")).eventsModule);
vi.mock("@aws-sdk/client-ses", async () => (await import("./cmrc-1-command-trace.js")).sesModule);
vi.mock("@aws-sdk/s3-request-presigner", async () => (await import("./cmrc-1-command-trace.js")).presignerModule);
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: async () => { spies.verify++; return true; } }));
vi.mock("../../src/lib/recaptcha.js", () => ({
    resolveRecaptchaConfig: () => { spies.recaptcha++; return null; },
    verifyRecaptcha: async () => { throw new Error("cmrc-2b: reCAPTCHA is not configured in the trace"); },
}));

const VARIABLE = "COMMERCE_WRITE_FREEZE_TENANTS";
const goldenText = readFileSync(path.join(__dirname, GOLDEN_FILE), "utf8");
const golden = JSON.parse(goldenText) as { scenarios: Record<string, { answer: unknown; effects: unknown[] }> };

const WRITERS = ["createOrder", "updateOrderStatus", "updateOrder", "updateCustomer", "publicUpdateCustomer"] as const;
const READERS = ["getOrder", "listOrders", "publicGetOrder", "reportsSummary", "getCustomer", "listCustomers", "download"] as const;

/** Writer scenarios refused by a check that precedes the guard (the tenant header, the presence checks, the role). */
const KEPT_BEFORE_GUARD = [
    "create: no tenant header → 400, no command",
    "order status: admin of another tenant → 403, no command",
    "customer note: admin of another tenant → 403, no command",
    "customer note: no body → 400",
    "profile update: tenant admin → 403, no command",
];

const FROZEN_ANSWER = {
    statusCode: 503,
    body: JSON.stringify({ code: "commerceFrozen", error: "Orders are paused for a short maintenance. Try again in a few minutes." }),
};

type Run = { scenarios: Record<string, ScenarioTrace>; text: string; verify: number; recaptcha: number };

async function runWith(list: string | undefined): Promise<Run> {
    if (list === undefined) vi.unstubAllEnvs(); else vi.stubEnv(VARIABLE, list);
    expect(process.env[VARIABLE]).toBe(list);
    spies.verify = 0;
    spies.recaptcha = 0;
    try {
        const trace = await runTrace();
        return { scenarios: trace.scenarios, text: serialize(trace), verify: spies.verify, recaptcha: spies.recaptcha };
    } finally {
        vi.unstubAllEnvs();
    }
}

const scenariosOf = (handlers: readonly string[]) => SCENARIOS.filter((s) => handlers.includes(s.handler)).map((s) => s.name);
const hasWrite = (effects: unknown[]) =>
    effects.some((e: any) => e.kind !== "dynamodb" || ["UpdateCommand", "PutCommand", "DeleteCommand", "TransactWriteCommand"].includes(e.command));

let listed: Run, unreadable: Run, unlisted: Run, empty: Run, absent: Run;
beforeAll(async () => {
    listed = await runWith("t1");
    unreadable = await runWith("t9;t8");
    unlisted = await runWith("t9, other-shop,T1");
    empty = await runWith("");
    absent = await runWith(undefined);
}, 120_000);

describe("CMRC-2B — a listed tenant: every writer refuses before its first effect", () => {
    it("the list of scenarios kept before the guard names only writer scenarios that exist", () => {
        const writerScenarios = scenariosOf(WRITERS);
        for (const name of KEPT_BEFORE_GUARD) expect(writerScenarios).toContain(name);
    });

    it.each(WRITERS)("%s: at least one of its golden scenarios writes, and under the freeze it does not", (handler) => {
        const writing = scenariosOf([handler]).filter((name) => hasWrite(golden.scenarios[name].effects));
        expect(writing.length).toBeGreaterThan(0);
        for (const name of writing) {
            expect(listed.scenarios[name].effects).toEqual([]);
            expect(listed.scenarios[name].answer).toEqual(FROZEN_ANSWER);
        }
    });

    it.each(scenariosOf(WRITERS))("%s → no effect; 503 commerceFrozen unless refused before the guard", (name) => {
        expect(listed.scenarios[name].effects).toEqual([]);
        if (KEPT_BEFORE_GUARD.includes(name)) {
            expect(canonical(listed.scenarios[name].answer)).toEqual(golden.scenarios[name].answer);
            expect(golden.scenarios[name].effects).toEqual([]);
        } else {
            expect(listed.scenarios[name].answer).toEqual(FROZEN_ANSWER);
        }
    });

    it("W1: no origin check and no reCAPTCHA decision is made for the listed tenant (the unlisted run makes them: control)", () => {
        expect(listed.verify).toBe(0);
        expect(listed.recaptcha).toBe(0);
        expect(unlisted.verify).toBeGreaterThan(0);
        expect(unlisted.recaptcha).toBeGreaterThan(0);
    });

    it.each(scenariosOf(WRITERS))("unreadable list (fail closed): %s is answered as for a listed tenant", (name) => {
        expect(unreadable.scenarios[name]).toEqual(listed.scenarios[name]);
    });
});

describe("CMRC-2B — readers are not frozen", () => {
    it.each(READERS)("%s has scenarios in the trace", (handler) => {
        expect(scenariosOf([handler]).length).toBeGreaterThan(0);
    });

    it.each(scenariosOf(READERS))("listed tenant: %s equals the golden", (name) => {
        expect(canonical(listed.scenarios[name])).toEqual(golden.scenarios[name]);
    });
});

describe("CMRC-2B — every other tenant: the whole trace equals the CMRC-1A golden byte for byte", () => {
    it("the list names other tenants only (t9, other-shop, T1 — the case differs from t1)", () => {
        expect(unlisted.text).toBe(goldenText);
    });
    it("the variable is empty", () => {
        expect(empty.text).toBe(goldenText);
    });
    it("the variable is absent", () => {
        expect(absent.text).toBe(goldenText);
    });
});
