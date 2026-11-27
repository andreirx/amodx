// Settings page: the page's draft type `SettingsDraft`, used by every section file.
// Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import type { TenantConfig } from "@amodx/shared";

/**
 * The page's config state: `interestListEmail: null` = "send to the contact e-mail" chosen.
 * Scheduling can start with just an explicit time zone; the backend schema supplies absent numeric defaults.
 */
export type SettingsDraft = Omit<Partial<TenantConfig>, "interestListEmail" | "scheduling"> & {
    interestListEmail?: string | null;
    scheduling?: Partial<NonNullable<TenantConfig["scheduling"]>>;
};
