# CMRC-2A — the copy, verify, purge and discard tool for the commerce private table (no runtime change)

- **Status:** IMPLEMENTED 2026-11-28 — built; revision 1 of the same day applies review-0 (five findings, two
  operator rulings) and revision 2 applies review-1 (two findings): § *Review-0: findings, classes and rules*;
  operator staging run pending (§ *Operator runbook*).
- **Track:** B (commerce-private). Fourth build slice of the track: the TOOL half of `cmrc-2`.
- **Depends:** `cmrc-1a`, `cmrc-1b`, `cmrc-1l` (on staging since 2026-11-28): `backend/src/lib/commerce-db.ts` exports
  `COMMERCE_PRIVATE_PREFIXES`; the empty table `AmodxCommerceTable<suffix>` exists. Operator rulings under the human's
  standing rule of 2026-11-27 (the human may overrule): CMRC-TABLE = B; CMRC-MAIN-KEYS = revised B
  (`docs/slices/cmrc-1.md` Appendix R.1); CMRC-TEST-ONLY is asked of the human, planned default A, and the discard
  branch is built in either case with the guard of Appendix R.2.
- **Source plan:** `docs/plan-commerce-private-table.md` (§ *Migration Script*, § *Safety Rules*); specification
  `docs/slices/cmrc-1.md` § 6 (the `cmrc-2` bullet without its part (2), the manifest of P1, `verify --post-cutover`
  of Q6, the whole `cmrc-6` bullet) and Appendix R.2 (conditions 2 and 4).
- **Maturity:** the tool is PROTOTYPE until the operator's staging run passes; MATURE when `cmrc-3` has run on
  staging with it.
- **Baseline:** `9f2e10e` (HEAD at the start of the slice; the working tree was clean).

Evidence labels: **OBSERVED** — read in the file at `9f2e10e`; **EXECUTED** — a command run in this slice (command
given); **INFERRED** — reasoned, not seen; **NOT RUN** — needs AWS or the operator. **No AWS call was made in this
slice.** Every proof is a unit test against in-memory tables.

## Guarantee scope (what is true after this slice, and what is not)

| Part | Statement | Basis |
|---|---|---|
| **True** | One operational tool exists for the steps that `cmrc-3`, `cmrc-4` and `cmrc-6` run: inventory, copy, content verification with a manifest, post-cutover verification, purge of verified copies, discard under an authorization record | § *Safety table*, § *Build record* |
| **True** | The tool takes the moved kinds from `COMMERCE_PRIVATE_PREFIXES` of `backend/src/lib/commerce-db.ts`; no file of the tool contains a commerce-private prefix as text | tests "kinds" (§ *Safety table* row S15) |
| **True** | Nothing at run time changes: no file under `backend/src`, `renderer/`, `infra/`, `packages/` is edited | `git status` in § *Build record* |
| **Not claimed** | `docs/VISION.md` guarantee 2 is NOT met. Every order and customer item is still in the main table, which the renderer's role can read. This slice only builds the tool; it copies and deletes nothing | — |
| **Not claimed** | That the tool works against DynamoDB. It is proven against an in-memory double that accepts exactly the four command forms the tool sends. The first real run is the operator's staging run | § *Evidence required* |
| **Not claimed** | That a commerce-table key outside the manifest was created after the release. `verify --post-cutover` lists such keys and says it cannot date them; the operator establishes it from the freeze record (operator ruling CMRC2A-Q6-RELEASE-EVIDENCE = B) | D4; `docs/slices/cmrc-1.md` § 6, note of 2026-11-28 |
| **Not claimed** | The write freeze (`cmrc-2b`), the cutover (`cmrc-4`), any decision about the commerce audit entries (finding F-CMRC2A-AUDIT) | — |

## Purpose / risk retired

The tool is the one part of Track B that DELETES customer data (`purge`, `discard`), and the human will run it
against production. The risk retired: **a copy that differs in silence, a verification that compares less than it
says, or a delete that selects one key too many.** The slice is judged by what the tool refuses to do; each refusal
has a test (§ *Safety table*).

Link to the vision: guarantee 2 (customer-private data outside the public renderer's IAM reach) becomes true only
when the main-table items are removed (`cmrc-6`). That removal is safe only if the copy was proven equal first. This
tool is that proof and that removal.

## The existing tool, mode by mode (verification before building; packet item 1)

All statements OBSERVED in `scripts/migrate-commerce-private-table.ts` at `9f2e10e` (370 lines) unless marked.

**How it is invoked.** `npm run migrate-commerce-private-table -- <flags>`; the script of `package.json:22` is
`npx tsx scripts/migrate-commerce-private-table.ts`. No workspace builds or type-checks `scripts/`; no test imports
the file.

**How it gets its tables and tenants.** `--source-table` and `--destination-table` (both required, `:102-108`),
`--tenants` (a comma list, required, `:110-121`), `--region` (else `AWS_REGION`, else `eu-central-1`, `:99`),
`--page-size` (default 50), `--allow-existing-destination`. The client is a `DynamoDBDocumentClient` with the default
conversion of values (`:303-308`).

**What every mode does first** (`:310-326`). For each tenant and each of its own four prefixes (`MOVED_PREFIXES`,
`:8`) it runs one paginated Query (`PK = :pk AND begins_with(SK, :prefix)`, `:157-166`) on the source and on the
destination, keeps all items in memory and prints two counts per prefix.

| Mode | What it does today | What is wrong against § 6 |
|---|---|---|
| `plan` | Prints the counts and ends. No write (`:328-331`) | No report of GSI attributes (§ 2.4) and no report of a key that is not in `normalizeEmail()` form (F-FND2-1). No inventory with hashes (Appendix R.2 needs the key set with the SHA-256 of each item) |
| `migrate` | Stops if the destination holds any item of a moved prefix, unless `--allow-existing-destination` (`:212-223`, `:322-324`). Then writes every source item with `BatchWriteCommand` `PutRequest`, 25 per call (`:225-248`). Then reloads both tables and compares the key sets | (a) It writes as soon as the mode is named; no separate flag. (b) A `BatchWrite` Put has no condition: with `--allow-existing-destination` it OVERWRITES a destination item of the same key, also a newer one. § 6 asks for conditional Puts (`attribute_not_exists(SK)`). (c) Its own check after the copy compares keys only |
| `verify` | Reloads both tables and compares the key SETS: "missing in destination", "unexpected in destination", the first 10 keys of each (`:250-292`). Prints `Verification OK` when the key sets are equal | It compares no attribute. Two items with the same key and different content pass as `Verification OK`. § 6 asks for content equality of every attribute at every depth. There is no `--strict`, no `--post-cutover`, no manifest |
| `purge-plan`, `purge`, `purge-verify`, `discard-plan`, `discard`, `discard-verify` | Do not exist (the type `Mode`, `:10`) | § 6, bullet `cmrc-6` |

**More differences from § 6 and from the packet:**

- **Its own list of kinds** (`:8`). § 6: import `COMMERCE_PRIVATE_PREFIXES`.
- **Numbers can change on the copy.** The document client converts a DynamoDB number to a JavaScript number and
  back. EXECUTED (local, no AWS): `unmarshall({x:{N:'0.12345678901234567891'}})` then `marshall` gives
  `{"N":"0.12345678901234568"}` — three digits lost with no error. The commerce writers store no such number today
  (§ *Canonical form*), but a copy tool must not depend on that.
- **The two table names are not compared.** `--source-table X --destination-table X` is accepted.
- **Unknown flags are ignored** (`:68-84`): a typing error such as `--tenant` is reported only as a missing
  `--tenants`; a wrong optional flag has no effect and no message.
- **Reads are not consistent reads** (no `ConsistentRead`), so a comparison just after a write can see an old value.
- **The name `verify` says more than the mode does** (key sets only). This slice removes that behaviour under that
  name (§ *Deviations and local decisions*, D1).
- **No test.** `docs/slices/cmrc-1.md` § 10.2 D2 records it.

## Scope

1. Extend `scripts/migrate-commerce-private-table.ts` (the same command, the same `package.json` script) to the
   modes below. No second tool.
2. A pure decision core (`scripts/commerce-private-table/canonical-item.ts`, `decisions.ts`), a thin I/O shell for
   the tables (`run.ts`) and one for the files (`files.ts`); the entry file only connects the real client, the real
   clock and `node:fs`, and holds no rule.
3. One canonical form and one hash for the manifest, `verify --strict`, `verify --post-cutover`, purge and discard.
4. The safety defaults of the packet, each with a test.
5. Unit tests against in-memory tables, reached by `npm --prefix backend run test:unit`.
6. The operator runbook (below) and the documents the packet lists.

**Modes** (`--mode`):

| Mode | Reads | Writes or deletes | Files it writes |
|---|---|---|---|
| `plan` | source and destination (selector `old-mail-counters`: source only) | nothing | `--inventory-out` (optional): the key set of the source with one SHA-256 per item |
| `migrate` | source and destination | with `--execute` only: conditional Puts into the destination | none |
| `verify --strict` | source and destination | nothing | `--manifest-out` (required): the verification manifest, only when there is no difference |
| `verify --post-cutover` | the manifest, source and destination | nothing | none |
| `purge-plan` | the manifest, source, destination (presence only) | nothing | none |
| `purge` | as `purge-plan` | with `--execute` only: deletes from the SOURCE | `--export-path`: one NDJSON line for EVERY candidate, all before the first delete |
| `purge-verify` | the manifest, source and destination | nothing | none |
| `discard-plan` | the authorization record, source | nothing | none |
| `discard` | as `discard-plan` | with `--execute` only: deletes from the SOURCE | `--export-path`: one NDJSON line per deleted item, each before the delete of that item |
| `discard-verify` | source, the export file | nothing | none |

## Non-scope

- The write freeze guard and `COMMERCE_WRITE_FREEZE_TENANTS` (`cmrc-2b`).
- Any change under `backend/src`, `infra/`, `renderer/`, `packages/`. The tool needs no new export:
  `COMMERCE_PRIVATE_PREFIXES` and `customerRef` are exported already.
- The cutover; `COUPONUSE#` and `MAILRATE#` code (`cmrc-4`).
- The commerce AUDIT entries: not designed here (finding F-CMRC2A-AUDIT).
- Any AWS call. The staging run is the operator's; every production run is the human's.
- A restore tool for the NDJSON export. The export format is defined (§ *Files*), so a restore can be written when
  one is needed.

## Architectural boundaries

- **Tenant isolation.** Every read is `PK = TENANT#<id>` for a tenant of the `--tenants` allowlist, or `PK = SYSTEM`
  with the fixed prefix of the old mail counters. A tenant that is not in the list is never read (safety row S4; the one exception is row S4x).
- **No DynamoDB scan.** The shell sends four command forms and no other: Query with
  `PK = :pk AND begins_with(SK, :sk)`, GetItem, PutItem with `attribute_not_exists(SK)`, DeleteItem. The test double
  refuses every other command and every other expression.
- **Commerce-private keys** (CLAUDE.md, Critical rule 10). The tool writes no prefix of its own: it imports the list
  from `backend/src/lib/commerce-db.ts`. The one key text the tool owns is the prefix of the old mail counters
  (`EMAILLIMIT#`, § 6 discard predicate 2), which is not a commerce-private prefix and is deleted, never moved.
- **Dependency direction.** `canonical-item.ts` and `decisions.ts` import no SDK, read no clock and no file.
  `run.ts` imports them, the SDK command classes, `commerce-db.ts` (the kinds) and `normalizeEmail` of
  `@amodx/shared` (the key-form notice; the core receives it as a parameter). `files.ts` imports the path rule of
  `decisions.ts` and takes the file system as a parameter. The entry file imports `run.ts` and `files.ts` and
  connects the client and `node:fs`; it holds no rule, because it is the one file no test runs. Nothing under
  `backend/src` imports the tool.
- **Data across the boundary.** Between shell and core: plain objects (`HashedItem`, verdicts, the parsed manifest
  and authorization record). No SDK object enters the core.

## Design

### Why the tool reads and writes raw DynamoDB values

The shell uses the low-level client (`@aws-sdk/client-dynamodb`): an item is a map of attribute name to a typed
value (`{S: "…"}`, `{N: "12.50"}`, `{M: {…}}` …). The copy puts back exactly the map it read. No conversion step
exists that could change a type or a number (see the EXECUTED number example above). Rejected: the document client
with `wrapNumbers` — it is exact for numbers too, but the copy would then depend on the conversion rules of
`@aws-sdk/lib-dynamodb` in both directions (sets, binary, empty values), and the canonical form would have to
define JavaScript classes instead of the ten DynamoDB types.

### Canonical form and hash (ONE function: `canonicalize` in `canonical-item.ts`)

`canonicalize(rawItem)` returns `{ key: {pk, sk}, canonical, sha256 }` or a refusal. It is the only place that
defines equality of two items. Users: the inventory, the manifest, `migrate` (is the destination item equal?),
`verify --strict`, `verify --post-cutover`, `purge`, `discard`, and the export lines.

| DynamoDB type | Canonical form | Note |
|---|---|---|
| item, and `M` (map) | `{"M":{…}}` with the attribute names sorted by UTF-16 code unit (the default JavaScript string order); the item itself is the map without the `M` wrapper | attribute order never matters |
| `S` (string) | `{"S":"<text>"}` | an empty string is a value and differs from an absent attribute |
| `N` (number) | `{"N":"<the text DynamoDB returned>"}` | **never converted to a JavaScript number**, so a number of any size or precision is compared digit by digit. The text must match `-?digits[.digits][E±digits]`, else refusal |
| `BOOL` | `{"BOOL":true}` or `{"BOOL":false}` | |
| `NULL` | `{"NULL":true}` | `null` is a value: it differs from an absent attribute and from every other type |
| `L` (list) | `{"L":[…]}` in the stored order | order is part of a list |
| `SS`, `NS` (string set, number set) | `{"SS":[…]}`, `{"NS":[…]}` with the members sorted by code unit | a set has no order; number members stay text |
| `B` (binary) | `{"B":"<base64>"}` | |
| `BS` (binary set) | `{"BS":[…]}`: base64 members, sorted | |

- **Canonical JSON** = `JSON.stringify` of that tree (no white space). **Hash** = SHA-256 of the UTF-8 bytes of
  the canonical JSON, lower-case hex.
- The type tag is part of the form: the string `"1"` and the number `1` differ; `false`, `null` and "absent" all
  differ.
- **Numbers.** Equality of two numbers is equality of their texts. DynamoDB stores a number in one normal form
  (INFERRED from the AWS documentation, not re-read today), so both tables return the same text for the same
  number. If they ever did not, the tool reports a DIFFERENCE. Every user of the hash treats a difference as a
  refusal, so this error is always on the safe side: the tool can refuse too much, it cannot call two different
  numbers equal.
- **Refused, never guessed** (`canonicalize` returns a refusal and the run stops before it decides anything about
  that item): a value that does not hold exactly one type tag; a tag that is not one of the ten above (a type the
  SDK does not know arrives as `$unknown`); a payload of the wrong JavaScript type under its tag (an `N` that is not
  a number text, a `B` that is not bytes, `NULL` that is not `true`); an item without a string `PK` and `SK`.
- **Types the commerce items use today:** `S`, `N`, `BOOL`, `NULL`, `M`, `L`. Basis: OBSERVED in
  `backend/src/orders/create.ts` (the three transaction items and the counter: strings, numbers, `null`, objects,
  lists, all through the document client); for the other four writers (`orders/update-status.ts`, `orders/update.ts`,
  `customers/update.ts`, `customers/public-update.ts`) INFERRED from the same client plus one search — no writer
  builds a set or a binary value (EXECUTED: `grep -rn "new Set(\|createSet\|Buffer\.\|Uint8Array" backend/src/orders
  backend/src/customers` → no hit). NOT RUN: what deployed items hold; an item with another type is still handled
  exactly, or refused. The function still defines `SS`, `NS`, `BS` and `B`, because DynamoDB defines
  them exactly and nothing has to be guessed.
- **Attribute paths.** `differingPaths(a, b)` walks two canonical trees and returns the path of every attribute
  that differs, as a JSON array of names and list indexes (`["items",2,"price"]`). It returns no path if and only
  if the two canonical JSON texts are equal (property tested). A path holds attribute NAMES only, never a value.

### Verdict sums (`decisions.ts`; every `switch` over them has no `default` arm)

| Sum | Variants | Rule |
|---|---|---|
| `CopyVerdict` (per source key) | `copy` · `alreadyPresentEqual` · `refusedDestinationDiffers` (with the differing paths) | destination absent → `copy`; present with the same hash → `alreadyPresentEqual`; present with another hash → refused, never overwritten |
| `ContentDifference` (per key, `verify --strict`) | `missingInDestination` · `missingInSource` · `attributeDiffers` (with the paths) | |
| `PostCutoverDifference` (per key) | `manifestKeyMissingInDestination` · `sourceKeyNotInManifest` · `sourceChangedSinceManifest` | EXACTLY the three statements of Q6 as amended (D4), one variant each: (1) every manifest key exists in the destination; (2) the source holds no key of a moved kind outside the manifest; (3) every item the source holds hashes to its manifest value. No other condition (D5). A destination key outside the manifest is NOT a difference: it is listed (`destinationKeysNotInManifest`) |
| `PurgeVerdict` (per candidate) | `delete` · `refusedNotInManifest` · `refusedSourceChanged` · `refusedDestinationAbsent` | the four rows of § 6 and nothing else. The checks run in this order; one reason per key |
| `PurgePostconditionDifference` (per key, `purge-verify`) | `remainsInSource` · `absentInSourceAndDestination` | |
| `DiscardVerdict` (per candidate) | `delete` · `refusedNotAuthorized` · `refusedChangedSinceAuthorization` | Appendix R.2 condition 4 |
| `Selector` | `movedKinds` (tenants × the imported prefixes) · `oldMailCounters` (`PK = SYSTEM`, prefix `EMAILLIMIT#`) | the two predicates of § 6. `parseSelector` returns one of them or a `SelectorRefusal` (`unknownSelector` · `tenantsRequired` · `tenantsNotApplicable` · `emptyKindPrefix`). A selector always becomes `PK = :pk AND begins_with(SK, :sk)` with a non-empty prefix: a whole-partition delete cannot be written |
| `Request` | one variant per mode, each with only the data of that mode | parsed from the arguments by `parseRequest` |
| `Deletion` (inside `purge` and `discard`) | `planOnly` · `execute` (with the backup reference and the export path) | the backup reference and the export path exist only in the `execute` variant |
| `ExportRule` (`run.ts`) | `everyCandidateBeforeFirstDelete` (purge) · `eachItemBeforeItsDelete` (discard) | when the export is written (D9) |
| `Notice` (per item, `plan`) | `gsiAttributes` · `keyNotNormalized` · `emailKeyOfUnknownForm` | D16 |
| `EmailKeyForm` | `emailToEnd` (`<prefix><email>`) · `emailThenLastHash` (`<prefix><email>#<id>`) | how a sort key holds an email (D16) |

A verdict is a decision. What then happens to a key is reported by the deletion loop of the shell (`runDeletion`),
one line per key:

| Line | Meaning | Green? |
|---|---|---|
| `DELETED` | the DeleteItem call answered | yes |
| `REFUSED <reason>` | the verdict | no |
| `VANISHED` | the consistent read just before the delete found no item; no verdict is made for an item that is not there | no |
| `NOT DELETED the item changed after it was exported` | purge only: the form the read before the delete found is not the form in the export (D19) | no |
| `DELETE CALL FAILED … ABSENT: it was deleted` / `… STILL IN THE SOURCE: it was not deleted` / `… UNKNOWN` | the DeleteItem call failed; the state is what a consistent read after it showed, or UNKNOWN when that read failed too. The loop stops | no |
| `STOPPED <reason>` | another call failed (a read, an export write). The loop stops; nothing is deleted after it | no |

### Files

All files are written to a path the operator gives. The tool **refuses a path inside the repository tree** and
**never overwrites an existing file** (an earlier export is the only copy of items that are already deleted).
The rule is in `files.ts` and is applied to the inventory, the manifest and the export alike (`outputFilesOf` lists
them per mode):

- the arguments are checked by path component (`isInsideDirectory`: a child directory named `..private` is inside);
- before the first read of a table, and again at the moment of creation, the REAL directory of the file (every link
  resolved) is compared with the real repository root — a directory outside the repository that is a link into it is
  refused; a directory that does not exist is refused;
- the file is created with the flag `wx` (the open fails if anything is at the path);
- a line or a file text is written until every UTF-8 byte is accepted, then flushed (`fsync`); a write that accepts
  no byte, or any error, stops the run before the next delete.

| File | Written by | Content |
|---|---|---|
| Inventory | `plan --inventory-out` | `{ "record": "amodx-commerce-private/inventory/1", "createdAt", "sourceTable", "selector", "entries": [{ "pk", "sk", "sha256" }] }` |
| Verification manifest | `verify --strict --manifest-out` | `{ "record": "amodx-commerce-private/verification-manifest/1", "createdAt", "sourceTable", "destinationTable", "tenants", "prefixes", "entries": [{ "pk", "sk", "sha256" }] }`. Written only when both tables are equal for the listed tenants, so every entry is a key that was deep-equal in both tables at `createdAt`. The tool prints the SHA-256 of the file; the operator writes it into the freeze record |
| Discard authorization record | the human | `{ "record": "amodx-commerce-private/discard-authorization/1", "authorizedBy", "authorizedOn" (YYYY-MM-DD), "sourceTable", "selector": { "predicate": "movedKinds", "tenants": [...], "kinds": [each prefix, one by one] } or { "predicate": "oldMailCounters", "partition": "SYSTEM" }, "authorizedKeys": [{ "pk", "sk", "sha256" }] }`. `authorizedKeys` is the `entries` list of an inventory that the human has classified |
| NDJSON export | `purge --execute`, `discard --execute` | one line per item: `{ "pk", "sk", "sha256", "item": <canonical form> }`. The canonical form is lossless (types kept, binary as base64), so the line is a full backup of the item. **`purge`: one line for EVERY candidate (every main-table key of the listed tenants and kinds), all written and flushed before the first delete — so the file can hold keys that were then refused, in the form the candidate read found. `discard`: one line per deleted item, written and flushed just before the delete of that item** (D9) |

`purge` accepts only a file whose `record` is the verification manifest: an inventory (keys of the source only,
nothing verified) is refused.

**The inventory, the manifest and the export hold keys, and a key of the kinds `CUSTOMER#<email>`,
`CUSTORDER#<email>#<orderId>` and `EMAILLIMIT#<email>` contains an email address. The export also holds the full
items. These files are personal data: keep them outside the repository, do not attach them to a slice record.**

### Reports

The standard report holds the time, the region, table names, tenant ids, PK, SK, hashes, attribute names, file paths
and counts. Three rules (`run.ts`, header):

1. **No line holds an attribute value.** Of a failure that came from outside the tool (AWS, the file system) the
   report prints the error's class name and short code only (`failureText`: `ConditionalCheckFailedException`,
   `Error ENOENT`), each only if it is one plain word — never the message, never the stack: such a text can quote an
   attribute value.
2. **The state of a table is reported only as the tool observed it.** When a Put or a Delete call fails, the report
   takes the outcome from a consistent read after it; when that read fails too, it says UNKNOWN.
3. **Once an export is open, its path, line count and SHA-256 are reported** at the end of every run the tool still
   controls, also after a failure — or the report says which of them is not available and why.

The last line is `RESULT: GREEN — …` (exit status 0) or `RESULT: NOT GREEN — …; exit status 1` and says in words why.

## Safety table (each row: the rule, and the test that proves it)

Test files: `backend/test/unit/cmrc-2a-canonical-item.test.ts` (C), `cmrc-2a-decisions.test.ts` (D),
`cmrc-2a-files.test.ts` (F), `cmrc-2a-tool.test.ts` (T), `cmrc-2a-tool-kinds.test.ts` (K). The names below are the
`it(…)` titles. "T both" = the test runs once for `purge` and once for `discard` (`describe.each`).

| # | Rule | Test |
|---|---|---|
| S1 | A mode that writes or deletes needs `--execute`; without it the mode prints the plan and changes nothing | T "migrate without --execute prints the plan and writes nothing"; T "purge without --execute deletes nothing and writes no export"; T "discard without --execute deletes nothing"; T "purge-plan refuses --execute"; D "purge-plan refuses --execute; discard-plan refuses --execute" |
| S2 | Both table names are required, must differ, and are in the report | D "refuses a missing table name"; D "refuses equal source and destination"; T "every report names both tables" |
| S3 | `purge` sends only reads to the destination; `discard` sends no command to it | T "purge --execute sends only reads to the destination table" (the double fails on a write); T "discard sends no command to the destination table; it writes the export line of each authorized item just before the delete of that item" (the double fails on any command) |
| S4 | The tenant allowlist is required **for every mode and selector that addresses tenant partitions**; a tenant outside it is never read | D "refuses a missing --tenants for the moved kinds"; T "a tenant that is not in the allowlist is never read" |
| S4x | **The one exception (operator ruling CMRC2A-SYSTEM-ALLOWLIST = A).** The selector `old-mail-counters` (`PK = SYSTEM`, `begins_with(SK, "EMAILLIMIT#")`) addresses items of no tenant: it takes NO tenant list and refuses one (an unused list would suggest a protection that does not exist). Its protections: the fixed predicate; the authorization record that names the partition `SYSTEM` and the predicate; the authorized key set with hashes (R.2 condition 4); the backup reference; the export | D "the old mail counters take no --tenants and exist only for plan and discard"; D "parseSelector: the two predicates and nothing else"; D "keyConditions: one tenant partition per allowlisted tenant and kind; the mail counters are one fixed condition"; T "SYSTEM partition: discard removes only the old mail counter" (every command named `PK = SYSTEM` and the fixed prefix; the record names the partition and the key with its hash) |
| S5a | **`purge`: the export of EVERY candidate is written and flushed before the first delete.** The report says exported N, deleted M, refused K with each reason; green only when K = 0 (then M = N). The per-key consistent reads and the verdict of § 6 stay, each just before that key's delete | T "purge writes and flushes the export of EVERY candidate before its first delete" (a refused candidate is in the export too); T "purge: source changed → refused" (exported 5, deleted 4, refused 1; not green); T "purge: destination updated after release → deleted; destination unchanged → deleted" (5, 5, 0; green) |
| S5b | **`discard`: the export line of an item is written and flushed before the delete of that item; green only when export lines = deleted items** | T "discard sends no command to the destination table; it writes the export line of each authorized item just before the delete of that item" (the order `export k`, `DeleteItem k` per key); T both "a delete call that fails and was NOT applied: …" (2 lines, 1 delete: not green, the summary says the counts are not equal) |
| S5c | An item is deleted only in the form the export holds | T "purge does not delete an item whose form at the read before the delete is not the form in the export" |
| S5d | **A line is on disk, whole, before the delete it guards (review-0 F01):** every UTF-8 byte is accepted before the flush; a write that accepts nothing, a write error or a flush error stops the run; no delete follows | F "a short write is repeated until every byte is accepted, then the file is flushed" (1, 2, 3, 5, 7 bytes per write; text with 2-, 3- and 4-byte characters); F "a write that accepts no byte stops with an error: the line is not reported as written, and nothing is flushed"; F "a write error in the middle of a line, and a flush error, both reach the caller"; F "createNew writes the whole text with short writes too, flushes and closes; it closes also when the write fails"; T both "an export line that cannot be written whole and flushed: no delete follows it" |
| S6 | **Failures of a delete (review-0 F03):** the report states the outcome only from a consistent read after the failed call — ABSENT (deleted), STILL IN THE SOURCE, or UNKNOWN; the run stops and is not green | T both "a delete call that fails and was NOT applied: a read after it finds the item, and the report says so"; T both "a delete call that fails AFTER it was applied (the answer was lost): the report says the item is absent, not that it is still there"; T both "a delete call that fails, and the read after it fails too: the outcome is reported as UNKNOWN" |
| S6b | **The export is finalized on every path (F03):** path, line count and SHA-256 are reported after any failure once the export is open, or the report says what is not available and why | T both "a read of the source that fails after one successful delete: the run stops and the export is still finalized"; T both "an export file that cannot be closed, or cannot be read back, makes the run not green and the report says which"; T both "an export file that cannot be created: nothing is deleted" |
| S6c | The same rule for a failed Put | T "a Put call that fails: its outcome is taken from a read after it — applied, not applied, or UNKNOWN" |
| S7 | `purge` needs the manifest, its SHA-256 (checked) and, to execute, a backup reference and an export path | D "purge needs the manifest and its SHA-256"; D "purge --execute needs a backup reference and an export path"; T "purge refuses a manifest whose SHA-256 differs"; T "purge refuses an inventory in place of a manifest"; T "purge refuses a manifest of other tables or tenants" |
| S8 | `discard` needs the authorization record and refuses when the record does not cover the request | T "discard refuses a record that does not cover the request" (another table, another predicate, a tenant or a kind the record does not name); D "authorization record: every field is required" |
| S9 | `discard` deletes only a key of the authorized set whose hash is unchanged | T "discard refuses a key that is not authorized and a key that changed" |
| S10 | `discard` accepts only the two predicates; no whole-partition delete | D "parseSelector: the two predicates and nothing else"; D "a kind list that would select a whole partition is refused"; T "SYSTEM partition: discard removes only the old mail counter" |
| S11 | `purge`: the four rows of § 6 | D the five tests under "purgeVerdict: the four rows"; T "purge: destination updated after release → deleted; destination unchanged → deleted" (one run: one destination item changed, four unchanged), T "purge: source changed → refused", T "purge: destination missing → refused", T "purge: key outside the manifest → refused" |
| S12 | `migrate` never overwrites: conditional Put; a destination item that differs is refused | T "a second migrate run after a destination item changed refuses that key and changes nothing"; T "a destination item that appears between the read and the Put is not overwritten" |
| S13 | `verify --strict` compares every attribute at every depth and writes the manifest only when nothing differs | C "two items that differ at any depth hash differently, and the differing attribute path is named"; T "verify --strict names the key and the attribute path of each difference and writes no manifest" |
| S13b | **`verify --post-cutover` claims what it establishes and no more (ruling CMRC2A-Q6-RELEASE-EVIDENCE = B):** EXACTLY the statements (1)-(3), one failure condition each and no other (review-1 F06); the destination keys that are not in the manifest are LISTED under that name, with their count in the last lines and the sentence that the tool cannot establish when they were created; no line says "written after" or "created after" | T "is green when the three statements hold; it LISTS the destination keys that are not in the manifest and says it cannot date them" (one such key carries a creation time of 2020: it is listed like the other, the run is green, and the last four lines are compared whole); T "a manifest key whose main-table item is absent is NOT a difference: the three statements hold and the run is green; each statement alone still fails (review-1 F06)"; T "names each difference with its statement: (1) a manifest key missing in the destination, (2) a main-table key outside the manifest, (3) a changed main-table item" (exactly three DIFFERENCE lines); D "names exactly three kinds of difference, one per statement"; D "a manifest key whose source item is absent breaks none of the three statements: no difference (review-1 F06)"; D "no difference when the source is exactly the manifest …; a destination key outside the manifest is LISTED, whatever creation time it carries" |
| S14 | Exit status 1 and a last line in words whenever a key was refused or a difference was found | asserted in every T test of a refusal or a difference; T "the last line says NOT GREEN with exit status 1 exactly when the exit status is 1" |
| S15 | The kinds come from `COMMERCE_PRIVATE_PREFIXES`; a new prefix there is followed with no edit of the tool | K "a fifth prefix in commerce-db.ts is copied and verified with no edit of the tool"; K "no file of the tool contains a commerce-private prefix as text" (five files) |
| S16 | **An output file is never inside the repository and never replaces a file (review-0 F02):** by path component in the arguments; by the REAL directory (links resolved) before the first table read and again at creation; for the inventory, the manifest and the export | D the eleven cases under "isInsideDirectory: by path component, not by text"; D "refuses an output path inside the repository" (`/repo/..private/…` for all three outputs, both deleting modes); D "names the inventory, the manifest and the export; a plan creates none"; F "refuses a path under the repository, also under a child whose name starts with two dots"; F "refuses a directory OUTSIDE the repository that is a link into it, and a repository reached through a link"; F "refuses a directory that does not exist, an existing file, and a repository root that cannot be resolved"; F "the same rule holds at the moment of creation, for all three kinds of output: nothing is opened"; F (real `node:fs`, temporary directory) "a link from outside into the repository, and a `..private` child, are refused; the real outside directory is accepted", "the tool refuses such a path before it reads a table, for the inventory, the manifest and the export", "`node:fs` is a FileSystem; a line appended is in the file; a second creation at the same path fails"; T "an existing export file is never overwritten"; T "a manifest file that exists is never replaced" |
| S17 | An unknown flag, or a flag that does not belong to the mode, is refused | D "refuses an unknown flag and a flag of another mode" |
| S18 | **The report prints no attribute value, also when a call fails (F03):** of an outside failure only the class name and short code, each only if one plain word | T "no report line contains an attribute value"; T "the text of an outside failure is never printed: its message, its stack, a name that is not one plain word"; T "failureText: the class name and the short code, each only if it is one plain word; never the message"; every failure test of S5d, S6, S6b, S6c injects an error whose message holds `VALUE-` and asserts that no line holds it |
| S19 | No Scan, no other command, no other expression, every read consistent | the double `cmrc-2a-raw-tables.ts` throws on any command or expression outside the four forms and on a read without `ConsistentRead`; every T test runs through it |
| S20 | A value the canonical form does not define stops the run before it decides anything | C the fifteen cases under "canonicalize: refused, never guessed"; T "an item with a value the canonical form does not define stops the run before any write" |
| S21 | More items than one page; a tenant with zero items | T "pagination: more items than one page are all read, copied, verified and purged"; T "a tenant with zero items: every mode is green and changes nothing" |
| S22 | **The key-form notice takes the COMPLETE email out of the key by the key's grammar (review-0 F04);** a key with `@` whose kind has no known form is reported as not checked | D "emailOfSortKey takes the COMPLETE email out of a key by its form, `#` included"; D "a key `<prefix><email>`: a normalization change before or after an embedded `#` is found"; D "a key `<prefix><email>#<id>`: the same, and the id after the last `#` is not part of the email"; D "a key with `@` whose kind has no known email form is reported as NOT CHECKED, never passed in silence"; T "the email forms of the tool are the key grammar of commerce-db.ts: the complete address comes back, `#` included"; T "a normalization change before or after a `#` inside the address is reported, for both key families and the mail counters (F04)" |
| S23 | **The operator's capture of a report keeps the exit status (review-1 F07):** the runbook's one capture form, the function `keep`, returns 0 only when the tool ended with 0 and the report was saved; a plain `\| tee` is forbidden in the runbook | Not a unit test (it is a shell function of the runbook): EXECUTED in bash and in zsh with the function text of the runbook, placeholder table names and no AWS call — a successful command → 0; a refused request → 1, and the saved report says `RESULT: NOT GREEN`; a report directory that does not exist → 1; a report write that fails in the middle → non-zero; an existing report file → 2, file unchanged; no command → 2; the contrast, the same refused request through a plain pipe to `tee` → 0 (§ *Build record*) |

**Controls (EXECUTED, § *Build record*).** Each rule was removed from the tool, one at a time, in a copy outside the
repository: 52 single changes — the 26 of the first build that still apply, 21 for the rules of revision 1 and 5
for revision 2 (a manifest key without a source item counted as a difference again; each of the three statements
left unchecked; green although a statement fails). The 21 of revision 1 (the
message of a failure printed; a failed delete assumed "still in the source"; no export finalization after a stop; a
failed export write ignored; a short write taken as whole; no progress taken as success; no flush; the directory not
resolved through links; the path compared by text prefix; each of the two email forms broken; the listed keys called
"written after the manifest"; a destination key outside the manifest counted as a difference; purge green with a
refusal; purge exporting item by item; and others). Every change made at least one test fail; the unchanged copy
passed. A `switch` that misses one variant of `PurgeVerdict` fails the strict type check (TS2366).

## Abstraction record

One line each: what it is — current users — axis of variation — simpler alternative rejected.

- **`canonicalize` / `differingPaths` (`canonical-item.ts`)** — the definition of item equality — inventory,
  manifest, `migrate`, both `verify` forms, `purge`, `discard`, the export (eight users) — the ten DynamoDB types
  are fixed, the users grow: a sum of types with an exhaustive `switch` — rejected: `isDeepStrictEqual` on
  document-client objects in each mode (no hash for the manifest; number precision lost).
- **Verdict sums (`decisions.ts`)** — pure functions from hashes and key sets to a verdict per key — the shell
  (`run.ts`) and the tests — the outcomes § 6 names are fixed, so a sum with an exhaustive `switch`; a new outcome
  must break every reader — rejected: `if` chains inside the I/O loops (the delete rules could then be tested only
  through I/O).
- **`Request` sum + `parseRequest`** — the arguments as one variant per mode — `run.ts` and the tests — the modes
  are fixed and each has its own required data — rejected: one flat record with optional fields (the existing
  shape; a `purge` without a manifest would then be a run-time check in the shell).
- **`Ports` (`run.ts`: `connect` → `send`, `now`, `files`, `out`)** — the I/O the shell needs — the entry file (real client,
  clock, file system, `console.log`) and the tests (in-memory doubles) — a documented boundary plus a test seam:
  the tests must not reach AWS or the disk — rejected: module-level client and `fs` calls (the existing shape; it
  cannot be tested without AWS).
- **`runDeletion` (`run.ts`)** — the loop "decide, export the line, delete, count" — `purge` and `discard` — two
  current callers with the same non-trivial ordering rule (export before delete, counts equal) — rejected: the loop
  written twice.
- **`FileSystem` port + `filesOn` (`files.ts`)** — the seven `node:fs` calls the tool's file rules need — the entry
  file (`node:fs`) and `cmrc-2a-files.test.ts` (a double with short writes and failures; `node:fs` in a temporary
  directory) — a test seam that cannot be had more simply: a short write and a failed flush cannot be produced on a
  real disk on demand — rejected: the file calls in the entry file (the first build; review-0 F01 found the write
  rule untested and wrong there).
- **`EmailKeyForm` + `emailOfSortKey` (`decisions.ts`)** — how a sort key holds an email — `noticesOf`; the forms
  are built in `run.ts` from `customerRef`, `customerOrderRef` and the mail-counter prefix — the two forms of the
  key grammar are fixed, a sum with an exhaustive `switch` — rejected: splitting the key on every `#` (the first
  build; review-0 F04).
- **`ExportRule` (`run.ts`)** — when the export is written — `purge` (every candidate first) and `discard` (each
  item before its delete), inside the one loop `runDeletion` — two fixed rules of § 6 — rejected: two deletion loops
  (the failure handling and the finalization would exist twice).
- **`outputFilesOf` (`decisions.ts`)** — the files a request would create — the check in `run` before the first
  table read — one exhaustive `switch` over the modes, so a new mode cannot have an output that is not checked —
  rejected: a check inside each mode function (the first build; one mode checked late).
- **The test double `RawTables` (`backend/test/unit/cmrc-2a-raw-tables.ts`)** — named in-memory tables for the raw
  command forms — the three tool test files — rejected: the existing `MemoryTable`: it is one table with no name
  (the tool needs two and the proof "no write to the destination"), it speaks the document-client commands, and its
  `put` copies through JSON, which would lose sets and binary values.

No registry, no plugin interface, no configuration layer was added.

## Deviations and local decisions

- **D1 — plain `--mode verify` is removed; `verify` needs `--strict` or `--post-cutover`.** The old mode compared
  key sets only under the name `verify`. A check that compares less than its name says is the exact risk of this
  slice. What it showed is still available: `plan` prints, per tenant and kind, the counts and how many keys are in
  one table only. Nothing else used the old mode (EXECUTED: `git grep -n "mode verify"` → only `--mode verify
  --strict` / `--post-cutover` examples in `docs/plan-commerce-private-table.md`).
- **D2 — `--allow-existing-destination` is removed.** Its purpose was to permit a second run. With conditional Puts
  and a verdict per key, a second run is always permitted and can never overwrite; a destination item that differs
  is refused by name. The flag is now an unknown flag (refused, S17).
- **D3 — `migrate` no longer ends with its own key-set check.** It ends with the verdict of every key. The content
  check is `verify --strict`, the next step of the runbook.
- **D4 — `verify --post-cutover` establishes three statements and lists the rest (operator ruling
  CMRC2A-Q6-RELEASE-EVIDENCE = B, 2026-11-28, after review-0).** The mode proves, and says it proves, exactly: (1)
  every manifest key exists in the commerce table; (2) the main table holds no key of a moved kind outside the
  manifest; (3) every main-table item still hashes to its manifest value. It LISTS the commerce-table keys that are
  not in the manifest under the name "destination keys not in the manifest": one report line per key
  (`DESTINATION KEY NOT IN THE MANIFEST: PK=… SK=…`) and their count in the last lines. It never calls them
  "written after the manifest" or "created after the release": **the tool cannot establish when such an item was
  created.** With (1)-(3) holding the result is green, and its last lines say how many such keys there are, that the
  tool cannot date them, and that the operator establishes it from the freeze record — the write freeze was on from
  before the manifest run P1 until the release deploy, and P2 showed every frozen writer refusing, so a key absent
  from the manifest can only have been written after the release. That operator check is BLOCKING for Q6
  (`docs/slices/cmrc-1.md` § 6, note of 2026-11-28). Rejected by the ruling: a `--release-time` input compared with
  `createdAt` — the order counter and the customer profile carry no creation time, so the check would cover some
  kinds and suggest all. (The first build said the tool proved "written after the manifest" by structure; review-0
  D01 showed that this was more than the tool can know. That text is removed everywhere.)
- **D5 — `verify --post-cutover` has exactly three failure conditions, one per ratified statement (review-1 F06).**
  Statements (2) and (3) speak of the items the main table HOLDS. A manifest key that has no main-table item breaks
  none of the three: the mode is green and reports no difference for it. The last line gives both counts ("each of
  the N manifest keys …", "each of the M source items …"), so the absence can be seen, and it is not judged. **Not
  checked by this mode, stated:** that every manifest key still has its main-table item. Before `cmrc-6` nothing
  should delete one; `purge-verify` is the mode that speaks about main-table items that are gone. (Revision 1 had a
  fourth condition here, `manifestKeyMissingInSource`, as the builder's reading of (3). The ruling ratifies three
  statements; the condition and its report line are removed, and `postCutoverFindings` is now one check per manifest
  key for (1) and one check per source item for (2) and (3).)
- **D6 — the selector `old-mail-counters` takes no `--tenants` and refuses one (operator ruling
  CMRC2A-SYSTEM-ALLOWLIST = A, 2026-11-28: a stated exception).** The old mail counters belong to no tenant: they
  are `PK = SYSTEM`, one per email address, for all tenants. An unused tenant list would suggest a protection that
  does not exist. The packet's rule now reads "the tenant allowlist is required for every mode and selector that
  addresses tenant partitions". The protections of this selector are listed in safety row S4x and in the help text.
- **D7 — the key-set-and-hash guard of Appendix R.2 applies to BOTH discard predicates**, also to the old mail
  counters. One rule and no special case: `discard` deletes only what the record lists with an unchanged hash.
- **D8 — the tool does not write into the authorization record.** § 6: "the export's line count and SHA-256 are
  written into the authorization record". The record is the human's signed statement; the tool prints the two
  values (`discard --execute` and `discard-verify`) and the runbook tells who writes them in.
- **D9 — when the export is written (operator ruling on review-0 F05, 2026-11-28).** `purge`: the export of EVERY
  candidate — every main-table key the run considers — is written and flushed before the first delete; then, per
  key, the consistent read, the verdict of § 6 and the delete. So a purge export can hold keys that were then
  refused, each in the form the candidate read found. The report says exported N, deleted M, refused K with each
  reason; green only when K = 0 (then M = N). `discard`: the line of an item is written and flushed just before the
  delete of that item, only for an item that is deleted; green only when export lines = deleted items. (The first
  build used the discard rule for both; § 6 asks more of purge.)
- **D10 — every read of the tool is a consistent read** (Query and GetItem). § 6 requires it just before a delete;
  one rule for all reads is simpler and costs only read capacity.
- **D11 — `purge-verify` is computed from the manifest**, not from the export: every manifest key of the listed
  tenants must be absent in the source and present in the destination; any key of a moved kind that remains in the
  source is reported. This is stronger than "every deleted key" and needs no second file.
- **D12 — a manifest must cover the request**: the same two table names, every requested tenant, and the same list
  of kinds as `COMMERCE_PRIVATE_PREFIXES` at the time of the run. Otherwise the request is refused before any read
  of a table. Without this rule, a manifest of staging used on production would refuse every key one by one.
- **D13 — a notice does not change the exit status.** `plan` reports GSI attributes, keys whose email is not in
  `normalizeEmail()` form, and keys with `@` whose form it cannot check, as `NOTICE` lines, and counts them in the
  last line. They are neither a refusal nor a
  difference; the copy is exact with or without them.
- **D14 — the argument names of the source plan are kept**: `--backup-ref`, `--export-path`
  (`docs/plan-commerce-private-table.md` § *Example Usage*).
- **D15 — the strict type check of the tool is a step of `npm run typecheck`.** No workspace covers `scripts/`.
  `scripts/commerce-private-table/tsconfig.json` (`strict`, `noEmit`) covers the entry file, the four tool files
  and the tool's test files; the root `typecheck` script runs it last. Without that step, the exhaustive `switch`
  statements would not be checked by any gate.
- **D16 — the key-form notice takes the complete email out of the key by the key's grammar (review-0 F04).** The
  grammar belongs to `backend/src/lib/commerce-db.ts`: a customer key is `<prefix><email>`, an index key is
  `<prefix><email>#<orderId>` with the order id after the LAST `#` (`orderIdOfCustomerOrder`). `run.ts` builds the
  two forms from `customerRef` and `customerOrderRef` (no prefix text of its own) and adds the old mail counter
  (`EMAILLIMIT#<email>`). The whole email is normalized at once, so a change before or after a `#` inside the
  address is found. A test proves the forms against keys those functions build. A sort key that contains `@` and
  fits no form gets its own notice ("its form was NOT checked"), so a later kind with an email in its key is never
  passed in silence. (The first build split the key on every `#` and checked only the part with `@`.)
- **D17 — "the detail file" of ruling CMRC2A-Q6-RELEASE-EVIDENCE is read as the report itself.** The ruling says the
  tool lists "(count, and keys in the detail file)". The tool writes one report; every key-level finding of every
  mode is a line of it, and the operator keeps the report in a file of `<out>` with the function `keep` of the
  runbook, which also keeps the exit status (review-1 F07; the reviewer confirmed that no separate key file is needed). So the
  count is in the last lines and the keys are report lines above them. **Open point for the operator** (not
  blocking the code): if a separate file is wanted (for example `--keys-out <file>`), it is one more output of
  `outputFilesOf` with the same path rules; it was not built because no other finding of the tool has its own file.
- **D18 — a Put call that fails for another reason than its condition stops the run**, after a consistent read that
  says whether the item is in the destination (equal, different, absent) or that this is UNKNOWN. A copy has no
  export to finalize; the next `migrate` run copies what is missing and never overwrites.
- **D19 — purge deletes an item only in the form the export holds.** The export is written from the candidate read;
  the delete follows a later consistent read. If the two forms differ and the later one still equals the manifest
  (the item changed and changed back in between), the verdict of § 6 is "delete", but the export would hold another
  form. The tool does not delete it and reports `NOT DELETED the item changed after it was exported`; the run is not
  green. This is not a fifth verdict of § 6: it is a rule of the export.

## Review-0: findings, classes and rules (revision 1, 2026-11-28)

Reviewer `gpt-6.1-sol`, verdict "escalate": five findings and two decisions. The operator accepted F01-F05 as
written and ruled on the two decisions (the packet, § "Operator rulings after review-0"). Each finding is closed as
a class, by one rule; the tests are the rows of the safety table.

| Finding | The class it is an instance of | The rule that closes the class | Where | Safety rows |
|---|---|---|---|---|
| **F01** — a short write let the export line count as written | A safety rule that lived in the one file no test runs (the entry file), so "the call returned" stood for "the effect happened" | **The entry file holds no rule.** Every rule about a file is in `files.ts`, over a file system that is passed in, and is tested: all bytes accepted, then flushed, before the call returns; no progress or any error stops the run; no delete follows a failed export write | `files.ts` (`writeAllAndFlush`); `run.ts` (`appendToExport`); the entry is wiring only | S5d |
| **F02** — `/repo/..private/x` passed as "outside the repository"; a link was not seen | Containment of a path decided on text, and on the path as written | **One function decides containment by path component (`isInsideDirectory`), and the file layer applies it to the REAL directory** (links resolved), before the first table read and again at creation, for every file the tool creates. `outputFilesOf` lists those files per mode in one exhaustive `switch` | `decisions.ts`; `files.ts` (`outputRefusal`); `run.ts` (`run`) | S16 |
| **F03** — an error message printed; "still in the source" said of an item that was gone; no export count after a failed read | The report said more than the tool knew, or less than it had done | **Three rules of the report** (§ *Reports*): only the name and code of an outside failure (`failureText`, the one place that turns an outside error into text; both top-level handlers use it); the state of a table only from a read (after a failed Put or Delete: a consistent read, else UNKNOWN); the export finalized on every path once it is open | `run.ts` (`failureText`, `runDeletion`, `migrate`, `run`, `runFromArgv`); the entry's rejection handler | S6, S6b, S6c, S18 |
| **F04** — `CUSTOMER#UPPER#x@y` got no notice | A check made by a heuristic over the key text instead of the key's grammar | **The email is taken out of a key by the form of its kind, built from the key functions of `commerce-db.ts`; the whole address is normalized at once; a key with `@` and no known form is reported as not checked** | `decisions.ts` (`emailOfSortKey`, `noticesOf`); `run.ts` (`EMAIL_KEY_FORMS`) | S22 |
| **F05** — purge exported and deleted key by key | § 6 asks more of purge than the packet's general rule; the first build took the weaker one for both branches | **`ExportRule`: purge exports every candidate before the first delete; discard exports each item before its delete** (operator ruling; D9). Plus D19: an item is deleted only in the form the export holds | `run.ts` (`runDeletion`) | S5a, S5b, S5c |
| **D01** → ruling CMRC2A-Q6-RELEASE-EVIDENCE = B | A claim about time that the tool has no evidence for | The mode states (1)-(3), lists the destination keys outside the manifest under that name, and says it cannot date them; the freeze record is the operator's blocking evidence (D4; the spec note) | `run.ts` (`verifyPostCutover`), `decisions.ts` (`postCutoverFindings`); `docs/slices/cmrc-1.md` § 6 | S13b |
| **D02** → ruling CMRC2A-SYSTEM-ALLOWLIST = A | A packet rule wider than the data it protects | The exception is stated: in the safety table (S4x), in the help text and in D6 | `run.ts` (`helpText`) | S4x |

### Review-1 (revision 2, 2026-11-28)

Verdict "revise": F01-F05 and both rulings confirmed closed; two new findings, no decision needed.

| Finding | The class it is an instance of | The rule that closes the class | Where | Safety rows |
|---|---|---|---|---|
| **F06** — `verify --post-cutover` failed for a manifest key whose main-table item was absent, although (1)-(3) held | A check added by the builder's reading of a ratified statement: the acceptance boundary of the tool was not the boundary of the ruling | **The differences of the mode are a sum with exactly one variant per ratified statement, and the function has one check per manifest key for (1) and one check per source item for (2) and (3).** A condition that is not one of the three cannot be expressed without a new variant, which the comment of the sum forbids and the tests would fail on. What the mode does not check is stated (D5) | `decisions.ts` (`PostCutoverDifference`, `postCutoverFindings`); `run.ts` (the report line and the last line with both counts) | S13b |
| **F07** — `cmrc … \| tee file` in the runbook returns the status of `tee` | An operator instruction that loses the signal the tool gives | **The runbook has one capture form, the function `keep`, which returns non-zero when the tool or the saving failed; every step command is written through it; a plain pipe to `tee` is forbidden in words** | § *Operator runbook* | S23 |

What the reviewer confirmed and this revision did not change: the core/shell split, the shared prefix list, the raw
DynamoDB form, the four command forms, the refusal of a changed destination item, the purge that keeps a changed
destination item, the discard that never touches the destination.

## Findings, not fixed

- **F-CMRC2A-AUDIT — to decide before `cmrc-4`.** Appendix R.1: the audit entries of order status and payment
  changes (`AUDIT#…` in the main table) hold the order id and a free-text note. How they are stored after the
  cutover is an open sub-decision; this tool does not copy, verify or delete `AUDIT#` items. Not designed here.
- **F-CMRC2A-STALE-COMMENT.** `backend/src/lib/commerce-db.ts:13-15` says the copy tool "keeps its own list of the
  prefixes … `cmrc-2` makes it import the list below". After this slice the tool imports the list. The comment is
  under `backend/src`, which this slice may not edit; one sentence there is stale until `cmrc-2b` or the operator
  corrects it. The same sentence in `backend/ARCHITECTURE.md` IS corrected by this slice.
- **F-CMRC2A-CLAUDE-MD.** CLAUDE.md Critical rule 10 says the copy tool "still writes these keys". The tool now
  holds no prefix text, and `npm run typecheck` has a ninth step that CLAUDE.md's comment ("all 8 workspaces") does
  not name. CLAUDE.md is governance and was not in the packet's list; proposed wording is in the build report.
- **F-CMRC2A-COUNTER-PREFIX.** The predicate `begins_with(SK, "COUNTER#ORDER")` (§ 6) would also match a key such
  as `COUNTER#ORDERS`. No such key is written today (EXECUTED: `grep -rln 'COUNTER#' backend/src renderer/src
  packages/*/src` → `commerce-db.ts` only). A later counter whose name starts with the same text would be copied,
  verified and purged with the order counter.
- **F-CMRC2A-GENERATED-MAP.** `scripts/migrate-commerce-private-table_ts_MAP.md` and `scripts/MAP.md` are generated
  by `rmap` ("do not hand-edit"). They describe the old file until the operator refreshes the index.

## Operator runbook

Run from the repository root, after `npm run build` (the tool loads `@amodx/shared` from `packages/shared/dist`).
The tool uses the AWS credentials of the shell; the region is `--region`, else `AWS_REGION`, else `eu-central-1`.
`<out>` is a directory OUTSIDE the repository (for example `~/cmrc-run/2026-11-28`); the tool refuses a path inside
the repository and refuses to replace a file that exists. The files in `<out>` contain keys with email addresses
and, for an export, full items: treat them as personal data. Every report starts with the mode, the time, the region,
both table names and the selection. A green run ends with `RESULT: GREEN — …` and exit status 0; any refusal or
difference ends with `RESULT: NOT GREEN — …; exit status 1`.

**Keep each report, and keep the exit status with it (review-1 F07).** The report is the detail of a run: it names
every key the run judged (D17), so it is personal data like the other files. Run every step through the function
`keep` below: it shows the report, saves it, and returns a status that is **0 only when the tool ended with 0 AND
the report was saved**. **Never write `cmrc … | tee file` by hand:** without `pipefail` the shell gives the status
of `tee`, which is 0 also when the tool refused a key (EXECUTED in bash and zsh, § *Build record*). `keep` does not
replace an existing report (status 2): each step has its own file name.

Staging names: source `AmodxTable-staging`, destination `AmodxCommerceTable-staging`, test shops `cm1-commerce`,
`cm1-catalog`, `cm1-content`. The common part of every command, written once (a shell function: it works in bash and
in zsh):

```bash
cmrc() { npm run migrate-commerce-private-table -- --source-table AmodxTable-staging --destination-table AmodxCommerceTable-staging "$@"; }
SHOPS=cm1-commerce,cm1-catalog,cm1-content

# keep <report file> <command …>: runs the command, shows its report and saves it.
# Status: the command's own status when the report was saved; non-zero when the command failed OR the report
# could not be written; 2 when the report file exists already or no command was given.
keep() {
  if [ "$#" -lt 2 ]; then echo "keep: usage: keep <report file> <command ...>" >&2; return 2; fi
  local report="$1"; shift
  if [ -e "$report" ]; then echo "keep: $report exists already; give a new name (a report is never replaced)" >&2; return 2; fi
  ( set -o pipefail; "$@" 2>&1 | tee "$report" )
}
```

After each step, read the last line of the report AND the status: `echo "status: $?"` directly after the command.
A step is passed only with `RESULT: GREEN` and status 0. In a script, stop at the first non-zero status
(`keep … || exit 1`); do not go on to a step with `--execute` after a status that is not 0.

| # | Step (staging: the operator) | Command | When all is well | Files |
|---|---|---|---|---|
| 0 | Help | `cmrc --help` | The modes, the kinds, the rules, the personal-data warning. No AWS call | none |
| 1 | Inventory | `keep <out>/1-plan.txt cmrc --mode plan --tenants $SHOPS --inventory-out <out>/inventory.json` | Per tenant and kind one line: `PK=TENANT#cm1-commerce kind <prefix>: source=<n> destination=0 only-in-source=<n> only-in-destination=0`. `NOTICE` lines, if any, name a key with a GSI attribute or a key that is not in normalized form. Last line: `RESULT: GREEN — plan: <n> source items, nothing written to a table, <k> notices (a notice does not change the exit status)` | `<out>/inventory.json` |
| 2 | Copy plan | `keep <out>/2-migrate-plan.txt cmrc --mode migrate --tenants $SHOPS` | One `WOULD COPY` line per key. Last line: `RESULT: GREEN — migrate (plan only, nothing written): <n> would be copied, 0 already present and equal, 0 refused` | none |
| 3 | Copy | `keep <out>/3-migrate.txt cmrc --mode migrate --tenants $SHOPS --execute` | One `COPIED` line per key. Last line: `RESULT: GREEN — migrate: <n> copied, 0 already present and equal, 0 refused` | none |
| 4 | Verify content | `keep <out>/4-verify-strict.txt cmrc --mode verify --strict --tenants $SHOPS --manifest-out <out>/manifest.json` | Three lines `Manifest:`, `Manifest entries:`, `Manifest SHA-256:`, then `RESULT: GREEN — verify --strict: <n> keys equal in both tables (every attribute, every depth), 0 differences; manifest written`. **Write the SHA-256 into the freeze record** | `<out>/manifest.json` |
| 5 | Copy again (idempotence) | `keep <out>/5-migrate-again.txt cmrc --mode migrate --tenants $SHOPS --execute` | One `EQUAL already present and equal, not written` line per key. `RESULT: GREEN — migrate: 0 copied, <n> already present and equal, 0 refused` | none |
| 6 | Purge plan | `keep <out>/6-purge-plan.txt cmrc --mode purge-plan --tenants $SHOPS --manifest <out>/manifest.json --manifest-sha256 <SHA-256 of step 4>` | One `WOULD DELETE` line per key. `RESULT: GREEN — purge (plan only, nothing deleted): <n> would be deleted, 0 refused` | none |
| 7 | Discard plan | `keep <out>/7-discard-plan.txt cmrc --mode discard-plan --tenants $SHOPS --authorization <out>/authorization.json` (the operator writes a synthetic record: § *Files*; `authorizedKeys` = the `entries` of step 1; `kinds` = the kinds the help prints) | One `WOULD DELETE` line per key. `RESULT: GREEN — discard (plan only, nothing deleted): <n> would be deleted, 0 refused` | none |
| 8 | Empty the destination again | by hand (the operator's own step; the tool has no mode that deletes from the destination) | — | — |

Each of the steps 1-7 also leaves its report in `<out>` (`1-plan.txt` … `7-discard-plan.txt`).

The staging run has synthetic items only. If a test shop holds no item of a moved kind, steps 1-7 are green with
`<n>` = 0; seed synthetic items first to see the per-key lines.

What a refusal looks like (examples of report lines; the key is always named):

```text
  REFUSED destination differs, not overwritten: PK=TENANT#cm1-commerce SK=<order key> attributes: ["status"] ["statusHistory",1]
  DIFFERENCE attribute differs: PK=TENANT#cm1-commerce SK=<order key> attributes: ["items",0,"quantity"]
  DIFFERENCE missing in destination: PK=TENANT#cm1-commerce SK=<customer key>
  REFUSED source changed after verification: PK=TENANT#cm1-commerce SK=<order key>
  REFUSED not authorized (the key is not in the authorized set): PK=TENANT#cm1-commerce SK=<order key>
RESULT: NOT GREEN — migrate: 3 copied, 0 already present and equal, 1 refused; exit status 1
```

A request the tool refuses (wrong arguments, a manifest or record that does not fit, an output file that exists or
whose real directory is inside the repository) prints `REFUSED REQUEST: <reason>` for each reason, then `RESULT: NOT
GREEN — the request was refused; no table was read, nothing was written or deleted; exit status 1`.

A run that cannot go on prints what it knows and no more:

```text
ABORTED: a call failed (ProvisionedThroughputExceededException)
  DELETE CALL FAILED the delete call of PK=… SK=… failed (TimeoutError); a consistent read after it finds the item ABSENT: it was deleted
  DELETE CALL FAILED the delete call of PK=… SK=… failed (TimeoutError) and the read after it failed too: whether the item was deleted is UNKNOWN
  STOPPED the export line of PK=… SK=… could not be written whole and flushed (IncompleteWrite); no item is deleted after this
Export lines:      NOT AVAILABLE: the export file could not be read back (Error ENOENT); the tool wrote 5 lines
```

Only the name and the short code of an AWS or file error are printed, never its message. After `UNKNOWN`, read the
item by hand before any further step. After any stop in `purge` or `discard`, the export lines (path, count,
SHA-256) are still printed; the `DELETED` lines above say what was deleted.

**Steps that exist only in the later slices** (`cmrc-3` … `cmrc-6`). On staging: the operator. **On production:
every step of BOTH tables is the human's** — with the production table names in the `cmrc` function, and a mode with
`--execute` only after its plan mode was read.

| Step | Command | Notes |
|---|---|---|
| P1 / Q6, after the cutover | `keep <out>/post-cutover.txt cmrc --mode verify --post-cutover --tenants $SHOPS --manifest <out>/manifest.json --manifest-sha256 <sha>` | Green means exactly: (1) every manifest key is in the commerce table; (2) the main table holds no key of a moved kind outside the manifest; (3) every item the main table holds hashes to its manifest value. Nothing else is checked: a manifest key that has no main-table item breaks none of the three and is not reported; the last line gives both counts (manifest keys, main-table items) (D5). The commerce-table keys that are not in the manifest are listed (`DESTINATION KEY NOT IN THE MANIFEST: …`) and counted in the last lines. **The tool cannot say when they were created. BLOCKING operator check for Q6: the freeze record shows that the write freeze was on from before the manifest run P1 until the release deploy, and that P2 showed every frozen writer refusing** — only then can a key absent from the manifest have been written only after the release (D4) |
| Purge (verified copy) | `keep <out>/purge.txt cmrc --mode purge --tenants $SHOPS --manifest <out>/manifest.json --manifest-sha256 <sha> --backup-ref "<backup ARN, or PITR + exact UTC time>" --export-path <out>/purge-export.ndjson --execute` | Take the backup first. The run first writes the export of EVERY candidate (`EXPORTED <n> candidates, written and flushed before the first delete`), then judges and deletes key by key. Green last line: `RESULT: GREEN — purge: exported <n> of <n> candidates before the first delete, deleted <n> from <table>, 0 refused`. The report ends with the export's path, line count and SHA-256 — also when the run stops early. A refused key stays in the table (it is in the export too) and is a defect to investigate; never repair it by copying source over destination |
| Purge check | `keep <out>/purge-verify.txt cmrc --mode purge-verify --tenants $SHOPS --manifest <out>/manifest.json --manifest-sha256 <sha>` | Green: no key of a moved kind remains in the main table; every manifest key is in the commerce table |
| Inventory of the old mail counters | `keep <out>/mail-plan.txt cmrc --mode plan --selector old-mail-counters --inventory-out <out>/mail-inventory.json` | No `--tenants`: the partition is `SYSTEM` |
| Discard (authorized loss) | `keep <out>/discard.txt cmrc --mode discard [--tenants $SHOPS or --selector old-mail-counters] --authorization <out>/authorization.json --backup-ref "<…>" --export-path <out>/discard-export.ndjson --execute` | The human writes and signs the authorization record. Run `discard-plan` first. The export line of an item is written just before its delete. Green: `RESULT: GREEN — discard: <n> deleted from <table>, <n> export lines, 0 refused`. `--selector old-mail-counters` takes no `--tenants` (the stated exception, S4x) |
| Discard check | `keep <out>/discard-verify.txt cmrc --mode discard-verify [--tenants $SHOPS or --selector old-mail-counters] --export-path <out>/discard-export.ndjson` | Green: no item of the predicate remains. It prints the export's line count and SHA-256; **the human writes both into the authorization record** |

## Migration / deployment notes

- Nothing to deploy. No runtime file changes. The tool runs on the operator's machine with the operator's AWS
  credentials.
- IAM the operator's identity needs (NOT RUN): `dynamodb:Query` and `dynamodb:GetItem` on both tables;
  `dynamodb:PutItem` on the destination (`migrate --execute`); `dynamodb:DeleteItem` on the source (`purge` and
  `discard` with `--execute`).
- Rollback of the slice: revert the commit. Rollback of a tool RUN: a copy is removed by emptying the destination
  (inert before `cmrc-4`); a purge or discard is restored from the backup reference or the NDJSON export.

## Definition of Done

- [x] The slice document exists with the findings on the existing tool.
- [x] The canonical form and hash are one function, defined and tested.
- [x] Every verdict variant has a test in which its key is named in the output.
- [x] Every row of the safety table has a passing test.
- [x] Every test § 6 lists by name exists (purge: five; the coexistence test of the `SYSTEM` partition; "no command
      ever targets the destination table except reads").
- [x] `npm run build`, `npm run typecheck` (with the tool's strict step), `npm --prefix backend run test:unit`,
      `git diff --check` pass.
- [ ] The operator's staging run (runbook steps 0-8). NOT RUN by the builder.

## Evidence required

- EXECUTED by the builder: the four gates (§ *Build record*).
- NOT RUN by the builder, the operator's: the staging run. It is the first proof against DynamoDB of: the four
  command forms, `ConsistentRead` on the Queries, the error name `ConditionalCheckFailedException` on a conditional
  Put, the number texts DynamoDB returns, and the size of a real partition.

## Exit criterion

`cmrc-2b` (the write freeze) can be built, and after it `cmrc-3` can run on staging with this tool.

## Build record (2026-11-28, builder `claude-fable-5-2`; revision 2 after review-1)

**Files** (21 candidate paths; revision 1 added `files.ts` and `cmrc-2a-files.test.ts`).

| Path | What it is |
|---|---|
| `scripts/migrate-commerce-private-table.ts` | Rewritten: the entry (51 lines). It connects the real client, the clock, `node:fs` and standard output, and holds no rule |
| `scripts/commerce-private-table/canonical-item.ts` | New, pure: `canonicalize`, `canonicalJson`, `sha256Hex`, `differingPaths` |
| `scripts/commerce-private-table/decisions.ts` | New, pure: the verdict sums, the selector, the manifest and authorization records, the email key forms, the path rule, `outputFilesOf`, `parseRequest` |
| `scripts/commerce-private-table/run.ts` | New, the shell for the tables: the four command forms, the report and its three rules, `runDeletion`, `runFromArgv` |
| `scripts/commerce-private-table/files.ts` | New (revision 1), the shell for the files, over a file system that is passed in: whole line then flush; real directory outside the repository; exclusive creation |
| `scripts/commerce-private-table/tsconfig.json` | New: the strict type check of the tool and of its test files (`noEmit`) |
| `package.json` | `typecheck` ends with the new script `typecheck:commerce-private-table-tool` (D15). No dependency added, the lock file is unchanged |
| `backend/test/unit/cmrc-2a-raw-tables.ts` | New: the in-memory doubles (named tables with hooks before a command and after an applied write; files with failure knobs) and the test harness |
| `backend/test/unit/cmrc-2a-canonical-item.test.ts` | New: 24 tests |
| `backend/test/unit/cmrc-2a-decisions.test.ts` | New: 54 tests |
| `backend/test/unit/cmrc-2a-files.test.ts` | New (revision 1): 11 tests |
| `backend/test/unit/cmrc-2a-tool.test.ts` | New: 62 tests |
| `backend/test/unit/cmrc-2a-tool-kinds.test.ts` | New: 2 tests |
| Documents | this file; `docs/slices/cmrc-1.md` (build status, fourth line; the dated note under Q6 in § 6), `docs/plan-commerce-private-table.md` (status), `backend/ARCHITECTURE.md` (three places and the test list), `scripts/README.md`, `docs/ROADMAP.md` (rows `cmrc-2`, `cmrc-2a`, `cmrc-2b`), `CURRENT_SLICE.md`, `docs/TECH-DEBT.md` (§ *CMRC-2A residuals*) |

No file under `backend/src`, `renderer/`, `infra/`, `packages/`, `admin/` or `tools/` is changed (EXECUTED: `git status
--short`).

**How the unit suite reaches the tool.** The tool is outside `backend/`. The five test files import it by relative
path (`../../../scripts/commerce-private-table/…`); `backend/vitest.unit.config.ts` includes `test/unit/**/*.test.ts`,
so `npm --prefix backend run test:unit` runs them with no change of configuration. `cmrc-2a-files.test.ts` creates
one directory `CMRC-2A-files-*` under the system temporary directory and removes it.

**How the tool is type-checked.** `backend`'s `tsc` covers `backend/src` only, and no workspace covers `scripts/`.
`npm run typecheck` ends with `tsc -p scripts/commerce-private-table/tsconfig.json` (`strict`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noEmit`), which covers the entry, the four tool files and the six `cmrc-2a-*` files of
the tests. A `switch` over a verdict sum with a missing arm is an error there (control of the first build:
`error TS2366` for a `PurgeVerdict` switch with one variant missing).

**Gates** (each EXECUTED on the final code of revision 2, from the repository root; exit status given bare).

| # | Command | Exit | Observed |
|---|---|---|---|
| G1 | `npm run build` | 0 | all eight workspaces built; no tracked file changed by the build |
| G2 | `npm run typecheck` | 0 | the eight workspaces, then `typecheck:commerce-private-table-tool` |
| G3 | `npm --prefix backend run test:unit` | 0 | 106 files passed, 3 skipped; 2897 tests passed, 3 skipped. The five new files: 153 tests (24 + 54 + 11 + 62 + 2) |
| G4 | `git add -N <the new files>` then `git diff --check`, both with `GIT_INDEX_FILE` set to a temporary copy of the index (deleted after), so the real index was never changed and needs no restore | 0 | no output |

**Controls** (EXECUTED).

- **Mutation controls, revision 1.** The tool, its tests and what they import were copied to
  `/tmp/CMRC-2A-mutation-r1` (deleted afterwards; the working tree was never changed for a control). One rule at a
  time was removed from the copy and the five test files were run: **47 changes, each made 1 to 56 tests fail, none
  passed unnoticed; the unchanged copy passed (151).** 26 are the changes of the first build that still apply. 21
  are the rules of this revision: the message of an outside failure printed (F03); a failed delete assumed "still
  in the source" without a read (F03); no export finalization after a stop (F03); a failed export write ignored
  (F01, F03); an item deleted in a form the export does not hold; a short write taken as whole (F01); a write with
  no progress taken as success (F01); no flush (F01); the directory not resolved through links (F02); the path
  compared by text prefix (F02); "only the part after the last `#` is the email" and "the email ends at the first
  `#`" (F04); the listed keys called "written after the manifest" (Q6); a destination key outside the manifest
  counted as a difference (Q6); purge green although a key was refused (F05); purge exporting item by item (F05);
  a failed Put reported without looking at the read; a key with `@` of an unknown kind passed in silence; the
  manifest output missing from the list of files to check; the creation itself not checking the path; the export
  close failure ignored; an export that cannot be read back accepted.
- **Mutation controls, revision 2** (`/tmp/CMRC-2A-mutation-r2`, deleted afterwards): 5 changes to the post-cutover
  check — a manifest key without a source item counted as a difference again (F06); statement (1), (2), (3) each
  left unchecked; the run green although a statement fails. Each made 2 to 4 tests fail; the unchanged copy passed
  (153). The 47 controls of revision 1 were not run again: of the code they change, only `postCutoverFindings`, its
  report line and its last line were edited in revision 2, and those are covered by the 5.
- **The report capture of the runbook (review-1 F07), EXECUTED in bash and in zsh** with the function text of the
  runbook, in `/tmp/CMRC-2A-capture` (deleted afterwards), with placeholder table names `X` and `Y` — no AWS call,
  because every command was `--help` or a request refused before any read:

  | Case | bash | zsh |
  |---|---|---|
  | `keep <file> cmrc --help` (a successful command) | status 0; the file holds the help | status 0; the same |
  | `keep <file> cmrc --mode plan` (refused: no `--tenants`) | status 1; the file holds `RESULT: NOT GREEN` | status 1; the same |
  | `keep <no such directory>/x.txt cmrc --help` (the report cannot be written; the command itself is green) | status 1 | status 1 |
  | the pipeline of `keep` with a `tee` limited to 512 bytes (the report write fails in the middle) | status 153 | status 153 |
  | `keep <existing file> …` | status 2; the file is unchanged | status 2; the same |
  | `keep <file>` with no command | status 2 | status 2 |
  | CONTRAST: `cmrc --mode plan 2>&1 \| tee <file>` (the instruction of revision 1) | **status 0** | **status 0** |
- **The reviewer's counterexample of review-1, now a test:** both manifest keys in the destination, one source item
  absent, the other unchanged, no source key outside the manifest → green (D "a manifest key whose source item is
  absent breaks none of the three statements …"; T "a manifest key whose main-table item is absent is NOT a
  difference …", which also shows (1), (2) and (3) each failing from that same state).
- **The reviewer's counterexamples of review-0, each now a test:** three bytes accepted by a write (F "a short
  write is repeated …"); `/repo/..private/items.json` and `.ndjson` for inventory, manifest and export (D "refuses
  an output path inside the repository"); `ABORTED: Error: VALUE-synthetic-private-note` (T "the text of an outside
  failure is never printed …"); a delete applied and then `TimeoutError` (T both "a delete call that fails AFTER it
  was applied …"); a source read failing after one delete (T both "a read of the source that fails after one
  successful delete …"); `CUSTOMER#UPPER#synthetic@example.invalid` (D and T of S22); `export A → delete A → export
  B` for purge (T "purge writes and flushes the export of EVERY candidate before its first delete"); a destination
  order with an old `createdAt` (T "is green when the three statements hold; it LISTS …").
- **The tool runs under `tsx`.** `npx tsx scripts/migrate-commerce-private-table.ts --help` → exit 0, the help text
  with the exception of the mail counters and the three statements of `verify --post-cutover`; `… --mode plan
  --source-table X --destination-table Y --tenants a --inventory-out <repository>/..private-x.json` → `REFUSED
  REQUEST: --inventory-out is inside the repository …`, exit 1, no file created. Neither makes an AWS call (the
  client is created only after a request is accepted).

**Test runs that failed on the way.** First build: 5 of 42 tool tests failed on their first run, all wrong
assumptions of the tests. Revision 1: every new and changed test passed on its first run; for that reason the 21 new
mutation controls above were run — each new test fails when its rule is removed. Revision 2: the new tool test
failed once — its own filter for `DIFFERENCE` lines also matched the last line of the report; the filter was
corrected, the tool was not changed for it.

**NOT RUN.** Any AWS call. The staging run (runbook steps 0-8): the operator's. `cd backend && npm test` (it uses the
staging table; forbidden by the packet). `tools/mcp-server` tests: no backend route changed (the reviewer ran them
in review-0: route coverage passed, 23 of 23 shape tests passed).

**No end-to-end coverage exists for this tool** besides the unit tests: the tables are an in-memory double, the
file rules are tested on a double and on `node:fs` in a temporary directory, and the entry file (the wiring) is run
by no test. The first run against DynamoDB is the operator's staging run, on synthetic items. § *Evidence required*
lists what that run proves for the first time.

**Assumptions.**

- DynamoDB returns one text for one number (INFERRED). If not, the tool refuses; it cannot report a false equality.
- A consistent Query on the base table and `ConditionalCheckFailedException` as the error name of a refused
  conditional Put behave as the AWS SDK documents them (INFERRED; NOT RUN against AWS).
- An AWS SDK error and a Node file-system error carry a class name or a short code that is one plain word
  (INFERRED from the SDK and Node conventions). If one does not, the report says "a failure with no printable name";
  it never falls back to the message.
- `fsync` on the export file makes the line durable on the operator's disk (the operating system's contract; the
  tool cannot verify it). The export directory is a local directory of the operator.
- Attribute NAMES of commerce items are schema names, not personal data (OBSERVED in the writers); the report prints
  names in attribute paths.
- `tsc` is in the root `node_modules/.bin` because every workspace depends on `typescript`; the root `package.json`
  does not list it.

**Self-review (what was removed or not added).** No `--kinds` flag (a run always covers every kind of the shared
list). No reverse copy mode (the rollback across the boundary of § 6 is `cmrc-4`'s decision). No release-time input
for `verify --post-cutover` (rejected by the ruling). No separate key file for that mode (D17). No fourth condition
in that mode and no notice in its place (D5): the two counts of the last line are enough to see an absent
main-table item. No `--report-out` flag in the tool: the capture is the shell function `keep` of the runbook. No restore mode for
the export. The request refusals of the argument parser are text, not a sum: nothing reads them but the report. The
count rule of discard ("export lines = deleted items") is kept as the ruling states it, although with the stop rule
a run that breaks it is already not green for another reason.

## References

- `docs/slices/cmrc-1.md` § 2.3, § 2.4, § 6, § 10.2 D2, Appendix R.1, R.2.
- `docs/plan-commerce-private-table.md` § *Migration Script*, § *Safety Rules*.
- `docs/platform-decisions.md` PD-001 (email normalization), PD-002.
- `docs/slices/cmrc-1a.md`, `cmrc-1b.md`, `cmrc-1l.md`.
- `docs/slices/fnd-2-normalize-email-callsites.md` (F-FND2-1).

## Closeout (operator, 2026-11-28)

- Relay: builder `claude-fable-5-2`, reviewer `gpt-6.1-sol`, three cycles; review-0 `escalate` (F01–F05 and two
  decisions), operator rulings CMRC2A-Q6-RELEASE-EVIDENCE = B and CMRC2A-SYSTEM-ALLOWLIST = A, review-1 `revise`
  (F06, F07), review-2 `approved`.
- Operator gates on the approved tree, each exit 0: build, typecheck (with the tool's strict typecheck), shared,
  plugins, renderer, serving, serving-bundle, admin unit, backend unit, infra, mcp, `git diff --check`; no change
  under `backend/src`, `infra`, `renderer`, `admin`, `packages`, `tools` or a lockfile. The root `package.json`
  changes in its `typecheck` scripts only (no dependency).
- No deployment: nothing at run time changes.
- Operator staging run, READ-ONLY modes only (2026-11-28, `AmodxTable-staging` → `AmodxCommerceTable-staging`, the
  three test shops, three synthetic items of `cm1-commerce` seeded in the main staging table and deleted after):
  - `--help`: exit 0, no AWS call;
  - `plan` with `--inventory-out`: exit 0, GREEN; per tenant and kind one line; `source=1 destination=0` for the
    three seeded kinds; an inventory of 3 entries;
  - `migrate` without `--execute`: exit 0, GREEN, three `WOULD COPY` lines naming the three keys, nothing written;
  - `plan --selector old-mail-counters`: exit 0, GREEN, 0 source items on staging;
  - the same table given as source and destination: `REFUSED REQUEST`, exit 1, no table read;
  - after the run: the three seeds deleted; `AmodxCommerceTable-staging` holds 0 items.
- NOT RUN on staging: every mode that WRITES the commerce staging table or deletes (`migrate --execute`,
  `verify --strict` on copied items, the second `migrate`, `purge-plan` / `discard-plan` on a copy). The human's
  standing rule names the two staging tables the operator may write; the commerce staging table is not one of them,
  and the human was asked ("commerce staging table ok"). Until then the copy, the content verification and the two
  removal branches are proven by the unit tests only (in-memory tables). The first real copy is `cmrc-3` on staging.
