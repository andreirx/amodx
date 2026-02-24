import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { apiRequest } from "@/lib/api";

interface Tenant {
    id: string;
    name: string;
    domain: string;
    commerceEnabled?: boolean;
    currency?: string;
    locale?: string;
    countryCode?: string;
}

interface TenantContextType {
    tenants: Tenant[];
    currentTenant: Tenant | null;
    isLoading: boolean;
    selectTenant: (id: string) => void;
    refreshTenants: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadTenants();
    }, []);

    async function loadTenants() {
        try {
            const data = await apiRequest("/tenants");
            const list = data.items || [];
            setTenants(list);

            // Auto-select logic
            const storedId = localStorage.getItem("AMODX_TENANT_ID");
            if (storedId) {
                const found = list.find((t: Tenant) => t.id === storedId);
                if (found) {
                    setCurrentTenant(found);
                } else if (list.length > 0) {
                    // ID invalid (deleted?), reset to first available
                    selectTenant(list[0].id);
                }
            } else if (list.length > 0) {
                // No ID, start fresh
                selectTenant(list[0].id);
            }
        } catch (e) {
            console.error("Failed to load tenants", e);
        } finally {
            setIsLoading(false);
        }
    }

    function selectTenant(id: string) {
        const found = tenants.find(t => t.id === id);
        if (found) {
            setCurrentTenant(found);
            localStorage.setItem("AMODX_TENANT_ID", id);

            // UX FIX: "Eject" to the list view if we are deep in a resource.
            // This prevents 404s when the new tenant tries to load the old tenant's Content ID.
            const path = window.location.pathname;
            let nextPath = path;

            if (path.startsWith("/content/")) nextPath = "/";
            else if (path.startsWith("/products/")) nextPath = "/products";
            else if (path.startsWith("/strategy/")) nextPath = "/strategy";

            // If we are changing paths, 'href' will load the new page.
            // If we are staying on the same path (e.g. /settings), 'reload()' forces the refresh.
            if (nextPath !== path) {
                window.location.href = nextPath;
            } else {
                window.location.reload();
            }
        }
    }

    return (
        <TenantContext.Provider value={{ tenants, currentTenant, isLoading, selectTenant, refreshTenants: loadTenants }}>
            {children}
        </TenantContext.Provider>
    );
}

export function useTenant() {
    const context = useContext(TenantContext);
    if (!context) throw new Error("useTenant must be used within TenantProvider");
    return context;
}
