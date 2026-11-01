/**
 * LOCALE-1E (docs/slices/locale-1e.md): the `<body>` class of every full document the renderer writes — the tenant
 * root layout `app/[siteId]/layout.tsx` and the root 404 boundary `app/not-found.tsx`. One source, never a copy
 * (operator ruling LOC1E-404-DOCUMENT = B, condition 1). The value is the class of the former `app/layout.tsx`.
 */
export const BODY_CLASS_NAME = "antialiased min-h-screen bg-white text-gray-900";
