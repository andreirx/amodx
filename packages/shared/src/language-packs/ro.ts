import { RO_PACK } from "../country-packs/ro.js";
import type { LanguagePack } from "./types.js";

/**
 * LOCALE-1 — the Romanian texts. Layer 2 of the resolver for a tenant whose normalised `locale` has the language
 * `ro` (docs/slices/locale-1.md § 3.3, § 5.1). Partial by type; `language-packs.test.ts` asserts that it covers every
 * key shipped so far (§ 2.3).
 *
 * The commerce, cookie and legal values are READ from the RO country pack, so no text has two copies until
 * `locale-1d` moves them here as literals and removes the country-pack text members (§ 3.2 item 2, § 10.2).
 * The other site values are the "RO (proposed)" column of § 6.1, pending the human's approval before the prod
 * deploy (§ 16.2 item 4); a changed value is edited here only.
 */
export const RO_LANGUAGE_PACK: LanguagePack = {
    language: "ro",
    name: "Romanian",
    defaultLocale: "ro-RO",
    commerce: RO_PACK.defaultStrings,
    catalog: {},
    site: {
        untitledSiteName: "Site fără nume",
        metaSiteDescription: "Site-ul oficial {name}",
        footerTaxId: "CUI: {value}",
        footerTradeRegister: "Reg. Com.: {value}",
        footerPhone: "Tel: {value}",
        footerLinksHeading: "Linkuri",
        footerLegalHeading: "Informații legale",
        legalTermsLabel: RO_PACK.legal.termsLabel,
        legalPrivacyLabel: RO_PACK.legal.privacyLabel,
        legalConsumerProtectionLabel: RO_PACK.legal.consumerProtectionLabel,
        legalDisputeResolutionLabel: RO_PACK.legal.disputeResolutionLabel,
        footerCopyright: "© {year} {name}. Toate drepturile rezervate.",
        cookieHeadline: RO_PACK.gdpr.headline,
        cookieDescription: RO_PACK.gdpr.description,
        cookieDenyAll: RO_PACK.gdpr.denyAll,
        cookieNecessaryOnly: RO_PACK.gdpr.necessaryOnly,
        cookieAcceptAll: RO_PACK.gdpr.acceptAll,
        navAllOf: "{label} (toate)",
        navContact: "Contact",
        navToggleMenu: "Deschide sau închide meniul",
        navViewAll: "Vezi tot",
        navContactUs: "Contactează-ne",
        breadcrumbHome: "Acasă",
        restrictedTitle: "Acces restricționat",
        restrictedLoginRequired: "Trebuie să fii autentificat pentru a vedea această pagină.",
        restrictedSubscription: "Acest conținut necesită un abonament ({currency} {price}).",
        restrictedLogIn: "Autentificare cu Google",
        restrictedPurchase: "Cumpără accesul",
        paginationPrevious: "Anterior",
        paginationPageOf: "Pagina {page} din {total}",
        paginationNext: "Următor",
        commentsPostFailed: "Comentariul nu a putut fi publicat",
        commentsHeading: "Discuție ({count})",
        commentsEmpty: "Niciun comentariu încă. Fii primul!",
        commentsClosed: "Comentariile sunt închise pentru acest articol.",
        commentsPlaceholder: "Scrie un comentariu...",
        commentsPost: "Publică",
        commentsJoin: "Alătură-te discuției",
        commentsSignIn: "Autentificare cu Google",
        shareLabel: "Distribuie:",
        shareOnX: "Distribuie pe X",
        shareOnLinkedIn: "Distribuie pe LinkedIn",
        shareOnFacebook: "Distribuie pe Facebook",
        shareByEmail: "Trimite pe e-mail",
        shareCopyLink: "Copiază linkul",
        quickContactCall: "Sună-ne",
        quickContactEmail: "Scrie-ne",
        formSubmissionFailed: "Trimiterea a eșuat",
        formErrorShort: "A apărut o eroare",
        formSelectPlaceholder: "Selectează...",
        formSubmitting: "Se trimite...",
    },
};
