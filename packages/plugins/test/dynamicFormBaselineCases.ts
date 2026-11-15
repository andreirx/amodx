/**
 * SMALL-FIXES-1 C: the `DynamicForm` inputs whose HTML was recorded BEFORE the slice changed the checkbox
 * (`dynamicForm.baseline.json`, rendered from `src/form/DynamicForm.tsx` at cef3b69 with `renderToStaticMarkup` and
 * `renderToString`, an en-US tenant's form texts). `dynamicForm.test.ts` renders each case with the current code and
 * asserts the HTML equals the recorded one: every field type but the checkbox is unchanged, byte for byte.
 * Each type: required with a placeholder, and optional without one; the select also with options and its own placeholder.
 */
export const DYNAMIC_FORM_BASELINE_CASES: Record<string, Record<string, unknown>[]> = {
    "text-required-placeholder": [{ id: "f", label: "Name", type: "text", required: true, placeholder: "Your name" }],
    "text-optional": [{ id: "f", label: "Name", type: "text", required: false }],
    "email-required-placeholder": [{ id: "f", label: "E-mail", type: "email", required: true, placeholder: "you@example.com" }],
    "email-optional": [{ id: "f", label: "E-mail", type: "email", required: false }],
    "phone-required-placeholder": [{ id: "f", label: "Phone", type: "phone", required: true, placeholder: "+40" }],
    "phone-optional": [{ id: "f", label: "Phone", type: "phone", required: false }],
    "number-required-placeholder": [{ id: "f", label: "Rooms", type: "number", required: true, placeholder: "3" }],
    "number-optional": [{ id: "f", label: "Rooms", type: "number", required: false }],
    "textarea-required-placeholder": [{ id: "f", label: "Message", type: "textarea", required: true, placeholder: "Tell us" }],
    "textarea-optional": [{ id: "f", label: "Message", type: "textarea", required: false }],
    "select-required-placeholder": [{ id: "f", label: "Interest", type: "select", required: true, placeholder: "Choose one", options: ["Hardwood", "Carpet"] }],
    "select-optional": [{ id: "f", label: "Interest", type: "select", required: false, options: ["Hardwood", "Carpet"] }],
    "select-no-options": [{ id: "f", label: "Interest", type: "select", required: false }],
    "all-six-in-order": [
        { id: "a", label: "Name", type: "text", required: true, placeholder: "Your name" },
        { id: "b", label: "E-mail", type: "email", required: true },
        { id: "c", label: "Phone", type: "phone", required: false },
        { id: "d", label: "Rooms", type: "number", required: false },
        { id: "e", label: "Interest", type: "select", required: false, options: ["Hardwood", "Carpet"] },
        { id: "g", label: "Message", type: "textarea", required: false },
    ],
};
