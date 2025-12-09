import { getTenantConfig } from "@/lib/dynamo";
import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";

// ISR: Cache layout for 1 hour
export const revalidate = 3600;

export default async function SiteLayout({
                                             children,
                                             params,
                                         }: {
    children: React.ReactNode;
    params: Promise<{ siteId: string }>;
}) {
    const { siteId } = await params;

    // Fetch Config
    // If siteId is "localhost", middleware passed it through.
    // Ideally you have a Tenant with domain "localhost" in DB for dev.
    const config = await getTenantConfig(siteId);

    if (!config) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="text-center p-8 bg-white shadow-lg rounded-xl border">
                    <h1 className="text-3xl font-bold text-red-600 mb-2">Site Not Found</h1>
                    <p className="text-gray-500">
                        The domain <span className="font-mono bg-gray-100 px-1 rounded">{siteId}</span> is not configured.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="site-wrapper flex flex-col min-h-screen">
            <ThemeInjector theme={config.theme} />

            <Navbar siteName={config.name} />

            <div className="flex-1">
                {children}
            </div>
        </div>
    );
}
