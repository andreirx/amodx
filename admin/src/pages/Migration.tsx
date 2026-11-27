import { useState, useEffect } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, CheckCircle2, AlertCircle, ImageIcon, ShoppingBag, FileText } from "lucide-react";
import { detectHeaderMappings, type HeaderMapping } from "@/lib/csv-headers";
import { useTenant } from "@/context/TenantContext";
import { isCatalogMode } from "@amodx/shared";
import { addressRowView, summarizeReport, type AddressRow } from "@/lib/wpAddressReport";
import { PagesImportFlow, checkAuthorisesImport } from "@/lib/wpImportRun";
import { uploadMigrationFile, putWithFetch } from "@/lib/migrationUpload";

interface StepResult {
    success: boolean;
    message: string;
    details?: any;
}

export default function MigrationPage() {
    const { currentTenant } = useTenant();
    // CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.6): a catalog's products come from the pricelist import (the WooCommerce
    // products import is refused for it, 403) — the page has two steps there, Media and Pages.
    const catalog = isCatalogMode(currentTenant);

    // Step 1: Media
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [mediaLoading, setMediaLoading] = useState(false);
    const [mediaResult, setMediaResult] = useState<StepResult | null>(null);
    const [existingMediaCount, setExistingMediaCount] = useState<number | null>(null);

    // Step 2: Products
    const [productsFile, setProductsFile] = useState<File | null>(null);
    const [productsLoading, setProductsLoading] = useState(false);
    const [productsResult, setProductsResult] = useState<StepResult | null>(null);
    const [headerMappings, setHeaderMappings] = useState<HeaderMapping[] | null>(null);
    const [pendingCsvContent, setPendingCsvContent] = useState<string>("");

    // Step 3: Pages
    const [pagesFile, setPagesFile] = useState<File | null>(null);
    const [pagesLoading, setPagesLoading] = useState(false);
    const [pagesResult, setPagesResult] = useState<StepResult | null>(null);
    // IMPORT-PATHS-1: the uploaded export (one upload for the check and the import; MIGRATION-UPLOAD-1: the importer
    // deletes it after the last batch of the import, so the key is dropped then), the option as the check answered
    // it or the operator set it (null = not checked yet), and the address report of the last check or import.
    const [pagesS3Key, setPagesS3Key] = useState<string | null>(null);
    const [keepOldAddresses, setKeepOldAddresses] = useState<boolean | null>(null);
    const [addressReport, setAddressReport] = useState<AddressReport | null>(null);
    // The last check and whether it authorises an import (one import per complete check): PagesImportFlow.
    const [pagesFlow] = useState(() => new PagesImportFlow(apiRequest));

    // Check if media already imported on page load
    useEffect(() => {
        if (currentTenant) {
            apiRequest("/assets").then(res => {
                setExistingMediaCount(res.items?.length || 0);
            }).catch(() => setExistingMediaCount(0));
        }
    }, [currentTenant?.id]);

    // Unlock steps 2/3 if media import succeeded OR if media already exists
    const mediaComplete = mediaResult?.success === true || (existingMediaCount !== null && existingMediaCount > 0);

    // MIGRATION-UPLOAD-1: an export is uploaded to the PRIVATE bucket (POST /import/upload-url), never to /assets: it
    // holds commenters' names and mail addresses. The importer deletes it after the last batch of the import.
    const uploadToS3 = (file: File): Promise<string> => uploadMigrationFile(apiRequest, putWithFetch, file);

    async function handleMediaImport() {
        if (!mediaFile) return;
        setMediaLoading(true);
        setMediaResult(null);

        try {
            const s3Key = await uploadToS3(mediaFile);

            // Process in batches to avoid API Gateway timeout
            let batchStart = 0;
            let totalDownloaded = 0;
            let totalFailed = 0;
            let totalInXml = 0;
            // MIGRATION-UPLOAD-1: the API walks the export's own order; each answer counts its own batch (batch*), so the
            // run's totals are their sums. (`alreadyImported` of an answer also counts what this run imported before it.)
            let alreadyImported = 0;
            const allErrors: string[] = [];

            while (true) {
                const res = await apiRequest("/import/media", {
                    method: "POST",
                    body: JSON.stringify({ s3Key, batchStart, batchSize: 50 }),
                });

                totalInXml = res.total;
                alreadyImported += res.batchSkipped || 0;
                totalDownloaded += res.batchDownloaded || 0;
                totalFailed += res.batchFailed || 0;
                if (res.errors) allErrors.push(...res.errors);

                // Update progress message
                setMediaResult({
                    success: true,
                    message: `Progress: ${res.processedSoFar || 0}/${res.total || 0} images checked (${alreadyImported} already imported)...`,
                    details: res,
                });

                if (res.complete) {
                    setMediaResult({
                        success: true,
                        message: `Downloaded ${totalDownloaded} of ${totalInXml} images (${alreadyImported} skipped, ${totalFailed} failed)`,
                        details: { ...res, errors: allErrors },
                    });
                    break;
                }

                batchStart = res.nextBatchStart;
            }
        } catch (e: any) {
            setMediaResult({ success: false, message: e.message });
        } finally {
            setMediaLoading(false);
        }
    }

    async function handleProductsImport() {
        if (!productsFile) return;
        setProductsResult(null);
        try {
            const csvContent = await productsFile.text();
            const firstLine = csvContent.split('\n')[0] || '';
            const mappings = detectHeaderMappings(firstLine);
            if (mappings) {
                // Non-English headers detected — show confirmation dialog
                setPendingCsvContent(csvContent);
                setHeaderMappings(mappings);
            } else {
                // English headers — import directly
                await doProductsImport(csvContent);
            }
        } catch (e: any) {
            setProductsResult({ success: false, message: e.message });
        }
    }

    async function doProductsImport(csvContent: string) {
        setProductsLoading(true);
        setProductsResult(null);
        try {
            const res = await apiRequest("/import/woocommerce", {
                method: "POST",
                body: JSON.stringify({ csvContent }),
            });
            setProductsResult({
                success: true,
                message: `${res.imported} products imported, ${res.categoriesCreated} categories created, ${res.skipped} skipped, ${res.drafts || 0} drafts`,
                details: res,
            });
        } catch (e: any) {
            setProductsResult({ success: false, message: e.message });
        } finally {
            setProductsLoading(false);
        }
    }

    async function uploadedPagesKey(): Promise<string> {
        if (pagesS3Key) return pagesS3Key;
        const key = await uploadToS3(pagesFile!);
        setPagesS3Key(key);
        return key;
    }

    // MIGRATION-UPLOAD-1: the stored upload is gone (404: deleted after an import, or expired after one day) — drop the
    // key, so the next check uploads the selected file again.
    function dropGoneUpload(e: unknown) {
        if (e instanceof ApiError && e.status === 404) setPagesS3Key(null);
    }

    async function handlePagesCheck() {
        if (!pagesFile) return;
        setPagesLoading(true);
        setPagesResult(null);
        setAddressReport(null);
        pagesFlow.reset();
        try {
            const run = await pagesFlow.runCheck(await uploadedPagesKey(), keepOldAddresses ?? undefined);
            setKeepOldAddresses(run.keep ?? false);
            setAddressReport({ dryRun: true, rows: run.rows, productAddresses: run.productAddresses });
            if (!checkAuthorisesImport(run)) {
                setPagesResult({ success: false, message: "The check is incomplete: some items could not be checked (in red). The import stays off; fix the cause and check again.", details: { errors: run.errors } });
            }
        } catch (e: any) {
            dropGoneUpload(e);
            setPagesResult({ success: false, message: e.message });
        } finally {
            setPagesLoading(false);
        }
    }

    async function handlePagesImport() {
        if (!pagesFile || keepOldAddresses === null || !pagesFlow.canImport()) return;
        setPagesLoading(true);
        setPagesResult(null);
        try {
            // The flow consumes the check before the first call: after a failed or partial import, check again.
            const run = await pagesFlow.runImport(await uploadedPagesKey(), keepOldAddresses);
            // The last batch deleted the upload (MIGRATION-UPLOAD-1): a later check uploads the file again.
            if (run.last?.complete === true) setPagesS3Key(null);
            let created = 0, updated = 0;
            if (run.rows.length > 0) setAddressReport({ dryRun: false, rows: run.rows });
            // Each answer counts its own batch only. With the option on the rows of all batches are summed; with it off
            // there are no rows and the message is the one before this slice.
            for (const row of run.rows) {
                if (row.item === "product") continue;
                const write = "write" in row.page ? row.page.write : null;
                if (write === "create") created++;
                if (write === "update") updated++;
            }
            setPagesResult({
                success: run.errors.length === 0,
                message: run.rows.length > 0
                    ? `Processed ${run.last.processedCount} of ${run.last.totalCount} items: ${created} pages created, ${updated} updated`
                    : `Processed ${run.last.processedCount} of ${run.last.totalCount} pages`,
                details: { ...run.last, errors: run.errors },
            });
        } catch (e: any) {
            dropGoneUpload(e);
            setPagesResult({ success: false, message: e.message });
        } finally {
            setPagesLoading(false);
        }
    }

    return (
        <div className="p-8 space-y-6 max-w-3xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">WordPress Migration</h1>
                <p className="text-muted-foreground">
                    Import media, products, and pages from WordPress/WooCommerce exports.
                </p>
                {catalog && <p className="text-muted-foreground">Products of a catalog come from the pricelist import.</p>}
            </div>

            {/* STEP 1: MEDIA */}
            <Card>
                <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${mediaComplete ? "bg-green-100" : "bg-blue-100"}`}>
                            {mediaComplete
                                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                                : <ImageIcon className="h-5 w-5 text-blue-600" />}
                        </div>
                        <div>
                            <h3 className="font-semibold">Step 1: Media Library</h3>
                            <p className="text-xs text-muted-foreground">
                                Upload WordPress media export XML. Images will be downloaded and re-hosted.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="media-file">Media XML File</Label>
                        <input
                            id="media-file"
                            type="file"
                            accept=".xml"
                            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
                            onChange={e => setMediaFile(e.target.files?.[0] || null)}
                            disabled={mediaLoading}
                        />
                    </div>

                    <Button onClick={handleMediaImport} disabled={!mediaFile || mediaLoading} className="w-full">
                        {mediaLoading
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing media...</>
                            : <><Upload className="mr-2 h-4 w-4" /> Import Media</>}
                    </Button>

                    {mediaResult && <ResultBanner result={mediaResult} />}

                    {!mediaResult && existingMediaCount !== null && existingMediaCount > 0 && (
                        <div className="rounded-md p-3 text-sm flex items-start gap-2 bg-green-50 text-green-800 border border-green-200">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                            <p>{existingMediaCount.toLocaleString()}{catalog
                                ? " media files already imported. You can proceed to Step 2, or re-import to add new files."
                                : " media files already imported. You can proceed to Steps 2 & 3, or re-import to add new files."}</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* STEP 2: PRODUCTS (not on a catalog) */}
            {!catalog && (
            <Card className={!mediaComplete ? "opacity-50" : ""}>
                <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${productsResult?.success ? "bg-green-100" : "bg-orange-100"}`}>
                            {productsResult?.success
                                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                                : <ShoppingBag className="h-5 w-5 text-orange-600" />}
                        </div>
                        <div>
                            <h3 className="font-semibold">
                                Step 2: Products
                                <span className="text-xs font-normal text-muted-foreground ml-2">(Optional — recommended before pages)</span>
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                Upload WooCommerce product CSV export. Supports Romanian & English column headers.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="products-file">Products CSV File</Label>
                        <input
                            id="products-file"
                            type="file"
                            accept=".csv"
                            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
                            onChange={e => setProductsFile(e.target.files?.[0] || null)}
                            disabled={!mediaComplete || productsLoading}
                        />
                    </div>

                    <Button onClick={handleProductsImport} disabled={!mediaComplete || !productsFile || productsLoading} className="w-full">
                        {productsLoading
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing products...</>
                            : <><Upload className="mr-2 h-4 w-4" /> Import Products</>}
                    </Button>

                    {productsResult && <ResultBanner result={productsResult} />}
                </CardContent>
            </Card>
            )}

            {/* STEP 3: PAGES (step 2 on a catalog) */}
            <Card className={!mediaComplete ? "opacity-50" : ""}>
                <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${pagesResult?.success ? "bg-green-100" : "bg-purple-100"}`}>
                            {pagesResult?.success
                                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                                : <FileText className="h-5 w-5 text-purple-600" />}
                        </div>
                        <div>
                            <h3 className="font-semibold">{catalog ? "Step 2: Pages" : "Step 3: Pages"}</h3>
                            <p className="text-xs text-muted-foreground">
                                Upload WordPress pages export XML. Content and comments will be imported.
                            </p>
                            <p className="text-xs text-red-600">
                                {keepOldAddresses === null
                                    ? "Check the addresses first: the check lists every WordPress address and the address it gets on this site, and writes nothing. "
                                    : keepOldAddresses
                                        ? "Imported pages keep their WordPress address, in this site's slug form (for example /cursuri/ceara/ becomes /cursuri/ceara). Where an address cannot be kept, the page gets its post name and the old address redirects to it, or the check lists the address as lost. "
                                        : "Imported pages get the URL /<WordPress post name>, stored exactly as WordPress had it; the permalink's folder structure (for example /2024/05/) is not kept. "}
                                Pages whose URL does not follow this site's slug rules are marked REVIEW SLUG in Content — check them after the import.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="pages-file">Pages XML File</Label>
                        <input
                            id="pages-file"
                            type="file"
                            accept=".xml"
                            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
                            onChange={e => {
                                setPagesFile(e.target.files?.[0] || null);
                                setPagesS3Key(null);
                                setKeepOldAddresses(null);
                                setAddressReport(null);
                                pagesFlow.reset();
                                setPagesResult(null);
                            }}
                            disabled={!mediaComplete || pagesLoading}
                        />
                    </div>

                    <label className="flex items-start gap-2 text-sm">
                        <input
                            type="checkbox"
                            className="mt-1"
                            checked={keepOldAddresses === true}
                            disabled={keepOldAddresses === null || pagesLoading}
                            onChange={e => { setKeepOldAddresses(e.target.checked); setAddressReport(null); pagesFlow.reset(); }}
                        />
                        <span>
                            Keep the old addresses
                            <span className="block text-xs text-muted-foreground">
                                {keepOldAddresses === null
                                    ? "The check sets this: on for a site with no imported pages, off for a site that has pages from an earlier import."
                                    : "Change it, then check again before you import."}
                            </span>
                        </span>
                    </label>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handlePagesCheck} disabled={!mediaComplete || !pagesFile || pagesLoading} className="flex-1">
                            {pagesLoading && addressReport === null
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking...</>
                                : "Check addresses"}
                        </Button>
                        <Button onClick={handlePagesImport} disabled={!mediaComplete || !pagesFile || pagesLoading || !pagesFlow.canImport()} className="flex-1">
                            {pagesLoading && addressReport !== null
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing pages...</>
                                : <><Upload className="mr-2 h-4 w-4" /> Import Pages</>}
                        </Button>
                    </div>

                    {addressReport && <AddressReportTable report={addressReport} />}
                    {pagesResult && <ResultBanner result={pagesResult} />}
                </CardContent>
            </Card>

            {/* Header Mapping Confirmation Dialog */}
            <Dialog open={headerMappings !== null} onOpenChange={(open) => { if (!open) { setHeaderMappings(null); setPendingCsvContent(""); } }}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>CSV Header Mapping</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        We detected non-English column headers in your CSV. This may be a translation in your language. Please confirm these mappings are correct before importing.
                    </p>
                    <div className="border rounded-md overflow-hidden mt-2">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-xs">Your CSV Header</TableHead>
                                    <TableHead className="text-xs">Mapped To</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {headerMappings?.filter(m => m.original !== m.mapped).map((m, i) => (
                                    <TableRow key={i}>
                                        <TableCell className="text-xs font-mono py-1">{m.original}</TableCell>
                                        <TableCell className="text-xs font-mono py-1 text-green-700">{m.mapped}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="flex gap-2 mt-4">
                        <Button variant="outline" onClick={() => { setHeaderMappings(null); setPendingCsvContent(""); }} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={() => { setHeaderMappings(null); doProductsImport(pendingCsvContent); setPendingCsvContent(""); }} className="flex-1">
                            Confirm & Import
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** IMPORT-PATHS-1: the address report of a check (dry run) or of an import with the option on. */
interface AddressReport {
    dryRun: boolean;
    rows: AddressRow[];
    productAddresses?: { site: string; old: string[] };
}

function AddressReportTable({ report }: { report: AddressReport }) {
    const views = report.rows.map(row => addressRowView(row, report.dryRun));
    const summary = summarizeReport(report.rows, report.dryRun);
    const product = report.productAddresses;
    return (
        <div className="space-y-2">
            <p className="text-sm">
                {report.dryRun ? "Check" : "Import"}: {summary.items} items, {summary.problems} with a problem (in red).
            </p>
            {summary.cannotKeepOrRedirect > 0 && (
                <p className="text-sm text-destructive">
                    {summary.cannotKeepOrRedirect} old {summary.cannotKeepOrRedirect === 1 ? "address" : "addresses"} cannot be kept or redirected: this site answers {summary.cannotKeepOrRedirect === 1 ? "it" : "them"} with its own pages first. {report.dryRun ? "The import does not change that." : ""}
                </p>
            )}
            {summary.failed > 0 && (
                <p className="text-sm text-destructive">{summary.failed} {summary.failed === 1 ? "item" : "items"} failed.</p>
            )}
            {product && product.old.some(p => p !== product.site) && (
                <p className="text-xs text-muted-foreground">
                    Product addresses differ: this site uses {product.site}, the old site used {product.old.join(", ")}. With "Keep the old addresses", the import redirects each product that this site has from its old address.
                </p>
            )}
            <div className="border rounded-md overflow-auto max-h-96">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-xs">Item</TableHead>
                            <TableHead className="text-xs">Old address</TableHead>
                            <TableHead className="text-xs">New address</TableHead>
                            <TableHead className="text-xs">Redirect</TableHead>
                            <TableHead className="text-xs">Note</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {views.map((v, i) => (
                            <TableRow key={i} className={v.problem ? "text-destructive" : ""}>
                                <TableCell className="text-xs py-1">{v.title}</TableCell>
                                <TableCell className="text-xs font-mono py-1">{v.oldAddress}</TableCell>
                                <TableCell className="text-xs font-mono py-1">{v.newAddress}</TableCell>
                                <TableCell className="text-xs py-1">{v.redirect}</TableCell>
                                <TableCell className="text-xs py-1">{v.note}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function ResultBanner({ result }: { result: StepResult }) {
    return (
        <div className={`rounded-md p-3 text-sm flex items-start gap-2 ${
            result.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
            {result.success
                ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <div>
                <p>{result.message}</p>
                {result.details?.errors?.length > 0 && (
                    <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium">
                            {result.details.errors.length} error(s)
                        </summary>
                        <ul className="mt-1 text-xs space-y-1 max-h-40 overflow-y-auto">
                            {result.details.errors.map((err: string, i: number) => (
                                <li key={i} className="font-mono">{err}</li>
                            ))}
                        </ul>
                    </details>
                )}
            </div>
        </div>
    );
}
