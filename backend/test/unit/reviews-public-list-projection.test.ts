import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard: DynamoDB rejects the reserved keyword `source` in a raw
// ProjectionExpression (bug hit twice — renderer fed5924, backend public-list
// caught on staging 2026-08-09). Pin that public-list aliases it and that its
// ExpressionAttributeNames carries BOTH #s and #src (a second EAN literal would
// silently drop the first).
describe("reviews public-list projection (reserved-keyword safety)", () => {
    const src = readFileSync(join(__dirname, "../../src/reviews/public-list.ts"), "utf8");
    it("does not project the bare reserved word `source`", () => {
        const proj = src.match(/ProjectionExpression:\s*"([^"]+)"/)?.[1] ?? "";
        expect(proj).not.toMatch(/\bsource\b/);
        expect(proj).toContain("#src");
    });
    it("has exactly one ExpressionAttributeNames carrying both #s and #src", () => {
        const eans = src.match(/ExpressionAttributeNames:/g) ?? [];
        expect(eans.length).toBe(1);
        expect(src).toMatch(/"#s":\s*"status"/);
        expect(src).toMatch(/"#src":\s*"source"/);
    });
});
