// Delivery: the per-tenant delivery configuration (DeliveryConfigSchema).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- DELIVERY CONFIG (per-tenant) ---

export const DeliveryConfigSchema = z.object({
    tenantId: z.string(),

    freeDeliveryThreshold: z.string().optional(),    // e.g. "150" RON
    flatShippingCost: z.string().default("15"),      // default shipping cost
    minimumOrderAmount: z.string().optional(),

    deliveryLeadDays: z.number().default(3),
    blockedDates: z.array(z.string()).default([]),   // YYYY-MM-DD specific blocked dates
    yearlyOffDays: z.array(z.string()).default([]),  // MM-DD recurring yearly (e.g. "12-25", "01-01")
    unblockedDates: z.array(z.string()).default([]), // YYYY-MM-DD forced available (overrides weekly/yearly)
    deliveryDaysOfWeek: z.array(z.number()).default([1, 2, 3, 4, 5]), // 0=Sun..6=Sat

    // Delivery zone restrictions
    restrictDeliveryZones: z.boolean().default(false),  // if true, only deliver to allowed zones
    allowedCountries: z.array(z.string()).default([]),  // e.g. ["Romania"]
    allowedCounties: z.array(z.string()).default([]),   // e.g. ["București", "Ilfov"] - empty = all counties in allowed countries

    // Checkout address configuration
    defaultCountry: z.string().default("Romania"),      // Default country in checkout form
    availableCountries: z.array(z.string()).default([]), // Countries shown in dropdown (empty = just default)
    availableCounties: z.array(z.string()).default([]),  // Counties shown in dropdown (empty = text input)

    updatedAt: z.string(),
});

export type DeliveryConfig = z.infer<typeof DeliveryConfigSchema>;
