import { normalizeEmail } from "@amodx/shared";
import { TABLE_NAME } from "./db.js";

/**
 * LEAD-NORMALIZE-1 (docs/slices/lead-normalize-1.md) — the lead write of the lead magnet (`leads/create.ts`), the contact
 * form (`contact/send.ts`) and comments (`comments/create.ts`).
 *
 * Key: `TENANT#<tenantId>` / `LEAD#<normalizeEmail(email)>`. The stored `email` is the same normalized address, the key's
 * own suffix: the admin Leads page sends `email` back to delete and to "Send again", and those handlers build the key
 * from it (NL1-R8, one lead identity). The newsletter writer (`leads/newsletter.ts`) uses the same key and `email`.
 *
 * Write: ONE `UpdateItem` whose every assignment is `if_not_exists`. No item with the key → it is created with these
 * attributes. An existing lead (another writer's, or an earlier submission) → only the attributes it lacks are added;
 * no stored value changes (the first `createdAt` and `source`, the owner's `status`, `id`, `name`, `data`). The
 * `NEWSLETTER#<n>` item is never named. Undefined values are not written.
 *
 * Returns the input of `new UpdateCommand(...)`, or of a transaction item `{ Update: ... }`. This function does NOT
 * validate the address. The lead magnet and comments validate its normalized form with their schemas (`LeadSchema`,
 * `CommentSchema`; PD-001) before they call it. The contact form has no address check of its own: SES receives the
 * address as Reply-To first, and a refusal there ends the request before this write (finding LN1-F2).
 */
export function createOrFillLead(
    tenantId: string,
    email: string,
    fields: { source?: unknown; name?: unknown; data?: unknown; createdAt: string },
) {
    const address = normalizeEmail(email);
    const values: Record<string, unknown> = {
        id: crypto.randomUUID(), tenantId, email: address, name: fields.name, source: fields.source,
        status: "New", data: fields.data, createdAt: fields.createdAt, Type: "Lead",
    };
    const attrs = Object.keys(values).filter((a) => values[a] !== undefined);
    return {
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: `LEAD#${address}` },
        UpdateExpression: `SET ${attrs.map((a) => `#${a} = if_not_exists(#${a}, :${a})`).join(", ")}`,
        ExpressionAttributeNames: Object.fromEntries(attrs.map((a) => [`#${a}`, a])),
        ExpressionAttributeValues: Object.fromEntries(attrs.map((a) => [`:${a}`, values[a]])),
    };
}
