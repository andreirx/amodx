// CAT-INTEREST-1 — hermetic browser E2E (slice docs/slices/cat-interest-1.md § 5; spec docs/slices/catalog-mode-1.md
// § 3.5). The real renderer build (`next build` + `next start`, harness.mjs) against the DynamoDB stub with the CM1
// fixture tenants (fixtures.mjs): `cm1-catalog` (catalogMode) and `cm1-commerce` (commerceEnabled).
//
// The browser's two API calls are intercepted with `page.route` — the harness builds with NEXT_PUBLIC_API_URL="",
// so they go to the page's own origin and never reach a backend:
//   POST /public/interest/resolve → the stored ids resolved by id (§ 8 F3): each row decides the answer;
//   POST /public/interest         → answered with the shared `InterestSubmitResult`; the rows assert the body.
import { test, expect } from "@playwright/test";
import { startStubs, buildRenderer, startRenderer } from "../serving-contract/harness.mjs";
import { CM1 } from "../serving-contract/fixtures.mjs";

const OAK = "e0000000-0000-4000-8000-000000000001";
const ASH = "e0000000-0000-4000-8000-000000000002";
const LEGACY = "e0000000-0000-4000-8000-000000000003";

let stubs;
let server;

test.beforeAll(async () => {
    test.setTimeout(600_000);
    stubs = await startStubs();
    await buildRenderer(stubs.ddb.url);
    server = await startRenderer(stubs);
});

test.afterAll(async () => {
    await server?.close();
    await stubs?.close();
});

const url = (tenant, p) => `http://${CM1[tenant].host}:${server.port}${p}`;

/** Answers `POST /public/interest/resolve` with `answer(requestBody)` → { status, body }. */
async function resolveWith(page, answer) {
    await page.route((u) => u.pathname === "/public/interest/resolve", async (route) => {
        const { status, body } = answer(route.request().postDataJSON());
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
}

/** Records every `POST /public/interest` and answers 201 "recorded" with every sent pair recorded. */
async function recordSubmissions(page, sent) {
    await page.route((u) => u.pathname === "/public/interest", async (route) => {
        const body = route.request().postDataJSON();
        sent.push({ body, headers: route.request().headers() });
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ outcome: "recorded", submissionId: "e2e-submission", recorded: body.items, dropped: [] }) });
    });
}

/** Stores a shortlist for the catalog tenant before any page script runs. */
async function seedList(page, items) {
    await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); },
        [`amodx:interest:${CM1.catalog.id}`, JSON.stringify({ items })]);
}

async function fillAndSend(page) {
    await page.fill("#interest-name", "Ana Pop");
    await page.fill("#interest-email", "ana@example.com");
    await page.getByRole("button", { name: "Trimite lista" }).click();
}

/** Clicks a toggle until it reports pressed: a click before hydration has no handler and is retried. */
async function press(toggle) {
    await expect(async () => {
        if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
    }).toPass({ timeout: 15_000 });
}

test("catalog: mark two items (one with an option) → widget 2 → list page shows both → submit → confirmation, list empty; a reload sends nothing", async ({ page }) => {
    const sent = [];
    await resolveWith(page, () => ({ status: 200, body: { products: [
        { productId: OAK, status: "active", title: "Oak Plank", slug: "oak-plank", collection: "Herringbone", optionValues: ["120x20", "140x20", "180x20"] },
        { productId: ASH, status: "active", title: "Ash Plank", slug: "ash-plank", optionValues: [] },
    ] } }));
    await recordSubmissions(page, sent);

    // 1. A card on the shop page (no option).
    await page.goto(url("catalog", "/shop"));
    await press(page.locator(`[data-interest-toggle="${ASH}"]`));

    // 2. The product page, with the option chosen in the variant presenter.
    await page.goto(url("catalog", "/product/oak-plank"));
    await page.locator('label:has(input[name="catalog-option-format"][value="140x20"])').click();
    const pageToggle = page.locator(`[data-interest-toggle="${OAK}"]`);
    await expect(pageToggle).toContainText("140x20");
    await press(pageToggle);

    // 3. The header widget counts 2.
    await expect(page.locator("[data-interest-count]:visible")).toHaveText("2");

    // 4. The list page shows both, the option with its item.
    await page.locator("[data-interest-widget]:visible").click();
    await expect(page).toHaveURL(url("catalog", "/lista-mea"));
    const items = page.locator("[data-interest-item]");
    await expect(items).toHaveCount(2);
    await expect(page.locator(`[data-interest-item="${ASH}"]`)).toContainText("Ash Plank");
    await expect(page.locator(`[data-interest-item="${OAK}"]`)).toContainText("Oak Plank");
    await expect(page.locator(`[data-interest-item="${OAK}"]`)).toContainText("140x20");
    // The live collection from the resolve answer (§ 8 F7); both rows available.
    await expect(page.locator(`[data-interest-item="${OAK}"] [data-interest-collection]`)).toHaveText("Colecția Herringbone");
    await expect(page.locator('[data-row-state="available"]')).toHaveCount(2);

    // 5. Submit.
    await page.fill("#interest-name", "Ana Pop");
    await page.fill("#interest-email", "ana@example.com");
    await page.fill("#interest-phone", "0700000000");
    await page.fill("#interest-message", "Aș dori o ofertă.");
    await page.getByRole("button", { name: "Trimite lista" }).click();

    // 6. The confirmation; the list is empty.
    await expect(page.locator("[data-interest-sent]")).toContainText("Lista a fost trimisă");
    await expect(page.locator("[data-interest-count]")).toHaveCount(0);
    expect(sent).toHaveLength(1);
    const { body, headers } = sent[0];
    expect(headers["x-tenant-id"]).toBe(CM1.catalog.id);
    expect(body.items).toEqual([{ productId: ASH }, { productId: OAK, optionValue: "140x20" }]);
    for (const item of body.items) for (const k of ["title", "slug", "imageLink"]) expect(item).not.toHaveProperty(k);
    expect(Object.keys(body).sort()).toEqual(["email", "items", "message", "name", "phone", "recaptchaToken", "submissionToken"]);
    expect(body).toMatchObject({ name: "Ana Pop", email: "ana@example.com", phone: "0700000000", recaptchaToken: null });
    expect(body.submissionToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // 7. A reload of the confirmation shows it again and sends nothing.
    await page.reload();
    await expect(page.locator("[data-interest-sent]")).toContainText("Lista a fost trimisă");
    await page.waitForLoadState("networkidle");
    expect(sent).toHaveLength(1);
});

test("commerce: no interest widget and no interest toggle (the cart is the commerce site's call to action)", async ({ page }) => {
    // The widget is server-rendered from a layout prop that a non-catalog tenant never receives, so the loaded page
    // is the evidence (the commerce pages keep a request open, so "network idle" is never reached there).
    for (const p of ["/", "/shop", "/product/variant-rug"]) {
        await page.goto(url("commerce", p));
        await expect(page.locator("nav").first()).toBeVisible();
        await expect(page.locator("[data-interest-widget]")).toHaveCount(0);
        await expect(page.locator("[data-interest-toggle]")).toHaveCount(0);
    }
    // Positive control on the same build: the catalog home shows the widget.
    await page.goto(url("catalog", "/"));
    await expect(page.locator("[data-interest-widget]").first()).toBeAttached();
});

const at = "2026-10-30T00:00:00.000Z";
const SEEDED = [
    { productId: OAK, title: "Oak Plank", slug: "oak-plank", optionValue: "140x20", addedAt: at },
    { productId: "gone-id", title: "Old Plank", slug: "old-plank", addedAt: at },
    { productId: LEGACY, title: "Legacy Plank", slug: "legacy-plank", addedAt: at },
    { productId: OAK, title: "Oak Plank", slug: "oak-plank", optionValue: "999x99", addedAt: at },
];

test("catalog list page, complete resolution: available | expired (absent) | unavailable | option no longer offered — only the available item is sent", async ({ page }) => {
    const sent = [];
    const resolveBodies = [];
    await seedList(page, SEEDED);
    await resolveWith(page, (body) => {
        resolveBodies.push(body);
        return { status: 200, body: { products: [
            { productId: OAK, status: "active", title: "Oak Plank", slug: "oak-plank", optionValues: ["120x20", "140x20"] },
            { productId: "gone-id", status: "absent" },
            { productId: LEGACY, status: "not-available" },
        ] } };
    });
    await recordSubmissions(page, sent);

    await page.goto(url("catalog", "/lista-mea"));
    const state = (id, option) => page.locator(`[data-interest-item="${id}"]`).filter({ hasText: option ?? "" });
    await expect(state(OAK, "140x20")).toHaveAttribute("data-row-state", "available");
    await expect(state("gone-id")).toHaveAttribute("data-row-state", "expired");
    await expect(state("gone-id")).toContainText("nu mai este în catalog");
    await expect(state(LEGACY)).toHaveAttribute("data-row-state", "unavailable");
    await expect(state(OAK, "999x99")).toHaveAttribute("data-row-state", "option-gone");
    expect(resolveBodies).toEqual([{ productIds: [OAK, "gone-id", LEGACY] }]);   // distinct ids, by id

    await fillAndSend(page);
    await expect(page.locator("[data-interest-sent]")).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.items).toEqual([{ productId: OAK, optionValue: "140x20" }]);
    // The confirmation names what the list held but the record does not.
    await expect(page.locator("[data-interest-not-included]")).toContainText("Old Plank");
    await expect(page.locator("[data-interest-not-included]")).toContainText("Legacy Plank");
});

test("catalog list page, the resolve read fails (503 keys unprocessed): nothing is marked and every item is sent for the server to validate", async ({ page }) => {
    const sent = [];
    await seedList(page, SEEDED);
    await resolveWith(page, () => ({ status: 503, body: { error: "The product list could not be checked. Please try again.", retryable: true } }));
    await recordSubmissions(page, sent);

    await page.goto(url("catalog", "/lista-mea"));
    await expect(page.locator("[data-interest-item]")).toHaveCount(4);
    await expect(page.locator('[data-row-state="unchecked"]')).toHaveCount(4);
    await fillAndSend(page);
    await expect(page.locator("[data-interest-sent]")).toBeVisible();
    expect(sent[0].body.items).toEqual([
        { productId: OAK, optionValue: "140x20" }, { productId: "gone-id" }, { productId: LEGACY }, { productId: OAK, optionValue: "999x99" },
    ]);
});
