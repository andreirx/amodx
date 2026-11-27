import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * NEWSLETTER-1 — two renderer boundaries.
 *  1. Ruling NL1-CONSENT-STORAGE = A, condition 3: the renderer never reads the newsletter subscription item (consent
 *     evidence and push state; the main table is readable by the renderer's role). Proof by search: no file under
 *     `renderer/` (sources, tests, fixtures, configuration; build output and dependencies excluded) names its key prefix.
 *     The prefix is built from two parts here, so this file does not name it either.
 *  2. Finding NL1-R1: the signup proxy `/api/leads` answers a body it cannot read with a fixed text — never the parser's
 *     message, which quotes the body (the visitor's address).
 */

const RENDERER = fileURLToPath(new URL("../../", import.meta.url));
const SKIP = new Set(["node_modules", ".next", ".open-next", "dist", "coverage", ".turbo"]);
const PREFIX = ["NEWSLETTER", "#"].join("");

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        if (SKIP.has(name)) return [];
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : [full];
    });
}

describe("NEWSLETTER-1 — the renderer never names the subscription item", () => {
    it("no file under renderer/ (build output and dependencies excluded) contains the key prefix", () => {
        const all = files(RENDERER);
        expect(all.length).toBeGreaterThan(100);                                   // precondition: the search saw the tree
        expect(all.some((f) => f.endsWith(path.join("src", "lib", "dynamo.ts")))).toBe(true);
        const naming = all.filter((f) => readFileSync(f).includes(PREFIX)).map((f) => path.relative(RENDERER, f));
        expect(naming).toEqual([]);
    });
});

vi.mock("@/lib/dynamo", () => ({ getTenantConfig: vi.fn(async () => ({ id: "t1" })) }));
vi.mock("@/lib/api-client", () => ({ getRendererKey: vi.fn(async () => "renderer-key") }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

describe("NEWSLETTER-1 (NL1-R1) — /api/leads: a body it cannot read → a fixed text, never the parser's message", () => {
    it("malformed JSON holding an address → 500 { error: \"Submission Failed\" }; the address is not in the answer; nothing is sent on", async () => {
        process.env.API_URL = "https://backend.test";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { POST } = await import("@/app/api/leads/route");
        const req = {
            headers: new Headers({ host: "acme.test", origin: "https://acme.test", "sec-fetch-site": "same-origin", "content-type": "application/json" }),
            json: async () => JSON.parse('{"email":"visitor.sentinel@example.test",'),
        } as any;
        const res = await POST(req);
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ error: "Submission Failed" });
        expect(text).not.toContain("visitor.sentinel");
        expect(fetchMock).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
