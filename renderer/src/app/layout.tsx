import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "AMODX Site",
    description: "Powered by AMODX",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
        {/* We will inject dynamic fonts/themes here later */}
        <body className="antialiased min-h-screen">
        {children}
        </body>
        </html>
    );
}
