import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2, ArrowRight } from "lucide-react";

/**
 * REDIRECT-1 (docs/slices/redirect-1.md) — the Redirects page: the site's redirects from old addresses (the existing
 * list route `GET /content?type=Redirect`; `targetFound` false → the mark `TARGET_NOT_FOUND`), an add row (`POST /redirects`) that shows the API's refusal text inline,
 * and a delete button with a confirmation (`DELETE /redirects`). No request before a site is selected (as
 * InvalidationBanner, FINDINGS-1 Part 4). Structure of the Forms page (header, Card, Table, empty row).
 */

/** One row of the list: the stored address pair, the creation date and whether something answers at the target. */
export interface RedirectRow {
    from: string;
    to: string;
    createdAt: string | null;
    targetFound: boolean;
}

/**
 * The rows of a `GET /content?type=Redirect` answer, sorted by old address. `from` is the stored key without
 * `ROUTE#` (exactly what DELETE needs). An item without a string `SK` under `ROUTE#` is skipped.
 */
export function redirectRowsOf(answer: unknown): RedirectRow[] {
    const items = (answer as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];
    const rows: RedirectRow[] = [];
    for (const i of items) {
        if (typeof i?.SK !== "string" || !i.SK.startsWith("ROUTE#")) continue;
        rows.push({
            from: i.SK.slice("ROUTE#".length),
            to: String(i.RedirectTo ?? ""),
            createdAt: typeof i.CreatedAt === "string" ? i.CreatedAt : null,
            targetFound: i.targetFound === true,
        });
    }
    return rows.sort((a, b) => a.from.localeCompare(b.from));
}

/** The text to show for a failed request: the API's `error` text when it sent one, else the message. */
export function requestErrorText(e: unknown): string {
    if (e instanceof ApiError) {
        const text = (e.body as { error?: unknown } | null)?.error;
        if (typeof text === "string" && text !== "") return text;
    }
    return e instanceof Error ? e.message : String(e);
}

/**
 * The mark of a redirect whose target has no page route (the list's `targetFound`: route presence only — a built-in
 * page such as the cart has no route and is marked too). Operator ruling after review-0.
 */
export const TARGET_NOT_FOUND = "target not found (no page at this address yet)";

export interface RedirectsViewProps {
    loading: boolean;
    loadError: string | null;
    rows: RedirectRow[];
    from: string;
    to: string;
    adding: boolean;
    addError: string | null;
    deleteError: string | null;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
    onAdd: () => void;
    onDelete: (from: string) => void;
}

/** The page body for one state. Exported for the admin unit tests (react-dom/server runs no effects). */
export function RedirectsView(p: RedirectsViewProps) {
    return (
        <div className="p-8 space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Redirects</h1>
                <p className="text-muted-foreground">
                    Send visitors and search engines from an old address of this site to its new address (permanent redirect, 308).
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                    A redirect never replaces a page. To change a redirect, delete it, then add it again.
                    The system addresses / and /contact cannot hold a redirect.
                </p>
            </div>

            <Card>
                <CardContent className="p-4 space-y-2">
                    <form
                        className="flex flex-col gap-2 md:flex-row md:items-center"
                        onSubmit={(e) => { e.preventDefault(); p.onAdd(); }}
                    >
                        <Input
                            aria-label="Old address"
                            placeholder="Old address, for example /room"
                            value={p.from}
                            onChange={(e) => p.onFromChange(e.target.value)}
                        />
                        <ArrowRight className="hidden md:block h-4 w-4 shrink-0 text-muted-foreground" />
                        <Input
                            aria-label="New address"
                            placeholder="New address, for example /guest-house"
                            value={p.to}
                            onChange={(e) => p.onToChange(e.target.value)}
                        />
                        <Button type="submit" disabled={p.adding}>
                            {p.adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                            Add redirect
                        </Button>
                    </form>
                    {p.addError && <p role="alert" className="text-sm text-destructive">{p.addError}</p>}
                </CardContent>
            </Card>

            {p.deleteError && <p role="alert" className="text-sm text-destructive">{p.deleteError}</p>}

            <Card>
                <CardContent className="p-0">
                    {p.loading ? (
                        <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>
                    ) : p.loadError ? (
                        <p role="alert" className="p-8 text-sm text-destructive">Could not load the redirects: {p.loadError}</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Old address</TableHead>
                                    <TableHead>New address</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {p.rows.map((row) => (
                                    <TableRow key={row.from}>
                                        <TableCell><span className="font-mono text-sm">{row.from}</span></TableCell>
                                        <TableCell>
                                            <span className="font-mono text-sm">{row.to}</span>
                                            {!row.targetFound && (
                                                <span className="ml-2 inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-destructive">
                                                    {TARGET_NOT_FOUND}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "-"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" aria-label={`Delete the redirect from ${row.from}`} onClick={() => p.onDelete(row.from)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {p.rows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                            No redirects yet. Add the old addresses of your previous site above.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function Redirects() {
    const { currentTenant } = useTenant();
    const [rows, setRows] = useState<RedirectRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    useEffect(() => {
        if (currentTenant) load();
    }, [currentTenant?.id]);

    async function load() {
        setLoading(true);
        setLoadError(null);
        try {
            setRows(redirectRowsOf(await apiRequest("/content?type=Redirect")));
        } catch (e) {
            setLoadError(requestErrorText(e));
        } finally {
            setLoading(false);
        }
    }

    async function add() {
        setAdding(true);
        setAddError(null);
        try {
            await apiRequest("/redirects", { method: "POST", body: JSON.stringify({ from, to }) });
            setFrom("");
            setTo("");
            await load();
        } catch (e) {
            setAddError(requestErrorText(e));
        } finally {
            setAdding(false);
        }
    }

    async function remove(address: string) {
        if (!confirm(`Delete the redirect from ${address}? Visitors of this address will see a not-found page.`)) return;
        setDeleteError(null);
        try {
            await apiRequest("/redirects", { method: "DELETE", body: JSON.stringify({ from: address }) });
            await load();
        } catch (e) {
            setDeleteError(requestErrorText(e));
        }
    }

    if (!currentTenant) return <div className="p-8">Select a site.</div>;

    return (
        <RedirectsView
            loading={loading}
            loadError={loadError}
            rows={rows}
            from={from}
            to={to}
            adding={adding}
            addError={addError}
            deleteError={deleteError}
            onFromChange={setFrom}
            onToChange={setTo}
            onAdd={add}
            onDelete={remove}
        />
    );
}
