import type { ApiCall } from "./wpImportRun";

/**
 * MIGRATION-UPLOAD-1 — the upload of a migration file (a WordPress export) for the Migration page: a PUT link from
 * `POST /import/upload-url`, then the PUT of the file to the private bucket. Answers the key the importers read.
 * A refusal of the link (type, size, role) throws the server's message (apiRequest's `API Error (<status>): <error>`);
 * the page shows it. Tested in `migrationUpload.test.ts` through a scripted API and PUT.
 *
 * Abstraction ledger: `PutFile` — the injected PUT. Concrete users: `Migration.tsx` (putWithFetch) and the test
 * (scripted answers). Axis: none; it is the test seam the admin's DOM-less tests need (as `ApiCall`, wpImportRun.ts).
 * Rejected alternative: the upload inside the component, testable only with a DOM runner.
 */
export type PutFile = (url: string, file: Blob, contentType: string) => Promise<{ ok: boolean; status: number }>;

export const putWithFetch: PutFile = (url, file, contentType) =>
    fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });

export async function uploadMigrationFile(api: ApiCall, put: PutFile, file: File): Promise<string> {
    // The PUT must send the content type the link was signed for. A browser that gives no type for a `.xml` file
    // (the inputs accept `.xml` only) sends it as XML, as before this slice.
    const contentType = file.type || "application/xml";
    const link = await api("/import/upload-url", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType, size: file.size }),
    });
    const stored = await put(link.uploadUrl, file, contentType);
    if (!stored.ok) throw new Error(`The upload of "${file.name}" failed: the storage answered HTTP ${stored.status}. Try again.`);
    return link.s3Key;
}
