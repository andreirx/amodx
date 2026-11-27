// Re-export the canonical email normalizer (PD-001 identity primitive, slice `fnd-1`).
// Every consumer that builds an email-keyed identity MUST derive it through this.
export { normalizeEmail } from "./normalizeEmail.js";

// Re-export the content-slug normaliser and its review predicate (BACKEND-CONTRACT-1 D3,
// moved here by IMPORT-POLICY-1 D2): one rule for the backend content API and the admin warnings.
export { normalizeSlug, needsSlugReview } from "./slug.js";

// LOCALE-1 (docs/slices/locale-1.md § 5): the locale-table resolver and the language packs. Pure; same re-export
// pattern as slug.ts.
export { normalizeLocale, localeLanguageSubtag, resolveLocaleStrings, fillTemplate, selectPluralText, pluralCategoriesOf, COOKIE_AND_LEGAL_LABEL_LOCATIONS, PLURAL_CATEGORIES, BLOCK_SITE_KEYS, BLOCK_FALLBACK_KEYS, blockStrings, catalogServerTexts, newsletterTexts, galleryTexts, templatePlaceholders, BOOKING_TEXT_KEYS, bookingStandardTexts } from "./locale-strings.js";

// LANG-1 (docs/slices/lang-1.md § 5): the page-language derivation and the read rule of the language settings. Pure and
// import-free (the renderer middleware loads the built module alone, `lang-1b`).
export { readLanguageSettings, pageLanguageOf, languageTagOf } from "./languages.js";
export type { PageLanguage, LanguageSettings, LanguageLink } from "./languages.js";

export type { LocaleStringsInput, ResolvedLocaleStrings, CookieOrLegalLabelKey, PluralCategory, BlockStrings, CatalogServerTexts, NewsletterTexts, GalleryTexts } from "./locale-strings.js";
export { LANGUAGE_PACKS, EN_LANGUAGE_PACK, RO_LANGUAGE_PACK } from "./language-packs/index.js";
export type { LanguagePack, CompleteLanguagePack, BookingStrings } from "./language-packs/index.js";

// Re-export the STATIC-1 iframe sandbox contract (D-STATIC-1). Framework-agnostic
// constant consumed by static-4's renderer shell; guarded by packages/shared/test/sandbox.test.ts.
export {
    STATIC_PAGE_SANDBOX_TOKENS,
    STATIC_PAGE_SANDBOX_ATTR,
    STATIC_PAGE_SANDBOX_FORBIDDEN_TOKENS,
} from "./sandbox.js";

// Re-export media classification module
export {
    ALLOWED_IMAGE_MIMES, ALLOWED_VIDEO_MIMES, ALLOWED_UPLOAD_MIMES,
    MAX_UPLOAD_BYTES,
    classifyMedia, getAssetMime, matchesMediaFilter, validateUpload,
    type MediaKind, type UploadValidationResult,
} from "./media.js";

// Re-export the catalog facet rules and the catalog listing rule (CAT-IMPORT-PROFILE-1B, moved from the renderer by
// ruling CIP1-PREVIEW = A): one implementation for the public site and the admin's import preview.
export {
    PRODUCER_FACET, VARIANT_FACET, ATTRIBUTE_FACET_PREFIX, HREF_BUDGET, PAGE_RESERVE, MAX_ATTRIBUTE_VALUES, MIN_HOLDERS,
    attributeFacetId, isFacetId, compareValues, matchesGeneratedLabelForm, facetValuesOf, parseSelection,
    formatSelection, utf8Bytes, listingHref, selectionFits, buildFacetListing,
    type FacetProduct, type Selection, type FacetValueView, type FacetView, type SelectionChip, type FacetListing,
    type FacetLabels,
} from "./facets.js";
export {
    utcDay, isProductAvailable, catalogListing, type CatalogListingItem,
} from "./catalog-listing.js";
// COUPON-FIX-1: the coupon rule of the order handler and the coupon pre-check.
export {
    evaluateCoupon, amountInCents, isCouponType, CouponPrecheckItemSchema, COUPON_PRECHECK_MAX_LINES,
    type CouponRuleRecord, type CouponCartLine, type CouponRefusal, type CouponOutcome, type CouponPrecheckItem,
} from "./coupon.js";
// PAY-1: the payment-state transition rule of PUT /orders/{id}.
export { paymentTransition, type PaymentTransition } from "./payment-transition.js";
// SCHED-1A (docs/slices/sched-1.md § 4, § 5): the scheduling kernel, appointments and the week planner. PROTOTYPE.
export {
    localToInstant, instantToLocal, localDaySpan,
    type Instant, type LocalDate, type LocalTime, type TimeZone, type Result,
} from "./zoned-time.js";
export {
    InstantSchema, LocalDateSchema, LocalTimeSchema, TimeZoneSchema,
    ResourceSchema, EligibilitySchema, ServiceSchema, AvailabilityRuleSchema, AvailabilityRulesSchema, LocalWindowSchema,
    DayOverrideSchema, DayOverridesSchema, DaySettingSchema, DaysEditSchema,
    BookingWhatSchema, ActorSchema, BookingStateSchema, PlacementSchema, HistoryEntrySchema, BookingSourceSchema,
    PersonSchema, BookingSchema, ResDayEntrySchema, KeyPart, HoldRequestSchema, MoveBodySchema,
    SchedulingSettingsSchema, SchedulingEmailKeySchema, SchedulingEmailTemplateSchema, SchedulingEmailConfigSchema,
    availableSlots, slotDecision, overlapCheck, pickResource,
    isActive, holdExpiry, confirmDecision, changeDecision, tokenView, appendHistory, bookingBase,
    dayWindows, lastBookableDate, activeEntries, planDay, editDays, weekMailDue,
    type Resource, type Eligibility, type Service, type AvailabilityRule, type LocalWindow,
    type DayOverride, type DayOverrides, type DaySetting, type DaysEdit,
    type BookingWhat, type Actor, type BookingState, type Placement, type HistoryEntry, type BookingSource,
    type Person, type Booking, type ContainerEntry,
    type SchedulingSettings, type SchedulingEmailKey, type SchedulingEmailTemplate, type SchedulingEmailConfig,
    type SlotRefusal, type ConfirmRefusal, type ChangeRefusal,
    type PlannedDay, type DaysEditError,
} from "./scheduling.js";

// SCHED-1D1 (docs/slices/sched-1.md § 9.2): the client address of a booking request (renderer proxy and hold route).
export { viewerAddress, addressKey } from "./client-address.js";

// Domain files (REFACTOR-SHARED-1): every schema, type and rule of this package lives in its domain file or in one of
// the rule modules above; this file only re-exports. A new schema goes in its domain file (packages/shared/ARCHITECTURE.md).
export * from "./content.js";
export * from "./context-and-work-items.js";
export * from "./signals.js";
export * from "./tenant-config-parts.js";
export * from "./url-prefixes.js";
export * from "./theme.js";
export * from "./tenant-config.js";
export * from "./users-and-keys.js";
export * from "./effects.js";
export * from "./locale-table.js";
export * from "./media-asset.js";
export * from "./leads-and-newsletter.js";
export * from "./audit-log.js";
export * from "./products.js";
export * from "./glam-import-profile.js";
export * from "./categories.js";
export * from "./delivery.js";
export * from "./orders-and-customers.js";
export * from "./order-price.js";
export * from "./coupon-schema.js";
export * from "./reviews.js";
export * from "./popups.js";
export * from "./forms-and-interest-list.js";

export {
    FormDateOrderSchema, resolveFormDateOrder, earliestFormDate, formatFormDate, isFormDate,
    type FormDateOrder, type FormDatePair,
} from "./form-date.js";

// Country Packs
export * from "./country-packs/index.js";

export * from "./email-dns.js";
