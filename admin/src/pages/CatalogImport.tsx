import { isCatalogMode } from "@amodx/shared";
import { useTenant } from "@/context/TenantContext";
import { GlamPricelistImport } from "@/components/GlamPricelistImport";

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.3, ruling 4, CA-L2) — "Pricelist import", the catalog's data path, on a
 * page of its own (reached from the sidebar's Catalog group). The page states the import's contract and mounts the
 * existing import form unchanged; every rule stays in that form and in the backend (`POST /import/glam-pricelist`).
 * A non-catalog site gets one sentence and no form: the backend refuses the import there (403) anyway.
 */
export default function CatalogImport() {
    const { currentTenant } = useTenant();

    if (!currentTenant) return <div className="p-8">Select a site.</div>;
    if (!isCatalogMode(currentTenant)) return <div className="p-8"><p className="text-muted-foreground">This site is not a catalog.</p></div>;

    return (
        <div className="p-8 space-y-6 max-w-5xl">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Pricelist import</h1>
                <p className="text-muted-foreground">Upload one producer sheet at a time.</p>
                <p className="text-muted-foreground">The next import of a sheet replaces the products it created, hand edits included.</p>
            </div>
            {/* No-op: this page shows no product list, so there is nothing to reload after an import. */}
            <GlamPricelistImport onImported={() => {}} />
        </div>
    );
}
