import { describe, it, expect } from 'vitest';
import { handler as createComment } from '../src/comments/create';
import { handler as listComments } from '../src/comments/list';
import { createEvent, generateTenantId } from './utils';

describe('Comments API', () => {
    const tenantId = generateTenantId();
    const pageId = "node-123"; // Fake page ID is fine for comments, they just link to it

    it('should post a comment', async () => {
        const event = createEvent(tenantId, {
            pageId: pageId,
            content: "This is a test comment",
            authorName: "Tester",
            authorEmail: "test@test.com"
        });

        const result = await createComment(event, {} as any, () => {}) as any;
        expect(result.statusCode).toBe(201);
    });

    it('should list comments for the page', async () => {
        const event = createEvent(tenantId, null, null, { pageId: pageId });
        const result = await listComments(event, {} as any, () => {}) as any;

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].content).toBe("This is a test comment");
    });

    it('should NOT list comments for a different page', async () => {
        const event = createEvent(tenantId, null, null, { pageId: "other-page" });
        const result = await listComments(event, {} as any, () => {}) as any;

        const body = JSON.parse(result.body);
        expect(body.items).toHaveLength(0);
    });
});
