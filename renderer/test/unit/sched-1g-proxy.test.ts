import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SCHED-1G2 (docs/slices/sched-1.md § 10.1 "Handlers", § 9.2, § 12, § 16.3) — the renderer booking proxy, driven
 * through `handleBookingApi` / `handleBookingFeed` (what the two route files call) with a recorded `fetch`. Mocked at
 * the module boundary: the tenant read (`getTenantConfig`) and the renderer key (`getRendererKey`). Proves what the
 * serving rows cannot see (the suite has no backend): each op reaches EXACTLY ONE backend route, with the renderer key
 * and the tenant of the `[siteId]` segment (never one from the body or a browser header), a body rebuilt from checked
 * fields, NO `x-viewer-address` and no browser header ever (SCHED-1G3, ruling SCHED-ADDR-INFRA = A), the pass-through
 * answer, the feed's headers and its scheduling switch (SCHED-1G3), and logs without a token, secret or address.
 */

const tenants = vi.hoisted(() => ({ map: new Map<string, { id: string; schedulingEnabled?: boolean }>() }));
const key = vi.hoisted(() => ({ value: "renderer-key" }));
vi.mock("@/lib/dynamo", () => ({ getTenantConfig: async (id: string) => tenants.map.get(id) ?? null }));
vi.mock("@/lib/api-client", () => ({ getRendererKey: async () => key.value }));

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDateSchema } from "@amodx/shared";
import { BOOKING_OPS, MAX_BODY_BYTES, handleBookingApi, handleBookingFeed } from "@/lib/booking-proxy";
import * as proxyModule from "@/lib/booking-proxy";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let reply: () => Response;
const logs: string[] = [];
const TOKEN = "Tok_en-" + "x".repeat(36);
const SECRET = "Sec_ret-" + "y".repeat(35);
const INTENT = "3b241101-e2bb-4255-8caf-4136c566a962";
const WHO = { email: "Ana@Example.test", name: "Ana", phone: "+40 700 000 000", language: "ro" };

beforeEach(() => {
    process.env.API_URL = "https://api.example.test/";
    key.value = "renderer-key";
    tenants.map = new Map([
        ["shop.example.test", { id: "tenant-shop", schedulingEnabled: true }],
        ["tenant-nodomain", { id: "tenant-nodomain", schedulingEnabled: true }],
        // SCHED-1G3: a record with the switch off (`false`) and one without the attribute (absent = off, § 4.1).
        ["off.example.test", { id: "tenant-off", schedulingEnabled: false }],
        ["unset.example.test", { id: "tenant-unset" }],
    ]);
    calls = [];
    reply = () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=999" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
        return reply();
    }));
    logs.length = 0;
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // No log line ever carries a link token, a feed secret, an email or an address.
    for (const line of logs) {
        expect(line).not.toContain(TOKEN);
        expect(line).not.toContain(SECRET);
        expect(line.toLowerCase()).not.toContain("ana@example.test");
        expect(line).not.toMatch(/\b198\.51\.100\.4\b|\b203\.0\.113\.7\b|2001:db8/);
    }
});

const get = (op: string, qs = "", headers: Record<string, string> = {}) =>
    handleBookingApi(new Request(`https://shop.example.test/_book/x/api/${op}${qs}`, { headers }), "shop.example.test", op);
const post = (op: string, body: unknown, headers: Record<string, string> = {}, siteId = "shop.example.test") =>
    handleBookingApi(new Request(`https://shop.example.test/_book/x/api/${op}`, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
    }), siteId, op);

describe("SCHED-1G2 proxy — one backend route per op, renderer key, tenant from the route segment", () => {
    it("the op table is exactly the seven visitor routes of § 10.2", () => {
        expect(Object.keys(BOOKING_OPS).sort()).toEqual(["cancel", "confirm", "hold", "move", "offer", "slots", "view"]);
    });
    it("each valid request → exactly one call, to its route, with x-api-key and x-tenant-id = the record's id", async () => {
        const cases: [() => Promise<Response>, string, string, unknown][] = [
            [() => get("offer"), "GET", "/scheduling/visitor/offer", undefined],
            [() => get("slots", "?serviceId=s1&from=2026-12-01&to=2026-12-07"), "GET", "/scheduling/visitor/slots?serviceId=s1&from=2026-12-01&to=2026-12-07", undefined],
            [() => post("hold", { intentId: INTENT, recaptchaToken: "r", what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: WHO }),
                "POST", "/scheduling/visitor/holds", { intentId: INTENT, recaptchaToken: "r", what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: WHO }],
            [() => post("hold", { intentId: INTENT, resend: true, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: { email: "a@b.test", name: "A" } }),
                "POST", "/scheduling/visitor/holds", { intentId: INTENT, resend: true, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: { email: "a@b.test", name: "A" } }],
            [() => post("view", { token: TOKEN }), "POST", "/scheduling/visitor/bookings/view", { token: TOKEN }],
            [() => post("confirm", { token: TOKEN }), "POST", "/scheduling/visitor/bookings/confirm", { token: TOKEN }],
            [() => post("cancel", { token: TOKEN }), "POST", "/scheduling/visitor/bookings/cancel", { token: TOKEN }],
            [() => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00.000Z" } }), "POST", "/scheduling/visitor/bookings/move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00.000Z" } }],
        ];
        for (const [send, method, route, body] of cases) {
            calls = [];
            const res = await send();
            expect(res.status, route).toBe(200);
            expect(calls, route).toHaveLength(1);
            expect(calls[0].method).toBe(method);
            expect(calls[0].url).toBe(`https://api.example.test${route}`);
            expect(calls[0].headers["x-api-key"]).toBe("renderer-key");
            expect(calls[0].headers["x-tenant-id"]).toBe("tenant-shop");
            expect(calls[0].body).toEqual(body);
            expect(calls[0].url).not.toContain(TOKEN);
        }
    });
    it("a no-domain tenant (preview path): the id in the route segment selects it", async () => {
        await post("view", { token: TOKEN }, {}, "tenant-nodomain");
        expect(calls[0].headers["x-tenant-id"]).toBe("tenant-nodomain");
    });
    it("a tenant id in the body or a browser x-tenant-id header is never used (body: refused; header: ignored)", async () => {
        const viaBody = await post("view", { token: TOKEN, tenantId: "tenant-other" });
        expect(viaBody.status).toBe(400);
        expect(calls).toHaveLength(0);
        await post("view", { token: TOKEN }, { "x-tenant-id": "tenant-other", "x-viewer-address": "203.0.113.7", "x-api-key": "browser-key" });
        expect(calls[0].headers).toEqual({ "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop", "content-type": "application/json" });
    });
    it("a [siteId] with no tenant record → 403 notAvailable, no call", async () => {
        const res = await post("view", { token: TOKEN }, {}, "nobody.example.test");
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "notAvailable" });
        expect(calls).toHaveLength(0);
    });
    it("the backend answer is passed through (status, body, Retry-After), always `private, no-store`", async () => {
        reply = () => new Response(JSON.stringify({ error: "x", code: "tooManyForEmail" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "120", "set-cookie": "a=b" } });
        const res = await post("hold", { intentId: INTENT, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: WHO });
        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ error: "x", code: "tooManyForEmail" });
        expect(res.headers.get("retry-after")).toBe("120");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(res.headers.get("set-cookie")).toBeNull();
    });
    it("no API_URL, no renderer key, or a failed call → 503 unavailable (no call for the first two)", async () => {
        delete process.env.API_URL;
        expect((await get("offer")).status).toBe(503);
        process.env.API_URL = "https://api.example.test";
        key.value = "";
        expect((await get("offer")).status).toBe(503);
        expect(calls).toHaveLength(0);
        key.value = "renderer-key";
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
        const res = await get("offer");
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "Booking is temporarily unavailable.", code: "unavailable" });
    });
});

describe("SCHED-1G2 proxy — inputs refused before forwarding (absent / valid / malformed)", () => {
    it("body size: ≤ 8 KB accepted; one byte more → 413 without a call; a declared larger length → 413", async () => {
        const pad = (n: number) => JSON.stringify({ token: TOKEN, p: "x".repeat(n) });
        const base = pad(0).length;
        expect((await post("view", pad(MAX_BODY_BYTES - base))).status).toBe(400); // exactly the limit: read, then the extra field is refused
        expect((await post("view", pad(MAX_BODY_BYTES - base + 1))).status).toBe(413);
        const declared = await handleBookingApi(new Request("https://x/_book/x/api/view", { method: "POST", headers: { "content-length": "9000" }, body: "{}" }), "shop.example.test", "view");
        expect(declared.status).toBe(413);
        expect(calls).toHaveLength(0);
    });
    it("token ops: absent / malformed token → 404 linkNotValid (the backend's one answer); extra field → 400; not JSON → 400", async () => {
        for (const op of ["view", "confirm", "cancel", "move"]) {
            for (const body of [{}, { token: "short" }, { token: TOKEN + "=" }, { token: 7 }, [TOKEN], "null"]) {
                const res = await post(op, body);
                expect(res.status, `${op} ${JSON.stringify(body)}`).toBe(404);
                expect((await res.json()).code).toBe("linkNotValid");
            }
            expect((await post(op, "{")).status).toBe(400);
            expect((await post(op, "")).status).toBe(400);
        }
        expect((await post("confirm", { token: TOKEN, extra: 1 })).status).toBe(400);
        expect(calls).toHaveLength(0);
    });
    it("move target: absent, unknown kind, bad start, extra key → 400", async () => {
        for (const to of [undefined, { kind: "x" }, { kind: "slot", start: "tomorrow" }, { kind: "slot", start: "2026-12-01T09:00:00+02:00" },
            { kind: "slot", start: "2026-12-01T09:00:00Z", extra: 1 }]) {
            expect((await post("move", { token: TOKEN, ...(to === undefined ? {} : { to }) })).status, JSON.stringify(to)).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });
    it("hold: each field absent / malformed → 400 with the field's path; nothing forwarded", async () => {
        const ok = { intentId: INTENT, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00Z" }, who: WHO };
        const bad: [Record<string, unknown>, string][] = [
            [{ ...ok, intentId: undefined }, "intentId"], [{ ...ok, intentId: "nope" }, "intentId"],
            [{ ...ok, recaptchaToken: 5 }, "recaptchaToken"], [{ ...ok, recaptchaToken: "x".repeat(4001) }, "recaptchaToken"],
            [{ ...ok, resend: "yes" }, "resend"], [{ ...ok, what: undefined }, "what"], [{ ...ok, what: { kind: "slot", serviceId: "a#b", start: "2026-12-01T09:00:00Z" } }, "what.serviceId"],
            [{ ...ok, what: { kind: "slot", serviceId: "s1", start: "tomorrow" } }, "what.start"], [{ ...ok, who: undefined }, "who"],
            [{ ...ok, who: { name: "A" } }, "who.email"], [{ ...ok, who: { email: "a@b.test", name: "" } }, "who.name"],
            [{ ...ok, who: { ...WHO, phone: "1".repeat(41) } }, "who.phone"], [{ ...ok, who: { ...WHO, tenantId: "x" } }, "who"],
            [{ ...ok, tenantId: "x" }, ""],
        ];
        for (const [body, field] of bad) {
            const res = await post("hold", JSON.parse(JSON.stringify(body)));
            expect(res.status, field).toBe(400);
            expect((await res.json()).issues.map((i: { path: string }) => i.path), field).toContain(field);
        }
        expect(calls).toHaveLength(0);
    });
    it("GET ops: absent, malformed, repeated or unknown query parameters → 400; a POST to a GET op → 405 Allow GET", async () => {
        for (const [op, qs] of [["slots", ""], ["slots", "?serviceId=s&from=2026-12-01"], ["slots", "?serviceId=s&from=2026-1-1&to=2026-12-07"],
            ["slots", "?serviceId=s&from=2026-12-01&to=2026-12-07&x=1"], ["slots", "?serviceId=s&serviceId=t&from=2026-12-01&to=2026-12-07"],
            ["offer", "?tenant=x"]] as const) {
            expect((await get(op, qs)).status, `${op}${qs}`).toBe(400);
        }
        const wrong = await post("offer", {});
        expect(wrong.status).toBe(405);
        expect(wrong.headers.get("allow")).toBe("GET");
        expect((await get("confirm")).headers.get("allow")).toBe("POST");
        expect((await get("nope")).status).toBe(404);
        expect(calls).toHaveLength(0);
    });
});

describe("SCHED-1G3 proxy — no client address, no browser header (ruling SCHED-ADDR-INFRA = A, § 9.2)", () => {
    /** Every header a browser could send to make the backend see an address, a tenant or a key. */
    const BROWSER = {
        "x-viewer-address": "203.0.113.7", "x-forwarded-for": "203.0.113.7, 198.51.100.4", "cloudfront-viewer-address": "198.51.100.4:4431",
        "x-real-ip": "203.0.113.7", "x-tenant-id": "tenant-other", "x-api-key": "browser-key", cookie: "a=b", authorization: "Bearer x",
    };
    it("every op and the feed: the backend request carries exactly the renderer's headers, never x-viewer-address", async () => {
        const sends: [string, () => Promise<Response>, boolean][] = [
            ["offer", () => get("offer", "", BROWSER), false],
            ["slots", () => get("slots", "?serviceId=s1&from=2026-12-01&to=2026-12-07", BROWSER), false],
            ["hold", () => post("hold", { intentId: INTENT, recaptchaToken: "r", what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: WHO }, BROWSER), true],
            ["view", () => post("view", { token: TOKEN }, BROWSER), true],
            ["confirm", () => post("confirm", { token: TOKEN }, BROWSER), true],
            ["cancel", () => post("cancel", { token: TOKEN }, BROWSER), true],
            ["move", () => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00.000Z" } }, BROWSER), true],
        ];
        expect(sends.map(([op]) => op).sort(), "precondition: every op of the table").toEqual(Object.keys(BOOKING_OPS).sort());
        for (const [op, send, isPost] of sends) {
            calls = [];
            expect((await send()).status, op).toBe(200);
            expect(calls, op).toHaveLength(1);
            expect(calls[0].headers, op).toEqual({ "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop", ...(isPost ? { "content-type": "application/json" } : {}) });
        }
        calls = [];
        await handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`);
        expect(calls[0].headers).toEqual({ "x-api-key": "renderer-key", "x-tenant-id": "tenant-shop", "content-type": "application/json" });
    });
    it("the TEMPORARY witness is gone: offer?witness= is refused (400, no call, no log line); the gate symbols are not exported", async () => {
        const res = await get("offer", "?witness=198.51.100.4", { "x-forwarded-for": "203.0.113.7, 198.51.100.4" });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "invalid", issues: [{ path: "witness", message: "Unknown parameter." }] });
        expect(calls).toHaveLength(0);
        expect(logs.filter((l) => l.includes("witness"))).toEqual([]);
        for (const name of ["witnessLine", "viewerAddressHeader", "TRUSTED_FORWARDED_POSITION"]) expect(name in proxyModule, name).toBe(false);
    });
    it("the proxy source holds no address extraction (no viewerAddress, no x-forwarded-for / cloudfront-viewer-address read)", () => {
        const src = readFileSync(fileURLToPath(new URL("../../src/lib/booking-proxy.ts", import.meta.url)), "utf8");
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");   // comments may name the ruling
        expect(code).not.toMatch(/viewerAddress|x-viewer-address|x-forwarded-for|cloudfront-viewer-address/i);
        expect(src, "control: the detector reads the real file (its header names the header)").toMatch(/x-viewer-address/);
    });
});

describe("SCHED-1G3 scheduling switch — the feed answers 404 when it is off; the API ops are left to the backend", () => {
    it("feed: switch false, switch absent, or no record → the one 404 linkNotValid, private no-store, no backend call", async () => {
        for (const site of ["off.example.test", "unset.example.test", "nobody.example.test"]) {
            const res = await handleBookingFeed(site, "r1", `${SECRET}.ics`);
            expect(res.status, site).toBe(404);
            expect(await res.json(), site).toEqual({ error: "This link is not valid.", code: "linkNotValid" });
            expect(res.headers.get("cache-control"), site).toBe("private, no-store");
        }
        expect(calls).toHaveLength(0);
        expect((await handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`)).status, "control: switch on").toBe(200);
        expect(calls).toHaveLength(1);
    });
    it("API op with the switch off: forwarded; the backend's own 403 notAvailable is passed through", async () => {
        reply = () => new Response(JSON.stringify({ error: "Booking is not available on this site.", code: "notAvailable" }), { status: 403, headers: { "content-type": "application/json" } });
        const res = await handleBookingApi(new Request("https://off.example.test/_book/x/api/offer"), "off.example.test", "offer");
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "notAvailable" });
        expect(calls).toHaveLength(1);
        expect(calls[0].headers["x-tenant-id"]).toBe("tenant-off");
    });
});

describe("SCHED-1G2 feed handler (§ 12)", () => {
    it("200 → the calendar text, text/calendar, private max-age=300; the secret travels in the POST body only", async () => {
        reply = () => new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", { status: 200, headers: { "content-type": "text/calendar" } });
        const res = await handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
        expect(res.headers.get("cache-control")).toBe("private, max-age=300");
        expect(await res.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ url: "https://api.example.test/scheduling/visitor/feed", method: "POST", body: { resourceId: "r1", secret: SECRET } });
        expect(calls[0].headers["x-tenant-id"]).toBe("tenant-shop");
        expect(calls[0].url).not.toContain(SECRET);
    });
    it("one 404 body for every failure a URL holder can meet: malformed name, unknown tenant, backend 404", async () => {
        const one = { error: "This link is not valid.", code: "linkNotValid" };
        for (const [site, res, file] of [["shop.example.test", "r1", "short.ics"], ["shop.example.test", "r1", SECRET], ["shop.example.test", "a#b", `${SECRET}.ics`],
            ["shop.example.test", "", `${SECRET}.ics`], ["nobody.example.test", "r1", `${SECRET}.ics`]]) {
            const answer = await handleBookingFeed(site, res, file);
            expect(answer.status).toBe(404);
            expect(await answer.json()).toEqual(one);
            expect(answer.headers.get("cache-control")).toBe("private, no-store");
        }
        expect(calls).toHaveLength(0);
        reply = () => new Response(JSON.stringify({ error: "other text", code: "linkNotValid" }), { status: 404 });
        const backend404 = await handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`);
        expect(await backend404.json()).toEqual(one);
    });
    it("a backend failure that is not a 404 is passed through, not stored", async () => {
        reply = () => new Response(JSON.stringify({ error: "Busy", code: "busy" }), { status: 503, headers: { "content-type": "application/json" } });
        const res = await handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`);
        expect(res.status).toBe(503);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
    });
});

// ── S1G2-R2: the proxy's primitives ARE the backend's rules ────────────────────────────────────────────────────────

describe("SCHED-1G2 ruling SCHED-1G2-ZOD-DEP = C — the proxy checks with the shared schemas; the renderer imports no zod", () => {
    it("no source file of the renderer (src/, middleware.ts) imports `zod` directly", () => {
        const ROOT = fileURLToPath(new URL("../../", import.meta.url));
        const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
            const p = path.join(dir, n);
            return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
        });
        const sources = [...files(path.join(ROOT, "src")), path.join(ROOT, "middleware.ts")];
        expect(sources.length).toBeGreaterThan(50);   // precondition: the walk reached the tree
        const importsZod = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']zod(?:\/[^"']*)?["']/;
        expect(sources.filter((f) => importsZod.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f))).toEqual([]);
        // Positive control: the detector finds the import form the backend uses.
        expect(importsZod.test('import { z } from "zod";')).toBe(true);
    });
    it("the proxy module takes its body schemas from @amodx/shared and holds no copy of a zod format", () => {
        const src = readFileSync(fileURLToPath(new URL("../../src/lib/booking-proxy.ts", import.meta.url)), "utf8");
        expect(src).toMatch(/import \{[^}]*\bHoldRequestSchema\b[^}]*\bMoveBodySchema\b[^}]*\} from "@amodx\/shared"/);
        expect(src).not.toMatch(/ZOD_UUID|ZOD_ISO_DATETIME|isKeyPart|onlyKeys|checkHold|checkMoveTarget/);
    });
    it("slots `from`/`to`: the proxy forwards exactly the dates the shared LocalDateSchema (the backend's own rule) accepts", async () => {
        for (const d of ["2026-02-31", "2026-02-29", "2024-02-29", "0024-02-29", "1900-02-29", "2000-02-29", "2026-13-01", "2026-1-1", "2026-12-01"]) {
            calls = [];
            const res = await get("slots", `?serviceId=s1&from=${d}&to=${d}`);
            const accepted = LocalDateSchema.safeParse(d).success;
            expect({ d, status: res.status, forwarded: calls.length }).toEqual({ d, status: accepted ? 200 : 400, forwarded: accepted ? 1 : 0 });
        }
    });
});

describe("SCHED-1G2 S1G2-R2 — zero forwarding for impossible dates, invalid instants and invalid UUIDs, on every op that takes one", () => {
    const BAD_INSTANTS = ["2026-02-31T09:00:00Z", "2026-02-29T09:00:00Z", "2026-12-01T09:00Z", "2026-12-01T24:00:00Z", "2026-12-01T09:00:00+02:00", "1900-02-29T09:00:00Z"];
    const BAD_DATES = ["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "0024-02-29"];
    const BAD_UUIDS = ["11111111-1111-1111-1111-111111111111", "3b241101-e2bb-0255-8caf-4136c566a962", "3b241101-e2bb-4255-7caf-4136c566a962", "{3b241101-e2bb-4255-8caf-4136c566a962}"];
    it("hold what.start, move to.start: each invalid instant → 400, nothing forwarded", async () => {
        for (const start of BAD_INSTANTS) {
            expect((await post("hold", { intentId: INTENT, what: { kind: "slot", serviceId: "s1", start }, who: WHO })).status, `hold ${start}`).toBe(400);
            expect((await post("move", { token: TOKEN, to: { kind: "slot", start } })).status, `move ${start}`).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });
    it("slots from / to: each impossible date → 400, nothing forwarded; a real 29 February is forwarded", async () => {
        for (const d of BAD_DATES) {
            expect((await get("slots", `?serviceId=s1&from=${d}&to=2026-12-07`)).status, `from ${d}`).toBe(400);
            expect((await get("slots", `?serviceId=s1&from=2026-12-01&to=${d}`)).status, `to ${d}`).toBe(400);
        }
        expect(calls).toHaveLength(0);
        expect((await get("slots", "?serviceId=s1&from=2028-02-29&to=2028-03-06")).status).toBe(200);
        expect(calls).toHaveLength(1);
    });
    it("hold intentId: each invalid UUID → 400, nothing forwarded", async () => {
        for (const intentId of BAD_UUIDS) {
            expect((await post("hold", { intentId, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00.000Z" }, who: WHO })).status, intentId).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });
});

// ── S1G2-R3 / packet rule 7: the input inventory — every new input, absent / valid / malformed, each a named test ──
// Page inputs (`?frame`, `?lang`, `?service`) and the fragment `#t=` are bound in contract.test.mjs
// (rows sched1g-g3, sched1g-selectors), sched-1g-pure.test.ts (takeLinkToken) and sched-1g-pages.test.ts.
type Inventory = { input: string; absent: () => Promise<Response>; valid: () => Promise<Response>; malformed: () => Promise<Response>; absentStatus: number; malformedStatus: number };
const holdWith = (patch: (b: any) => void) => () => {
    const b: any = { intentId: INTENT, recaptchaToken: "r", resend: false, what: { kind: "slot", serviceId: "s1", start: "2026-12-01T09:00:00Z" }, who: { ...WHO } };
    patch(b);
    return post("hold", b);
};
const INVENTORY: Inventory[] = [
    { input: "slots ?serviceId", absent: () => get("slots", "?from=2026-12-01&to=2026-12-07"), valid: () => get("slots", "?serviceId=s1&from=2026-12-01&to=2026-12-07"), malformed: () => get("slots", "?serviceId=a%23b&from=2026-12-01&to=2026-12-07"), absentStatus: 400, malformedStatus: 400 },
    { input: "slots ?from", absent: () => get("slots", "?serviceId=s1&to=2026-12-07"), valid: () => get("slots", "?serviceId=s1&from=2026-12-01&to=2026-12-07"), malformed: () => get("slots", "?serviceId=s1&from=2026-02-30&to=2026-12-07"), absentStatus: 400, malformedStatus: 400 },
    { input: "slots ?to", absent: () => get("slots", "?serviceId=s1&from=2026-12-01"), valid: () => get("slots", "?serviceId=s1&from=2026-12-01&to=2026-12-07"), malformed: () => get("slots", "?serviceId=s1&from=2026-12-01&to=07.12.2026"), absentStatus: 400, malformedStatus: 400 },
    // SCHED-1G3: offer takes no parameter; any parameter (the former `?witness` included) is malformed.
    { input: "offer: no parameter", absent: () => get("offer"), valid: () => get("offer"), malformed: () => get("offer", "?witness=198.51.100.4"), absentStatus: 200, malformedStatus: 400 },
    { input: "hold intentId", absent: holdWith((b) => { delete b.intentId; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.intentId = "11111111-1111-1111-1111-111111111111"; }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold recaptchaToken (optional)", absent: holdWith((b) => { delete b.recaptchaToken; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.recaptchaToken = 7; }), absentStatus: 200, malformedStatus: 400 },
    { input: "hold resend (optional)", absent: holdWith((b) => { delete b.resend; }), valid: holdWith((b) => { b.resend = true; }), malformed: holdWith((b) => { b.resend = "yes"; }), absentStatus: 200, malformedStatus: 400 },
    { input: "hold what.kind", absent: holdWith((b) => { delete b.what.kind; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.what.kind = "slots"; }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold what.serviceId", absent: holdWith((b) => { delete b.what.serviceId; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.what.serviceId = "x".repeat(101); }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold what.start", absent: holdWith((b) => { delete b.what.start; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.what.start = "2026-02-31T09:00:00Z"; }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold who.email", absent: holdWith((b) => { delete b.who.email; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.who.email = "ana@"; }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold who.name", absent: holdWith((b) => { delete b.who.name; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.who.name = "x".repeat(201); }), absentStatus: 400, malformedStatus: 400 },
    { input: "hold who.phone (optional)", absent: holdWith((b) => { delete b.who.phone; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.who.phone = 40; }), absentStatus: 200, malformedStatus: 400 },
    { input: "hold who.language (optional)", absent: holdWith((b) => { delete b.who.language; }), valid: holdWith(() => {}), malformed: holdWith((b) => { b.who.language = ""; }), absentStatus: 200, malformedStatus: 400 },
    { input: "view token", absent: () => post("view", {}), valid: () => post("view", { token: TOKEN }), malformed: () => post("view", { token: TOKEN.slice(1) }), absentStatus: 404, malformedStatus: 404 },
    { input: "confirm token", absent: () => post("confirm", {}), valid: () => post("confirm", { token: TOKEN }), malformed: () => post("confirm", { token: `${TOKEN}=` }), absentStatus: 404, malformedStatus: 404 },
    { input: "cancel token", absent: () => post("cancel", {}), valid: () => post("cancel", { token: TOKEN }), malformed: () => post("cancel", { token: null }), absentStatus: 404, malformedStatus: 404 },
    { input: "move token", absent: () => post("move", { to: { kind: "slot", start: "2026-12-01T09:00:00Z" } }), valid: () => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00Z" } }), malformed: () => post("move", { token: "x", to: { kind: "slot", start: "2026-12-01T09:00:00Z" } }), absentStatus: 404, malformedStatus: 404 },
    { input: "move to.kind", absent: () => post("move", { token: TOKEN, to: { start: "2026-12-01T09:00:00Z" } }), valid: () => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00Z" } }), malformed: () => post("move", { token: TOKEN, to: { kind: "slots", start: "2026-12-01T09:00:00Z" } }), absentStatus: 400, malformedStatus: 400 },
    { input: "move to.start", absent: () => post("move", { token: TOKEN, to: { kind: "slot" } }), valid: () => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-12-01T09:00:00Z" } }), malformed: () => post("move", { token: TOKEN, to: { kind: "slot", start: "2026-02-31T09:00:00Z" } }), absentStatus: 400, malformedStatus: 400 },
    { input: "feed resourceId", absent: () => handleBookingFeed("shop.example.test", "", `${SECRET}.ics`), valid: () => handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`), malformed: () => handleBookingFeed("shop.example.test", "a#b", `${SECRET}.ics`), absentStatus: 404, malformedStatus: 404 },
    { input: "feed <secret>.ics", absent: () => handleBookingFeed("shop.example.test", "r1", ".ics"), valid: () => handleBookingFeed("shop.example.test", "r1", `${SECRET}.ics`), malformed: () => handleBookingFeed("shop.example.test", "r1", `${SECRET}.txt`), absentStatus: 404, malformedStatus: 404 },
];
describe("SCHED-1G2 input inventory (packet rule 7): absent / valid / malformed for every proxy input", () => {
    for (const row of INVENTORY) {
        it(`${row.input}: absent → ${row.absentStatus}${row.absentStatus === 200 ? " (forwarded)" : " (not forwarded)"}`, async () => {
            const res = await row.absent();
            expect(res.status).toBe(row.absentStatus);
            expect(calls).toHaveLength(row.absentStatus === 200 ? 1 : 0);
        });
        it(`${row.input}: valid → forwarded once`, async () => {
            expect((await row.valid()).status).toBe(200);
            expect(calls).toHaveLength(1);
        });
        it(`${row.input}: malformed → ${row.malformedStatus}, not forwarded`, async () => {
            expect((await row.malformed()).status).toBe(row.malformedStatus);
            expect(calls).toHaveLength(0);
        });
    }
});
