interface FBPixelProps {
    pixelId: string;
}

/**
 * Server component: mounts the Facebook pixel for a tenant that has a pixel id.
 * It renders the client component FBPixelLoader, which renders the loader script only after the
 * visitor accepts marketing cookies (PIXEL-CONSENT-1). This component itself sends nothing.
 *
 * Why the dynamic `import()` (PIXEL-CONSENT-1, measured with the serving rows cm1-identity-*):
 * a STATIC import of a new client module here, or the same code added to Analytics.tsx, made
 * Turbopack's chunk optimiser split one existing chunk of the site layout, so every compared HTML
 * page, also of tenants without a pixel id, referenced one more /_next/static chunk. With this dynamic
 * import those pages compare equal to their baselines under the serving comparator. The chunk partition is Turbopack's decision, observed, not
 * derived: re-run `npm --prefix renderer run test:serving` after a change to this file.
 */
export async function FBPixel({ pixelId }: FBPixelProps) {
    const { FBPixelLoader } = await import("./FBPixelLoader");
    return <FBPixelLoader pixelId={pixelId} />;
}
