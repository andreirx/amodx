import { getTenantConfig } from "@/lib/dynamo";
import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";
import { Analytics } from "@/components/Analytics";
import { Metadata } from "next";
import { PaddleLoader } from "@/components/PaddleLoader";

export const revalidate = 3600;

type Props = {
    children: React.ReactNode;
    params: Promise<{ siteId: string }>;
};

// NEW: Global Metadata (Favicon & Title Template)
export async function generateMetadata({ params }: { params: Promise<{ siteId: string }> }): Promise<Metadata> {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) return {};

    return {
        title: {
            template: `%s | ${config.name}`,
            default: config.name, // "My Site"
        },
        icons: {
            // Logic: Specific Icon -> Logo -> Default
            icon: config.icon || config.logo || '/favicon.ico',
        },
    };
}

export default async function SiteLayout({ children, params }: Props) {
    const { siteId } = await params;
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
            <ThemeInjector theme={config.theme} tenantId={config.id} />

            {/* ANALYTICS INJECTION */}
            <Analytics config={{
                gaId: config.integrations?.googleAnalyticsId,
                analytics: config.integrations?.analytics
            }} />

            <PaddleLoader config={config.integrations?.paddle} />

            <Navbar
                siteName={config.name}
                logo={config.logo}
                links={config.navLinks}
                showLogo={config.header?.showLogo}
                showTitle={config.header?.showTitle}
            />

            <div className="flex-1">
                {children}
            </div>

            <footer className="border-t py-12 bg-muted/30">
                <div className="max-w-7xl mx-auto px-6 flex justify-between items-center text-sm text-muted-foreground">
                    <p>© {new Date().getFullYear()} {config.name}</p>
                    <div className="flex gap-4">
                        {(config.footerLinks || []).map((link, i) => (
                            <a key={i} href={link.href} className="hover:text-foreground">{link.label}</a>
                        ))}
                    </div>
                </div>
            </footer>
        </div>
    );
}
