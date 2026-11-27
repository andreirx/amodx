import { describe, it, expect, beforeEach, vi } from "vitest";
import { PutCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { urlPrefixesOf } from "@amodx/shared";
import { LangTable } from "./lang-1a-table";

/**
 * REDIRECT-1 (docs/slices/redirect-1.md) — an owner adds a redirect from an old address.
 *  - Part 1: the decision rules (backend/src/redirects/rules.ts), pure, no table.
 *  - Part 2: the real handlers (redirects/create.ts, redirects/delete.ts, content/list.ts `type=Redirect`) against the
 *    in-memory table of LANG-1A (lang-1a-table.ts: evaluates the emitted conditions). Mocked: `db.js`, the audit and
 *    the purge (recorded). The reserved addresses are the real rule (slug-guard.ts) on the English defaults.
 * Row ids: R1-TAX-* = the specification's evidence table; R1-R<n>-* = ruling n of the packet; R1-F-* = the findings of
 * review-0 (F-R1-DESTINATION, F-R1-CONTROLS, F-R1-TARGET-MARK, F-R1-PROTECTED-DELETE) and review-1 (F-R1-DESTINATION
 * repeated slashes, F-R1-TARGET-PREDICATE), review-2 (F-R1-TARGET-PREDICATE narrowed: absent or `false` only) and
 * review-3 (F-R1-REFUSAL-FORMATTING: the refusal names the flag's type, never its value);
 * R1-SYS-* = the operator ruling on the system routes `/` and `/contact`.
 * Credential-free.
 */

const h = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: vi.fn(), purgeStoredPagesOfRequestTenant: vi.fn() }));

import { publishAudit } from "../../src/lib/events.js";
import { revalidateTenantPaths } from "../../src/lib/revalidate.js";
import { handler as createHandler } from "../../src/redirects/create.js";
import { handler as deleteHandler } from "../../src/redirects/delete.js";
import { handler as listHandler } from "../../src/content/list.js";
import { redirectRouteItem } from "../../src/content/update.js";
import {
    addressOf, createRefusal, createRequestOf, deletableRedirect, deleteRequestOf, effectiveTarget, fromRefusal, refusalAnswer, routeAtOf,
    storedAddressOf, targetFound, type RedirectRefusal, type RouteAt,
} from "../../src/redirects/rules.js";

const DEFAULTS = { prefixes: urlPrefixesOf(undefined), catalog: false };
const T1 = "TENANT#t1";
const NOW = "2026-11-27T10:00:00.000Z";

// ── Part 1: rules, no table ─────────────────────────────────────────────────────────────────────────────────────────

describe("REDIRECT-1 rules — addresses (pure)", () => {
    it("R1-TAX-SLASH: a trailing slash is dropped; a missing leading slash is added; whitespace around is trimmed", () => {
        expect(addressOf("/room/", "from")).toEqual({ ok: true, value: "/room" });
        expect(addressOf("/de/room//", "from")).toEqual({ ok: true, value: "/de/room" });
        expect(addressOf("guest-house", "to")).toEqual({ ok: true, value: "/guest-house" });
        expect(addressOf("  /to-do/ ", "to")).toEqual({ ok: true, value: "/to-do" });
        expect(addressOf("/", "to")).toEqual({ ok: true, value: "/" });
    });

    it("R1-R4: empty, absolute, scheme-relative, control character and backslash are refused, each with its own kind", () => {
        for (const raw of [undefined, null, 7, "", "   "]) expect(addressOf(raw, "to"), String(raw)).toEqual({ ok: false, refusal: { kind: "missing", field: "to" } });
        for (const raw of ["https://other.example/x", "http:/x", "mailto:a@b", "javascript:alert(1)", "//other.example/x"]) {
            expect(addressOf(raw, "to"), raw).toEqual({ ok: false, refusal: { kind: "not-root-relative", field: "to", value: raw } });
        }
        for (const raw of ["/a\u0000b", "/a\tb", "/a\u007Fb", "/a\\b", "\\\\host/x"]) {
            expect(addressOf(raw, "to"), JSON.stringify(raw)).toMatchObject({ ok: false, refusal: { kind: "bad-character", field: "to" } });
        }
    });

    it("R1-F-CONTROLS: a control character is refused wherever it is — leading, embedded or trailing — before trimming; spaces around stay accepted", () => {
        const controls = ["\t", "\n", "\r", "\u0000", "\u001F", "\u007F", "\u0085", "\u009F"];
        for (const c of controls) {
            for (const raw of [`${c}/guest-house`, `/guest${c}-house`, `/guest-house${c}`, `  /guest-house${c}  `]) {
                for (const field of ["from", "to"] as const) {
                    expect(addressOf(raw, field), `${field} ${JSON.stringify(raw)}`).toEqual({ ok: false, refusal: { kind: "bad-character", field, value: raw } });
                }
            }
        }
        expect(addressOf("  /guest-house  ", "to")).toEqual({ ok: true, value: "/guest-house" });   // the positive control
        expect(storedAddressOf("/room\n")).toMatchObject({ ok: false, refusal: { kind: "bad-character" } });
    });

    it("R1-F-DESTINATION (review-1): // inside an address is refused in both fields; trailing slashes are only dropped", () => {
        for (const raw of ["/a//b", "/a///b", "/a//b/", "/de//room"]) {
            for (const field of ["from", "to"] as const) {
                expect(addressOf(raw, field), `${field} ${raw}`).toEqual({ ok: false, refusal: { kind: "repeated-slash", field, value: raw } });
            }
        }
        expect(addressOf("/a/b//", "to")).toEqual({ ok: true, value: "/a/b" });   // trailing: dropped, not refused
        expect(addressOf("/a/b", "to")).toEqual({ ok: true, value: "/a/b" });     // the ordinary path
    });

    it("an address normalizeSlug would change (case, a dot, a space, a query) is refused with the form it would get, never changed silently", () => {
        expect(addressOf("/Room", "from")).toEqual({ ok: false, refusal: { kind: "not-normal", field: "from", value: "/Room", normal: "/room" } });
        expect(addressOf("/camere.html", "from")).toMatchObject({ ok: false, refusal: { kind: "not-normal", normal: "/camerehtml" } });
        expect(addressOf("/my page", "to")).toMatchObject({ ok: false, refusal: { kind: "not-normal", normal: "/my-page" } });
        expect(addressOf("/page?lang=de", "to")).toMatchObject({ ok: false, refusal: { kind: "not-normal", normal: "/pagelangde" } });
    });

    it("R1-SYS: / and /contact as from (also /contact/) are refused before any table read; as to they are allowed", () => {
        for (const from of ["/", "/contact", "/contact/", "contact"]) {
            expect(createRequestOf({ from, to: "/x" }), from).toEqual({ ok: false, refusal: { kind: "system-route", address: from === "/" ? "/" : "/contact" } });
        }
        expect(createRequestOf({ from: "/old-contact", to: "/contact" })).toEqual({ ok: true, value: { from: "/old-contact", to: "/contact" } });
        expect(createRequestOf({ from: "/blog", to: "/" })).toEqual({ ok: true, value: { from: "/blog", to: "/" } });
        expect(deleteRequestOf({ from: "/" })).toEqual({ ok: false, refusal: { kind: "system-route", address: "/" } });
        expect(deleteRequestOf({ from: "/contact" })).toEqual({ ok: false, refusal: { kind: "system-route", address: "/contact" } });
        expect(deleteRequestOf({ from: "/contact/" })).toEqual({ ok: true, value: "/contact/" });   // another stored key
    });

    it("R1-TAX-SAME: to equal to from (after normalization) is refused; from is checked before to", () => {
        expect(createRequestOf({ from: "/room/", to: "/room" })).toEqual({ ok: false, refusal: { kind: "same-address", address: "/room" } });
        expect(createRequestOf({ from: "", to: "https://x" })).toEqual({ ok: false, refusal: { kind: "missing", field: "from" } });
        expect(createRequestOf({ from: "/room/", to: "/guest-house/" })).toEqual({ ok: true, value: { from: "/room", to: "/guest-house" } });
    });

    it("R1-TAX-RESERVED: from at a built-in page's address → the guard's own text; an address the renderer never looks up → not-served", () => {
        expect(fromRefusal("/shop/old", DEFAULTS)).toEqual({
            kind: "reserved", from: "/shop/old",
            message: 'Slug "/shop/old" uses the address "/shop" of the built-in shop page. Choose a different slug, or change that address in Settings.',
        });
        expect(fromRefusal("/", DEFAULTS)).toEqual({ kind: "not-served", from: "/", by: "the site's home page" });
        expect(fromRefusal("/products/abc", DEFAULTS)).toMatchObject({ kind: "not-served" });
        expect(fromRefusal("/api/x", DEFAULTS)).toMatchObject({ kind: "not-served" });
        expect(fromRefusal("/room", DEFAULTS)).toBeNull();
        expect(fromRefusal("/de/room", DEFAULTS)).toBeNull();
    });

    it("the delete address is the stored key exactly (not normalized: a rename may have stored /OPN1-x)", () => {
        expect(storedAddressOf("/OPN1-x/")).toEqual({ ok: true, value: "/OPN1-x/" });
        expect(storedAddressOf("room")).toMatchObject({ ok: false, refusal: { kind: "not-root-relative" } });
        expect(storedAddressOf("")).toEqual({ ok: false, refusal: { kind: "missing", field: "from" } });
        expect(storedAddressOf("/a\\b")).toMatchObject({ ok: false, refusal: { kind: "bad-character" } });
    });

    it("R1-F-DESTINATION: the effective target — / is the home page's route when homePageSlug is set (an empty one counts as not set)", () => {
        expect(effectiveTarget("/", "/home")).toBe("/home");
        expect(effectiveTarget("/", undefined)).toBe("/");
        expect(effectiveTarget("/", "")).toBe("/");
        expect(effectiveTarget("/about", "/home")).toBe("/about");
        const none = { kind: "none" } as const;
        expect(createRefusal("/home", "/", "/home", none, none)).toEqual({ kind: "home-loop", from: "/home" });
        expect(createRefusal("/blog", "/", "/home", none, { kind: "redirect", to: "/new-home" })).toEqual({ kind: "home-is-redirect", home: "/home", next: "/new-home" });
        expect(createRefusal("/blog", "/", "/home", none, { kind: "page" })).toBeNull();
    });

    it("routes as read → refusals: page or redirect at from; a redirect at to (no chain); a missing target is allowed", () => {
        expect(routeAtOf(undefined)).toEqual({ kind: "none" });
        expect(routeAtOf({ IsRedirect: true, RedirectTo: "/x" })).toEqual({ kind: "redirect", to: "/x" });
        expect(routeAtOf({ TargetNode: "NODE#n1" })).toEqual({ kind: "page" });
        expect(routeAtOf({ IsRedirect: false, TargetNode: "NODE#n1" })).toEqual({ kind: "page" });
        // review-2: any other stored flag is unclassified (the renderer serves a truthy one as a redirect)
        for (const flag of ["true", 1, null, 0, "", "false"]) {
            expect(routeAtOf({ IsRedirect: flag, RedirectTo: "/x" }), JSON.stringify(flag)).toEqual({ kind: "unclassified", flag });
        }
        expect(createRefusal("/a", "/b", undefined, { kind: "none" }, { kind: "unclassified", flag: 1 })).toEqual({ kind: "unclassified-route", address: "/b", flagType: "number" });
        expect(createRefusal("/a", "/b", undefined, { kind: "unclassified", flag: "true" }, { kind: "none" })).toEqual({ kind: "unclassified-route", address: "/a", flagType: "string" });
        expect(deletableRedirect("/a", { kind: "unclassified", flag: 1 })).toEqual({ ok: false, refusal: { kind: "unclassified-route", address: "/a", flagType: "number" } });
        const none = { kind: "none" } as const;
        expect(createRefusal("/a", "/b", undefined, { kind: "page" }, none)).toEqual({ kind: "page-at-from", from: "/a" });
        expect(createRefusal("/a", "/b", undefined, { kind: "redirect", to: "/c" }, none)).toEqual({ kind: "redirect-at-from", from: "/a", to: "/c" });
        expect(createRefusal("/a", "/b", undefined, none, { kind: "redirect", to: "/c" })).toEqual({ kind: "target-is-redirect", to: "/b", next: "/c" });
        expect(createRefusal("/a", "/b", undefined, none, { kind: "page" })).toBeNull();
        expect(createRefusal("/a", "/b", undefined, none, none)).toBeNull();
        expect(deletableRedirect("/a", none)).toEqual({ ok: false, refusal: { kind: "no-redirect-at", from: "/a" } });
        expect(deletableRedirect("/a", { kind: "page" })).toEqual({ ok: false, refusal: { kind: "page-not-redirect", from: "/a" } });
        expect(deletableRedirect("/a", { kind: "redirect", to: "/b" })).toEqual({ ok: true, value: { to: "/b" } });
    });

    it("R1-R6: every refusal kind has its status code of the evidence table and its own text (the one mapping)", () => {
        const all: [RedirectRefusal, number][] = [
            [{ kind: "missing", field: "to" }, 400],
            [{ kind: "not-root-relative", field: "to", value: "https://x" }, 400],
            [{ kind: "bad-character", field: "to", value: "/a\\b" }, 400],
            [{ kind: "repeated-slash", field: "to", value: "/a//b" }, 400],
            [{ kind: "not-normal", field: "from", value: "/Room", normal: "/room" }, 400],
            [{ kind: "system-route", address: "/contact" }, 400],
            [{ kind: "reserved", from: "/shop/x", message: "guard text" }, 400],
            [{ kind: "not-served", from: "/", by: "the site's home page" }, 400],
            [{ kind: "same-address", address: "/a" }, 400],
            [{ kind: "home-loop", from: "/home" }, 400],
            [{ kind: "target-is-redirect", to: "/b", next: "/c" }, 400],
            [{ kind: "home-is-redirect", home: "/home", next: "/c" }, 400],
            [{ kind: "page-at-from", from: "/a" }, 409],
            [{ kind: "unclassified-route", address: "/a", flagType: "number" }, 409],
            [{ kind: "redirect-at-from", from: "/a", to: "/b" }, 409],
            [{ kind: "changed-meanwhile", address: "/a" }, 409],
            [{ kind: "no-redirect-at", from: "/a" }, 404],
            [{ kind: "page-not-redirect", from: "/a" }, 409],
        ];
        expect(all.map(([r, s]) => [r.kind, refusalAnswer(r).statusCode])).toEqual(all.map(([r, s]) => [r.kind, s]));
        const texts = all.map(([r]) => refusalAnswer(r).error);
        expect(new Set(texts).size).toBe(texts.length);
        expect(refusalAnswer({ kind: "reserved", from: "/shop/x", message: "guard text" }).error).toBe("guard text");
        expect(refusalAnswer({ kind: "redirect-at-from", from: "/a", to: "/b" }).error).toMatch(/delete it first, then add the new one/);
        // REDIRECT1-NORMAL-FORM = A: the text names the reason (a redirect stored elsewhere never answers) and the form.
        expect(refusalAnswer({ kind: "not-normal", field: "from", value: "/Room", normal: "/room" }).error)
            .toBe('The "from" address "/Room" cannot be stored as typed: the site stores addresses with lowercase letters a-z, digits, "-" and "/" only, so it would become "/room". A redirect stored at another address than the one visitors ask for never answers. Use "/room" only if that is the real address.');
    });

    it("R1-F-TARGET-MARK: targetFound = route presence only — a page route at the effective target; no inference from reserved prefixes", () => {
        const routes = new Map<string, RouteAt>([["/guest-house", { kind: "page" }], ["/home", { kind: "page" }], ["/old", { kind: "redirect", to: "/guest-house" }]]);
        expect(targetFound("/guest-house", routes, undefined)).toBe(true);
        expect(targetFound("/missing", routes, undefined)).toBe(false);
        expect(targetFound("/old", routes, undefined)).toBe(false);               // a redirect is not a page
        expect(targetFound("/", routes, "/home")).toBe(true);                     // the home page resolves
        expect(targetFound("/", routes, undefined)).toBe(false);                  // no ROUTE#/
        expect(targetFound("/", new Map([["/", { kind: "page" } as const]]), undefined)).toBe(true);
        expect(targetFound("/", routes, "/gone")).toBe(false);                    // home page set, its route absent
        expect(targetFound("/product/does-not-exist", routes, undefined)).toBe(false);
        expect(targetFound("/cart", routes, undefined)).toBe(false);
        expect(targetFound("/shop", routes, undefined)).toBe(false);
    });
});

// ── Part 2: handlers on the in-memory table ──────────────────────────────────────────────────────────────────────────

let db: LangTable;
const callerOf = (tenantId: string, role = "TENANT_ADMIN") => ({ sub: "u1", email: `owner@${tenantId}.example.test`, role, tenantId });
const event = (body: unknown, headerTenant = "t1", caller = callerOf(headerTenant), query?: Record<string, string>) => ({
    headers: { "x-tenant-id": headerTenant },
    queryStringParameters: query,
    body: typeof body === "string" ? body : JSON.stringify(body),
    requestContext: { authorizer: { lambda: caller }, http: { sourceIp: "203.0.113.9" }, requestId: "r1" },
}) as any;
const answer = async (h: any, e: any) => {
    const res = await h(e, {} as any, () => {});
    return { statusCode: res.statusCode as number, body: JSON.parse(res.body) };
};
const add = (body: unknown, tenant = "t1", caller?: any) => answer(createHandler, event(body, tenant, caller));
const remove = (body: unknown, tenant = "t1", caller?: any) => answer(deleteHandler, event(body, tenant, caller));
const list = (tenant = "t1") => answer(listHandler, event(undefined, tenant, callerOf(tenant), { type: "Redirect" }));
const routeOf = (address: string, pk = T1) => db.get(pk, `ROUTE#${address}`);
const writes = () => db.commands.filter((c) => c instanceof PutCommand || c instanceof DeleteCommand || c instanceof TransactWriteCommand);
/** The page route a page create writes (content/create.ts): no IsRedirect. */
const pageRoute = (address: string, pk = T1) => ({ PK: pk, SK: `ROUTE#${address}`, TargetNode: "NODE#n1", Type: "Route", Domain: "x" });
/** The renderer's reader rule, copied (renderer/src/lib/dynamo.ts `getContentBySlug`; same copy as import-paths-1.test.ts). */
const rendererAnswer = (address: string) => {
    const route = routeOf(address);
    if (!route) return null;
    return route.IsRedirect ? { redirect: route.RedirectTo } : { page: route.TargetNode };
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    db = new LangTable();
    h.table = db;
    vi.mocked(publishAudit).mockClear();
    vi.mocked(revalidateTenantPaths).mockClear();
});

describe("REDIRECT-1 POST /redirects", () => {
    it("R1-TAX-VALID + R1-TAX-SLASH: 201; the ONE redirect item at ROUTE#<from> without the trailing slash; the renderer's rule answers the redirect", async () => {
        expect(await add({ from: "/room/", to: "/guest-house/" })).toEqual({ statusCode: 201, body: { from: "/room", to: "/guest-house" } });
        expect(routeOf("/room")).toEqual(redirectRouteItem("t1", "/room", "/guest-house", NOW, "u1"));
        expect(routeOf("/room/")).toBeUndefined();
        expect(rendererAnswer("/room")).toEqual({ redirect: "/guest-house" });
    });

    it("R1-R9: audit with the actor's email and a title; the purge of the changed path, as on a slug rename", async () => {
        await add({ from: "/room", to: "/guest-house" });
        expect(publishAudit).toHaveBeenCalledTimes(1);
        expect(vi.mocked(publishAudit).mock.calls[0][0]).toMatchObject({
            tenantId: "t1", action: "CREATE_REDIRECT",
            actor: { id: "u1", email: "owner@t1.example.test" },
            target: { id: "ROUTE#/room", title: "/room → /guest-house" },
        });
        expect(vi.mocked(revalidateTenantPaths).mock.calls).toEqual([["t1", "page", ["/room"]]]);
    });

    it("R1-R4: a target that does not exist yet is accepted", async () => {
        expect((await add({ from: "/room", to: "/not-built-yet" })).statusCode).toBe(201);
    });

    it("R1-TAX-PAGE + R1-R3: from owned by a published page → 409; the page route unchanged (read back); no write sent", async () => {
        db.put(pageRoute("/despre"));
        const before = routeOf("/despre");
        const res = await add({ from: "/despre", to: "/about" });
        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({ error: 'A page uses the address "/despre". A redirect never replaces a page.', refusal: "page-at-from" });
        expect(routeOf("/despre")).toEqual(before);
        expect(writes()).toEqual([]);
        expect(publishAudit).not.toHaveBeenCalled();
    });

    it("R1-R3: an existing redirect at from → 409 that says delete then add; the redirect unchanged; delete then add replaces it", async () => {
        await add({ from: "/room", to: "/guest-house" });
        const res = await add({ from: "/room", to: "/rooms" });
        expect(res.statusCode).toBe(409);
        expect(res.body.error).toBe('A redirect from "/room" already exists (to "/guest-house"). To change it, delete it first, then add the new one.');
        expect(routeOf("/room")).toMatchObject({ RedirectTo: "/guest-house" });
        expect((await remove({ from: "/room" })).statusCode).toBe(200);
        expect((await add({ from: "/room", to: "/rooms" })).statusCode).toBe(201);
        expect(routeOf("/room")).toMatchObject({ RedirectTo: "/rooms" });
    });

    it("R1-R3: the write is conditional — a page written between the read and the write is not overwritten (409, page kept)", async () => {
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { db.put(pageRoute("/room")); } };
        const res = await add({ from: "/room", to: "/guest-house" });
        expect(res).toEqual({ statusCode: 409, body: { error: 'The address "/room" changed while saving. Reload the list and try again.', refusal: "changed-meanwhile" } });
        expect(routeOf("/room")).toEqual(pageRoute("/room"));
        expect(publishAudit).not.toHaveBeenCalled();
    });

    it("R1-TAX-RESERVED: from under a reserved prefix → 400 with the guard's text; nothing written", async () => {
        const res = await add({ from: "/shop/old", to: "/new" });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('Slug "/shop/old" uses the address "/shop" of the built-in shop page. Choose a different slug, or change that address in Settings.');
        expect(writes()).toEqual([]);
    });

    it("R1-TAX-RESERVED: the tenant's own prefixes are read (a renamed shop address)", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", urlPrefixes: { shop: "/magazin" } });
        expect((await add({ from: "/magazin/x", to: "/new" })).statusCode).toBe(400);
        expect((await add({ from: "/shop/x", to: "/new" })).statusCode).toBe(201);
    });

    it("R1-TAX-TO: to absolute, scheme-relative, empty, equal to from, with a control character or a backslash → 400; nothing written", async () => {
        for (const to of ["https://other.example/x", "//other.example/x", "", "/room/", "/a\u0001b", "/a\\b"]) {
            const res = await add({ from: "/room", to });
            expect(res.statusCode, JSON.stringify(to)).toBe(400);
        }
        expect(writes()).toEqual([]);
    });

    it("R1-TAX-CHAIN: to is itself a redirect → 400 (no chain); nothing written", async () => {
        db.put(redirectRouteItem("t1", "/old-rooms", "/guest-house", NOW, "u0"));
        const res = await add({ from: "/room", to: "/old-rooms" });
        expect(res).toEqual({ statusCode: 400, body: { error: '"/old-rooms" is itself a redirect (to "/guest-house"). Point to the final address instead.', refusal: "target-is-redirect" } });
        expect(writes()).toEqual([]);
    });

    it("R1-F-CONTROLS: the handler refuses a target with a trailing newline, a leading tab or a trailing CR (400, nothing written)", async () => {
        for (const to of ["/guest-house\n", "\t/guest-house", "/guest-house\r"]) {
            const res = await add({ from: "/room", to });
            expect({ to, status: res.statusCode, kind: res.body.refusal }).toEqual({ to, status: 400, kind: "bad-character" });
        }
        expect(writes()).toEqual([]);
        expect((await add({ from: "/room", to: " /guest-house " })).statusCode).toBe(201);   // spaces only: accepted
    });

    it("R1-F-DESTINATION (1): / with homePageSlug /home and /home a redirect → 400 (no chain through the home alias); nothing written", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        db.put(redirectRouteItem("t1", "/home", "/new-home", NOW, "u0"));
        const res = await add({ from: "/blog", to: "/" });
        expect(res).toEqual({ statusCode: 400, body: { error: '"/" shows the home page "/home", which is itself a redirect (to "/new-home"). Point to the final address instead.', refusal: "home-is-redirect" } });
        expect(routeOf("/blog")).toBeUndefined();
        expect(writes()).toEqual([]);
    });

    it("R1-F-DESTINATION (2): /home → / with homePageSlug /home (its route absent) → 400 (a loop); nothing written", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        const res = await add({ from: "/home", to: "/" });
        expect(res.statusCode).toBe(400);
        expect(res.body.refusal).toBe("home-loop");
        expect(routeOf("/home")).toBeUndefined();
        expect(writes()).toEqual([]);
    });

    it("R1-F-DESTINATION: / with homePageSlug /home and /home a page → 201 (the home page is the final address)", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        db.put(pageRoute("/home"));
        expect(await add({ from: "/blog", to: "/" })).toEqual({ statusCode: 201, body: { from: "/blog", to: "/" } });
    });

    it("R1-F-DESTINATION (3): interleaved /a → /b and /b → /a — the second commits between the first's reads and its write; the first is refused (409), no cycle", async () => {
        let inner: { statusCode: number; body: any } | undefined;
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { inner = await add({ from: "/b", to: "/a" }); } };
        const outer = await add({ from: "/a", to: "/b" });
        expect(inner).toEqual({ statusCode: 201, body: { from: "/b", to: "/a" } });
        expect(outer).toEqual({ statusCode: 409, body: { error: 'The address "/b" changed while saving. Reload the list and try again.', refusal: "changed-meanwhile" } });
        expect(routeOf("/a")).toBeUndefined();
        expect(routeOf("/b")).toMatchObject({ IsRedirect: true, RedirectTo: "/a" });
        // The guard is in the write: one transaction, the source Put and the target ConditionCheck.
        const tx = db.commands.filter((c) => c instanceof TransactWriteCommand).at(-1)!.input.TransactItems;
        expect(tx.map((a: any) => Object.keys(a)[0])).toEqual(["Put", "ConditionCheck"]);
        expect(tx[0].Put.ConditionExpression).toBe("attribute_not_exists(SK)");
        expect(tx[1].ConditionCheck).toMatchObject({
            Key: { PK: T1, SK: "ROUTE#/b" },
            ConditionExpression: "attribute_not_exists(IsRedirect) OR IsRedirect = :no",
            ExpressionAttributeValues: { ":no": false },
        });
    });

    it("F-REDIRECT1-REVERSE-CHAIN, the order that is refused: /b → /c first, then /a → /b → 400 target-is-redirect", async () => {
        expect((await add({ from: "/b", to: "/c" })).statusCode).toBe(201);
        const res = await add({ from: "/a", to: "/b" });
        expect({ status: res.statusCode, kind: res.body.refusal }).toEqual({ status: 400, kind: "target-is-redirect" });
        expect(routeOf("/a")).toBeUndefined();
    });

    it("documented limitation (F-REDIRECT1-REVERSE-CHAIN): /a → /b commits first, inside an overlapping /b → /c — both succeed; the destination is checked, not the redirects that point at from", async () => {
        let inner: { statusCode: number; body: any } | undefined;
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { inner = await add({ from: "/a", to: "/b" }); } };
        const outer = await add({ from: "/b", to: "/c" });
        expect([inner?.statusCode, outer.statusCode]).toEqual([201, 201]);
        expect([routeOf("/a")?.RedirectTo, routeOf("/b")?.RedirectTo]).toEqual(["/b", "/c"]);   // a two-hop chain, no cycle
    });

    it("R1-F-DESTINATION (review-1): /a/b → /a//b (and ///) → 400, nothing written — the self-alias loop", async () => {
        for (const to of ["/a//b", "/a///b"]) {
            const res = await add({ from: "/a/b", to });
            expect({ to, status: res.statusCode, kind: res.body.refusal }).toEqual({ to, status: 400, kind: "repeated-slash" });
        }
        expect(routeOf("/a/b")).toBeUndefined();
        expect(writes()).toEqual([]);
    });

    it("R1-F-DESTINATION (review-1): /old → /a//b while /a/b holds a redirect → 400 (the hidden redirect target); /a/b unchanged", async () => {
        db.put(redirectRouteItem("t1", "/a/b", "/elsewhere", NOW, "u0"));
        const before = routeOf("/a/b");
        expect((await add({ from: "/old", to: "/a//b" })).body.refusal).toBe("repeated-slash");
        expect(routeOf("/old")).toBeUndefined();
        expect(routeOf("/a/b")).toEqual(before);
        expect(writes()).toEqual([]);
    });

    it("R1-F-DESTINATION (review-1): the ordinary path /old → /a/b (a page) → 201", async () => {
        db.put(pageRoute("/a/b"));
        expect(await add({ from: "/old", to: "/a/b" })).toEqual({ statusCode: 201, body: { from: "/old", to: "/a/b" } });
        expect(routeOf("/old")).toMatchObject({ IsRedirect: true, RedirectTo: "/a/b" });
    });

    it("R1-F-TARGET-PREDICATE: a target route with IsRedirect: false is a page — direct target → 201, written", async () => {
        db.put({ ...pageRoute("/guest-house"), IsRedirect: false });
        expect(routeAtOf(routeOf("/guest-house"))).toEqual({ kind: "page" });
        expect(await add({ from: "/room", to: "/guest-house" })).toEqual({ statusCode: 201, body: { from: "/room", to: "/guest-house" } });
        expect(routeOf("/room")).toEqual(redirectRouteItem("t1", "/room", "/guest-house", NOW, "u1"));
    });

    it("R1-F-TARGET-PREDICATE (review-2): a target whose IsRedirect is truthy but not Boolean (\"true\", 1) → 409 unclassified-route; nothing written, the target unchanged — no cycle /old → /target → /old", async () => {
        for (const flag of ["true", 1]) {
            db = new LangTable();
            h.table = db;
            db.put({ PK: T1, SK: "ROUTE#/target", Type: "Route", IsRedirect: flag, RedirectTo: "/old" });
            const before = routeOf("/target");
            const res = await add({ from: "/old", to: "/target" });
            expect({ flag, status: res.statusCode, kind: res.body.refusal }).toEqual({ flag, status: 409, kind: "unclassified-route" });
            expect(routeOf("/old")).toBeUndefined();
            expect(routeOf("/target")).toEqual(before);
            expect(writes()).toEqual([]);
        }
    });

    it("R1-F-TARGET-PREDICATE (review-2): the same through the home alias — homePageSlug /home whose IsRedirect is 1 → 409, nothing written", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        db.put({ PK: T1, SK: "ROUTE#/home", Type: "Route", IsRedirect: 1, RedirectTo: "/blog" });
        const res = await add({ from: "/blog", to: "/" });
        expect({ status: res.statusCode, kind: res.body.refusal }).toEqual({ status: 409, kind: "unclassified-route" });
        expect(routeOf("/blog")).toBeUndefined();
        expect(writes().filter((c) => c instanceof TransactWriteCommand)).toEqual([]);
    });

    it("R1-F-TARGET-PREDICATE (review-2): the ConditionCheck itself refuses a truthy non-Boolean flag written between the read and the commit → 409 changed-meanwhile, nothing written", async () => {
        for (const flag of ["true", 1]) {
            db = new LangTable();
            h.table = db;
            db.put(pageRoute("/target"));
            db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { db.put({ PK: T1, SK: "ROUTE#/target", Type: "Route", IsRedirect: flag, RedirectTo: "/old" }); } };
            const res = await add({ from: "/old", to: "/target" });
            expect({ flag, status: res.statusCode, body: res.body }).toEqual({ flag, status: 409, body: { error: 'The address "/target" changed while saving. Reload the list and try again.', refusal: "changed-meanwhile" } });
            expect(routeOf("/old")).toBeUndefined();
        }
    });

    it("R1-F-TARGET-PREDICATE (review-2): a from route with an unclassified flag → 409 (never overwritten); DELETE of it → 409 (never deleted); both read back unchanged", async () => {
        db.put({ PK: T1, SK: "ROUTE#/odd", Type: "Route", IsRedirect: "true", RedirectTo: "/x" });
        const before = routeOf("/odd");
        expect((await add({ from: "/odd", to: "/x" })).body.refusal).toBe("unclassified-route");
        const del = await remove({ from: "/odd" });
        expect({ status: del.statusCode, kind: del.body.refusal }).toEqual({ status: 409, kind: "unclassified-route" });
        expect(routeOf("/odd")).toEqual(before);
        expect(writes()).toEqual([]);
    });

    describe("R1-F-REFUSAL-FORMATTING (review-3): a big integer flag (a bigint from the SDK) → 409 unclassified-route, never 500; read back unchanged", () => {
        const BIG = 9007199254740993n;   // > 2^53: @aws-sdk/util-dynamodb unmarshalls it as a bigint (EXECUTED in the build)
        const SHAPES: [string, unknown, string][] = [["scalar", BIG, "bigint"], ["map", { x: BIG }, "map"], ["list", [BIG], "list"]];
        const oddRoute = (address: string, flag: unknown, to = "/x") => ({ PK: T1, SK: `ROUTE#${address}`, Type: "Route", IsRedirect: flag, RedirectTo: to });
        const check = async (res: { statusCode: number; body: any }, type: string, address: string) => {
            expect({ status: res.statusCode, kind: res.body.refusal }).toEqual({ status: 409, kind: "unclassified-route" });
            expect(res.body.error).toContain(`holds an IsRedirect value of type ${type}`);
            expect(res.body.error).toContain(`"${address}"`);
            expect(res.body.error).not.toContain("9007199254740993");   // the value is never written into the text
        };
        for (const [shape, flag, type] of SHAPES) {
            it(`${shape}: at from`, async () => {
                db.put(oddRoute("/odd", flag));
                const before = routeOf("/odd");
                await check(await add({ from: "/odd", to: "/x" }), type, "/odd");
                expect(routeOf("/odd")).toEqual(before);
                expect(writes()).toEqual([]);
            });
            it(`${shape}: at the direct target`, async () => {
                db.put(oddRoute("/target", flag, "/old"));
                const before = routeOf("/target");
                await check(await add({ from: "/old", to: "/target" }), type, "/target");
                expect(routeOf("/old")).toBeUndefined();
                expect(routeOf("/target")).toEqual(before);
                expect(writes()).toEqual([]);
            });
            it(`${shape}: through the home alias`, async () => {
                db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
                db.put(oddRoute("/home", flag, "/blog"));
                const before = routeOf("/home");
                await check(await add({ from: "/blog", to: "/" }), type, "/home");
                expect(routeOf("/blog")).toBeUndefined();
                expect(routeOf("/home")).toEqual(before);
                expect(writes()).toEqual([]);
            });
            it(`${shape}: on DELETE`, async () => {
                db.put(oddRoute("/odd", flag));
                const before = routeOf("/odd");
                await check(await remove({ from: "/odd" }), type, "/odd");
                expect(routeOf("/odd")).toEqual(before);
                expect(writes()).toEqual([]);
            });
        }
        it("the type description covers every shape the document client returns, and the refusal text is built for each without throwing", () => {
            const flags: [unknown, string][] = [
                [BIG, "bigint"], [{ x: BIG }, "map"], [[BIG], "list"], [new Set([1, 2]), "set"], [new Uint8Array([1]), "binary"],
                [null, "null"], [1, "number"], ["true", "string"], [0, "number"], ["", "string"],
            ];
            for (const [flag, type] of flags) {
                const refusal = createRefusal("/a", "/b", undefined, { kind: "none" }, routeAtOf({ IsRedirect: flag }));
                expect(refusal).toEqual({ kind: "unclassified-route", address: "/b", flagType: type });
                expect(() => refusalAnswer(refusal!)).not.toThrow();
                expect(refusalAnswer(refusal!).statusCode).toBe(409);
            }
        });
    });

    it("R1-F-TARGET-PREDICATE: / through homePageSlug /home whose route has IsRedirect: false → 201, written", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        db.put({ ...pageRoute("/home"), IsRedirect: false });
        expect(await add({ from: "/blog", to: "/" })).toEqual({ statusCode: 201, body: { from: "/blog", to: "/" } });
        expect(routeOf("/blog")).toMatchObject({ IsRedirect: true, RedirectTo: "/" });
    });

    it("R1-SYS: POST from / or /contact → 400 system-route; nothing written; an existing /contact page is unchanged (read back)", async () => {
        db.put(pageRoute("/contact"));
        const before = routeOf("/contact");
        for (const from of ["/", "/contact", "/contact/"]) {
            const res = await add({ from, to: "/x" });
            expect({ from, status: res.statusCode, kind: res.body.refusal }).toEqual({ from, status: 400, kind: "system-route" });
        }
        expect(routeOf("/contact")).toEqual(before);
        expect(routeOf("/")).toBeUndefined();
        expect(db.commands).toEqual([]);   // refused before any read
    });

    it("a body that is not JSON, or not an object → 400", async () => {
        expect((await add("{not json")).statusCode).toBe(400);
        expect((await add("[]")).statusCode).toBe(400);
        expect((await add("null")).statusCode).toBe(400);
    });

    it("R1-TAX-TENANT: keys come from x-tenant-id only — a tenant id in the body is ignored; another tenant's route does not block", async () => {
        db.put(pageRoute("/room", "TENANT#t2"));
        expect((await add({ from: "/room", to: "/guest-house", tenantId: "t2", PK: "TENANT#t2" })).statusCode).toBe(201);
        expect(routeOf("/room")).toMatchObject({ PK: T1, RedirectTo: "/guest-house" });
        expect(routeOf("/room", "TENANT#t2")).toEqual(pageRoute("/room", "TENANT#t2"));
    });

    it("R1-TAX-TENANT: a caller of tenant t2 naming x-tenant-id t1 → 403, nothing read or written", async () => {
        const res = await add({ from: "/room", to: "/guest-house" }, "t1", callerOf("t2"));
        expect(res.statusCode).toBe(403);
        expect(db.commands).toEqual([]);
    });
});

describe("REDIRECT-1 DELETE /redirects", () => {
    it("R1-R5: a redirect is deleted (200); audit and purge as for an add", async () => {
        db.put(redirectRouteItem("t1", "/room", "/guest-house", NOW, "u0"));
        expect(await remove({ from: "/room" })).toEqual({ statusCode: 200, body: { from: "/room" } });
        expect(routeOf("/room")).toBeUndefined();
        expect(vi.mocked(publishAudit).mock.calls[0][0]).toMatchObject({
            action: "DELETE_REDIRECT", actor: { email: "owner@t1.example.test" }, target: { title: "/room → /guest-house" },
        });
        expect(vi.mocked(revalidateTenantPaths).mock.calls).toEqual([["t1", "page", ["/room"]]]);
    });

    it("R1-TAX-DELPAGE + R1-R5: delete of an address that is a page → 409, nothing deleted (read back)", async () => {
        db.put(pageRoute("/despre"));
        const res = await remove({ from: "/despre" });
        expect(res).toEqual({ statusCode: 409, body: { error: 'The address "/despre" belongs to a page, not to a redirect. Nothing was deleted.', refusal: "page-not-redirect" } });
        expect(routeOf("/despre")).toEqual(pageRoute("/despre"));
        expect(writes()).toEqual([]);
    });

    it("R1-R5: the delete is conditional — a page that replaced the redirect meanwhile is not deleted (409, page kept)", async () => {
        db.put(redirectRouteItem("t1", "/room", "/guest-house", NOW, "u0"));
        db.beforeCommand = { match: (c) => c instanceof DeleteCommand, run: async () => { db.put(pageRoute("/room")); } };
        expect((await remove({ from: "/room" })).statusCode).toBe(409);
        expect(routeOf("/room")).toEqual(pageRoute("/room"));
    });

    it("R1-F-PROTECTED-DELETE + R1-SYS: DELETE of / or /contact → 400 system-route, even when a redirect is stored there; both read back unchanged", async () => {
        db.put(redirectRouteItem("t1", "/", "/home", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/contact", "/contact-us", NOW, "u0"));
        const before = [routeOf("/"), routeOf("/contact")];
        for (const from of ["/", "/contact"]) {
            const res = await remove({ from });
            expect(res).toEqual({ statusCode: 400, body: { error: `"${from}" is a system route of the site. A redirect cannot be added or deleted there.`, refusal: "system-route" } });
        }
        expect([routeOf("/"), routeOf("/contact")]).toEqual(before);
        expect(writes()).toEqual([]);
        expect(publishAudit).not.toHaveBeenCalled();
    });

    it("an address with nothing at it → 404; the address is used exactly as stored (no normalization)", async () => {
        db.put(redirectRouteItem("t1", "/OPN1-x", "/opn1-x", NOW, "u0"));
        expect((await remove({ from: "/room" })).statusCode).toBe(404);
        expect((await remove({ from: "/opn1-x" })).statusCode).toBe(404);
        expect((await remove({ from: "/OPN1-x" })).statusCode).toBe(200);
    });

    it("R1-TAX-TENANT: another tenant's redirect at the same address is not deleted", async () => {
        db.put(redirectRouteItem("t2", "/room", "/guest-house", NOW, "u0"));
        expect((await remove({ from: "/room", tenantId: "t2" })).statusCode).toBe(404);
        expect(routeOf("/room", "TENANT#t2")).toBeDefined();
        expect((await remove({ from: "/room" }, "t1", callerOf("t2"))).statusCode).toBe(403);
        expect(routeOf("/room", "TENANT#t2")).toBeDefined();
    });
});

describe("REDIRECT-1 GET /content?type=Redirect (the existing list route)", () => {
    it("R1-F-TARGET-MARK: only redirects, all pages of the query, each with targetFound by route presence; page routes are not listed", async () => {
        db.pageSize = 1;   // one item per Query page: the list must follow LastEvaluatedKey
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", homePageSlug: "/home" });
        db.put(pageRoute("/guest-house"));
        db.put(pageRoute("/home"));
        db.put(redirectRouteItem("t1", "/room", "/guest-house", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/blog", "/", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/to-see-articles", "/to-see", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/old-shop", "/shop", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/old-vase", "/product/does-not-exist", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/old-cart", "/cart", NOW, "u0"));
        db.put(redirectRouteItem("t1", "/chain", "/room", NOW, "u0"));
        db.put(redirectRouteItem("t2", "/elsewhere", "/x", NOW, "u0"));
        const res = await list();
        expect(res.statusCode).toBe(200);
        const rows = res.body.items.map((i: any) => [i.SK, i.RedirectTo, i.targetFound, i.CreatedAt]);
        expect(rows).toEqual([
            ["ROUTE#/blog", "/", true, NOW],                         // / → the home page's route (/home), a page
            ["ROUTE#/chain", "/room", false, NOW],                   // the target is a redirect, not a page
            ["ROUTE#/old-cart", "/cart", false, NOW],                // built-in address, no route: marked
            ["ROUTE#/old-shop", "/shop", false, NOW],
            ["ROUTE#/old-vase", "/product/does-not-exist", false, NOW],
            ["ROUTE#/room", "/guest-house", true, NOW],
            ["ROUTE#/to-see-articles", "/to-see", false, NOW],
        ]);
    });

    it("an empty site → an empty list", async () => {
        expect(await list()).toEqual({ statusCode: 200, body: { items: [] } });
    });
});
