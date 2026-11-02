"use client";

/**
 * CAT-QUOTE-1 — "Request a quote" ("Cere ofertă") on the catalog product page.
 * Spec: docs/slices/cat-quote-1.md § 3 item 2 (CQ-D1 = A, CQ-D2 = A); record docs/slices/cat-quote-1-impl.md.
 *
 * A button that opens a small dialog with up to three actions, one per contact channel the tenant set in
 * Settings → Contact channels (`contactChannels`): Call (`tel:`), WhatsApp (`https://wa.me/<digits>?text=…`, the
 * message pre-filled), E-mail (`mailto:` with subject = the product title and body = the message). A channel without a
 * value is not shown; with no channel at all the component renders nothing (the server also does not mount it then).
 * The message holds the product title, the option chosen in the catalog variant presenter and the product's absolute
 * URL — never a price or a code (a catalog product has neither).
 *
 * The chosen option is read from the presenter's radio group `optionGroupName` (server-rendered, keeps its choice in the
 * form state — SitePage.tsx `CatalogVariantPresenter`; the group `InterestToggle` reads) when the dialog opens, and
 * followed on every `change` of that group while it is open, so the three links never carry a stale variant.
 *
 * Dialog (ruling R2 option a): the native `<dialog>`, opened with `showModal()` — the browser makes the rest of the page
 * inert and keeps focus inside. It is always in the server HTML (closed = not shown), with the links for "no variant".
 * Escape (also handled here, so it closes the same way in every engine), the close button and a click on the backdrop
 * close it; focus moves to the first action on open and back to the button on close. jsdom has no `showModal`, so the
 * jsdom tests stub `showModal`/`close` on `HTMLDialogElement.prototype` in the test file only.
 * Texts: the catalog keys `quote*` of the tenant locale table, passed by the server as `strings` (locale-1 § 5.3).
 */

import { useEffect, useId, useRef, useState } from "react";
import { fillTemplate, type ContactChannels, type LocaleStrings } from "@amodx/shared";

/** The catalog texts of the button and the dialog. */
export type QuoteRequestStrings = Pick<LocaleStrings["catalog"],
    "quoteButton" | "quoteTitle" | "quoteCall" | "quoteWhatsApp" | "quoteEmail" | "quoteMessage" | "quoteClose">;

/** The `[…]` segment of a template that holds `{variant}`: kept (without the brackets) only when an option is chosen. */
const VARIANT_SEGMENT = /\[([^[\]]*\{variant\}[^[\]]*)\]/g;

/**
 * The pre-filled message: `template` with `{product}`, `{variant}` and `{url}` filled. A `[…]` segment that holds
 * `{variant}` is dropped when no option is chosen, else kept without its brackets; any other text, brackets included,
 * stays as written. The segments are resolved BEFORE the values are filled, so a product title is never read as syntax.
 */
export function quoteMessage(template: string, values: { product: string; variant?: string; url: string }): string {
    const variant = values.variant || "";
    const shaped = template.replace(VARIANT_SEGMENT, (_whole, inner: string) => (variant ? inner : ""));
    return fillTemplate(shaped, { product: values.product, variant, url: values.url });
}

/** One action of the dialog; `kind` selects its label. */
export type QuoteAction = { kind: "call" | "whatsapp" | "email"; href: string };

/**
 * The dialog's actions, in the order Call, WhatsApp, E-mail; a channel without a value has none.
 * `tel:` drops the spaces (dashes are valid tel separators); `wa.me` takes the digits only (as QuickContact.tsx).
 */
export function quoteActions(channels: ContactChannels, message: string, subject: string): QuoteAction[] {
    const out: QuoteAction[] = [];
    if (channels.phone) out.push({ kind: "call", href: `tel:${channels.phone.replace(/\s/g, "")}` });
    if (channels.whatsapp) out.push({ kind: "whatsapp", href: `https://wa.me/${channels.whatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}` });
    if (channels.email) out.push({ kind: "email", href: `mailto:${channels.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` });
    return out;
}

function actionLabel(kind: QuoteAction["kind"], strings: QuoteRequestStrings): string {
    switch (kind) {
        case "call": return strings.quoteCall;
        case "whatsapp": return strings.quoteWhatsApp;
        case "email": return strings.quoteEmail;
    }
}

export function QuoteRequest({ channels, productTitle, productUrl, optionGroupName, strings }: {
    channels: ContactChannels;
    productTitle: string;
    /** The product page's absolute URL. */
    productUrl: string;
    /** The catalog variant presenter's radio group (`catalog-option-<group id>`); absent = the product has no options. */
    optionGroupName?: string;
    strings: QuoteRequestStrings;
}) {
    const [open, setOpen] = useState(false);
    const [variant, setVariant] = useState<string | undefined>(undefined);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    // While open, follow every change of the presenter's radio group (rule: the message is never stale, even if the
    // background is reached in a way the modal dialog does not block).
    useEffect(() => {
        if (!open || !optionGroupName) return;
        const onChange = (e: Event) => {
            const t = e.target as HTMLInputElement | null;
            if (t?.name === optionGroupName && t.checked) setVariant(t.value);
        };
        document.addEventListener("change", onChange);
        return () => document.removeEventListener("change", onChange);
    }, [open, optionGroupName]);

    const message = quoteMessage(strings.quoteMessage, { product: productTitle, variant, url: productUrl });
    const actions = quoteActions(channels, message, productTitle);
    if (actions.length === 0) return null;

    function openDialog() {
        const checked = optionGroupName ? document.querySelector<HTMLInputElement>(`input[name="${optionGroupName}"]:checked`) : null;
        setVariant(checked ? checked.value : undefined);
        const dialog = dialogRef.current;
        if (!dialog || dialog.open) return;
        dialog.showModal();
        setOpen(true);
        dialog.querySelector<HTMLElement>("a, button")?.focus();
    }
    function closeDialog() {
        dialogRef.current?.close();       // fires `close` → onClose below
    }
    function onClosed() {
        setOpen(false);
        buttonRef.current?.focus();
    }

    return (
        <div>
            <button
                ref={buttonRef}
                type="button"
                onClick={openDialog}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-quote-request=""
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-11 px-8 hover:opacity-90 transition-opacity"
            >
                {strings.quoteButton}
            </button>
            <dialog
                ref={dialogRef}
                aria-labelledby={titleId}
                onClose={onClosed}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeDialog(); } }}
                onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}
                className="m-auto w-full max-w-sm rounded-lg border border-border bg-background text-foreground p-0 shadow-lg backdrop:bg-foreground/50"
            >
                <div className="p-6 space-y-4">
                    <h2 id={titleId} className="text-lg font-semibold">{strings.quoteTitle}</h2>
                    <ul className="space-y-2">
                        {actions.map((a) => (
                            <li key={a.kind}>
                                <a
                                    href={a.href}
                                    data-quote-action={a.kind}
                                    target={a.kind === "whatsapp" ? "_blank" : undefined}
                                    rel={a.kind === "whatsapp" ? "noopener noreferrer" : undefined}
                                    className="flex w-full items-center justify-center rounded-md border border-border h-11 px-4 text-sm font-medium hover:border-primary transition-colors"
                                >
                                    {actionLabel(a.kind, strings)}
                                </a>
                            </li>
                        ))}
                    </ul>
                    <button type="button" onClick={closeDialog} className="w-full text-sm text-muted-foreground hover:text-foreground">
                        {strings.quoteClose}
                    </button>
                </div>
            </dialog>
        </div>
    );
}
