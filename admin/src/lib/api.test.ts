// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAuthSession } from "aws-amplify/auth";
import { apiRequest } from "./api";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn(), signOut: vi.fn() }));

beforeEach(() => {
    vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: { idToken: { toString: () => "test-token" } } } as never);
    localStorage.setItem("AMODX_TENANT_ID", "test-tenant");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
});
afterEach(() => {
    delete window.AMODX_CONFIG;
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe("F2 admin API URL join", () => {
    it.each([
        ["https://api.example.test", "/scheduling/admin/bookings"],
        ["https://api.example.test/", "/scheduling/admin/bookings"],
        ["https://api.example.test///", "///scheduling/admin/bookings"],
        ["https://api.example.test/", "scheduling/admin/bookings"],
    ])("one slash between base %s and path %s; auth and tenant headers stay intact", async (base, path) => {
        window.AMODX_CONFIG = { VITE_API_URL: base };
        expect(await apiRequest(path)).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledExactlyOnceWith("https://api.example.test/scheduling/admin/bookings", expect.anything());
        const options = vi.mocked(fetch).mock.calls[0][1]!;
        const headers = new Headers(options.headers);
        expect(headers.get("Authorization")).toBe("Bearer test-token");
        expect(headers.get("x-tenant-id")).toBe("test-tenant");
        expect(headers.get("x-api-key")).toBe("web-client");
    });
    it("keeps a base path and the request query", async () => {
        window.AMODX_CONFIG = { VITE_API_URL: "https://api.example.test/stage/" };
        await apiRequest("/content?limit=10");
        expect(fetch).toHaveBeenCalledWith("https://api.example.test/stage/content?limit=10", expect.anything());
    });
});
