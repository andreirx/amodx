"use client";

/**
 * CAT-INTEREST-1 — the visitor-facing interest list ("Mă interesează") on a CATALOG site.
 * Spec: docs/slices/catalog-mode-1.md § 3.5; slice docs/slices/cat-interest-1.md § 2.1–2.3, § 2.8.
 *
 * Rendered only under `isCatalogMode` (SitePage.tsx, layout.tsx): a non-catalog page never mounts any of these, so
 * its HTML and RSC payload do not change (spec § 3.6). The rules live in `lib/interest.ts` (pure, unit-tested);
 * this file binds them to React (`useSyncExternalStore`) and does the two network calls of the list page:
 *   - the stored ids resolved BY ID, `POST /public/interest/resolve` (`resolveShortlist`) — expired, unavailable,
 *     option gone, the live collection; a failed or incomplete read marks nothing;
 *   - the submission, `POST /public/interest`, called by the browser directly as DynamicForm does for forms.
 *
 * LOCALE-1B (docs/slices/locale-1.md § 6.3, § 5.3): the toggle, the list page and the header widget show the tenant's
 * catalog texts, passed by the server as a `strings` prop with only the keys each uses — the toggle and the list page by
 * `SitePage.tsx`, the widget by `app/[siteId]/layout.tsx` through `Navbar.tsx` (operator ruling LOCALE1B-WIDGET = A).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Heart, Check, Loader2, X } from "lucide-react";
import { InterestSubmissionSchema, fillTemplate, selectPluralText, type InterestResolution, type InterestSubmissionPayload, type InterestSubmitResult, type LocaleStrings } from "@amodx/shared";
import {
    createShortlistStore, listRows, resolveShortlist, sameItem, sendableItems,
    type ListRow, type ShortlistItem, type ShortlistState, type ShortlistStore, type StoragePort,
} from "@/lib/interest";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import { useTenantUrl } from "@/lib/routing";

const SERVER_STATE: ShortlistState = { items: [], persistence: "saved", notice: null };
const stores = new Map<string, ShortlistStore>();

/** One store per tenant for the page's lifetime, over `localStorage` when the browser gives it. */
function storeFor(tenantId: string): ShortlistStore {
    let store = stores.get(tenantId);
    if (!store) {
        let storage: StoragePort | null = null;
        try { storage = window.localStorage; } catch { storage = null; }
        store = createShortlistStore(tenantId, storage);
        stores.set(tenantId, store);
    }
    return store;
}

function useShortlist(tenantId: string) {
    const store = typeof window === "undefined" ? null : storeFor(tenantId);
    const state = useSyncExternalStore(
        (l) => (store ? store.subscribe(l) : () => {}),
        () => (store ? store.getSnapshot() : SERVER_STATE),
        () => SERVER_STATE,
    );
    return { state, store };
}

/** The catalog texts of the toggle (LOCALE-1B). */
export type InterestToggleStrings = Pick<LocaleStrings["catalog"], "interestAdd" | "interestAdded" | "interestListFull">;

/** The catalog texts of the header widget (LOCALE-1B). `interestWidgetLabel` is a count key (the list's item count). */
export type InterestWidgetStrings = Pick<LocaleStrings["catalog"], "interestListTitle" | "interestWidgetLabel" | "interestStorageWarning" | "interestStorageAck">;

/** The catalog texts of the list page and its rows (LOCALE-1B). `interestAdd` fills `{action}` of `interestEmpty`. */
export type InterestListStrings = Pick<LocaleStrings["catalog"],
    | "interestListTitle" | "interestBrowse" | "interestSentTitle" | "interestSentBody" | "interestExcludedIntro"
    | "interestEmpty" | "interestAdd" | "interestErrorNoneAvailable" | "interestErrorInvalid" | "interestErrorCheck"
    | "interestErrorAllGone" | "interestErrorSend" | "interestErrorNetwork" | "interestPreviouslySent"
    | "interestContactHeading" | "interestName" | "interestEmail" | "interestPhone" | "interestMessage" | "interestSubmit"
    | "interestRowExpired" | "interestRowUnavailable" | "interestRowOptionGone" | "interestCollection" | "interestRemove">;

/**
 * The "Mă interesează" toggle. On a card it marks the product; on the product page it marks the product with the
 * option checked in the catalog variant presenter — read from the radio group `optionGroupName` (the presenter is
 * server-rendered; its choice lives in the form state, SitePage.tsx `CatalogVariantPresenter`). The choice is bound
 * to the CURRENT product: when `productId` (or the group) changes, it is read again from the presenter and is empty
 * when nothing is checked (review-0 F4) — an option chosen for another product is never carried over.
 */
export function InterestToggle({ tenantId, productId, title, slug, imageLink, optionGroupName, options = [], variant = "card", strings }: {
    tenantId: string;
    productId: string;
    title: string;
    slug: string;
    imageLink?: string;
    optionGroupName?: string;
    options?: { value: string; imageLink?: string }[];
    variant?: "card" | "page";
    strings: InterestToggleStrings;
}) {
    const { state, store } = useShortlist(tenantId);
    const [optionValue, setOptionValue] = useState<string | undefined>(undefined);
    const [message, setMessage] = useState("");

    useEffect(() => {
        setMessage("");
        if (!optionGroupName) { setOptionValue(undefined); return; }
        const checked = document.querySelector<HTMLInputElement>(`input[name="${optionGroupName}"]:checked`);
        setOptionValue(checked ? checked.value : undefined);
        const onChange = (e: Event) => {
            const t = e.target as HTMLInputElement | null;
            if (t?.name === optionGroupName && t.checked) { setOptionValue(t.value); setMessage(""); }
        };
        document.addEventListener("change", onChange);
        return () => document.removeEventListener("change", onChange);
    }, [optionGroupName, productId]);

    const key = optionValue === undefined ? { productId } : { productId, optionValue };
    const marked = state.items.some((i) => i.productId === productId && (i.optionValue ?? null) === (optionValue ?? null));

    function toggle() {
        if (!store) return;
        if (marked) { store.remove(key); setMessage(""); return; }
        const optionImage = options.find((o) => o.value === optionValue)?.imageLink;
        const item: ShortlistItem = {
            productId, title, slug, addedAt: new Date().toISOString(),
            ...((optionImage || imageLink) ? { imageLink: optionImage || imageLink } : {}),
            ...(optionValue !== undefined ? { optionValue } : {}),
        };
        setMessage(store.add(item) === "full" ? strings.interestListFull : "");
    }

    const label = marked ? strings.interestAdded : strings.interestAdd;
    const size = variant === "page" ? "h-11 px-6 text-sm" : "h-9 px-3 text-xs mt-2 w-full";
    return (
        <div>
            <button
                type="button"
                onClick={toggle}
                aria-pressed={marked}
                data-interest-toggle={productId}
                className={`inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors ${size} ${marked ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:border-primary"}`}
            >
                {marked ? <Check className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
                {variant === "page" && optionValue && !marked ? `${label} (${optionValue})` : label}
            </button>
            {message && <p role="status" className="text-xs text-muted-foreground mt-1">{message}</p>}
        </div>
    );
}

/** The header widget: a link to the list page with the count. Says once when the list cannot be saved. */
export function InterestWidget({ tenantId, listPrefix, strings }: { tenantId: string; listPrefix: string; strings: InterestWidgetStrings }) {
    const { state, store } = useShortlist(tenantId);
    const { getUrl } = useTenantUrl();
    const count = state.items.length;
    return (
        <span className="relative">
            <Link href={getUrl(listPrefix)} data-interest-widget="" aria-label={fillTemplate(selectPluralText(strings.interestWidgetLabel, count), { n: count })} className="relative flex items-center gap-1 p-2 text-muted-foreground hover:text-foreground transition-colors">
                <span className="relative">
                    <Heart className="h-5 w-5" />
                    {count > 0 && (
                        <span data-interest-count={count} className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                            {count}
                        </span>
                    )}
                </span>
                <span className="text-sm font-medium hidden lg:inline">{strings.interestListTitle}</span>
            </Link>
            {state.notice === "page-only" && (
                <span role="status" className="absolute right-0 top-full mt-2 w-64 rounded-md border bg-background p-3 text-xs text-foreground shadow-lg z-50">
                    {strings.interestStorageWarning}
                    <button type="button" onClick={() => store?.acknowledgeNotice()} className="block mt-2 font-medium text-primary">{strings.interestStorageAck}</button>
                </span>
            )}
        </span>
    );
}

const browserFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => fetch(url, init);
const randomBytes = () => crypto.getRandomValues(new Uint8Array(16));

/** The list page: the items (resolved by id, each in its state), the contact form, the confirmation after a send. */
export function InterestListPage({ tenantId, apiUrl, productPrefix, shopPrefix, contentMaxWidth, strings }: {
    tenantId: string;
    apiUrl: string;
    productPrefix: string;
    shopPrefix: string;
    contentMaxWidth: string;
    strings: InterestListStrings;
}) {
    const { state, store } = useShortlist(tenantId);
    const { getUrl } = useTenantUrl();
    const { execute: executeRecaptcha } = useRecaptcha("interest_submit");
    const [mounted, setMounted] = useState(false);
    const [resolution, setResolution] = useState<Map<string, InterestResolution> | null>(null);
    const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => { setMounted(true); }, []);
    useEffect(() => {
        if (state.items.length === 0) return;
        let live = true;
        resolveShortlist(browserFetch, apiUrl, tenantId, state.items.map((i) => i.productId)).then((r) => { if (live) setResolution(r); });
        return () => { live = false; };
        // The catalogue is read once per page view; adding items happens on other pages.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiUrl, tenantId, state.items.length > 0]);

    if (!mounted) {
        return <main className={`${contentMaxWidth} mx-auto py-12 px-6`}><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></main>;
    }

    const shopLink = <Link href={getUrl(shopPrefix)} className="text-primary font-medium hover:underline">{strings.interestBrowse}</Link>;

    if (state.items.length === 0 && state.sent) {
        return (
            <main className={`${contentMaxWidth} mx-auto py-12 px-6 space-y-4`} data-interest-sent="">
                <h1 className="text-3xl font-bold tracking-tight">{strings.interestSentTitle}</h1>
                <p className="text-muted-foreground">{strings.interestSentBody}</p>
                {state.sent.droppedTitles.length > 0 && (
                    <p className="text-sm text-muted-foreground" data-interest-not-included="">
                        {strings.interestExcludedIntro} {state.sent.droppedTitles.join(", ")}.
                    </p>
                )}
                <p>{shopLink}</p>
            </main>
        );
    }

    if (state.items.length === 0) {
        return (
            <main className={`${contentMaxWidth} mx-auto py-12 px-6 space-y-4`}>
                <h1 className="text-3xl font-bold tracking-tight">{strings.interestListTitle}</h1>
                <p className="text-muted-foreground">{fillTemplate(strings.interestEmpty, { action: strings.interestAdd })}</p>
                <p>{shopLink}</p>
            </main>
        );
    }

    const rows = listRows(state.items, resolution);
    const sendable = sendableItems(rows);

    async function send(e: React.FormEvent) {
        e.preventDefault();
        if (!store || sending) return;
        setError("");
        if (sendable.length === 0) { setError(strings.interestErrorNoneAvailable); return; }
        const payload: InterestSubmissionPayload = {
            name: form.name,
            email: form.email,
            ...(form.phone ? { phone: form.phone } : {}),
            ...(form.message ? { message: form.message } : {}),
            items: sendable.map((i) => (i.optionValue === undefined ? { productId: i.productId } : { productId: i.productId, optionValue: i.optionValue })),
            submissionToken: store.tokenForSend(randomBytes()),
            recaptchaToken: null,
        };
        if (!InterestSubmissionSchema.safeParse(payload).success) {
            setError(strings.interestErrorInvalid);
            return;
        }
        // The list's item instances NOW: the completion removes these objects only (review-0 F5, review-1 F5).
        const listAtSend = state.items;
        setSending(true);
        try {
            payload.recaptchaToken = await executeRecaptcha();
            const res = await fetch(`${apiUrl}/public/interest`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(body?.recorded)) {
                // Both outcomes carry what the stored record holds; everything else of the list was not included.
                const result = body as InterestSubmitResult;
                const notIncluded = listAtSend.filter((i) => !result.recorded.some((r) => sameItem(r, i))).map((i) => i.title);
                store.markSent({ submissionId: result.submissionId, droppedTitles: notIncluded }, listAtSend);
            } else if (res.status === 503) {
                setError(strings.interestErrorCheck);
            } else if (res.status === 400 && Array.isArray(body.dropped)) {
                setError(strings.interestErrorAllGone);
            } else {
                setError(strings.interestErrorSend);
            }
        } catch {
            setError(strings.interestErrorNetwork);
        } finally {
            setSending(false);
        }
    }

    const input = "w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

    return (
        <main className={`${contentMaxWidth} mx-auto py-12 px-6 space-y-8`}>
            <h1 className="text-3xl font-bold tracking-tight">{strings.interestListTitle}</h1>
            {state.sent && (
                <p className="text-sm text-muted-foreground" data-interest-previous-sent="">{strings.interestPreviouslySent}</p>
            )}
            <ul className="divide-y border rounded-lg" data-interest-items="">
                {rows.map((row) => <ListItem key={`${row.item.productId}\u0000${row.item.optionValue ?? ""}`} row={row} productUrl={getUrl(`${productPrefix}/${row.item.slug}`)} onRemove={() => store?.remove(row.item)} strings={strings} />)}
            </ul>

            <form onSubmit={send} className="space-y-4 max-w-xl">
                <h2 className="text-xl font-semibold">{strings.interestContactHeading}</h2>
                <div>
                    <label className="text-sm font-medium block mb-1" htmlFor="interest-name">{strings.interestName}<span className="text-destructive ml-1">*</span></label>
                    <input id="interest-name" required value={form.name} onChange={set("name")} className={input} autoComplete="name" />
                </div>
                <div>
                    <label className="text-sm font-medium block mb-1" htmlFor="interest-email">{strings.interestEmail}<span className="text-destructive ml-1">*</span></label>
                    <input id="interest-email" type="email" required value={form.email} onChange={set("email")} className={input} autoComplete="email" />
                </div>
                <div>
                    <label className="text-sm font-medium block mb-1" htmlFor="interest-phone">{strings.interestPhone}</label>
                    <input id="interest-phone" type="tel" value={form.phone} onChange={set("phone")} className={input} autoComplete="tel" />
                </div>
                <div>
                    <label className="text-sm font-medium block mb-1" htmlFor="interest-message">{strings.interestMessage}</label>
                    <textarea id="interest-message" rows={4} value={form.message} onChange={set("message")} className={`${input} resize-y`} />
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button type="submit" disabled={sending} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground h-11 px-8 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                    {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {strings.interestSubmit}
                </button>
            </form>
        </main>
    );
}

/** One list row in its resolved state (see `RowState` in lib/interest.ts). */
function ListItem({ row, productUrl, onRemove, strings }: { row: ListRow; productUrl: string; onRemove: () => void; strings: InterestListStrings }) {
    const { item, state } = row;
    const rowNote: Record<Exclude<ListRow["state"]["kind"], "available" | "unchecked">, string> = {
        "expired": strings.interestRowExpired,
        "unavailable": strings.interestRowUnavailable,
        "option-gone": strings.interestRowOptionGone,
    };
    const dimmed = state.kind === "expired" || state.kind === "unavailable";
    const note = state.kind === "available" || state.kind === "unchecked" ? null : rowNote[state.kind];
    const collection = state.kind === "available" || state.kind === "option-gone" ? state.collection : undefined;
    return (
        <li className="flex items-center gap-4 p-4" data-interest-item={item.productId} data-row-state={state.kind}>
            <div className="h-16 w-16 shrink-0 rounded-md bg-muted overflow-hidden">
                {item.imageLink && <img src={item.imageLink} alt={item.title} className={`h-full w-full object-cover ${dimmed ? "opacity-40" : ""}`} />}
            </div>
            <div className="flex-1 min-w-0">
                {state.kind === "expired" ? (
                    <p className="font-medium text-muted-foreground">{item.title}</p>
                ) : (
                    <Link href={productUrl} className="font-medium hover:text-primary">{item.title}</Link>
                )}
                {collection && <p className="text-sm text-muted-foreground" data-interest-collection="">{strings.interestCollection} {collection}</p>}
                {item.optionValue && <p className="text-sm text-muted-foreground">{item.optionValue}</p>}
                {note && <p className="text-sm text-destructive">{note}</p>}
            </div>
            <button type="button" onClick={onRemove} aria-label={fillTemplate(strings.interestRemove, { title: item.title })} className="p-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
            </button>
        </li>
    );
}
