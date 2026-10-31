import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handler as createProduct } from '../src/products/create';
import { handler as listProducts } from '../src/products/list';
import { handler as updateProduct } from '../src/products/update';
import { handler as deleteProduct } from '../src/products/delete';
import { createEvent, generateTenantId, cleanupTenant, createTenantRecord } from './utils';

describe('Product Domain', () => {
    const tenantId = generateTenantId();
    let productId: string;

    // The site must exist: product writes read its record (cat-mode-1, readTenantMode).
    beforeAll(async () => { await createTenantRecord(tenantId); });
    afterAll(async () => { await cleanupTenant(tenantId); });

    it('1. Create Product', async () => {
        const event = createEvent(tenantId, {
            title: "Running Shoes",
            // FIX: Description is required in your Schema
            description: "High quality running shoes.",
            price: "99.00",
            currency: "USD",
            imageLink: "https://example.com/shoe.jpg",
            status: "active"
        });

        // @ts-ignore
        const res = await createProduct(event, {} as any, () => {}) as any;

        if (res.statusCode !== 201) console.error("Create Product Failed:", res.body);
        expect(res.statusCode).toBe(201);
        productId = JSON.parse(res.body).id;
    });

    it('2. List Products', async () => {
        const event = createEvent(tenantId);
        // @ts-ignore
        const res = await listProducts(event, {} as any, () => {}) as any;

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].title).toBe("Running Shoes");
    });

    it('3. Update Inventory', async () => {
        const event = createEvent(tenantId, {
            inventoryQuantity: 50,
            availability: "in_stock"
        }, { id: productId });

        // @ts-ignore
        const res = await updateProduct(event, {} as any, () => {}) as any;

        if (res.statusCode !== 200) console.error("Update Product Failed:", res.body);
        expect(res.statusCode).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.inventoryQuantity).toBe(50);
    });

    it('4. Delete Product', async () => {
        const event = createEvent(tenantId, null, { id: productId });
        // @ts-ignore
        const res = await deleteProduct(event, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(200);
    });
});
