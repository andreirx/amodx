import type { AddressRow } from "./wpAddressReport";

/**
 * IMPORT-PATHS-1 — the check and the import of the WordPress pages step, as calls (review F-IP1-FAILURE-REPORT: the
 * failure paths are tested through this wiring, admin/src/lib/wpImportRun.test.ts). `Migration.tsx` passes
 * `apiRequest`; the tests pass a scripted API.
 *
 * Abstraction ledger: `ApiCall` — the injected request function. Concrete users: `Migration.tsx` (apiRequest) and the
 * test (scripted answers). Axis: none; it is the test seam the admin's DOM-less tests need for the batch loop and the
 * import gate. Rejected alternative: the loop inside the component, testable only with a DOM runner.
 */
export type ApiCall = (path: string, init: { method: "POST"; body: string }) => Promise<any>;

export interface PagesRun {
    /** The option as sent, or as the first batch answered it when it was not sent. */
    keep: boolean | undefined;
    rows: AddressRow[];
    errors: string[];
    /** The last batch's answer (its counts are per batch). */
    last: any;
    productAddresses?: { site: string; old: string[] };
}

/**
 * `POST /import/wordpress[?dryRun=1]` over every batch (the API answers 100 items per call). `keep` undefined → the API
 * decides the default on the first batch and answers it; every later batch sends that value (a later batch without it
 * is refused, 400). A failed call throws (the caller shows the message; nothing after it runs).
 */
export async function runPagesBatches(api: ApiCall, s3Key: string, dryRun: boolean, keep: boolean | undefined): Promise<PagesRun> {
    const rows: AddressRow[] = [];
    const errors: string[] = [];
    let batchStart: number | undefined = 0;
    let res: any;
    do {
        res = await api(`/import/wordpress${dryRun ? "?dryRun=1" : ""}`, {
            method: "POST",
            body: JSON.stringify({ s3Key, batchStart, ...(keep === undefined ? {} : { keepOldAddresses: keep }) }),
        });
        if (keep === undefined && typeof res.keepOldAddresses === "boolean") keep = res.keepOldAddresses;
        rows.push(...(res.rows ?? []));
        errors.push(...(res.errors ?? []));
        batchStart = res.nextBatchStart;
    } while (!res.complete && batchStart !== undefined);
    return { keep, rows, errors, last: res, ...(res.productAddresses ? { productAddresses: res.productAddresses } : {}) };
}

/**
 * Whether a check authorises the import: a COMPLETE dry run — every batch answered, no error, no item whose read
 * failed. A check with an error lists items it could not decide; importing on it would write what the operator has
 * not seen (review F-IP1-FAILURE-REPORT).
 */
export function checkAuthorisesImport(run: PagesRun | null): boolean {
    if (run === null || run.last?.complete !== true || run.last?.dryRun !== true) return false;
    if (run.errors.length > 0) return false;
    return !run.rows.some((row) => row.redirect.kind === "failed"
        || (row.item === "product" ? row.product.kind === "failed" : row.page.kind === "failed"));
}

/**
 * The state of the pages step that decides whether an import may start (review-1 3c: "a check authorises one
 * import"). It holds the last check; `runImport` CONSUMES it before the first call, so an import that fails, stops
 * part way or loses an answer cannot be confirmed again on the same check — a new check is needed. `reset` drops it
 * (another file, or the option changed). `Migration.tsx` renders the import button from `canImport()`.
 *
 * Abstraction ledger: `PagesImportFlow` — the owner of that one piece of state. Concrete users: `Migration.tsx` and its
 * node test (`wpImportRun.test.ts`, IP1-R1-ADMIN-FLOW-*). Axis: none; it is the test seam for the state transition the
 * component makes (the admin tests have no DOM). Rejected alternative: the check in React state, cleared after the
 * call — the shape review-1 found reusable after a failed import, and untestable without a DOM runner.
 */
export class PagesImportFlow {
    private check: PagesRun | null = null;
    private readonly api: ApiCall;

    constructor(api: ApiCall) {
        this.api = api;
    }

    canImport(): boolean {
        return checkAuthorisesImport(this.check);
    }

    reset(): void {
        this.check = null;
    }

    /** A check over every batch; it authorises an import only when complete (`checkAuthorisesImport`). */
    async runCheck(s3Key: string, keep: boolean | undefined): Promise<PagesRun> {
        this.check = null;
        const run = await runPagesBatches(this.api, s3Key, true, keep);
        this.check = run;
        return run;
    }

    /** The import, on the authorising check; the check is consumed before the first call, whatever happens next. */
    async runImport(s3Key: string, keep: boolean): Promise<PagesRun> {
        if (!this.canImport()) throw new Error("Check the addresses first: the import needs a complete check.");
        this.check = null;
        return runPagesBatches(this.api, s3Key, false, keep);
    }
}
