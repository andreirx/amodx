// Settings page: the Site Identity, Company Details and Legal Links cards.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { ExternalLink, Upload } from "lucide-react";
import { SmartLinkInput } from "@/components/ui/smart-link-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsDraft } from "./draft";

// HELPER: Get Config at Runtime (Fixes the "Relative Link" bug)
const getRendererUrl = () => {
    // @ts-ignore
    const url = window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL || "";
    return url.replace(/\/$/, "");
};

/** The "Site Identity" card (logo, name, description, schema type, domain, preview link). */
export function SiteIdentityCard({ config, setConfig, updateHeader, handleLogoUpload }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; updateHeader: (key: string, val: boolean | string) => void; handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
    // Get the URL dynamically so it works in Prod and Local
    const rendererUrl = getRendererUrl();
    const previewUrl = rendererUrl && config.id ? `${rendererUrl}/_site/${config.id}` : "#";
    return (
        <Card>
            <CardHeader>
                <CardTitle>Site Identity</CardTitle>
                <CardDescription>Technical details and domains</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex gap-6 items-start">
                    {/* Logo Upload */}
                    <div className="space-y-2">
                        <Label>Logo</Label>
                        <div
                            className="relative w-32 h-32 bg-muted/30 border-2 border-dashed border-muted-foreground/20 rounded-lg flex flex-col items-center justify-center hover:bg-muted/50 transition-colors overflow-hidden group">
                            {config.logo ? (
                                <>
                                    <img src={config.logo} alt="Logo"
                                         className="w-full h-full object-contain p-2"/>
                                    <div
                                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <label
                                            className="cursor-pointer text-white text-xs font-medium p-2">
                                            Change
                                            <input type="file" className="hidden" accept="image/*"
                                                   onChange={handleLogoUpload}/>
                                        </label>
                                    </div>
                                </>
                            ) : (
                                <label
                                    className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
                                    <Upload className="h-6 w-6 text-muted-foreground mb-2"/>
                                    <span className="text-xs text-muted-foreground">Upload</span>
                                    <input type="file" className="hidden" accept="image/*"
                                           onChange={handleLogoUpload}/>
                                </label>
                            )}
                        </div>
                        {/* NEW: Header Toggles */}
                        <div className="flex flex-col gap-2 mt-2">
                            <label
                                className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.header?.showLogo ?? true}
                                    onChange={e => updateHeader('showLogo', e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                Show in Header
                            </label>
                        </div>
                    </div>

                    <div className="flex-1 space-y-4">
                        <div className="space-y-2">
                            <Label>Site Name</Label>
                            <Input value={config.name || ""}
                                   onChange={e => setConfig({...config, name: e.target.value})}/>
                            <label
                                className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.header?.showTitle ?? true}
                                    onChange={e => updateHeader('showTitle', e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                Show Name in Header
                            </label>
                        </div>

                        {/* NEW: Description */}
                        <div className="space-y-2">
                            <Label>Site Description</Label>
                            <textarea
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                value={config.description || ""}
                                onChange={e => setConfig({...config, description: e.target.value})}
                                placeholder="Used for SEO meta tags and AI crawlers (llms.txt)."
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>SEO Entity Type (Schema.org)</Label>
                            <Select
                                value={config.schemaType || "Organization"}
                                onValueChange={v => setConfig({...config, schemaType: v as any})}
                            >
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Organization">Organization (Standard)</SelectItem>
                                    <SelectItem value="Corporation">Corporation</SelectItem>
                                    <SelectItem value="LocalBusiness">Local Business</SelectItem>
                                    <SelectItem value="SoftwareApplication">Software Application
                                        (SaaS)</SelectItem>
                                    <SelectItem value="Person">Person (Portfolio)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground">
                                Defines what this site "is" to Google.
                                Use 'SoftwareApplication' for AMODX.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>Production Domain</Label>
                    <Input
                        value={config.domain || ""}
                        onChange={e => setConfig({...config, domain: e.target.value})}
                        placeholder="client.com"
                    />
                </div>

                <div className="p-3 bg-secondary/50 rounded-md flex items-center justify-between">
                    <div className="space-y-0.5">
                        <div className="text-xs text-muted-foreground">Preview Link</div>
                        <div className="text-xs font-mono truncate max-w-md select-all">{previewUrl}</div>
                    </div>
                    <Button variant="ghost" size="sm" asChild className="h-8">
                        <a href={previewUrl} target="_blank" rel="noreferrer">Open <ExternalLink
                            className="ml-2 h-3 w-3"/></a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

/** The "Company Details" card. */
export function CompanyDetailsCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Company Details</CardTitle>
                <CardDescription>Used in the footer and for legal compliance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Legal Name</Label>
                        <Input
                            value={config.companyDetails?.legalName || ""}
                            onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, legalName: e.target.value } })}
                            placeholder="SC Company Name SRL"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>CUI / CIF</Label>
                        <Input
                            value={config.companyDetails?.cui || ""}
                            onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, cui: e.target.value } })}
                            placeholder="RO12345678"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Trade Register</Label>
                        <Input
                            value={config.companyDetails?.tradeRegister || ""}
                            onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, tradeRegister: e.target.value } })}
                            placeholder="J40/1234/2020"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input
                            value={config.companyDetails?.phone || ""}
                            onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, phone: e.target.value } })}
                            placeholder="+40 700 000 000"
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                        value={config.companyDetails?.address || ""}
                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, address: e.target.value } })}
                        placeholder="1 Example Street, Example City"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                        value={config.companyDetails?.email || ""}
                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, email: e.target.value } })}
                        placeholder="contact@company.ro"
                    />
                </div>
            </CardContent>
        </Card>
    );
}

/** The "Legal Links" card. */
export function LegalLinksCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Legal Links</CardTitle>
                <CardDescription>Shown in the footer. The link texts are edited in Labels → Cookie banner & legal links.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Terms & Conditions URL</Label>
                        <SmartLinkInput
                            value={config.legalLinks?.termsUrl || ""}
                            onChange={val => setConfig({ ...config, legalLinks: { ...config.legalLinks, termsUrl: val } })}
                            placeholder="/termeni-si-conditii"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Privacy Policy URL</Label>
                        <SmartLinkInput
                            value={config.legalLinks?.privacyUrl || ""}
                            onChange={val => setConfig({ ...config, legalLinks: { ...config.legalLinks, privacyUrl: val } })}
                            placeholder="/politica-confidentialitate"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Consumer Protection URL</Label>
                        <Input
                            value={config.legalLinks?.anpcUrl || ""}
                            onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcUrl: e.target.value } })}
                            placeholder="https://anpc.ro/..."
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Dispute Resolution URL</Label>
                        <Input
                            value={config.legalLinks?.anpcSalUrl || ""}
                            onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcSalUrl: e.target.value } })}
                            placeholder="https://ec.europa.eu/consumers/odr"
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
