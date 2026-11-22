// SCHED-1G2 — the frame of both booking pages (docs/slices/sched-1.md § 10.1): the tenant header (logo and name) and the
// page title, or — with `?frame=1` — no header and a transparent background (the frame chrome itself, the height
// script and the embed check, belong to `sched-frame-1`). `lang` on the wrapper is the language of the texts (which
// `?lang=` may set); `<html lang>` stays the tenant's (the root layout cannot read the query).
// Abstraction line: users — the book page and the manage page; axis: none; rejected: the same markup in both pages.
import type { TenantConfig } from "@amodx/shared";

export function PageShell({ config, frame, language, title, children }: {
    config: TenantConfig; frame: boolean; language: string; title: string; children: React.ReactNode;
}) {
    return (
        <div lang={language} className="mx-auto max-w-2xl px-4 py-8 space-y-6">
            {frame
                ? <style>{"body{background:transparent!important}"}</style>
                : (
                    <header className="flex items-center gap-3 border-b pb-4">
                        {config.logo && <img src={config.logo} alt="" className="h-10 w-auto" />}
                        <span className="text-lg font-semibold">{config.name}</span>
                    </header>
                )}
            <main className="space-y-6">
                <h1 className="text-2xl font-bold">{title}</h1>
                {children}
            </main>
        </div>
    );
}
