import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTenantConfig } from "@/lib/dynamo";
import { ThemeInjector } from "@/components/ThemeInjector";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const headersList = await headers();
    const host = headersList.get("x-amodx-host") || "localhost";
    const config = await getTenantConfig(host);

    return {
        title: config?.name || "AMODX Site",
        description: "Powered by AMODX",
    };
}

export default async function RootLayout({
                                             children,
                                         }: Readonly<{
    children: React.ReactNode;
}>) {
    // 1. Identify Tenant (The Context)
    const headersList = await headers();
    const host = headersList.get("x-amodx-host") || "localhost";

    // LOG: See what host we are looking for
    console.log("------------------------------------------------");
    console.log(`[Layout] Rendering for Host: ${host}`);

    const config = await getTenantConfig(host);

    // LOG: See exactly what config came back
    console.log(`[Layout] Config Found:`, JSON.stringify(config, null, 2));
    console.log("------------------------------------------------");


    // 2. Handle "Site Not Found" (Global Guard)
    if (!config) {
        return (
            <html lang="en">
            <body className="antialiased min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-gray-900">Site Not Found</h1>
                <p className="text-gray-500 mt-2">Configuration missing for: {host}</p>
            </div>
            </body>
            </html>
        );
    }

    // 3. Render the Shell
    return (
        <html lang="en">
        <body className="antialiased min-h-screen bg-white text-gray-900">
        {/* Inject Dynamic CSS Variables based on Tenant Config */}
        <ThemeInjector theme={config.theme} />

        {/* Persistent Shell */}
        <Navbar siteName={config.name} />

        {/* Page Content */}
        {children}
        </body>
        </html>
    );
}
