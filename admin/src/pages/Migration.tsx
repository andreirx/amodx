import { useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, CheckCircle2, AlertCircle, ImageIcon, ShoppingBag, FileText } from "lucide-react";
import { detectHeaderMappings, type HeaderMapping } from "@/lib/csv-headers";

interface StepResult {
    success: boolean;
    message: string;
    details?: any;
}

export default function MigrationPage() {
    // Step 1: Media
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [mediaLoading, setMediaLoading] = useState(false);
    const [mediaResult, setMediaResult] = useState<StepResult | null>(null);

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

    const mediaComplete = mediaResult?.success === true;

    async function uploadToS3(file: File): Promise<string> {
        // 1. Get presigned URL
        const res = await apiRequest("/assets", {
            method: "POST",
            body: JSON.stringify({
                filename: `migration/${file.name}`,
                contentType: file.type || "application/xml",
                size: file.size,
            }),
        });

        // 2. Upload file to S3 via presigned URL
        const uploadRes = await fetch(res.uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type || "application/xml" },
        });

        if (!uploadRes.ok) throw new Error("Failed to upload file to S3");

        // Return the S3 key (extract from publicUrl)
        // publicUrl format: https://cdn.../tenantId/assetId-filename
        const url = new URL(res.publicUrl);
        return url.pathname.slice(1); // Remove leading /
    }

    async function handleMediaImport() {
        if (!mediaFile) return;
        setMediaLoading(true);
        setMediaResult(null);
        try {
            const s3Key = await uploadToS3(mediaFile);
            const res = await apiRequest("/import/media", {
                method: "POST",
                body: JSON.stringify({ s3Key }),
            });
            setMediaResult({
                success: true,
                message: `Downloaded ${res.downloaded} of ${res.total} images (${res.failed} failed)`,
                details: res,
            });
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

    async function handlePagesImport() {
        if (!pagesFile) return;
        setPagesLoading(true);
        setPagesResult(null);
        try {
            const s3Key = await uploadToS3(pagesFile);
            const res = await apiRequest("/import/wordpress", {
                method: "POST",
                body: JSON.stringify({ s3Key }),
            });
            setPagesResult({
                success: true,
                message: `Processed ${res.processedCount} of ${res.totalCount} pages`,
                details: res,
            });
        } catch (e: any) {
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
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing media (this may take several minutes)...</>
                            : <><Upload className="mr-2 h-4 w-4" /> Import Media</>}
                    </Button>

                    {mediaResult && <ResultBanner result={mediaResult} />}
                </CardContent>
            </Card>

            {/* STEP 2: PRODUCTS */}
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

            {/* STEP 3: PAGES */}
            <Card className={!mediaComplete ? "opacity-50" : ""}>
                <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${pagesResult?.success ? "bg-green-100" : "bg-purple-100"}`}>
                            {pagesResult?.success
                                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                                : <FileText className="h-5 w-5 text-purple-600" />}
                        </div>
                        <div>
                            <h3 className="font-semibold">Step 3: Pages</h3>
                            <p className="text-xs text-muted-foreground">
                                Upload WordPress pages export XML. Content and comments will be imported.
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
                            onChange={e => setPagesFile(e.target.files?.[0] || null)}
                            disabled={!mediaComplete || pagesLoading}
                        />
                    </div>

                    <Button onClick={handlePagesImport} disabled={!mediaComplete || !pagesFile || pagesLoading} className="w-full">
                        {pagesLoading
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing pages...</>
                            : <><Upload className="mr-2 h-4 w-4" /> Import Pages</>}
                    </Button>

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
