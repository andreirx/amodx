import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { verifyRecaptcha, getRecaptchaErrorMessage, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";
import { formatFromHeader } from "../lib/email-from.js";
import { FormFieldSchema, type FormField } from "@amodx/shared";

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

// SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 2): the submission is read BY FIELD LABEL, for exactly the fields of
// the stored form — the shape the form component sends (`data` keyed by label, `submitterEmail` at the top level) and
// the shape `FormSubmissions.tsx` reads. Nothing of the request but the cleaned field values and the submitter email
// is stored or mailed.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXTAREA = 5000;
const MAX_TEXT = 500;
/** What an HTML number input sends: an optional sign, digits with an optional decimal point, an optional exponent. */
const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type FieldValue = string | number | boolean;
type CleanedSubmission =
    | { ok: true; fields: FormField[]; data: Record<string, FieldValue>; submitterEmail: string | null }
    | { ok: false; error: string; fields?: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Only the request's OWN keys are read (a label such as "constructor" never reads an inherited value). */
const ownValue = (o: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
/** CR and LF removed (mail header injection), then trimmed. */
const cleanEmail = (raw: string): string => raw.replace(/[\r\n]/g, "").trim();
const isEmail = (v: string): boolean => v.length <= MAX_TEXT && EMAIL_PATTERN.test(v);

/**
 * The stored form's fields that are fields (`FormFieldSchema`), one per label: labels are the submission's keys, so the
 * FIRST field of a label defines it and a later field of the same label is not part of the submission (finding
 * F-1E-DUPLICATE-LABEL). The handler does not validate stored forms, so a stored entry that is not a field is skipped.
 */
function formFields(stored: unknown): FormField[] {
    const seen = new Set<string>();
    const out: FormField[] = [];
    for (const entry of Array.isArray(stored) ? stored : []) {
        const parsed = FormFieldSchema.safeParse(entry);
        if (!parsed.success || seen.has(parsed.data.label)) continue;
        seen.add(parsed.data.label);
        out.push(parsed.data);
    }
    return out;
}

/**
 * FORM-SUBMIT-2 (finding A): the result of cleaning one value. A refusal is a separate variant, so no field value (a
 * visitor's text "invalid", a select option "too-long") can be read as a refusal.
 */
type CleanedValue = { ok: true; value: FieldValue } | { ok: false; reason: "invalid" | "too-long" };
const accepted = (value: FieldValue): CleanedValue => ({ ok: true, value });
const INVALID: CleanedValue = { ok: false, reason: "invalid" };
const TOO_LONG: CleanedValue = { ok: false, reason: "too-long" };

/** One field's value: the cleaned value, or a refusal ("invalid" / "too-long"). An absent key is the blank value. */
function cleanValue(field: FormField, raw: unknown): CleanedValue {
    switch (field.type) {
        case "text":
        case "email":
        case "phone":
        case "textarea": {
            if (raw === undefined) return accepted("");
            if (typeof raw !== "string") return INVALID;
            const value = field.type === "email" ? cleanEmail(raw) : raw.trim();
            if (value.length > (field.type === "textarea" ? MAX_TEXTAREA : MAX_TEXT)) return TOO_LONG;
            return accepted(value);
        }
        case "number": {
            if (raw === undefined) return accepted("");
            if (typeof raw === "number") return Number.isFinite(raw) ? accepted(raw) : INVALID;
            if (typeof raw !== "string") return INVALID;
            const text = raw.trim();
            if (text === "") return accepted("");
            // FORM-SUBMIT-2 (finding C): the same limit as a text field, before the pattern test and the conversion.
            if (text.length > MAX_TEXT) return TOO_LONG;
            const n = Number(text);
            return NUMBER_TEXT.test(text) && Number.isFinite(n) ? accepted(n) : INVALID;
        }
        case "checkbox":
            if (raw === undefined) return accepted(false);
            return typeof raw === "boolean" ? accepted(raw) : INVALID;
        case "select":
            if (raw === undefined || raw === "") return accepted("");
            return typeof raw === "string" && (field.options ?? []).includes(raw) ? accepted(raw) : INVALID;
        default: {
            const unhandled: never = field.type;
            return unhandled;
        }
    }
}

const isBlank = (v: FieldValue): boolean => v === "" || v === false;

/**
 * The submission as stored: `data` = label → cleaned value for every field of the form; the submitter email =
 * `body.submitterEmail`, else the first `email` field's value (blank = absent). Refusals, in this order: a value of
 * the wrong type or an option the field does not have ("Invalid value"), a value over its limit ("Value too long"), an
 * email that fails the pattern ("Invalid email format"), a blank required field ("Missing required fields").
 */
function cleanSubmission(storedFields: unknown, body: Record<string, unknown>): CleanedSubmission {
    const rawData = body.data === undefined ? {} : body.data;
    if (!isPlainObject(rawData)) return { ok: false, error: "Invalid form data" };

    const fields = formFields(storedFields);
    const invalid: string[] = [], tooLong: string[] = [], badEmail: string[] = [], missing: string[] = [];
    const entries: [string, FieldValue][] = [];
    for (const field of fields) {
        const result = cleanValue(field, ownValue(rawData, field.label));
        if (!result.ok) {
            switch (result.reason) {
                case "invalid": invalid.push(field.label); continue;
                case "too-long": tooLong.push(field.label); continue;
                default: {
                    const unhandled: never = result.reason;
                    return unhandled;
                }
            }
        }
        const value = result.value;
        if (field.type === "email" && value !== "" && !isEmail(String(value))) badEmail.push(field.label);
        if (field.required && isBlank(value)) missing.push(field.label);
        entries.push([field.label, value]);
    }
    if (invalid.length > 0) return { ok: false, error: "Invalid value", fields: invalid };
    if (tooLong.length > 0) return { ok: false, error: "Value too long", fields: tooLong };
    if (badEmail.length > 0) return { ok: false, error: "Invalid email format", fields: badEmail };
    if (missing.length > 0) return { ok: false, error: "Missing required fields", fields: missing };

    // Built with fromEntries: a label such as "__proto__" becomes an own key, never the object's prototype.
    const data = Object.fromEntries(entries);

    let submitterEmail: string | null = null;
    const top = body.submitterEmail;
    if (top !== undefined && top !== null) {
        if (typeof top !== "string") return { ok: false, error: "Invalid email format" };
        const cleaned = cleanEmail(top);
        if (cleaned !== "") {
            if (!isEmail(cleaned)) return { ok: false, error: "Invalid email format" };
            submitterEmail = cleaned;
        }
    }
    if (submitterEmail === null) {
        const firstEmailField = fields.find((f) => f.type === "email");
        const value = firstEmailField ? data[firstEmailField.label] : undefined;
        if (typeof value === "string" && value !== "") submitterEmail = value;
    }
    return { ok: true, fields, data, submitterEmail };
}

/** A value in a mail line: blank → "(empty)"; each CR and each LF → a space, so a value cannot add a line. */
const mailValue = (v: FieldValue): string => (v === "" ? "(empty)" : String(v).replace(/[\r\n]/g, " "));

const badRequest = (error: string, fields?: string[]) => ({
    statusCode: 400,
    body: JSON.stringify(fields ? { error, fields } : { error }),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // Verify tenant ID matches request origin
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId);
        if (!tenantVerified) {
            console.warn("Tenant verification failed", { tenantId, origin: event.headers['origin'] });
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid request origin" }) };
        }

        // SHOP-LOOK-1E: the body is parsed once, here; a body that is not a JSON object → 400 (was a 500 from
        // JSON.parse or from reading a key of `null`), before any read of the tenant's data.
        let body: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(event.body || "{}");
            if (!isPlainObject(parsed)) return badRequest("Invalid request body");
            body = parsed;
        } catch {
            return badRequest("Invalid request body");
        }

        // reCAPTCHA verification (deployment-level mandatory, tenant can override keys/threshold)
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));
        const tenantConfig = tenantRes.Item;

        const recaptchaConfig = resolveRecaptchaConfig(tenantConfig?.recaptcha);
        if (recaptchaConfig) {
            const recaptchaToken = typeof body.recaptchaToken === "string" ? body.recaptchaToken : undefined;

            if (!recaptchaToken) {
                return { statusCode: 400, body: JSON.stringify({ error: "CAPTCHA verification required" }) };
            }

            const result = await verifyRecaptcha(
                recaptchaToken,
                recaptchaConfig.secretKey,
                event.requestContext?.http?.sourceIp
            );

            if (!result.success || result.score < recaptchaConfig.threshold) {
                console.warn(`reCAPTCHA BLOCKED [${recaptchaConfig.source}]: score=${result.score}, ip=${event.requestContext?.http?.sourceIp}, form=public-submit`);
                return { statusCode: 403, body: JSON.stringify({ error: getRecaptchaErrorMessage(result) }) };
            }

            console.log(`reCAPTCHA passed [${recaptchaConfig.source}]: score=${result.score}, action=${result.action}`);
        }

        const slug = event.pathParameters?.slug;
        if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing form slug" }) };

        // 1. Look up form via FORMSLUG# pointer (O(1) lookup)
        const slugResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${slug}` }
        }));

        if (!slugResult.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const formId = slugResult.Item.formId;

        // 2. Fetch full form definition
        const formResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `FORM#${formId}` }
        }));

        if (!formResult.Item) return { statusCode: 404, body: JSON.stringify({ error: "Form not found" }) };

        const form = formResult.Item;

        if (form.status !== "active") {
            return { statusCode: 403, body: JSON.stringify({ error: "This form is not currently accepting submissions" }) };
        }

        // 3. Validate and clean the submission against the stored form's fields (SHOP-LOOK-1E)
        const cleaned = cleanSubmission(form.fields, body);
        if (!cleaned.ok) return badRequest(cleaned.error, cleaned.fields);
        const { data, submitterEmail } = cleaned;

        // 4. Create submission
        const submissionId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: `TENANT#${tenantId}`,
                SK: `FORMSUB#${formId}#${submissionId}`,
                Type: "FormSubmission",
                id: submissionId,
                tenantId,
                formId,
                formName: form.name,
                data,
                submitterEmail,
                status: "new",
                createdAt: now,
            }
        }));

        // 5. Send email notification if configured
        if (form.notifyEmail) {
            const fieldLines = cleaned.fields
                .map((f) => `${f.label}: ${mailValue(data[f.label])}`)
                .join("\n");

            try {
                await ses.send(new SendEmailCommand({
                    Source: formatFromHeader(tenantConfig?.name, FROM_EMAIL),
                    Destination: { ToAddresses: [form.notifyEmail] },
                    ReplyToAddresses: submitterEmail ? [submitterEmail] : undefined,
                    Message: {
                        Subject: { Data: `New submission: ${form.name}` },
                        Body: {
                            Text: { Data: `New form submission for "${form.name}"\n\n${fieldLines}\n\nSubmitted: ${now}` }
                        }
                    }
                }));
            } catch (emailErr: any) {
                console.error("Form notification email failed:", emailErr.message);
            }
        }

        return {
            statusCode: 201,
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify({
                message: form.successMessage || "Thank you for your submission!",
                submissionId,
            })
        };
    } catch (e) {
        // FORM-SUBMIT-2 (finding B): the caller is anonymous — the failure (a DynamoDB or reCAPTCHA-fetch text with
        // table names, ARNs, regions; an SES failure is caught above) goes to the log only; the answer is the fixed text of
        // system/invalidation.ts:80.
        console.error("[forms/public-submit] Error:", e);
        return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
    }
};
