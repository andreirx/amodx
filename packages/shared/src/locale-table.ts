// The tenant locale table (LOCALE-1): the stored parts (commerce, catalog, site), the booking texts and the resolved types.
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";
import { BOOKING_TEXT_KEYS } from "./locale-strings.js";
import type { BookingStrings } from "./language-packs/index.js";

// LOCALE-1B (docs/slices/locale-1.md § 16.2 item 6) — a COUNT text: one text per plural category of the language
// (`Intl.PluralRules`; the six CLDR categories, `PLURAL_CATEGORIES` in locale-strings.ts). A pack holds the categories of
// its language (English `one`/`other`, Romanian `one`/`few`/`other`); a tenant override may hold any of them. Each text
// keeps the placeholder `{n}` (the count) and may have others. A key of this shape is a "count key".
export const PluralTextsSchema = z.object({
    zero: z.string().optional(),
    one: z.string().optional(),
    two: z.string().optional(),
    few: z.string().optional(),
    many: z.string().optional(),
    other: z.string().optional(),
});
export type PluralTexts = z.infer<typeof PluralTextsSchema>;

// Commerce UI Strings (i18n) - all optional, defaults applied at runtime
export const CommerceStringsSchema = z.object({
    // Product page
    description: z.string().optional(),         // "Description"
    addToCart: z.string().optional(),           // "Add to Cart"
    addedToCart: z.string().optional(),         // "Added to Cart!"
    viewCart: z.string().optional(),            // "View Cart"
    inStock: z.string().optional(),             // "In Stock"
    outOfStock: z.string().optional(),          // "Out of Stock"
    variantUnavailable: z.string().optional(),  // "Variant Unavailable"
    units: z.string().optional(),               // "units"

    // Cart page
    cart: z.string().optional(),                // "Cart"
    shoppingCart: z.string().optional(),        // "Shopping Cart"
    emptyCart: z.string().optional(),           // "Your cart is empty"
    emptyCartMessage: z.string().optional(),    // "Browse our products and add something you like."
    continueShopping: z.string().optional(),    // "Continue Shopping"
    orderSummary: z.string().optional(),        // "Order Summary"
    subtotal: z.string().optional(),            // "Subtotal"
    shipping: z.string().optional(),            // "Shipping"
    discount: z.string().optional(),            // "Discount"
    total: z.string().optional(),               // "Total"
    freeShipping: z.string().optional(),        // "Free"
    freeDeliveryFrom: z.string().optional(),    // "Free delivery from"
    addMoreForFreeDelivery: z.string().optional(), // "Add {amount} more for free delivery"
    minimumOrder: z.string().optional(),        // "Minimum order"
    proceedToCheckout: z.string().optional(),   // "Proceed to Checkout"

    // Coupon
    couponCode: z.string().optional(),          // "Coupon code"
    apply: z.string().optional(),               // "Apply"
    remove: z.string().optional(),              // "Remove"
    invalidCoupon: z.string().optional(),       // "Invalid coupon"

    // Checkout
    checkout: z.string().optional(),            // "Checkout"
    placeOrder: z.string().optional(),          // "Place Order"
    placingOrder: z.string().optional(),        // "Placing Order..."
    orderConfirmation: z.string().optional(),   // "Order Confirmation"
    contactInformation: z.string().optional(),  // "Contact Information"
    fullName: z.string().optional(),            // "Full Name"
    email: z.string().optional(),               // "Email"
    phone: z.string().optional(),               // "Phone"
    phonePlaceholder: z.string().optional(),    // "+40..."
    shippingAddress: z.string().optional(),     // "Shipping Address"
    shippingStreetAddress: z.string().optional(), // "Street Address" (under shipping section)
    streetAddress: z.string().optional(),       // "Street Address" (deprecated, use specific ones)
    billingStreetAddress: z.string().optional(), // "Street Address" (under billing section)
    city: z.string().optional(),                // "City"
    county: z.string().optional(),              // "County"
    selectCounty: z.string().optional(),        // "Select county..."
    postalCode: z.string().optional(),          // "Postal Code"
    deliveryNotes: z.string().optional(),       // "Delivery Notes"
    deliveryNotesPlaceholder: z.string().optional(), // "Apartment, floor, etc."
    paymentMethod: z.string().optional(),       // "Payment Method"
    cashOnDelivery: z.string().optional(),      // "Cash on Delivery"
    cashOnDeliveryDesc: z.string().optional(),  // "Pay when you receive your order"
    bankTransfer: z.string().optional(),        // "Bank Transfer"
    termsAgreement: z.string().optional(),      // "By placing your order, you agree to our terms and conditions."
    preferredDeliveryDate: z.string().optional(), // "Preferred Delivery Date"
    country: z.string().optional(),             // "Country"
    selectCountry: z.string().optional(),       // "Select country..."

    // Customer extras
    birthday: z.string().optional(),            // "Birthday"
    birthdayHint: z.string().optional(),        // "For a birthday surprise!"

    // Billing / Company (B2B) - generic labels, customizable per locale
    billingDetails: z.string().optional(),      // "Billing Details"
    firstName: z.string().optional(),           // "First Name"
    lastName: z.string().optional(),            // "Last Name"
    orderAsCompany: z.string().optional(),      // "Order as a company"
    companyName: z.string().optional(),         // "Company Name"
    taxId: z.string().optional(),               // "Tax ID" (CUI/CIF in Romania, EIN in US, etc.)
    taxIdPlaceholder: z.string().optional(),    // "e.g. 12345678"
    vatNumber: z.string().optional(),           // "VAT Number"
    vatNumberPlaceholder: z.string().optional(), // "e.g. RO12345678"
    registrationNumber: z.string().optional(),  // "Registration No." (Trade Register in Romania)
    registrationNumberPlaceholder: z.string().optional(), // "e.g. J40/1234/2020"
    useSameAsShipping: z.string().optional(),   // "Use same address for billing"
    billingAddress: z.string().optional(),      // "Billing Address"

    // Search
    searchButton: z.string().optional(),       // "Search"
    searchNoResults: z.string().optional(),    // "No products found"
    searchSearching: z.string().optional(),    // "Searching..."
    viewAllResults: z.string().optional(),     // "View all results"
    resultsFor: z.string().optional(),         // "Results for"
    searchProducts: z.string().optional(),     // "Search Products"

    // Account / Auth
    signIn: z.string().optional(),             // "Sign In"
    accountLabel: z.string().optional(),       // "Account"

    // LOCALE-1B — shared product surfaces (commerce AND catalog sites; docs/slices/locale-1.md § 6.2): the product,
    // category, shop and search pages of components/SitePage.tsx, ProductByIdPage.tsx and the SearchBar placeholder.
    metaCategoryDescription: z.string().optional(), // "Browse {category} products"
    metaShopTitle: z.string().optional(),       // "Shop - {site}"
    metaSearchQueryTitle: z.string().optional(), // "Search: {query} - {site}"
    metaSearchTitle: z.string().optional(),     // "Search - {site}"
    searchPlaceholder: z.string().optional(),   // "Search products..." (when the tenant's searchBar.placeholder is empty)
    shopTitle: z.string().optional(),           // "Shop"
    volumePricing: z.string().optional(),       // "Volume Pricing"
    preOrder: z.string().optional(),            // "Pre-order"
    buyNow: z.string().optional(),              // "Buy Now"
    ingredients: z.string().optional(),         // "Ingredients"
    nutritionalValues: z.string().optional(),   // "Nutritional Values"
    reviewsHeading: z.string().optional(),      // "Reviews"
    reviewsSummary: PluralTextsSchema.optional(), // count: "{rating}/5 ({n} review)" / "{rating}/5 ({n} reviews)"
    categoryEmpty: z.string().optional(),       // "No products in this category yet."
    productCount: PluralTextsSchema.optional(), // count: "{n} product" / "{n} products"
    shopEmptyInStock: z.string().optional(),    // "No products currently in stock."
    shopEmpty: z.string().optional(),           // "No products available yet."
    shopAllProducts: z.string().optional(),     // "All Products"
    searchBreadcrumb: z.string().optional(),    // "Search"
    searchResultCount: PluralTextsSchema.optional(), // count: "{n} result" / "{n} results"
    searchEnterTerm: z.string().optional(),     // "Enter a search term to find products."

    // LOCALE-1D — commerce-only surfaces (docs/slices/locale-1.md § 6.2): the cart, checkout, account, order
    // confirmation and tracking pages (components/{CartPageView,CheckoutPageView,AccountPageView}.tsx, SitePage.tsx), the
    // add-to-cart controls, the commerce bar and the navbar's account links. Each EN value is the literal rendered before.
    metaCartTitle: z.string().optional(),       // "Cart - {site}"
    metaCheckoutTitle: z.string().optional(),   // "Checkout - {site}"
    metaOrderConfirmationTitle: z.string().optional(), // "Order Confirmation - {site}"
    metaOrderTrackingTitle: z.string().optional(), // "Order Tracking - {site}"
    personalizationRequired: z.string().optional(), // 'Please fill in "{label}"'
    variantRequired: z.string().optional(),     // "Please select {name}"
    cartWidgetTotal: z.string().optional(),     // "Cart/{total} {currency}" (commerce bar)
    couponValidateFailed: z.string().optional(), // "Could not validate coupon"
    deliveryDatesLoading: z.string().optional(), // "Loading delivery dates..."
    calendarMo: z.string().optional(),          // "Mo" (delivery date picker, weekday heads Monday first)
    calendarTu: z.string().optional(),          // "Tu"
    calendarWe: z.string().optional(),          // "We"
    calendarTh: z.string().optional(),          // "Th"
    calendarFr: z.string().optional(),          // "Fr"
    calendarSa: z.string().optional(),          // "Sa"
    calendarSu: z.string().optional(),          // "Su"
    checkoutEmptyMessage: z.string().optional(), // "Add some products before checking out."
    orderFailed: z.string().optional(),         // "Order failed"
    orderFailedStatus: z.string().optional(),   // "Order failed ({status})"
    deliveryDateSelected: z.string().optional(), // "Selected: {date}"
    bankTransferTo: z.string().optional(),      // "Transfer to {bank} - {iban}"
    orderStatusPlaced: z.string().optional(),   // "Placed" (account order list badge)
    orderStatusConfirmed: z.string().optional(), // "Confirmed"
    orderStatusPrepared: z.string().optional(), // "Prepared"
    orderStatusShipped: z.string().optional(),  // "Shipped"
    orderStatusDelivered: z.string().optional(), // "Delivered"
    orderStatusCancelled: z.string().optional(), // "Cancelled"
    orderStatusAnnulled: z.string().optional(), // "Annulled"
    myAccount: z.string().optional(),           // "My Account"
    accountSignInPrompt: z.string().optional(), // "Sign in to view your orders and manage your account."
    signInWithGoogle: z.string().optional(),    // "Sign In with Google"
    signOut: z.string().optional(),             // "Sign Out"
    profileHeading: z.string().optional(),      // "Profile"
    edit: z.string().optional(),                // "Edit"
    accountName: z.string().optional(),         // "Name"
    save: z.string().optional(),                // "Save"
    saving: z.string().optional(),              // "Saving..."
    cancel: z.string().optional(),              // "Cancel"
    loyaltyPoints: z.string().optional(),       // "Loyalty Points"
    defaultAddress: z.string().optional(),      // "Default Address"
    orderHistory: z.string().optional(),        // "Order History"
    noOrdersYet: z.string().optional(),         // "No orders yet."
    startShopping: z.string().optional(),       // "Start Shopping"
    orderThankYou: z.string().optional(),       // "Thank you for your order!"
    orderPlacedMessage: z.string().optional(),  // "Your order has been placed successfully. You will receive a confirmation email shortly."
    orderConfirmed: z.string().optional(),      // "Order Confirmed!"
    orderNumber: z.string().optional(),         // "Order {number}"
    bankTransferDetails: z.string().optional(), // "Bank Transfer Details"
    bankTransferInstruction: z.string().optional(), // "Please transfer the total amount to the following account:"
    bankLabel: z.string().optional(),           // "Bank:"
    accountHolderLabel: z.string().optional(),  // "Account Holder:"
    ibanLabel: z.string().optional(),           // "IBAN:"
    swiftLabel: z.string().optional(),          // "SWIFT:"
    referenceLabel: z.string().optional(),      // "Reference:"
    amountLabel: z.string().optional(),         // "Amount:"
    codPayOnDelivery: z.string().optional(),    // "You will pay {amount} when you receive your order."
    estimatedDelivery: z.string().optional(),   // "Estimated delivery:"
    orderDetails: z.string().optional(),        // "Order Details"
    quantityLabel: z.string().optional(),       // "Qty: {n}"
    phoneLine: z.string().optional(),           // "Phone: {phone}"
    orderNotFound: z.string().optional(),       // "Order Not Found"
    orderNotFoundMessage: z.string().optional(), // "Please check the order ID and email address."
    placedOn: z.string().optional(),            // "Placed on {date}"
    orderStepPending: z.string().optional(),    // "pending" (tracking timeline; shown with CSS capitalize)
    orderStepConfirmed: z.string().optional(),  // "confirmed"
    orderStepProcessing: z.string().optional(), // "processing"
    orderStepShipped: z.string().optional(),    // "shipped"
    orderStepDelivered: z.string().optional(),  // "delivered"
    orderStepCompleted: z.string().optional(),  // "completed"
    statusHistory: z.string().optional(),       // "Status History"
    orderHistoryPlaced: z.string().optional(),  // "placed" (tracking status history; CSS capitalize)
    orderHistoryConfirmed: z.string().optional(), // "confirmed"
    orderHistoryPrepared: z.string().optional(), // "prepared"
    orderHistoryShipped: z.string().optional(), // "shipped"
    orderHistoryDelivered: z.string().optional(), // "delivered"
    orderHistoryCancelled: z.string().optional(), // "cancelled"
    orderHistoryAnnulled: z.string().optional(), // "annulled"
    tracking: z.string().optional(),            // "Tracking"
    trackingNumber: z.string().optional(),      // "Tracking Number:"
    items: z.string().optional(),               // "Items"
    // LOCALE-1C: the category-showcase block (packages/plugins/src/category-showcase/CategoryShowcaseRender.tsx), a
    // product surface on shops, catalogs and content sites (with `outOfStock`, an existing key above, at a new reader)
    showcaseEmpty: z.string().optional(),       // "No products found in this category."
    // ORDER-CONFIRM-1 (docs/slices/order-confirm-1.md § 1 item 4, ruling OC1-TEXT = A): the notice of the checkout after a
    // `price-changed` answer. Resolved by the ORDER HANDLER (orders/create.ts) into the answer's `message` — never part
    // of the checkout's `strings` prop, so the checkout's first render stays byte-identical. Blank override → pack text.
    pricesChanged: z.string().optional(),       // "Prices have changed. Check the new total, then place the order again."
});

export type CommerceStrings = z.infer<typeof CommerceStringsSchema>;

// LOCALE-1 (docs/slices/locale-1.md § 2) — the tenant locale table has three parts. `commerceStrings` (above) is the
// commerce part; these two are the catalog and site parts, stored as the tenant attributes `catalogStrings` and
// `siteStrings` (§ 4.1). Every key is optional: an absent key = no override. A key is never renamed (§ 2.2 rule 5).
// Adding a key: schema here → EN value in language-packs/en.ts (compile error until done) → RO value in
// language-packs/ro.ts (test failure until done) → the reader → the Labels input (§ 2.3).
//
// The catalog part (§ 6.3): the texts of the catalog-only features — the interest list ("Mă interesează") and its header
// widget, and the facet panel, including the two fixed facet headings that `buildFacetListing` receives. Shipped by
// `locale-1b`. The § 6.3 pair `facetsCountOne` / `facetsCountOther` is ONE count key, `facetsCount` (§ 16.2 item 6), and
// `interestWidgetLabel` is a count key too.
export const CatalogStringsSchema = z.object({
    // Interest list (components/InterestShortlist.tsx; the list page title also in SitePage metadata)
    interestListFull: z.string().optional(),            // "Your list already has 50 products. Remove one to add another."
    interestAdd: z.string().optional(),                 // "I'm interested" (the toggle)
    interestAdded: z.string().optional(),               // "In my list" (the toggle, marked)
    interestListTitle: z.string().optional(),           // "My list" (list page heading and title; header widget)
    interestWidgetLabel: PluralTextsSchema.optional(),  // count: "My list: {n} product" / "My list: {n} products" (widget aria-label)
    interestStorageWarning: z.string().optional(),      // "This browser cannot save the list. …" (widget notice)
    interestStorageAck: z.string().optional(),          // "Got it" (widget notice button)
    interestBrowse: z.string().optional(),              // "See the products"
    interestSentTitle: z.string().optional(),           // "Your list was sent"
    interestSentBody: z.string().optional(),            // "Thank you! We received your list and will contact you soon."
    interestExcludedIntro: z.string().optional(),       // "These products were not included because they are no longer available:"
    interestEmpty: z.string().optional(),               // "Your list is empty. Press “{action}” on the products you like."
    interestErrorNoneAvailable: z.string().optional(),  // "The list has no available products. Choose the products again."
    interestErrorInvalid: z.string().optional(),        // "Check your details: …"
    interestErrorCheck: z.string().optional(),          // "We could not check the list now. Try again in a few moments."
    interestErrorAllGone: z.string().optional(),        // "The products in the list are no longer available. …"
    interestErrorSend: z.string().optional(),           // "The list could not be sent. Try again."
    interestErrorNetwork: z.string().optional(),        // "The list could not be sent. Check your connection and try again."
    interestPreviouslySent: z.string().optional(),      // "Your earlier list was received. …"
    interestContactHeading: z.string().optional(),      // "Your contact details"
    interestName: z.string().optional(),                // "Name"
    interestEmail: z.string().optional(),               // "E-mail"
    interestPhone: z.string().optional(),               // "Phone"
    interestMessage: z.string().optional(),             // "Message"
    interestSubmit: z.string().optional(),              // "Send the list"
    interestRowExpired: z.string().optional(),          // "This product is no longer in the catalog. …"
    interestRowUnavailable: z.string().optional(),      // "This product is not available now and will not be sent."
    interestRowOptionGone: z.string().optional(),       // "The chosen option is no longer offered. …"
    interestCollection: z.string().optional(),          // "Collection" (followed by the collection name)
    interestRemove: z.string().optional(),              // "Remove {title} from the list" (aria-label)
    // Facet panel (components/SitePage.tsx, catalog shop and category pages)
    facetsTooMany: z.string().optional(),               // "Too many filters selected — remove one"
    facetsCount: PluralTextsSchema.optional(),          // count: "{n} product" / "{n} products"
    facetsUrlTooLong: z.string().optional(),            // "The filters in the address are too long and were not applied."
    facetsRemove: z.string().optional(),                // "Remove the filter {facet}: {value}" (aria-label)
    facetsClear: z.string().optional(),                 // "Clear the filters"
    facetsNoMatch: z.string().optional(),               // "No product matches the selected filters."
    facetsTitle: z.string().optional(),                 // "Filters"
    facetProducer: z.string().optional(),               // "Brand" (heading of the producer facet)
    facetVariantDefault: z.string().optional(),         // "Option" (variant heading when the option groups differ)
    // CAT-QUOTE-1: the "Request a quote" button and dialog of the catalog product page (components/QuoteRequest.tsx)
    quoteButton: z.string().optional(),                 // "Request a quote"
    quoteTitle: z.string().optional(),                  // "Ask us for a quote" (dialog heading)
    quoteCall: z.string().optional(),                   // "Call us"
    quoteWhatsApp: z.string().optional(),               // "WhatsApp" (brand name)
    quoteEmail: z.string().optional(),                  // "Send an e-mail"
    quoteMessage: z.string().optional(),                // "Hello! I would like a quote for {product}[, option {variant}]: {url}" ([…] only with a variant)
    quoteClose: z.string().optional(),                  // "Close"
    // CDL-1 (docs/slices/catalog-data-labels-1.md § 3.1): the texts the backend WRITES or MAILS for a catalog site, read
    // through `catalogServerTexts` (locale-strings.ts), each non-empty (a blank override gives the language default).
    // The four site labels are written as attribute keys at import, so an edit takes effect at the next import of a
    // list; stored products are never rewritten.
    importCollectionAttribute: z.string().optional(),   // "Collection" (attribute key of file column 0)
    importUnitAttribute: z.string().optional(),         // "Unit" (attribute key of file column 6)
    importPackagingAttribute: z.string().optional(),    // "Packaging" (attribute key of file column 7)
    importMinimumOrderAttribute: z.string().optional(), // "Minimum order" (attribute key of file column 8)
    importVariantName: z.string().optional(),           // "Option" (option name written when the import request gives none)
    interestMailSubject: z.string().optional(),         // "Interest list — {name}" (mail to the site owner)
    interestMailIntro: z.string().optional(),           // "New interest list from {name}"
    interestMailProducts: z.string().optional(),        // "Products ({n}):"
    interestMailSentAt: z.string().optional(),          // "Sent: {date}" ({date} = the ISO time of the submission)
});
export type CatalogStrings = z.infer<typeof CatalogStringsSchema>;

// SCHED-LABELS-1 — the tenant's own wording of the hosted booking pages, stored as the tenant attribute `bookingStrings`:
// a fourth stored home beside the three parts of the locale table (docs/slices/locale-1.md, amendment 2026-11-22). One
// optional text per booking key; the keys are `BOOKING_TEXT_KEYS`, derived from the English pack (the `BookingStrings`
// type, language-packs/types.ts), never written a second time. Absent key or `""` = no override (the renderer then shows
// the standard text of the page language). PUT /settings checks the attribute as sent (backend/src/tenant/settings.ts):
// the limits of `siteStrings`, plus: a booking key holds a text that keeps exactly the `{placeholders}` of its standard
// text. Unknown keys are kept (§ 2.4). Shown only on a booking page in the tenant's own language
// (renderer/src/lib/booking-text.ts).
export const BookingStringsSchema = z.object(
    Object.fromEntries(BOOKING_TEXT_KEYS.map((key) => [key, z.string().optional()])) as { [K in keyof BookingStrings]: z.ZodOptional<z.ZodString> },
);

// The site part: texts every tenant shows (§ 6.1). `locale-1a` ships the site chrome keys; `locale-1c` adds the block
// chrome keys. The nine cookie and legal keys are stored ONLY in `gdpr` / `legalLinks` (§ 4.1): `PUT /settings`
// refuses them in `siteStrings`, and the resolver never reads them from there (COOKIE_AND_LEGAL_LABEL_LOCATIONS).
export const SiteStringsSchema = z.object({
    // Site identity and footer (renderer/src/lib/dynamo.ts, app/[siteId]/layout.tsx)
    untitledSiteName: z.string().optional(),            // "Untitled Site"
    metaSiteDescription: z.string().optional(),         // "Official site for {name}"
    footerTaxId: z.string().optional(),                 // "CUI: {value}"
    footerTradeRegister: z.string().optional(),         // "Reg: {value}"
    footerPhone: z.string().optional(),                 // "Tel: {value}"
    footerLinksHeading: z.string().optional(),          // "Links"
    footerLegalHeading: z.string().optional(),          // "Legal"
    legalTermsLabel: z.string().optional(),             // stored only in legalLinks.termsLabel
    legalPrivacyLabel: z.string().optional(),           // stored only in legalLinks.privacyLabel
    legalConsumerProtectionLabel: z.string().optional(), // stored only in legalLinks.anpcLabel
    legalDisputeResolutionLabel: z.string().optional(), // stored only in legalLinks.anpcSalLabel
    footerCopyright: z.string().optional(),             // "© {year} {name}. All rights reserved."
    // Cookie banner (components/CookieConsent.tsx) — stored only in gdpr.*
    cookieHeadline: z.string().optional(),
    cookieDescription: z.string().optional(),
    cookieDenyAll: z.string().optional(),
    cookieNecessaryOnly: z.string().optional(),
    cookieAcceptAll: z.string().optional(),
    // Navigation (components/Navbar.tsx)
    navAllOf: z.string().optional(),                    // "{label} (All)"
    navContact: z.string().optional(),                  // "Contact"
    navToggleMenu: z.string().optional(),               // "Toggle menu" (aria-label)
    navViewAll: z.string().optional(),                  // "View All"
    navContactUs: z.string().optional(),                // "Contact Us"
    // Page chrome (components/SitePage.tsx)
    breadcrumbHome: z.string().optional(),              // "Home"
    restrictedTitle: z.string().optional(),             // "Restricted Access"
    restrictedLoginRequired: z.string().optional(),     // "You must be logged in to view this page."
    restrictedSubscription: z.string().optional(),      // "This content requires a subscription ({currency} {price})."
    restrictedLogIn: z.string().optional(),             // "Log In with Google"
    restrictedPurchase: z.string().optional(),          // "Purchase Access"
    paginationPrevious: z.string().optional(),          // "Previous"
    paginationPageOf: z.string().optional(),            // "Page {page} of {total}"
    paginationNext: z.string().optional(),              // "Next"
    // Comments (components/CommentsSection.tsx)
    commentsPostFailed: z.string().optional(),          // "Failed to post"
    commentsHeading: z.string().optional(),             // "Discussion ({count})"
    commentsEmpty: z.string().optional(),               // "No comments yet. Be the first!"
    commentsClosed: z.string().optional(),              // "Comments are closed for this post."
    commentsPlaceholder: z.string().optional(),         // "Write a comment..."
    commentsPost: z.string().optional(),                // "Post"
    commentsJoin: z.string().optional(),                // "Join the conversation"
    commentsSignIn: z.string().optional(),              // "Sign in with Google"
    // Social share (components/SocialShare.tsx)
    shareLabel: z.string().optional(),                  // "Share:"
    shareOnX: z.string().optional(),                    // "Share on X"
    shareOnLinkedIn: z.string().optional(),             // "Share on LinkedIn"
    shareOnFacebook: z.string().optional(),             // "Share on Facebook"
    shareByEmail: z.string().optional(),                // "Share via Email"
    shareCopyLink: z.string().optional(),               // "Copy Link"
    // Quick contact button (components/QuickContact.tsx)
    quickContactCall: z.string().optional(),            // "Call us"
    quickContactEmail: z.string().optional(),           // "Email us"
    // Forms (components/DynamicForm.tsx)
    formSubmissionFailed: z.string().optional(),        // "Submission failed"
    formErrorShort: z.string().optional(),              // "Something went wrong"
    formSelectPlaceholder: z.string().optional(),       // "Select..."
    formSubmitting: z.string().optional(),              // "Submitting..."
    // Generic error (components/CheckoutPageView.tsx since locale-1d; the contact and lead-magnet blocks in locale-1c)
    errorTryAgain: z.string().optional(),               // "Something went wrong. Please try again."
    // LOCALE-1C: block chrome (packages/plugins/src/*/…Render.tsx; ruling LOCALE1-BLOCK-TEXTS = A). Fixed UI texts that are
    // the same in every block instance; a block's own author field, where one exists, wins over its key. The contact and
    // lead-magnet blocks also read `formSubmissionFailed` and `errorTryAgain` (above).
    contactSendFailed: z.string().optional(),           // "Failed to send message"
    contactSent: z.string().optional(),                 // "Message Sent!"
    contactSentDetail: z.string().optional(),           // "We'll get back to you shortly." (block field successMessage wins)
    contactName: z.string().optional(),                 // "Name"
    contactEmail: z.string().optional(),                // "Email"
    contactMessage: z.string().optional(),              // "Message"
    contactSending: z.string().optional(),              // "Sending..."
    leadUnlocked: z.string().optional(),                // "Unlocked!"
    leadFileReady: z.string().optional(),               // "Your file is ready."
    leadDownload: z.string().optional(),                // "Download Now"
    leadEmail: z.string().optional(),                   // "Email" (label for screen readers)
    leadEmailPlaceholder: z.string().optional(),        // "name@example.com"
    leadUnlocking: z.string().optional(),               // "Unlocking..."
    heroNoImage: z.string().optional(),                 // "No Image"
    imageAltFallback: z.string().optional(),            // "Image" (block field alt wins)
    videoTitle: z.string().optional(),                  // "Embedded video" (iframe title; block field caption wins)
    videoBackgroundTitle: z.string().optional(),        // "Background video" (iframe title; block field headline wins)
    noImage: z.string().optional(),                     // "No image" (carousel card, category showcase)
    noImageCaps: z.string().optional(),                 // "NO IMAGE" (coverflow carousel)
    carouselView: z.string().optional(),                // "View"
    codeCopy: z.string().optional(),                    // "Copy"
    codeCopied: z.string().optional(),                  // "Copied!"
    reviewsReadMore: z.string().optional(),             // "Read more"
    reviewsShowLess: z.string().optional(),             // "Show less"
    postsEmpty: z.string().optional(),                  // "No posts found."
    postsLoadFailed: z.string().optional(),             // "API {status}" (the browser fetch answered an HTTP error)
    // SHOP-LOOK-1A (docs/slices/shop-look-1.md § 5): the accessible name of the header's category bar (components/Navbar.tsx
    // `<nav aria-label>`). Last in the schema so the order of the older keys is unchanged.
    navCategoryBarLabel: z.string().optional(),         // "Categories"
    // NEWSLETTER-1: the newsletter block and the newsletter popup's field (`newsletterTexts`, locale-strings.ts). After
    // the older keys, so their order is unchanged. Not block keys: they reach a page only in the `_newsletter` of a
    // newsletter block (renderer prepareBlocks) or in the public popups answer of a popup that collects addresses.
    newsletterEmail: z.string().optional(),             // "Email" (label for screen readers)
    newsletterEmailPlaceholder: z.string().optional(),  // "name@example.com"
    newsletterConsent: z.string().optional(),           // the consent line next to the box; "" → the language default
    newsletterSubscribe: z.string().optional(),         // "Subscribe" (block field buttonText wins)
    newsletterSubscribing: z.string().optional(),       // "Subscribing..."
    newsletterThanks: z.string().optional(),            // "Thank you for subscribing!"
    // GALLERY-1 (docs/slices/gallery-1.md, ruling 2): the photo viewer of the `gallery` block (`galleryTexts`,
    // locale-strings.ts). After the older keys, so their order is unchanged. Not block keys: they reach a page only in
    // the `_gallery` of a gallery block (renderer prepareBlocks). Blank → the language default (each is an accessible
    // name or the position announcement).
    galleryViewer: z.string().optional(),               // "Photo viewer" (the dialog's accessible name)
    galleryClose: z.string().optional(),                // "Close"
    galleryPrevious: z.string().optional(),             // "Previous photo"
    galleryNext: z.string().optional(),                 // "Next photo"
    galleryCounter: z.string().optional(),              // "{n} of {total}" (the position in the viewer)
    galleryPhoto: z.string().optional(),                // "Photo {n}" (a tile's name when the photo has no description)
});
export type SiteStrings = z.infer<typeof SiteStringsSchema>;

/**
 * A resolved count key (§ 16.2 item 6): `forms` = the texts of the text language per plural category (the pack's,
 * then the tenant's; any subset), `language` = whose `Intl.PluralRules` select among them, `english` = the English
 * texts (the last fallback, selected by English rules; `other` always present). Read it with
 * `selectPluralText(value, n)`. A DTO — plain data only.
 */
export type CountText = { language: string; forms: PluralTexts; english: PluralTexts & { other: string } };

/** One resolved part: a text key holds its string, a count key its `CountText`. */
export type ResolvedPart<T> = { [K in keyof T]-?: NonNullable<T[K]> extends string ? string : CountText };

/** The resolved locale table (§ 2.3): every key of every part holds a string (a count key: a `CountText`). A DTO. */
export type LocaleStrings = {
    commerce: ResolvedPart<CommerceStrings>;
    catalog: ResolvedPart<CatalogStrings>;
    site: ResolvedPart<SiteStrings>;
};
