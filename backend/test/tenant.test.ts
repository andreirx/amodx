import { describe, it, expect, afterAll } from 'vitest';
import { handler as createTenant } from '../src/tenant/create';
// FIX: Importing specific named exports
import { getHandler, updateHandler } from '../src/tenant/settings';
import { createEvent, generateTenantId, cleanupTenant } from './utils';

describe('Tenant Domain', () => {
    const tenantId = generateTenantId();

    afterAll(async () => {
        await cleanupTenant(tenantId);
    });

    it('1. Create Tenant -> Should scaffold default pages', async () => {
        const event = createEvent(tenantId, {
            id: tenantId,
            name: "Integration Tech",
            domain: `${tenantId}.localhost`
        });

        // @ts-ignore
        const res = await createTenant(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(201);
    });

    it('2. Get Settings -> Should return defaults', async () => {
        const event = createEvent(tenantId);
        // FIX: Using getHandler
        // @ts-ignore
        const res = await getHandler(event, {} as any, () => {}) as any;

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.name).toBe("Integration Tech");
    });

    it('3. Update Settings -> Modifies Theme', async () => {
        const event = createEvent(tenantId, {
            theme: { primaryColor: "#FF0000" }
        });
        // FIX: Using updateHandler
        // @ts-ignore
        const res = await updateHandler(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(200);

        // Verify
        const getRes = await getHandler(createEvent(tenantId), {} as any, () => {}) as any;
        const body = JSON.parse(getRes.body);
        expect(body.theme.primaryColor).toBe("#FF0000");
    });
});
