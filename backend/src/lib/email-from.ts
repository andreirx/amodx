/**
 * `From` header construction — ship-now hotfix, ratified D-EMAIL-6 option D
 * (`docs/plan-email-onboarding.md` § ratification header, D6).
 *
 * WHAT IT DOES. Turns a tenant's site name into the *display name* of an RFC 5322
 * `From` header, so a customer of tenant *X* sees `"<X's site name>" <contact@…>`
 * instead of the bare platform address (F-EMAIL-1, the brand-leak defect). The
 * ADDRESS never changes — this is display-name only. Reply-To is DEFERRED
 * (ratified D-EMAIL-6.4); do not add it here.
 *
 * WHY IT IS A SHARED HELPER AND NOT INLINE INTERPOLATION. The header field body is
 * `display-name <addr-spec>`, and `display-name` is not "any string". A tenant name
 * is arbitrary operator-entered text — it can contain the RFC 5322 `specials`
 * (`" , ( ) < > : ; @ \`), non-ASCII (diacritics, emoji), or — the security case —
 * a CR/LF that would otherwise inject a second header. Three failure modes if you
 * write `` `"${name}" <${addr}>` `` directly:
 *   1. a `"` in the name terminates the quoted-string early → malformed header;
 *   2. a non-ASCII byte in the name is rejected by SES (SendEmail requires the
 *      display name to be 7-bit ASCII unless MIME encoded-word per RFC 2047);
 *   3. a `\r\n` in the name splits the header → injection.
 * All six SES send sites need the same correct treatment, so the logic lives once.
 *
 * HOW IT ENCODES. Two branches, decided by whether the name is entirely printable
 * ASCII (0x20–0x7E):
 *   - printable ASCII  → RFC 5322 quoted-string, escaping `\` and `"`. Everything
 *     else printable-ASCII (comma, parens, colon…) is legal *inside* the quotes, so
 *     one branch covers all of it.
 *   - anything else (non-ASCII OR a control char incl. CR/LF) → RFC 2047 `B`
 *     encoded-words over UTF-8. Base64 turns arbitrary bytes into a safe
 *     `[A-Za-z0-9+/=]` payload, which neutralises the injection case for free.
 *
 * The encoded-word path folds into ≤75-char words (RFC 2047's hard limit) and never
 * splits a multi-byte character across a word — hence the code-point iteration and
 * the byte budget below. Realistic site names produce a single word; the folding is
 * there so an arbitrarily long name (the packet's "arbitrary tenant names") stays
 * RFC-correct rather than emitting one over-long word some receivers mangle.
 */

/**
 * 45 UTF-8 payload bytes → 60 base64 chars; plus the `=?UTF-8?B?` (10) + `?=` (2)
 * wrapper = 72 chars, safely under RFC 2047's 75-char encoded-word ceiling.
 */
const MAX_ENCODED_WORD_PAYLOAD_BYTES = 45;

/**
 * Platform brand label used as the `From` display name when a send site has no
 * tenant `siteName` in scope (ratified fallback: "fall back to the platform default").
 * Single source of truth — previously duplicated as a `|| "AMODX"` literal at the
 * contact and invite call sites. A send site must NEVER emit a bare address (the
 * defect EMAIL-HOTFIX-1 review-0 rejected), so this default is applied inside
 * `formatFromHeader` rather than per caller.
 */
export const DEFAULT_FROM_NAME = "AMODX";

/** True iff every code point is printable US-ASCII (0x20–0x7E) — no control, no non-ASCII. */
function isAsciiPrintable(name: string): boolean {
    for (const ch of name) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20 || cp > 0x7e) return false;
    }
    return true;
}

/** RFC 5322 quoted-string: wrap in quotes, backslash-escape `\` and `"`. */
function toQuotedString(name: string): string {
    return `"${name.replace(/([\\"])/g, "\\$1")}"`;
}

/**
 * RFC 2047 `B` (base64) encoded-words over UTF-8, folded to ≤75 chars each,
 * never splitting a multi-byte character. `for…of` iterates by code point, so a
 * surrogate-pair emoji is one unit and can never straddle two words.
 */
function toEncodedWords(name: string): string {
    const words: string[] = [];
    let chunk: Buffer[] = [];
    let chunkBytes = 0;
    for (const ch of name) {
        const b = Buffer.from(ch, "utf8");
        // Flush before overflow — but never flush an empty chunk (a single char may
        // be up to 4 bytes, always well under the 45-byte budget, so it always fits).
        if (chunkBytes > 0 && chunkBytes + b.length > MAX_ENCODED_WORD_PAYLOAD_BYTES) {
            words.push(Buffer.concat(chunk).toString("base64"));
            chunk = [];
            chunkBytes = 0;
        }
        chunk.push(b);
        chunkBytes += b.length;
    }
    if (chunkBytes > 0) words.push(Buffer.concat(chunk).toString("base64"));
    // Adjacent encoded-words separated by a single space are re-joined by the
    // decoder with the space removed (RFC 2047 §6.2), so this reconstructs the name.
    return words.map((b64) => `=?UTF-8?B?${b64}?=`).join(" ");
}

/**
 * Build an RFC 5322 `From` header field body from a tenant site name and a sender
 * address. When `siteName` is empty/whitespace/undefined, falls back to the platform
 * brand label (`DEFAULT_FROM_NAME`) — the ratified fallback for a send site that has
 * no tenant name in scope. The result therefore ALWAYS carries a display name; a bare
 * address is never returned (EMAIL-HOTFIX-1 review-0). The ADDRESS never changes.
 *
 * A NON-EMPTY name is used VERBATIM — surrounding whitespace is preserved (ratified
 * "the display name IS the tenant siteName; nothing else changes", EMAIL-HOTFIX-1
 * review-1). Trimming is used ONLY to decide whether an all-whitespace value should
 * trigger the fallback; it never mutates the emitted display name.
 *
 * @param siteName tenant site name (arbitrary operator text) or null/undefined
 * @param address  the SES-verified sender address — trusted, never encoded
 * @returns e.g. `"Acme, Inc." <contact@bijuterie.software>`, or `"AMODX" <…>` when unnamed
 */
export function formatFromHeader(siteName: string | null | undefined, address: string): string {
    const raw = siteName ?? "";
    const name = raw.trim() === "" ? DEFAULT_FROM_NAME : raw;
    const displayName = isAsciiPrintable(name) ? toQuotedString(name) : toEncodedWords(name);
    return `${displayName} <${address}>`;
}
