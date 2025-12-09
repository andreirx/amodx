import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { apiRequest } from "@/lib/api";

interface Tenant {
    id: string;
    name: string;
    domain: string;
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
                    selectTenant(list[0].id);
                }
            } else if (list.length > 0) {
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
            // Reload page to ensure all components re-fetch data with new ID
            window.location.reload();
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
