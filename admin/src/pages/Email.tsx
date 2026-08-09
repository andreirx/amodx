import { useMemo, useState, type ComponentType } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    EMAIL_PROVIDER_RECIPES,
    deriveEmailDnsValue,
    type EmailDnsCheckResponse,
    type EmailDnsCheckRecordResult,
    type EmailDnsCheckStatus,
    type EmailDnsRecipeRecord,
} from "@amodx/shared";
import {
    Mail, Copy, Check, Loader2, AlertTriangle, ShieldAlert,
    CheckCircle2, XCircle, HelpCircle,
} from "lucide-react";

/**
 * slice email-2 — Guided DNS onboarding + read-only DNS checker.
 * docs/plan-email-onboarding.md §4.2, D-EMAIL-3 (neutral recipes), D-EMAIL-4 (read-only).
 *
 * Renders a provider recipe (records to publish, with copy buttons + lastVerified), the
 * destructive-advice warning for MX-repointing recipes, and — on demand — the result of a
 * read-only public-DNS check per record. AmodX never writes DNS. The "expected" values and
 * the check are both server-authoritative (from @amodx/shared / the backend handler); the
 * only value computed in the browser is the display of a `derive` row's target, which admin
 * mirrors from the SAME pure function the backend uses.
 */

/**
 * Status → theme-token styling + icon (Critical Rule 6: no hardcoded colours). The admin
 * palette exposes only `primary` / `destructive` / `muted` semantic tokens, so the
 * verdict semantics are carried by the ICON (accessible, not colour-dependent) and tinted
 * with those tokens: destructive for a real mismatch, muted for the two AMBIGUOUS states
 * (missing / error), primary for a confirmed match.
 */
const STATUS_META: Record<EmailDnsCheckStatus, { label: string; cls: string; Icon: ComponentType<{ className?: string }> }> = {
    match: { label: "Published", cls: "border-primary/40 bg-primary/5 text-primary", Icon: CheckCircle2 },
    mismatch: { label: "Mismatch", cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle },
    missing: { label: "Not found", cls: "border-border bg-muted text-muted-foreground", Icon: HelpCircle },
    error: { label: "Lookup error", cls: "border-border bg-muted text-muted-foreground", Icon: AlertTriangle },
};

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    if (!text) return null;
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                } catch { /* clipboard unavailable */ }
            }}
        >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
    );
}

/** Render one observed value list, adding the MX priority when present. */
function observedDisplay(res: EmailDnsCheckRecordResult): string {
    if (res.type === "MX" && res.observedMx && res.observedMx.length > 0) {
        return res.observedMx.map((m) => `${m.exchange} (priority ${m.priority})`).join(", ");
    }
    return res.observed.join(", ");
}

export default function EmailPage() {
    const { currentTenant } = useTenant();
    const domain = currentTenant?.domain || "";
    const [providerId, setProviderId] = useState(EMAIL_PROVIDER_RECIPES[0].id);
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<EmailDnsCheckResponse | null>(null);
    const [error, setError] = useState("");

    const recipe = useMemo(
        () => EMAIL_PROVIDER_RECIPES.find((r) => r.id === providerId)!,
        [providerId],
    );

    // Index check results by the recipe row's ORIGINAL index — collision-free even when a
    // recipe holds several records with the same (type, host), e.g. Zoho's three MX rows.
    const resultByIndex = useMemo(() => {
        const m = new Map<number, EmailDnsCheckRecordResult>();
        result?.records.forEach((r) => m.set(r.recordIndex, r));
        return m;
    }, [result]);

    // The concrete value to show/copy for a row: static, or derived from the tenant domain
    // (same pure function the backend uses for the check's `expected`). "" for reference rows.
    function displayValue(rec: EmailDnsRecipeRecord): string {
        if (rec.derive) return domain ? deriveEmailDnsValue(rec.derive, domain) : "";
        return rec.value;
    }

    async function runCheck() {
        setChecking(true);
        setError("");
        try {
            const res: EmailDnsCheckResponse = await apiRequest("/email/dns-check", {
                method: "POST",
                body: JSON.stringify({ provider: providerId }),
            });
            setResult(res);
        } catch (e: any) {
            setError(e.message || "DNS check failed");
            setResult(null);
        } finally {
            setChecking(false);
        }
    }

    // Switching provider invalidates any previous result.
    function onProviderChange(id: string) {
        setProviderId(id);
        setResult(null);
        setError("");
    }

    return (
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
            <div className="flex items-center gap-3">
                <Mail className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Email DNS</h1>
                    <p className="text-sm text-muted-foreground">
                        Guided DNS records for your mailbox provider, plus a read-only check of what is
                        currently published for <span className="font-medium">{domain || "your domain"}</span>.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Mailbox provider</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Select value={providerId} onValueChange={onProviderChange}>
                        <SelectTrigger className="w-full sm:w-80">
                            <SelectValue placeholder="Select a provider" />
                        </SelectTrigger>
                        <SelectContent>
                            {EMAIL_PROVIDER_RECIPES.map((r) => (
                                <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Records last verified against provider documentation on{" "}
                        <span className="font-medium">{recipe.lastVerified}</span>. Always confirm against your
                        provider's current setup screen before publishing.
                        {recipe.docsUrl && (
                            <> {" "}<a href={recipe.docsUrl} target="_blank" rel="noreferrer" className="text-primary underline">Provider docs</a>.</>
                        )}
                    </p>
                </CardContent>
            </Card>

            {recipe.replacesMailRouting && (
                <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
                    <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" />
                    <div>
                        <p className="font-semibold text-destructive">Publishing the MX record repoints ALL mail for this domain.</p>
                        <p className="text-muted-foreground">
                            If mailboxes are currently hosted elsewhere (e.g. cPanel), replacing the MX record moves
                            incoming mail to {recipe.label} domain-wide and your existing mailboxes stop receiving.
                            Migrate mailboxes first and publish MX last (see the migration checklist).
                        </p>
                    </div>
                </div>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>DNS records to publish</CardTitle>
                    {recipe.records.length > 0 && (
                        <Button onClick={runCheck} disabled={checking}>
                            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {checking ? "Checking…" : "Check DNS"}
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="space-y-4">
                    {recipe.records.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            No records to publish — keep your current provider's existing DNS. Nothing here changes
                            your mail routing.
                        </p>
                    )}

                    {result && (
                        <div className="flex gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>{result.ambiguityNote} Checked at {new Date(result.queriedAt).toLocaleString()}.</span>
                        </div>
                    )}

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {recipe.records.map((rec, i) => {
                        const res = resultByIndex.get(i);
                        const referenceOnly = rec.checkable === false;
                        const value = displayValue(rec);
                        const meta = res ? STATUS_META[res.status] : null;
                        return (
                            <div key={i} className="rounded-md border p-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">{rec.type}</span>
                                    {rec.type === "MX" && recipe.replacesMailRouting && (
                                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                                            <ShieldAlert className="h-3.5 w-3.5" /> repoints mail
                                        </span>
                                    )}
                                    {meta && (
                                        <span className={`ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                                            <meta.Icon className="h-3.5 w-3.5" />
                                            {meta.label}
                                        </span>
                                    )}
                                    {!res && referenceOnly && (
                                        <span className="ml-auto text-xs text-muted-foreground">generated in provider console — not auto-checked</span>
                                    )}
                                </div>

                                <div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1 text-sm">
                                    <span className="text-muted-foreground">Host</span>
                                    <span className="flex items-center gap-1 font-mono break-all">
                                        {rec.host}<CopyButton text={rec.host} />
                                    </span>
                                    {typeof rec.priority === "number" && (
                                        <>
                                            <span className="text-muted-foreground">Priority</span>
                                            <span className="font-mono">{rec.priority}</span>
                                        </>
                                    )}
                                    {value ? (
                                        <>
                                            <span className="text-muted-foreground">Value</span>
                                            <span className="flex items-center gap-1 font-mono break-all">
                                                {value}<CopyButton text={value} />
                                            </span>
                                        </>
                                    ) : referenceOnly ? (
                                        <>
                                            <span className="text-muted-foreground">Value</span>
                                            <span className="text-xs italic text-muted-foreground">
                                                Generated in the provider console — see the guidance below.
                                            </span>
                                        </>
                                    ) : rec.derive ? (
                                        <>
                                            <span className="text-muted-foreground">Value</span>
                                            <span className="text-xs italic text-muted-foreground">
                                                Set your domain in Settings to compute this record's value.
                                            </span>
                                        </>
                                    ) : null}
                                </div>

                                {rec.note && <p className="text-xs text-muted-foreground">{rec.note}</p>}

                                {res && (
                                    <div className="space-y-1 border-t pt-2">
                                        {res.status !== "match" && (
                                            <p className="text-xs text-muted-foreground">{res.detail}</p>
                                        )}
                                        {res.observed.length > 0 && (
                                            <p className="text-xs">
                                                <span className="text-muted-foreground">Observed: </span>
                                                <span className="font-mono break-all">{observedDisplay(res)}</span>
                                            </p>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                            TTL: {res.observedTtl !== null
                                                ? `${res.observedTtl}s`
                                                : "not exposed by the resolver for this record type — the verdict is bound to the query time above, not a permanent state."}
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
}
