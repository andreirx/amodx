// LOCALE-1E (docs/slices/locale-1e.md § 5, operator ruling LOC1E-404-DOCUMENT = B): the ROOT not-found boundary.
// Since `app/[siteId]/layout.tsx` became the root layout, the top `app/` segment has no layout, and Next's default 404
// boundary sits ABOVE the layout that writes `<html>`: its fallback replaces that subtree. So this boundary writes the
// document itself — exactly today's 404 document: `<html>` with lang `en` (the § 3.3 en-US default through the shared
// helper), the shared body class, the global stylesheet, and Next's own built-in 404 UI. The import of Next's internal
// module is deliberate: a Next upgrade that moves it fails the BUILD loudly, where a hand-written copy of the markup
// would drift silently. The 404 stays English on every tenant, as before this slice.
import "./globals.css";
import NotFound from "next/dist/client/components/builtin/not-found";
import { localeLanguageSubtag } from "@amodx/shared";
import { BODY_CLASS_NAME } from "@/lib/document-shell";

export default function RootNotFound() {
    return (
        <html lang={localeLanguageSubtag(undefined)}>
        <body className={BODY_CLASS_NAME}>
        <NotFound />
        </body>
        </html>
    );
}
