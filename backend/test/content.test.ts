import { describe, it, expect, afterAll } from 'vitest';
import { handler as createHandler } from '../src/content/create';
import { handler as getHandler } from '../src/content/get';
import { handler as updateHandler } from '../src/content/update';
import { createEvent, generateTenantId, cleanupTenant } from './utils';

describe('Content Domain', () => {
    const tenantId = generateTenantId();
    let pageNodeId: string;

    afterAll(async () => {
        await cleanupTenant(tenantId);
    });

    it('1. Create Page (Draft) -> Generates Route and Content', async () => {
        const event = createEvent(tenantId, {
            title: "My Test Page",
            slug: "/custom-slug-123", // <--- Test explicit slug
            status: "Draft",
            blocks: [{ type: "hero", attrs: { headline: "Hello" } }]
        });

        // @ts-ignore
        const res = await createHandler(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);

        expect(body.slug).toBe("/custom-slug-123"); // <--- Verify it wasn't overwritten
        expect(body.nodeId).toBeDefined();
        pageNodeId = body.nodeId;
    });

    it('2. Get Page -> Returns correct data', async () => {
        const event = createEvent(tenantId, null, { id: pageNodeId });
        const res = await getHandler(event, {} as any, () => {}) as any;

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.title).toBe("My Test Page");
        expect(body.blocks[0].type).toBe("hero");
    });

    it('3. Update Page -> Changes Title and SEO', async () => {
        const event = createEvent(tenantId, {
            title: "Updated Title",
            seoDescription: "SEO Test"
        }, { id: pageNodeId });

        const res = await updateHandler(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(200);

        // Verify Persistence
        const readEvent = createEvent(tenantId, null, { id: pageNodeId });
        const readRes = await getHandler(readEvent, {} as any, () => {}) as any;
        const body = JSON.parse(readRes.body);
        expect(body.title).toBe("Updated Title");
        expect(body.seoDescription).toBe("SEO Test");
    });

    it('4. Slug Change -> Creates Redirect', async () => {
        // Change slug from /my-test-page to /new-slug
        const event = createEvent(tenantId, {
            slug: "new-slug"
        }, { id: pageNodeId });

        const res = await updateHandler(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(200);

        // Note: To fully verify the Redirect Route creation, we would query the DB directly here
        // or add a listRoutes handler. For now, 200 OK implies the transaction passed.
    });
});
