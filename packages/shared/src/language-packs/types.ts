import type { CatalogStrings, CommerceStrings, PluralTexts, SiteStrings } from "../locale-table.js";

/**
 * LOCALE-1 (docs/slices/locale-1.md § 2.3, § 3.2) — the texts of one language, per part of the locale table.
 * A pack holds texts only; country facts (currency, regions, phone prefix) stay in `country-packs/`.
 * A pack may lack a key: the resolver then uses the English value (§ 3.3, ruling LOCALE1-LANGUAGE = A).
 * A count key holds the texts of the pack language's plural categories (`pluralCategoriesOf`), `other` included.
 */
export interface LanguagePack {
    /** The primary language subtag this pack serves (`"en"`, `"ro"`): the key of `LANGUAGE_PACKS`. */
    language: string;
    /** English name shown in the admin "Site language" select (the admin stays English). */
    name: string;
    /** The `locale` the admin writes when an owner selects this language (§ 3.5). */
    defaultLocale: string;
    commerce: Partial<CommerceStrings>;
    catalog: Partial<CatalogStrings>;
    site: Partial<SiteStrings>;
    /** SCHED-1G2: the texts of the hosted booking pages. Optional, so a pack without them gets English. */
    booking?: Partial<BookingStrings>;
}

/**
 * SCHED-1G2 (docs/slices/sched-1.md § 10.1) — the visitor texts of the hosted booking pages (`/_booking`,
 * `/_booking/manage`). Plain texts with `{placeholders}` (filled by `fillTemplate`); no count key. Not part of the
 * three-part locale table; the page selects a pack by language (`?lang=`, else the tenant locale). SCHED-LABELS-1: a tenant overrides them in its own stored home,
 * `bookingStrings` (`BookingStringsSchema`, keys `BOOKING_TEXT_KEYS` derived from the English pack), shown only on a
 * booking page in the tenant's own language (`renderer/src/lib/booking-text.ts`).
 * The `err*` keys are the visitor texts of the refusal codes of § 10.2 and of the renderer proxy
 * (`renderer/src/lib/booking-ui.ts` maps each code to one key).
 */
export interface BookingStrings {
    bookTitle: string; manageTitle: string; loading: string; back: string; timesShownIn: string;
    chooseOffer: string; servicesHeading: string; durationMinutes: string; nothingOffered: string;
    chooseTime: string; previousWeek: string; nextWeek: string; noTimesThisWeek: string; lastBookableDate: string;
    detailsHeading: string; selectedLabel: string; nameLabel: string; emailLabel: string; phoneLabel: string;
    fieldRequired: string; emailInvalid: string; submitHold: string; sending: string;
    checkMailHeading: string; checkMailHeld: string; checkMailConfirmed: string; resendMail: string; resent: string;
    newBooking: string;
    noLinkToken: string; bookingRef: string; stateHeld: string; stateConfirmed: string; whenLabel: string;
    whatLabel: string; confirmButton: string; confirmedNow: string;
    cancelButton: string; cancelQuestion: string; cancelYes: string; cancelNo: string; cancelledNow: string;
    moveTimeButton: string; movedNow: string; moveNotOffered: string; changeUntil: string;
    refreshBooking: string;
    errInvalid: string; errNotAvailable: string; errNotFound: string; errVerificationRequired: string;
    errVerificationFailed: string; errUnavailable: string; errSlotTaken: string; errNotOnGrid: string; errInPast: string;
    errBeyondHorizon: string; errNotEligible: string; errOutsideAvailability: string; errResourceUnavailable: string;
    errIntentReused: string; errIntentClosed: string; errTooManyForEmail: string; errTooManyFromAddress: string;
    errBusy: string; errMailFailed: string; errLinkNotValid: string; errExpired: string; errCancelled: string;
    errTooLate: string; errNotConfirmed: string; errStale: string; errRange: string;
    errServer: string; errGeneric: string;
}

/** A complete part: every text key holds a string; every count key its texts with `other` present (§ 16.2 item 6). */
export type CompletePart<T> = { [K in keyof T]-?: NonNullable<T[K]> extends string ? string : PluralTexts & { other: string } };

/** The English pack: complete by type, so the compiler refuses a key without an English value (§ 2.3). */
export interface CompleteLanguagePack extends LanguagePack {
    commerce: CompletePart<CommerceStrings>;
    catalog: CompletePart<CatalogStrings>;
    site: CompletePart<SiteStrings>;
    booking: CompletePart<BookingStrings>;
}
