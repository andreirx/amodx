import { describe, it, expect } from 'vitest';
import { handler as createLead } from '../src/leads/create';
import { handler as listLeads } from '../src/leads/list';
import { createEvent, generateTenantId } from './utils';

describe('Leads API', () => {
    const tenantId = generateTenantId();
    const leadEmail = `lead-${Date.now()}@example.com`;

    it('should capture a new lead', async () => {
        const event = createEvent(tenantId, {
            email: leadEmail,
            source: "Footer Form",
            tags: "newsletter"
        });

        const result = await createLead(event, {} as any, () => {}) as any;
        expect(result.statusCode).toBe(201);
    });

    it('should list leads', async () => {
        const event = createEvent(tenantId);
        const result = await listLeads(event, {} as any, () => {}) as any;

        const body = JSON.parse(result.body);
        const lead = body.items.find((l: any) => l.email === leadEmail);
        expect(lead).toBeDefined();
        expect(lead.source).toBe("Footer Form");
    });
});
