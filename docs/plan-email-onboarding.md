> **RATIFIED 2026-08-01 (human).** All six decisions D-EMAIL-1..6 are ratified in their
> CONVERGED form — the corrected recommendation cells from the decision-review packet
> (`.agent-manager/slices/EMAIL-1/ratification-packet.md`, all-converged, 4 concessions /
> 2 agreements) are the binding text where they amend the sections below:
> D1 per-tenant sending as target ONLY WITH the sender-identity lifecycle (dedicated
> `sendFromDomain` + verification states, never derived from routing `domain`);
> D2 inbound = gated ask-only delegated-subdomain archive, apex MX/mailboxes/forwarding
> permanently rejected; D3 neutral provider recipes; D4 read-only DNS checker only;
> D5 SES-Tenants deferred with recorded trigger (tenant-level suppression/metrics/
> enforcement need → v2 migration; shared identity acceptable; per-tenant fee noted);
> D6 roadmap order unchanged, conditional `email-2a` slice, ship-now hotfix = From
> DISPLAY NAME only, Reply-To deferred until an explicit reply-address contract exists.


> **F-EMAIL-12 CORRECTED (human, 2026-08-16):** `mocheta.com` / `crm@mocheta.com` are NOT
> a foreign workload — they belong to a separate CRM app of the SAME business (a tenant
> of the business, not of amodx; potential future amodx integration). The shared SES
> account is deliberate and treated as internal. What remains true and worth knowing:
> both apps share one account-level suppression list, one reputation, and one quota —
> a deliverability incident in either affects both. The "separate AWS account" open
> question is DOWNGRADED from a risk item to a scaling option, revisit only if the two
> workloads' sending volumes ever conflict.
>
> **email-2a DEFERRED-UNTIL-NEEDED (human, 2026-08-16):** no current tenant has their
> own sending domain or needs a Reply-To. email-2a implements when the FIRST commerce
> tenant with their own domain wants branded sending — that request IS the trigger. The
> enablement procedure is documented NOW in `docs/runbooks/enable-branded-email.md`.

# Domain-Email Onboarding Plan (Track EMAIL)

## Status

- **Discovery plan — doc only.** No implementation, no `infra/` changes, no AWS mutations.
- Track: `EMAIL` (`docs/ROADMAP.md` § *Backlog / Discovery Tracks*). NOT an active slice.
- Source of the problem statement: human notes, 2026-07-30.
- Audit evidence: `EXECUTED` 2026-07-30 against the live prod AWS account `324037297014`,
  read-only SES / WorkMail / CloudWatch / DNS inspection in `eu-central-1` and the three
  WorkMail regions, plus `git grep` over the working tree. Every claim below carries a
  label; `INFERRED` and `NOT VERIFIED` claims are marked as such and nothing downstream
  depends on one.
- **Writable surface of `email-1`:** this document plus the `docs/ROADMAP.md` EMAIL row.
  Nothing else — no code, no `infra/`, no adjacent debt tracking. Items that belong in
  `docs/TECH-DEBT.md` are listed in § 9 as a follow-up action, not written by this slice.
- **Phase numbering is the ratified ROADMAP row, unchanged** (`email-1`..`email-5`). One
  addition is proposed and left deliberately unnumbered (§ 4.4); no ratified phase moves.
- Current maturity of the email path: **PROTOTYPE.** It is one hardcoded platform sender
  with no per-tenant identity, no DMARC, no bounce visibility, and no CDK declaration.
- Target maturity of the *track*: onboarding + deliverability surface at MATURE. AmodX
  never becomes a mailbox host — see § *Non-Goals*.

**This document does not decide anything.** It records what exists, verifies the two
external claims the human's notes depend on, proposes phase boundaries, and raises six
ratification-class decisions (one with a sub-decision). Six `DECISION_REQUIRED` blocks are
collected in § 6.

---

## 1. Problem

WordPress/cPanel clients get mailboxes as a byproduct of hosting: mailboxes, aliases,
forwarding, IMAP/SMTP, webmail, and the DNS to make all of it work are provisioned by the
control panel. AmodX provides none of that. AmodX only **sends** transactional mail from a
verified SES identity.

This is real migration friction, and it is commercial, not technical: the client's daily
workflow (`office@`, `orders@`, forwarding rules, a webmail bookmark) is built around the
thing we are asking them to leave. "Your website moves but your email breaks" loses the
deal regardless of how good the CMS is.

The product answer is **not** running a mail server. It is:

1. guided onboarding onto an external mailbox provider,
2. DNS + deliverability management that AmodX can *see* and *diagnose*,
3. optionally, SES inbound aliases for machine mail (forms, orders) — gated, see D-EMAIL-2,
4. a migration checklist that makes the cutover a procedure rather than an improvisation.

---

## 2. Current-state audit

### 2.1 Sending topology (`OBSERVED`)

There is exactly one sender identity for the entire multi-tenant deployment.

```
amodx.config.json         : "sesEmail": "contact@bijuterie.software"
amodx.staging.json        : "sesEmail": "contact@bijuterie.software"   <-- same value
infra/lib/amodx-stack.ts:158
    const sesEmail = props.config.sesEmail || "contact@bijuterie.software";
```

`EXECUTED`: `node -e "console.log(require('./amodx.config.json').sesEmail)"` → `contact@bijuterie.software`.
Same for `amodx.staging.json`.

That one value is fanned out to every construct that sends mail (`OBSERVED`,
`infra/lib/amodx-stack.ts:165, 213, 241, 257`) and lands in Lambda environment as
`SES_FROM_EMAIL` (`infra/lib/api.ts`, `api-commerce.ts:189`, `api-engagement.ts:192`).

Six send sites, all reading that one env var (`EXECUTED`,
`grep -rn "client-ses\|SendEmailCommand\|SES_FROM_EMAIL" backend/src renderer/src`):

| Send site | `Source` | `ReplyToAddresses` |
|---|---|---|
| `backend/src/contact/send.ts:79` | `FROM_EMAIL` | submitter's email ✔ |
| `backend/src/forms/public-submit.ts:142` | `FROM_EMAIL` | submitter's email ✔ |
| `backend/src/users/invite.ts:82` | `SES_FROM_EMAIL` | none |
| `backend/src/orders/create.ts:476` (to customer) | `FROM_EMAIL` | **none** |
| `backend/src/orders/create.ts:506` (to tenant staff) | `FROM_EMAIL` | none |
| `backend/src/orders/update-status.ts:144, 160` | `FROM_EMAIL` | **none** |
| `backend/src/webhooks/paddle.ts:118` | `FROM_EMAIL` | none |

A seventh sender exists outside that env var: Cognito is wired to send admin invites
through the same SES identity (`OBSERVED`, `infra/lib/auth.ts:65-70`,
`cognito.UserPoolEmail.withSES({ fromEmail: sesEmail, sesRegion })`).

There is **no per-tenant sender field anywhere in the schema** (`EXECUTED`,
`grep -n "fromEmail\|senderEmail\|replyTo\|contactEmail\|notifyEmail" packages/shared/src/index.ts`).
The three matches are all *recipients*:

- `TenantConfig.integrations.contactEmail` (line 389) — where contact-form and order
  notifications are **delivered**,
- `FormDefinition.notifyEmail` (line 1312) — same,
- and `orderProcessingEmail`, consumed at `backend/src/orders/create.ts:433-434`.

The name `contactEmail` is a recipient address, not a sender. It reads as though it could
be the tenant's public-facing "from" address; it is not, and nothing today can make it one.

### 2.2 SES account state (`EXECUTED` 2026-07-30)

```
aws sesv2 get-account --region eu-central-1
```

| Property | Value | Note |
|---|---|---|
| `ProductionAccessEnabled` | `true` | out of sandbox |
| `EnforcementStatus` | `HEALTHY` | not paused / under review |
| `SendQuota.Max24HourSend` | `50000` | |
| `SendQuota.MaxSendRate` | `14.0` /s | |
| `SentLast24Hours` | `0.0` | |
| `Details.MailType` | `TRANSACTIONAL` | |
| `Details.WebsiteURL` | `https://staging.dnxa642oddwmy.amplifyapp.com` | **not an AmodX URL** |
| `Details.ReviewDetails.Status` | `GRANTED` (case `173800261100447`) | |
| `SuppressionAttributes.SuppressedReasons` | `[BOUNCE, COMPLAINT]` | account-level suppression is ON |

Actual volume over the last 30 days (`EXECUTED`, `aws cloudwatch get-metric-statistics
--namespace AWS/SES --metric-name {Send,Delivery,Bounce,Complaint,Reject} --start-time
2026-06-30 --end-time 2026-07-30 --period 2592000 --statistics Sum`):

```
Send       2.0
Delivery   2.0
Bounce     None
Complaint  None
Reject     None
```

**Two sends in thirty days, account-wide.** Read this carefully: it means the findings
below are *latent*, not actively burning — and equally that there is no operational signal
that would tell us if the email path broke tomorrow. Nobody would notice.

`account-wide` is load-bearing and is the only form this number may be quoted in, because
the figure **cannot** be attributed to AmodX. `EXECUTED`, `aws cloudwatch list-metrics
--namespace AWS/SES --region eu-central-1` returns exactly two metrics — `Send` and
`Delivery` — each with `"Dimensions": []`. The SES data reaching CloudWatch carries no
identity, tenant, or configuration-set dimension, and none can appear while zero
configuration sets exist (§ 2.3); the `Sum: 2.0` above came from an undimensioned query and
is therefore an account total by construction. So **AmodX's own share of those 2 sends is
`NOT OBSERVED`** and is not obtainable from current telemetry. What the figure does license
is an **upper bound**: AmodX sent *at most* 2 messages in the window. Every later use of
"2 sends / 30 days" in this document (§ 2.8 severity discounting, F-EMAIL-11, D-EMAIL-5)
uses it only as that upper bound — as a reason a defect is *latent* or a signal is weak —
never as a measurement of AmodX traffic. Closing the attribution gap is itself part of the
`email-obs` scope (§ 4.4): a configuration set with an event destination is exactly the
missing dimension.

Two precision notes on `list-metrics`, since a later reader will re-run it. It reports only
metrics with datapoints in the **preceding ~14 days**, so its output is evidence about
*current* emission shape, not about the whole 30-day window — the account-total reading
above does not depend on it either way. And `Bounce` / `Complaint` / `Reject` being absent
from that list means only "no such datapoint in the last 14 days"; it is consistent with the
`None` readings above but is **not** proof they were never emitted at any point.

### 2.3 Identity inventory (`EXECUTED`, `aws sesv2 list-email-identities --region eu-central-1`)

| Identity | Type | Verified | Sending | Referenced by AmodX? |
|---|---|---|---|---|
| `bijuterie.software` | DOMAIN | SUCCESS | yes | indirectly (parent of the sender address) |
| `contact@bijuterie.software` | EMAIL_ADDRESS | SUCCESS | yes | **yes — the only sender** |
| `mocheta.com` | DOMAIN | SUCCESS | yes | **no** |
| `crm@mocheta.com` | EMAIL_ADDRESS | SUCCESS | yes | **no** |
| `andrei.fecioru@gmail.com` | EMAIL_ADDRESS | SUCCESS | yes | **no** |

Per-identity detail (`EXECUTED`, `aws sesv2 get-email-identity --email-identity <id>`):

- **Easy DKIM is correct and live on both domains.** `SigningEnabled: true`,
  `Status: SUCCESS`, `SigningAttributesOrigin: AWS_SES`, `RSA_2048_BIT`, three CNAME tokens
  each, last key generation Jan 2026. Spot-verified in public DNS (`EXECUTED`):
  `dig +short CNAME cgfy7fu7rltc3gqv3skx2dazhvszhbcw._domainkey.bijuterie.software`
  → `cgfy7fu7rltc3gqv3skx2dazhvszhbcw.dkim.amazonses.com.` ✔ (same shape for `mocheta.com`).
- **No custom MAIL FROM domain on any identity.** `MailFromAttributes` contains only
  `BehaviorOnMxFailure: USE_DEFAULT_VALUE` — no `MailFromDomain` key at all.
- **No SES identity policies.** `Policies: {}` on all inspected identities.
- **Zero configuration sets** (`EXECUTED`, `aws sesv2 list-configuration-sets` →
  `{"ConfigurationSets": []}`). No event destination exists anywhere, therefore no
  bounce/complaint/delivery event is captured, stored, or surfaced.
- **VDM is off** (`EXECUTED`, `get-account --query VdmAttributes` → `null`).
- **`VerificationInfo.ErrorType: "HOST_NOT_FOUND"`** is present on *both* domain identities
  despite `VerificationStatus: SUCCESS`, with `LastCheckedTimestamp` and
  `LastSuccessTimestamp` one second apart on 2026-07-30. See F-EMAIL-8 — interpretation is
  `INFERRED`, not `OBSERVED`.

### 2.4 DNS reality per domain (`EXECUTED`, `dig`)

| Domain | Authoritative NS | MX (mailbox provider) | SPF | DMARC | SES DKIM published |
|---|---|---|---|---|---|
| `bijuterie.software` | `NS1.BLUEHOST.COM` | **Google Workspace** (`aspmx.l.google.com` + 4 alt) | `v=spf1 a mx ip4:50.6.152.225 include:_spf.google.com include:_spf.mlsend.com ~all` | **none** | ✔ |
| `mocheta.com` | `ns3.spatiul.ro` | hosting provider's own (`mx1..mx4.spatiul.ro`) | `v=spf1 ip4:80.96.32.23 ip4:45.134.161.249 ip4:176.223.66.3 +a +mx ~all` | **none** | ✔ |
| `bijup.com` (**prod AmodX tenant**) | Cloudflare (`alan/meera.ns.cloudflare.com`) | **none at all** | **none** | **none** | n/a — not an SES identity |
| `amodx.net` (platform root) | Route53 (`ns-*.awsdns-*`) | none | — | **none** | n/a |

Four domains, four different DNS providers (Bluehost, spatiul.ro, Cloudflare, Route53).
Only `amodx.net` is in Route53, i.e. only `amodx.net` is a zone AmodX can write. This one
row is the single most important input to D-EMAIL-4.

Two more things worth stating plainly:

- `bijuterie.software` — AmodX's own domain and the domain of the only sender — already
  runs its mailboxes on **Google Workspace**, not cPanel and not WorkMail. The recommended
  product answer (external provider + DNS management) is the answer we already chose for
  ourselves.
- `bijup.com`, the actual production tenant listed in `amodx.config.json`
  (`domains.tenants: ["blog.bijup.com", "bijup.com"]`), has **no MX record**. That tenant
  has no email at all, and its customers receive order/contact mail from
  `contact@bijuterie.software`.

### 2.5 Account sharing (`OBSERVED`)

`mocheta.com`, `crm@mocheta.com`, and `andrei.fecioru@gmail.com` are verified in this SES
account and are referenced by **nothing** in this repository (`EXECUTED`, `git grep -i
mocheta` and `git grep fecioru` over the working tree → no matches outside this document).
`get-account` reports `WebsiteURL: https://staging.dnxa642oddwmy.amplifyapp.com`, an Amplify
app that is not AmodX.

Corroborating, `EXECUTED` 2026-07-30 (byproduct of the § 2.7 provenance check): CloudFormation
in `eu-central-1` holds **12 stacks**, of which 6 are AmodX (`AmodxStack`,
`AmodxStack-staging`, and their Commerce/Engagement nested stacks). The other 6 are
`glamcrm-prod`, `glamcrm-dev`, `ZapZapStack`, `ZapExamplesStack`, `InfraStack`, and
`CDKToolkit` (the last being CDK bootstrap, shared rather than foreign). By resource count the
split is starker: `glamcrm-dev` (441) and `glamcrm-prod` (399) together exceed either AmodX
root stack (487 each). The AWS **account** is therefore demonstrably multi-application. This does
**not** upgrade the conclusion below out of `INFERRED`, because the remaining step — that one
of those other applications is what *sends the SES mail* whose bounces appear in § 2.6 — is
still an inference, not an observation.

Conclusion (`INFERRED`, high confidence): **the SES account is shared between AmodX and at
least one non-AmodX application.** SES reputation, `EnforcementStatus`, the 50k/day quota,
and the account-level suppression list are all **per account per region** — they are shared
with that other workload. A bounce spike in the CRM app can get AmodX's sending paused.
This is the same class of blast-radius problem `docs/VISION.md` § *Tenant isolation* treats
as a product guarantee, one level up: not tenant-to-tenant, but product-to-product.

### 2.6 Suppression list (`EXECUTED`, `aws sesv2 list-suppressed-destinations`)

```
illona@mocheta.com   BOUNCE   2025-09-25T10:49:04+03:00
ina@mocheta.com      BOUNCE   2025-09-25T11:30:05+03:00
montaj@crm.com       BOUNCE   2025-04-30T09:51:09+03:00
```

All three are `mocheta.com`/`crm.com` addresses, i.e. (per § 2.5) most likely the *other*
workload's, not AmodX's. **Do not read this as "an AmodX tenant is broken."** Read it as a
worked example of the mechanism, because the mechanism applies identically to AmodX:

1. `TenantConfig.integrations.contactEmail` / `orderProcessingEmail` are the tenant's own
   staff mailboxes, and they are exactly what receives internal order notifications
   (`backend/src/orders/create.ts:433-434, 487-488`).
2. If such an address hard-bounces once, SES adds it to the account-level suppression list.
3. Every later send to it is **silently dropped by SES**. The API call succeeds.
4. `backend/src/orders/create.ts:514` (and `update-status.ts:169`) swallows failures anyway:
   `catch (emailErr) { console.error("Failed to send confirmation email:", emailErr); }`
   — and in the suppression case there is no error to swallow.
5. With zero configuration sets there is no event destination, so nothing records it.
6. No admin page shows suppression, bounce, or complaint state (`EXECUTED`, `ls
   admin/src/pages/` — 36 pages, none email-deliverability related; `grep -n CardTitle
   admin/src/pages/Settings.tsx` — 27 cards, none of them email health).

So a tenant can stop receiving its own order notifications, and the failure is invisible at
every layer: to SES's caller, to the handler's error path, to the audit log, and to the
tenant admin. That is the concrete justification for the `email-obs` addition proposed in
§ 4.4 — and for its deep-vertical rule.

### 2.7 What does not exist (`EXECUTED`, verified absence)

**Zero SES resources are declared in this repository's CDK.** The absence check is scoped to
CDK *source* — no docs, no build output, so it stays reproducible as this plan grows:

```
grep -rniE "CfnEmailIdentity|EmailIdentity|CfnConfigurationSet|ConfigurationSet|ReceiptRule|MailFrom|aws-ses|aws_ses|sesv2|dkim|dmarc" \
  infra/bin infra/lib infra/test --include="*.ts"
  -> no matches (exit 1)
```

`EXECUTED` 2026-07-30, over the 25 `.ts` files in those three directories (14 authored + 11
generated `.d.ts`). What it establishes is exactly one thing: **no SES resource construct is
declared by this repo.**

For precision about what *is* there, rather than leaving the absence claim to be read as
"infra never mentions SES": the same directories hold **34** `ses`/`sesEmail` references in
authored source (`EXECUTED`, `grep -rniE "\bses\b|sesEmail" infra/bin infra/lib infra/test
--include="*.ts" | grep -v "\.d\.ts:"`). Every one is `sesEmail`/`sesRegion` prop-and-variable
plumbing, a `SES_FROM_EMAIL` Lambda env var, a `ses:SendEmail`/`ses:SendRawEmail` IAM action,
an `arn:aws:ses:…:identity/…` string interpolation, the Cognito `UserPoolEmail.withSES` block
(`infra/lib/auth.ts:66`), or a comment. All of it *consumes* an identity that must already
exist. Not one line creates one.

Second, independent confirmation from the deployed side rather than the source side
(`EXECUTED` 2026-07-30): across **all 12** CloudFormation stacks in `eu-central-1` —
**2559 resources** in total — there are **zero** `AWS::SES::*` resources. Nothing that is
running was created by CloudFormation either.

- **Consequence for testability.** `test-4`'s named-assertion regime
  (`infra/test/amodx-stack.test.ts`) cannot pin a single email property, because nothing
  email-related is synthesized to assert. This is the same failure mode `cache-6`
  documented: *"the defect shipped precisely because nothing asserted the list."*
- **Provenance of the existing identities — `NOT VERIFIED`.** Absence from this repo proves
  only that *this repo* does not declare them; it does not establish *how* they were created.
  Two read-only checks narrow it without settling it:
  - `EXECUTED` — **no deployed CloudFormation stack declares any SES resource** (the 12-stack
    / 2559-resource sweep above). This rules out CDK/CloudFormation — including any *other*
    CFN-based project in the account — as the creator.
    *Method note:* the first attempt at this sweep used `--query "length(...)"` with
    `--output text`, which the AWS CLI evaluates **per page**, so a paginated stack emits one
    number per page. That made 12 stacks look like 30 rows. The count above comes from
    fetching full `--output json` per stack and counting in one place. Recorded because the
    mangled form is a plausible way for a later reader to get a different number from the
    same account.
  - `EXECUTED` — **CloudTrail cannot answer it.** `lookup-events` for
    `CreateEmailIdentity`, `VerifyDomainIdentity`, `VerifyEmailIdentity`,
    `VerifyDomainDkim`, and `PutEmailIdentityDkimAttributes` each return **0 events**, and the
    oldest `ses.amazonaws.com` event CloudTrail still holds is dated **2026-05-03** — i.e. the
    ~90-day management-event lookup window. `INFERRED` from those two facts (not observed): the
    identities were created before that window and their creation events are no longer
    retrievable. The alternative reading — that creation used an API whose event name is none of
    the five above — is not excluded, only made unlikely by those five covering both the SES v1
    and v2 creation paths.
  - **What remains open:** console, CLI/SDK, or a non-CloudFormation IaC tool (Terraform,
    Pulumi, Serverless) are indistinguishable from here. See § 8 for the question to the human.

  This does not soften the finding that matters: whatever created them, **the identities are
  not reproducible from this repository and `test-4` cannot assert them**, which is what
  F-EMAIL-7 records and what `email-obs` (§ 4.4) and D-EMAIL-1 option C partly retire. No
  phase in § 4 depends on the creation mechanism.
- **No receipt rule sets, no Mail Manager.** `aws ses list-receipt-rule-sets` →
  `{"RuleSets": []}`; `aws ses describe-active-receipt-rule-set` → empty;
  `aws ses list-receipt-filters` → `{"Filters": []}`; `aws mailmanager list-ingress-points`
  → `{"IngressPoints": []}`. All four calls **succeeded** in `eu-central-1` — the APIs are
  available here (see § 3.2), they are simply unused.
- **No SES tenants.** `aws sesv2 list-tenants --region eu-central-1` → `{"Tenants": []}`.
  The API exists in this region and account. SES has a native per-tenant construct we are
  not using; see F-EMAIL-9.
- **No DMARC anywhere**, on any of the four domains inspected.
- **Staging and prod share the same identity, suppression list, reputation, and quota** —
  same account, same region, same `sesEmail`. A staging test send to a bad address writes
  to the production suppression list.

### 2.8 Findings

Severity is *product* severity, discounted by the 2-sends/30-days volume in § 2.2.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **F-EMAIL-1** | HIGH | **No per-tenant sender.** Every tenant's mail is `From: contact@bijuterie.software`. A customer of tenant *X* receives their order confirmation from an unrelated agency domain. The only branding is the `[${siteName}]` subject prefix (`orders/create.ts:479`). `contactEmail` is a recipient field and cannot be repurposed. | `OBSERVED` § 2.1 |
| **F-EMAIL-2** | MEDIUM | **Customer-facing order mail has no `Reply-To`.** `orders/create.ts:476` and `update-status.ts:144` omit `ReplyToAddresses`, so a customer replying to their order confirmation reaches AmodX's inbox, not the merchant. `contact/send.ts` and `forms/public-submit.ts` *do* set it — the estate is inconsistent with itself. **The fix is conditional, not universal** — see F-EMAIL-2b; do not scope it as "add one field." | `OBSERVED` § 2.1 table |
| **F-EMAIL-2b** | — | **There is no guaranteed value to put in `Reply-To`.** `integrations.contactEmail` is `.optional()` (`packages/shared/src/index.ts:389`), the admin field is free-text with no required validation, and its helper text states the intended behaviour outright: *"If empty, they go to the agency admin"* (`admin/src/pages/Settings.tsx:1234`). Worse, `TenantConfigSchema`'s default seeds it as the **empty string**, not `undefined` (`index.ts:836`), so an absent value is `undefined` **or** `""` depending on how the record was written. A naive `contactEmail !== undefined` guard would emit `ReplyToAddresses: [""]`, which SES rejects for the whole message — converting a cosmetic omission into a total send failure for that tenant. The estate already contains the correct shape twice: `backend/src/forms/public-submit.ts:144` is `ReplyToAddresses: submitterEmail ? [submitterEmail] : undefined` — a truthiness guard that omits the field rather than sending an empty one — and `backend/src/contact/send.ts:74` uses `config?.integrations?.contactEmail \|\| FROM_EMAIL` for recipient selection. Any `Reply-To` fix should reuse the first shape rather than invent one, and must state its absent-value behaviour (D-EMAIL-6 sub-decision D.i). | `OBSERVED` (5 file:line) |
| **F-EMAIL-3** | MEDIUM | **No custom MAIL FROM domain.** Envelope sender stays in `amazonses.com`, so SPF authenticates `amazonses.com` and is **not aligned** with the `From:` domain. DMARC would therefore rest **entirely on DKIM**, with no second mechanism. One deleted CNAME during a DNS edit and authentication fails outright. | `OBSERVED` § 2.3 |
| **F-EMAIL-4** | MEDIUM | **No DMARC record on any domain.** No spoofing/forwarding visibility, and no policy statement to receivers. | `EXECUTED` § 2.4 |
| **F-EMAIL-5** | LOW→MED | **SPF on both sending domains omits SES.** Currently harmless *only because* of F-EMAIL-3. The two are coupled: adopting a custom MAIL FROM without publishing the SES SPF TXT + feedback MX on that subdomain newly breaks SPF. Fix them together or not at all. | `EXECUTED` § 2.4 |
| **F-EMAIL-6** | HIGH | **Deliverability is unobservable end to end.** Zero configuration sets → no event destination → bounces/complaints not captured. Account-level suppression silently drops mail with a *successful* API response. Handlers swallow send errors. No admin surface exists. A tenant losing its order notifications produces no signal anywhere. | `EXECUTED` § 2.3, § 2.6 |
| **F-EMAIL-7** | MEDIUM | **Zero SES infrastructure in CDK.** The identities exist only in the account, not in any repo: not reproducible from source, and unassertable by `test-4` because nothing email-related is synthesized. They are also **shared between staging and prod** (same account/region/identity → shared suppression list and reputation). *How* they were created is **`NOT VERIFIED`** — ruled out: CloudFormation/CDK (no deployed stack declares an SES resource) and CloudTrail (creation predates the ~90-day window). Console vs CLI vs non-CFN IaC is indistinguishable from here, and nothing in this plan depends on which. | `EXECUTED` § 2.7; provenance `NOT VERIFIED` |
| **F-EMAIL-8** | LOW | `VerificationInfo.ErrorType: "HOST_NOT_FOUND"` on both domain identities' latest periodic re-check, while `VerificationStatus` is still `SUCCESS`. Both zones are third-party DNS. Whether this is residual from an old failed lookup or an intermittently failing re-check is **`INFERRED`, not established**. It matters because a *sustained* re-check failure revokes the identity and stops all tenant mail — and today nothing would report it. Verification step: re-run `get-email-identity` on consecutive days and compare `LastSuccessTimestamp` against `LastCheckedTimestamp`. | `OBSERVED` field; `INFERRED` cause |
| **F-EMAIL-9** | INFO | Backend uses the **SES v1 API** (`@aws-sdk/client-ses`, `SendEmailCommand`) at all six send sites. Consequences: 10 MB message cap (v2 = 40 MB, § 3.3), and **SES Tenants + VDM are v2-only** — so native per-tenant reputation isolation requires an SDK migration, not a config change. Not a defect; it is the constraint D-EMAIL-1 option B collides with. | `OBSERVED` § 2.1, § 2.7 |
| **F-EMAIL-10** | LOW | **SES IAM grants are resource-scoped to the single address** (`arn:aws:ses:…:identity/${sesEmail}`, five call sites: `api.ts:328`, `api-commerce.ts:195`, `api-engagement.ts:198`). Any per-tenant sender **must** widen or parameterise all five, or sends fail at runtime with an authorization error. This is precisely the class of bug the memory-file pattern names: *"IAM grants must match actual DB operations… always check CDK grants when adding new operations."* Also inconsistent today: `api-commerce.ts:197, 226` grant `ses:SendEmail` only, while `api.ts:330, 709` and `api-engagement.ts:200` also grant `ses:SendRawEmail` — no handler calls `SendRawEmail` (`EXECUTED` grep), so three grants are over-broad by one action. | `OBSERVED` |
| **F-EMAIL-11** | LOW | **Cognito's SES send path may be unauthorized.** `auth.ts:65-70` configures the admin pool to send invites via `UserPoolEmail.withSES({ fromEmail: sesEmail })`, but `get-email-identity` reports `Policies: {}` — no SES identity policy granting `email.cognito-idp.amazonaws.com`. Whether that path currently works is **NOT VERIFIED**; at 2 sends/30 days it is plausible nothing has exercised it. Note `backend/src/users/invite.ts` sends its *own* SES email independently, so the Cognito template may simply be dead configuration. Verification step: one staging invite, then check CloudTrail / the invitee's inbox. | `OBSERVED` fields; `NOT VERIFIED` behaviour |
| **F-EMAIL-12** | MEDIUM | **SES account is shared with a non-AmodX workload** (§ 2.5). Reputation, enforcement status, sending quota, and the suppression list are account-scoped and therefore shared. Another app's bounce spike can pause AmodX's sending for every tenant. | `INFERRED` (high confidence) from `OBSERVED` § 2.3, § 2.5 |

---

## 3. Verification of the two external claims

The human's notes depend on two factual claims. Both were checked and both are
**verified**. One corollary that a reader might reach for — whether *this AWS account* is
still eligible to create a WorkMail organization — is **NOT VERIFIED** and is separated out
explicitly in § 3.1(c), because nothing in this plan is allowed to rest on it.

### 3.1 AWS WorkMail end of support — dates **VERIFIED**; account eligibility **NOT VERIFIED**

Source: AWS official docs, `docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html`
(`EXECUTED` fetch 2026-07-30). Paraphrased — the page states three things:

| AWS statement (paraphrased) | Date |
|---|---|
| Support for Amazon WorkMail ends; the service can no longer be used after this date | **2027-03-31** |
| WorkMail stops accepting new customers from this date onward | **2026-04-30** |
| Customers whose account signed up *before* the new-customer cutoff may keep using WorkMail features until end of support | (spans the two above) |

The same page names its recommended third-party migration targets — see the end of this
subsection.

**What this establishes, and what it does not.** Today is 2026-07-30, so the new-customer
window closed **three months ago** and the service itself ends in **eight months**. Three
separate statements have to be kept apart here, because the previous revision of this
document collapsed them and overstated the result:

**(a) The service is dead for planning purposes — `EXECUTED`/`OBSERVED`, no caveat.**
Support ends 2027-03-31 for *everyone*, grandfathered or not. A migration plan whose target
is a mailbox platform that stops working in eight months is not a plan. This alone is
sufficient to exclude WorkMail from `email-5`'s provider recipes and from D-EMAIL-3, and it
is the only WorkMail fact any downstream phase needs. It also applies to a *prospect* who
arrives already on WorkMail: they are a migration source, never a target.

**(b) No WorkMail organization exists in this AWS account — `EXECUTED` 2026-07-30.**

```
aws sts get-caller-identity          -> Account 324037297014
aws workmail list-organizations --region us-east-1   -> {"OrganizationSummaries": []}
aws workmail list-organizations --region us-west-2   -> {"OrganizationSummaries": []}
aws workmail list-organizations --region eu-west-1   -> {"OrganizationSummaries": []}
```

Those are the three regions where the WorkMail API answers. Negative controls, same
command, same credentials: `eu-central-1`, `eu-north-1`, `ap-southeast-2`, and `us-east-2`
all fail with `Could not connect to the endpoint URL` — i.e. WorkMail has no endpoint
there. That control matters twice: it shows the three empty responses are real API
responses rather than silent failures, **and** it independently establishes that WorkMail
is not offered in `eu-central-1`, the region the entire AmodX deployment runs in. Using it
would have meant a cross-region mail platform regardless of eligibility.

**(c) Whether this account is *eligible* to create one — `NOT VERIFIED`.** AWS's carve-out is
written in terms of an account having *signed up for the service* before the cutoff — not in
terms of an organization existing today. Eligibility is therefore an AWS-side determination
about sign-up history, and no public API exposes it.
Zero organizations today is strong evidence but **not proof**: an organization could have
existed and been deleted, and eligibility may attach to the Organizations payer account
rather than to `324037297014`. Establishing this would require creating an organization —
a mutation, out of scope for `email-1` — or an AWS Support case.

> **Exact question for the human (blocking nothing, recorded for completeness):** has AWS
> account `324037297014`, or its Organizations payer account, ever had a WorkMail
> organization or subscription created before 2026-04-30? If the answer is "no" or
> "unknown," the definitive check is an AWS Support case asking whether the account retains
> WorkMail new-organization eligibility. **Do not run `create-organization` to find out** —
> it is a billable mutation and this slice forbids AWS mutations.

**Consequence for this plan.** It rests on (a) alone, which is fully verified and does not
depend on (c): WorkMail is excluded as a migration *target* because the service ends
2027-03-31. This removes the only in-AWS mailbox option and hardens the external-provider
stance from a preference into the only path. If the human later confirms eligibility, the
conclusion does not change — it would merely mean an eight-month-lifespan option was
technically open to us.

AWS's own recommended alternatives, from the same page: Kopano Cloud, Zoho Mail, Zoom Mail.
Note that AWS does **not** name Google Workspace or Microsoft 365 — relevant to D-EMAIL-3
only as colour; it does not constrain our recipe list.

### 3.2 SES inbound receiving in `eu-central-1` — **VERIFIED AVAILABLE**

Two independent checks, both `EXECUTED` 2026-07-30:

1. **Authoritative docs table.** `docs.aws.amazon.com/general/latest/gr/ses.html`
   § *Email Receiving endpoints* lists 22 regions and includes:
   `Europe (Frankfurt) | eu-central-1 | inbound-smtp.eu-central-1.amazonaws.com`.
   The page's only exclusions are `us-gov-east-1` and `us-gov-west-1`.
2. **Live DNS resolution.** `dig +short A inbound-smtp.eu-central-1.amazonaws.com` →
   `3.78.135.165 3.78.71.215 3.78.140.108`. For contrast, `eu-central-2` (Zurich) returns
   nothing, matching its absence from the docs table — which is what makes check 2 a real
   discriminator rather than a tautology.

Additionally, the receiving control plane responds in this account/region: `list-receipt-rule-sets`,
`describe-active-receipt-rule-set`, and `list-receipt-filters` all returned successfully and
empty (§ 2.7), as did Mail Manager's `list-ingress-points`.

**So the technical blocker on inbound does not exist.** That moves the entire weight of the
inbound question off "can we" and onto "should we" — which is D-EMAIL-2, and which is a
product and liability decision, not an availability one.

### 3.3 Relevant hard limits (`EXECUTED`, `docs.aws.amazon.com/ses/latest/dg/quotas.html`)

Recorded here so later phases design against real numbers rather than guesses.

| Limit | Value | Adjustable |
|---|---|---|
| Max message size — **SES v1 API** (what we use today, F-EMAIL-9) | **10 MB** | No |
| Max message size — SES v2 API / SMTP | 40 MB | No |
| Recipients per sent message | 50 | No |
| Verified identities per region | 10,000 | contact AWS |
| **SES tenants per region** | 10,000 | Yes |
| Configuration sets per region | 10,000 | No |
| **Receipt rule sets per account** | **40** | **No** |
| **Rules per receipt rule set** | **200** | **No** |
| Recipients per receipt rule | 500 | No |
| Actions per receipt rule | 10 | No |
| Max received email size storable to S3 | 40 MB | No |
| Max received email size via SNS notification | 150 KB | No |
| Max received headers via Lambda | 50 KB | No |
| Mail Manager: rule sets / rules per set | 40 / 40 | No |

**Read the receiving limits against the 99-tenant ceiling in `CLAUDE.md`.** 40 rule sets is
a hard, non-adjustable cap, but only one rule set can be active at a time and it holds 200
rules with 500 recipients each. So inbound for up to 99 tenants fits comfortably in a
*single* active rule set (≤ 2 rules/tenant), and **any design that allocates one rule set
per tenant hits an unraisable wall at 40 tenants.** That constraint must be written into
`email-4`'s design before a line of code is planned, not discovered during it.

Also note the v1 10 MB cap (F-EMAIL-9) is *below* the 40 MB inbound-to-S3 ceiling — an
inbound-then-forward design on the v1 SDK cannot re-send the largest messages it can accept.

---

## 4. Proposed phases

**The numbering below IS the ratified `docs/ROADMAP.md` EMAIL row, unchanged:** `email-1`
audit → `email-2` guided DNS → `email-3` DKIM/DMARC health → `email-4` optional inbound →
`email-5` cPanel migration checklist. Two deviations are *proposed* and neither is taken
unilaterally:

1. an **ordering** prerequisite (F-EMAIL-1 sits underneath `email-2`/`email-3`) — § 4.0 and
   D-EMAIL-6;
2. an **added, deliberately unnumbered** phase for bounce/suppression visibility
   (`email-obs`, § 4.4). It does not displace `email-4` or `email-5`.

Every phase states the admin-visible surface, because the deep-vertical rule applies: a
DNS/deliverability check that lives only in a Lambda is not a feature. If the tenant admin
cannot see it, it does not exist.

### 4.0 An ordering problem the ROADMAP row does not name

The row reads: `audit → guided DNS → SES DKIM/DMARC health → optional inbound → checklist`.
The audit found that **the sending foundation is broken underneath all four of those**:

- Guided DNS (`email-2`) tells a tenant which MX/SPF/DKIM records to publish. But AmodX
  does not send from the tenant's domain at all (F-EMAIL-1), so *there is no DKIM record
  for the tenant to publish* and no SPF for AmodX to be included in. Guided DNS for a
  tenant whose mail we send from someone else's domain is a page of records that authorize
  nothing we do.
- A "DKIM/DMARC health" page (`email-3`) on a shared platform identity reports the health of
  `bijuterie.software`, not of the tenant's domain. Every tenant sees the same row. It is
  not a per-tenant health surface; it is a platform status light rendered 99 times.

So F-EMAIL-1 is a **prerequisite**, not a follow-up. Four ways to absorb that, put to
ratification as D-EMAIL-6 rather than chosen here — none of them renumbers the row.
Independently, the cheap half of F-EMAIL-1 + F-EMAIL-2 (add a `From` display name and a
customer-facing `Reply-To`) needs no DNS, no IAM change, and no CDK change — it is a
candidate for immediate shipping outside this track, in the same spirit as `cache-6`. It is
**not** decision-free, however: `Reply-To` has no value to use when a tenant has not
configured one (see F-EMAIL-2b and D-EMAIL-6 sub-decision D.i), so the absent-value
behaviour must be specified before it ships.

> **IMPLEMENTED (`EMAIL-HOTFIX-1`, 2026-08-01, uncommitted — pending review/deploy) —
> display-name half only.** The `From` display name is applied at all six SES send sites via
> `backend/src/lib/email-from.ts` (`formatFromHeader`, RFC 5322/2047-correct for quotes,
> commas, diacritics, emoji, and CR/LF injection; unit-tested in
> `backend/test/unit/email-from.test.ts`). A send site with no tenant name in scope (Paddle
> fulfilment) falls back to the platform brand label (`DEFAULT_FROM_NAME`, "AMODX"), never a
> bare address. Per the ratified D-EMAIL-6 sub-decision, the **`Reply-To` half was NOT
> implemented** (deferred, D-EMAIL-6.4) — so this narrows F-EMAIL-1's *symptom* but closes
> neither F-EMAIL-1 nor F-EMAIL-2. The sender address is unchanged; the per-tenant sending
> identity remains `email-2a` (option B). Residuals — Reply-To, per-tenant sender identity,
> and personalising Paddle's `From` with the buyer's tenant name — are tracked in
> `docs/TECH-DEBT.md` § *EMAIL-HOTFIX-1 residuals*.

### 4.1 `email-1` — Audit and decisions

- **Scope.** This document. Current-state audit with executed evidence; verification of the
  WorkMail and SES-receiving claims; phase decomposition; the six decisions in § 6;
  reconciliation of the ROADMAP EMAIL row.
- **Non-scope.** No code. No `infra/`. No AWS mutations. No schema change. No admin UI.
- **Admin surface.** None.
- **Risk.** Only the risk of a wrong audit. Mitigated by labelling: F-EMAIL-8, F-EMAIL-11,
  and F-EMAIL-12 are explicitly *not* presented as established.
- **Evidence.** § 2 and § 3 above, all labelled.
- **Exit criterion.** The six decisions are ratified, or the track stays parked. Nothing
  downstream can be scoped honestly until D-EMAIL-1 and D-EMAIL-6 are answered.

### 4.2 `email-2` — Guided DNS for external mailbox providers

- **Scope.** A per-tenant *Email* page in admin that renders the exact DNS records the
  tenant must publish, for a chosen mailbox provider, and then **reads public DNS to report
  whether they are actually published**. Recipes as data (provider → record set), not code:
  Google Workspace, Microsoft 365, Zoho, and "keep my existing cPanel/host mail". One
  backend handler performing the DNS reads; results rendered as a per-record pass/fail list
  with the observed value next to the expected value.
- **Non-scope.** **AmodX writes no DNS** (pending D-EMAIL-4). No registrar/DNS-provider API
  adapters. No credential storage for any DNS provider. No mailbox provisioning, no
  reseller flow, no billing. No inbound mail. No change to the sending identity — that is
  D-EMAIL-1/D-EMAIL-6 territory and must not be smuggled in here.
- **Admin surface.** *Settings → Email* (or a top-level Email page): provider selector; the
  record table (type, host, value, priority) with copy buttons; a *Check DNS* action;
  per-record status showing expected vs. observed.
- **Risks.**
  - *Recipe rot.* Providers change records. Mitigation: recipes are data with a
    "last verified" date shown in the UI, and the checker reports observed values, so a
    stale recipe reads as a mismatch rather than as silent breakage.
  - *Dangerous advice.* Publishing an MX recipe replaces the tenant's current mail routing
    **domain-wide**. If a client pastes Google's MX while still using cPanel mailboxes,
    their existing mail stops. The UI must state the destructive consequence next to the MX
    rows, and `email-5`'s checklist owns the ordering.
  - *DNS read reliability.* Lambda resolver caching and negative-cache TTLs mean "not
    published" and "not yet propagated" are indistinguishable. Mitigation: report the
    query timestamp and the observed TTL; never assert a permanent verdict from one read.
  - *Scope creep into writing DNS.* Guarded by the explicit non-scope + D-EMAIL-4.
- **Boundaries.** DNS lookups are volatile external mechanism — they belong in a backend
  handler, never in the renderer, and never in the browser. Tenant-scoped like every other
  operation (`x-tenant-id`). Recipe data lives in `packages/shared` if and only if both
  admin and backend consume it; if only admin renders it, it stays in admin.
- **Evidence required.** `EXECUTED` DNS check against at least two real tenant domains with
  genuinely different providers — `bijup.com` (Cloudflare, no MX) and `mocheta.com`
  (spatiul.ro, MX present) are the natural pair, since they exercise the empty and populated
  cases respectively.

### 4.3 `email-3` — SES sending-authentication health surface

- **Scope.** Make the *sending* side observable per tenant: DKIM CNAME presence and SES
  verification state, custom MAIL FROM presence (F-EMAIL-3), SPF content (F-EMAIL-5), DMARC
  presence and policy (F-EMAIL-4), and identity verification drift (F-EMAIL-8) — rendered
  in admin with a remediation record set for anything failing. What this phase *can* report
  depends entirely on D-EMAIL-1: on a shared identity it is one platform status row; on
  per-tenant identities it is a real per-tenant panel.
- **Non-scope.** No auto-remediation, no DNS writes. No SES Tenants adoption and no SDK
  v1→v2 migration (F-EMAIL-9) unless D-EMAIL-5 rules otherwise. No inbound.
- **Admin surface.** *Settings → Email → Deliverability*: per-check row (DKIM, SPF, MAIL
  FROM, DMARC, identity verified) with status, observed value, and the exact record to
  publish when failing.
- **Risks.**
  - *False confidence.* A green panel that only checks record *presence* can pass while
    mail still fails (wrong DKIM selector, `~all` vs `-all`, an unrelated `include:` that
    blew the SPF 10-lookup limit). The panel must report observed values, never a bare
    green tick.
  - *IAM widening.* Reading SES identity state needs `ses:GetEmailIdentity`, which no
    Lambda holds today. Per F-EMAIL-10, that is a new resource-scoped grant, and it is the
    grant class that has already caused one regression in this repo.
  - *Cross-tenant leak.* An identity-state handler that accepts an arbitrary domain
    parameter would let tenant A read tenant B's SES state. The domain **must** be derived
    from the tenant record, never from the request body. This is Critical Rule 3 applied to
    a non-DynamoDB resource.
- **Boundaries.** SES is volatile external mechanism. The purity rule matters here: *"is
  this SPF record adequate?"* is business policy and should be a pure, unit-testable
  function over a DTO (`test-3`'s layer); *"fetch the TXT record"* and *"call
  GetEmailIdentity"* are I/O at the edge. Keeping them apart is what makes this testable
  without AWS.
- **Evidence required.** `EXECUTED` against a domain in each state: DKIM present + DMARC
  absent (`bijuterie.software` today), and nothing published (`bijup.com` today).

### 4.4 `email-obs` — Bounce, complaint, and suppression visibility *(PROPOSED ADDITION — deliberately unnumbered)*

**This is not a ratified phase, and it is deliberately given no number.** The ratified
ROADMAP row defines exactly five phases, `email-1`..`email-5`, and this document does not
renumber them: inbound stays `email-4` and the migration checklist stays `email-5`. The
identifier `email-obs` is a placeholder for cross-referencing within this document only.
Promoting it into the row — and giving it a number — is itself a ROADMAP change that
requires ratification, and is not taken here.

It is proposed because F-EMAIL-6 is the finding with a live, silent, revenue-shaped failure
mode and the row does not cover it: `email-3` reports whether *authentication* is
configured; nothing in the row reports whether mail *arrived*. If it is ratified, the
natural position is after `email-3` and independent of `email-4`/`email-5`; if it is
rejected, F-EMAIL-6 stays open and must be recorded as debt outside this track.

- **Scope.** One SES configuration set with an event destination (bounce, complaint,
  delivery, reject) persisting per-tenant events; suppression state visible in admin; a
  loud signal when a tenant's own notification recipient (`contactEmail` /
  `orderProcessingEmail` / `FormDefinition.notifyEmail`) is suppressed. Declared in CDK, so
  `test-4` can assert it exists — directly retiring the F-EMAIL-7 half of the problem.
- **Non-scope.** No sender changes. No inbound. No new mail content. No automatic
  un-suppression (removing an address from the suppression list is an operator action with
  reputational consequence, not a button for a tenant).
- **Admin surface.** *Settings → Email → Delivery log*: recent bounces/complaints with
  reason and timestamp; an unmissable banner when a configured notification recipient is
  suppressed, because the whole point is that today this state is invisible.
- **Risks.**
  - *PII.* Bounce events carry recipient addresses — customer PII. Storage location and
    retention must respect the commerce-private boundary (PD-002, Track B). This phase
    should almost certainly land **after** `cmrc-1`, or store nothing the renderer can read.
  - *Volume.* Unbounded event storage. Needs TTL from day one.
  - *CDK deploy.* Touches `infra/` and is production-sensitive. Under the standing
    no-CDK-without-named-gain directive, the named gain is: *a live tenant can currently
    stop receiving order notifications with no signal at any layer.*
  - *Shared account.* Per F-EMAIL-12 the event stream will include the other workload's
    events unless scoped by configuration set. Design for that explicitly.
- **Evidence required.** `EXECUTED` end-to-end: send to an SES simulator bounce address
  (`bounce@simulator.amazonses.com`), observe the event stored and the admin banner appear.
  Run on **staging** — and note that under F-EMAIL-7 staging shares the production
  suppression list, so use simulator addresses only, never a real one.

### 4.5 `email-4` — Optional SES inbound aliases / forms archive

**Hard-gated on D-EMAIL-2.** If D-EMAIL-2 answers "no inbound", this phase is `WITHDRAWN`
and only `email-5` remains.

- **Scope (if ratified, and only in the delegated-subdomain form).** Accept mail for a
  subdomain the tenant delegates (`forms.example.com`), store to S3, surface it in admin
  alongside form submissions. **A single** active receipt rule set shared by all tenants
  (per § 3.3: 40 rule sets is an unraisable cap; 200 rules × 500 recipients is not).
- **Non-scope, permanently.** No MX authority over a tenant's apex domain. No mailbox
  hosting. No IMAP, no webmail, no user-facing mail client. No forward-to-external-mailbox
  (see the SPF/DKIM/SRS risk below). Not a mail server — `docs/ROADMAP.md` says so and this
  plan holds that line.
- **Admin surface.** Received-mail list with sender, subject, timestamp, and body, inside
  the existing Forms area rather than as a new inbox.
- **Risks.**
  - **Forwarding breaks authentication.** If AmodX receives mail and forwards it onward,
    the forwarded message fails SPF at the final recipient (envelope sender is now ours) and
    fails DKIM if anything rewrites the body. Correct handling needs SRS-style sender
    rewriting. This is exactly the "become a mail server" cost the problem statement
    forbids, and it is the single strongest reason to keep this phase to *archive*, never
    *forward*.
  - **MX is domain-wide.** You cannot have Google Workspace mailboxes and SES aliases on the
    same domain via MX. Anything other than the subdomain form displaces the tenant's real
    mailbox provider. This is the crux of D-EMAIL-2.
  - **Third-party content custody.** Storing inbound mail means storing arbitrary
    third-party PII and attachments: GDPR, retention, and a malware surface.
  - **Rule-set cap.** § 3.3. Per-tenant rule sets die at 40 tenants.
  - **Commercial weakness.** `orders@forms.example.com` is not what a client asking for
    "my email" means. The honest framing is a *forms archive*, not email hosting.
- **Evidence required.** `EXECUTED` inbound delivery to a delegated test subdomain, message
  visible in admin, with retention configured.

### 4.6 `email-5` — cPanel migration checklist

- **Scope.** An operator/sales-facing runbook in `docs/runbooks/`: inventory the client's
  existing mailboxes/aliases/forwarders before touching anything; choose a provider
  (D-EMAIL-3); provision mailboxes at the provider; **migrate existing mail via IMAP before
  the MX cutover**; publish MX/SPF/DKIM/DMARC in the correct order; verify with `email-2`
  and `email-3`; set the old host's mail to a defined state; a rollback step. Plus the
  pre-sales talking points that make this a reason to switch rather than an objection.
- **Non-scope.** No automation, no tooling, no code. A checklist.
- **Admin surface.** None — this is a runbook. If a tenant-visible version is wanted later
  it is a separate slice, not a smuggled scope extension.
- **Risks.** *Data loss.* Cutting MX before IMAP migration loses mail. *Downtime window.*
  TTL reduction must precede cutover by at least the old TTL. Both are checklist-ordering
  problems, which is precisely why the checklist is the deliverable.
- **Evidence required.** One real client migration executed against the checklist, with
  deviations recorded back into it. A checklist never run is a draft.

### 4.7 Phase summary

The five numbered phases are exactly the ratified ROADMAP row, in its order. `email-obs` is
a proposed addition and carries no number — it is listed in its proposed position, not
inserted into the sequence.

| Phase | Scope | Admin-visible | Touches `infra/` | Gated on |
|---|---|---|---|---|
| `email-1` | Audit + decisions (this doc) | no | no | — |
| `email-2` | Guided DNS recipes + read-only checker | **yes** | no | D-EMAIL-3, D-EMAIL-4 |
| `email-3` | Sending-auth health surface (DKIM/SPF/MAIL FROM/DMARC) | **yes** | maybe (IAM grant) | D-EMAIL-1, D-EMAIL-6 |
| *(`email-obs`)* | Bounce/complaint/suppression visibility — **PROPOSED, unnumbered, not in the ratified row** | **yes** | **yes** | ratification of the addition itself; then PD-002 / Track B for PII |
| `email-4` | Optional inbound aliases / forms archive | yes | **yes** | **D-EMAIL-2** (may be WITHDRAWN) |
| `email-5` | cPanel migration checklist | no (runbook) | no | `email-2`, `email-3` |

---

## 5. Non-goals of the whole track

Stated so no later slice can drift into them without an explicit new decision:

- **AmodX does not host mailboxes.** No IMAP, no POP, no webmail, no mail client, no
  per-user quota, no mailbox storage. The word "mailbox" in this track always means
  *someone else's mailbox*.
- **AmodX does not become the MX for a tenant's apex domain** (subject to D-EMAIL-2, and
  even the permissive answer there is subdomain-only).
- **AmodX does not forward third-party mail** — see the SRS risk in § 4.5.
- **AmodX does not sell, resell, or bill for mailboxes** unless D-EMAIL-3 option C is
  ratified, which is a business decision outside this plan.
- **AmodX does not take over a tenant's DNS zone** unless D-EMAIL-4 option B is ratified
  per-tenant, and then as an operator runbook, not a product feature.
- **This track is not marketing email.** Newsletters, campaigns, list management, and
  unsubscribe handling are a different product with different compliance obligations.
  (`bijuterie.software`'s SPF already includes `_spf.mlsend.com`, i.e. MailerLite is doing
  that job today, externally.)

---

## 6. Decisions requiring ratification

Six. D-EMAIL-1 and D-EMAIL-6 block phase scoping and are the two that matter first.

```
DECISION_REQUIRED:
- ID: D-EMAIL-1
  QUESTION: What is the sending identity model — one shared platform identity, or one per
    tenant?
  PROBLEM: Today every tenant's transactional mail is sent as
    `From: contact@bijuterie.software` (F-EMAIL-1). A customer who buys from tenant
    "bijup.com" receives their order confirmation from an unrelated agency domain, with the
    tenant's brand appearing only inside the subject line as `[siteName]`. There is no
    schema field that could hold a per-tenant sender; `integrations.contactEmail` is a
    RECIPIENT (backend/src/orders/create.ts:433). This is simultaneously (a) a brand defect
    visible to every end customer, (b) a deliverability coupling — all 99 tenants share one
    domain's DKIM, one reputation, and one account-level suppression list, itself shared
    with a non-AmodX application (F-EMAIL-12), and (c) the reason a per-tenant "email
    health" page has nothing tenant-specific to report (§ 4.0). Every option below has a
    different blast radius across CDK, five IAM grants (F-EMAIL-10), the shared schema, six
    send sites, and the tenant onboarding contract, which is why this is ratification-class.
  INVARIANT THAT CONSTRAINS EVERY OPTION BELOW — read this before scoring them:
    SES sending REPUTATION, EnforcementStatus, the 24-hour sending quota, and the
    account-level SUPPRESSION LIST are scoped PER AWS ACCOUNT PER REGION. They are NOT
    scoped per identity. Verifying more identities in this account partitions NONE of them.
    OBSERVED, two ways: (i) `sesv2 get-account` returns EnforcementStatus, SendQuota, and
    SuppressionAttributes with no identity dimension at all (§ 2.2); (ii) the list returned
    by `sesv2 list-suppressed-destinations` is ONE account-wide list whose entries carry no
    identity field, and an AmodX send to any address on it is dropped irrespective of which
    identity's traffic put it there (§ 2.6).
    What is NOT observed, stated so this proof is not overread: the three current entries
    are `mocheta.com` / `crm.com` addresses, and their attribution to a non-AmodX workload
    is `INFERRED` (F-EMAIL-12, § 2.5) — precisely because the list has no identity
    dimension, attribution cannot be observed from it. The invariant does not rest on that
    attribution; it rests on the missing dimension itself, which holds even if every entry
    turned out to be AmodX's own.
    Therefore NO option below, on its own, gives a tenant "their own reputation," and none
    isolates AmodX from a co-resident workload. ("The foreign workload" in the options
    below is shorthand for F-EMAIL-12 and inherits its `INFERRED` label.) Per-identity
    reputation isolation requires SES Tenants (v2-only, D-EMAIL-5) or a separate AWS
    account (§ 8 question 2). Options B and C buy BRANDING and DKIM/DMARC ALIGNMENT, and
    nothing else on the reputation axis. Score them on that.
  OPTIONS:
  - A. Keep the shared platform identity; add only a `From` display name (`"<siteName>"
    <contact@bijuterie.software>`) and a customer-facing `Reply-To` derived from the tenant
    record. NOTE: `integrations.contactEmail` is `.optional()` (OBSERVED,
    packages/shared/src/index.ts:389) — see D-EMAIL-6 sub-decision D.i for the absent-value
    behaviour that must be specified before this ships.
    RISK: the brand leak persists — the envelope and From domain are still ours; DMARC,
    reputation, and suppression stay pooled across all tenants AND the foreign workload, so
    one bad actor degrades everyone; Gmail renders a "via bijuterie.software" annotation on
    mismatched display names, which reads as phishing to a careful recipient; and email-3
    remains a platform status light rather than a per-tenant panel.
    REWARD: no tenant DNS dependency at all; no IAM change; no CDK change; roughly two
    lines per send site; also fixes F-EMAIL-2 (missing Reply-To) for tenants that have
    configured a contact address; zero onboarding friction.
  - B. Per-tenant verified DOMAIN identity — send as `<local>@<tenant domain>`, tenant
    publishes three DKIM CNAMEs.
    RISK: creates an onboarding GATE — a tenant unwilling or unable to edit DNS cannot go
    live, and the observed estate already spans four DNS providers (§ 2.4); all five IAM
    grants must widen from `identity/<one address>` to a per-tenant set or a wildcard,
    which is a real blast-radius increase and exactly the grant class that already caused
    the slug-guard regression (F-EMAIL-10); needs a verification state machine plus
    pending/failed UI; interacts with F-EMAIL-3/5 (custom MAIL FROM and SPF must be solved
    together or SPF newly breaks); and per-tenant reputation isolation additionally wants
    SES Tenants, which is v2-only (F-EMAIL-9, D-EMAIL-5).
    REWARD: correct branding — the customer sees the merchant's own domain in From; DKIM
    aligned to the tenant's own domain, so DMARC passes on the TENANT's terms and the tenant
    can publish their own DMARC policy meaningfully; the Gmail "via" annotation disappears;
    and critically, the DNS-instructions-plus-checker panel this requires is THE SAME PANEL
    email-2 has to build anyway — the marginal cost is lower than it looks.
    EXPLICITLY NOT A REWARD (per the INVARIANT above): this does NOT give the tenant their
    own reputation, their own quota, or their own suppression list. All three stay
    account-scoped and stay shared with every other tenant and with the foreign workload. A
    per-tenant identity changes WHO THE MAIL CLAIMS TO BE FROM, not WHOSE REPUTATION CARRIES
    IT. Anyone reading this option as "tenants own their deliverability" has misread it.
  - C. Per-tenant subdomain of a platform domain, e.g. `no-reply@<tenant>.amodx.net`.
    AmodX controls `amodx.net` in Route53 (OBSERVED § 2.4: NS = awsdns-*), so AmodX
    publishes the DKIM itself and the tenant touches nothing.
    RISK: the From domain is still not the tenant's brand, so the core complaint is
    unresolved; DMARC alignment is to amodx.net, not the tenant's domain; reputation,
    quota, EnforcementStatus and the suppression list remain EXACTLY as pooled as under
    option A — same AWS account, same region, same shared list, still shared with the
    foreign workload (see the INVARIANT above); and `no-reply@bijup.amodx.net` looks like
    infrastructure, not a business.
    REWARD: zero tenant DNS dependency; fully automatable in CDK + Route53 with no manual
    console step, which also retires part of F-EMAIL-7; a per-tenant DKIM signature and
    per-tenant From domain that AmodX can guarantee is correctly published, since AmodX owns
    the zone. It is better than A on BRANDING and on operability. It is NOT better than A on
    isolation — on that axis it is identical.
  - D. B with C as automatic fallback — attempt the tenant domain, fall back to the
    platform subdomain if DKIM is not published within N days.
    RISK: two code paths and two support stories to operate permanently (not two
    reputations — see the INVARIANT: there is one, account-wide);
    the fallback is the state most low-engagement tenants will settle into, so you pay B's
    full cost and then run C anyway; and it is precisely the "imagined variation"
    abstraction the repo's own directive says must be earned by demonstrated need.
    REWARD: no tenant is ever blocked from going live.
  RECOMMENDED: B as the target model, for BRANDING and DMARC ALIGNMENT — not for isolation,
    which it does not deliver. Ship A's two cheap mitigations (display name + customer
    Reply-To) IMMEDIATELY and INDEPENDENTLY: they need no DNS, no IAM change and no CDK
    change, and they narrow a live product defect while the rest is debated. They are NOT
    decision-free — the Reply-To fallback when `contactEmail` is unset must be chosen first
    (D-EMAIL-6 sub-decision D.i). Hold C in reserve for a NAMED tenant who refuses DNS. Do
    NOT build D's automatic fallback until a second tenant actually refuses: one concrete
    caller is not two. If reputation isolation is what is actually wanted, neither B nor C
    is the answer — § 8 question 2 (separate AWS account) and D-EMAIL-5 (SES Tenants) are.
  BLOCKING_REASON: email-3's entire scope is a function of this answer. On a shared
    identity there is nothing per-tenant to display and the phase collapses to a platform
    status row; on per-tenant identities it is a verification state machine plus a DNS
    panel plus five widened IAM grants. The two are not the same slice, so email-3 cannot
    be scoped, estimated, or written until this is settled.

- ID: D-EMAIL-2
  QUESTION: Does AmodX offer SES inbound receiving at all, and if so on what DNS scope?
  PROBLEM: § 3.2 verified that SES receiving IS available in eu-central-1
    (inbound-smtp.eu-central-1.amazonaws.com resolves; the region is in the authoritative
    docs table; the receiving control plane answers in this account). So the technical
    blocker people assume exists does not, and the question is entirely product and
    liability. The hard constraint is that MX is DOMAIN-WIDE, not per-address: you cannot
    have Google Workspace mailboxes AND SES aliases on the same domain. Any inbound offering
    on the apex therefore DISPLACES the tenant's real mailbox provider, which is the exact
    opposite of the "guide them to an external provider" strategy. A second constraint is
    that receiving mail and forwarding it onward breaks SPF at the final recipient and
    needs SRS-style sender rewriting to work — a mail-server-grade problem the problem
    statement explicitly rules out.
  OPTIONS:
  - A. No inbound. Ever. Remove email-4 from the track.
    RISK: does not directly answer a client asking "where do orders@ and office@ land?" —
    though an external mailbox provider answers it completely, and better.
    REWARD: zero mail-handling liability; no MX authority over any client domain; no
    third-party PII or attachment custody; no GDPR retention surface; no malware ingestion
    path; no spam/loop/forwarding operations; and it holds the ROADMAP row's own "NOT a mail
    server" line without needing judgement calls later.
  - B. Inbound ONLY on a subdomain the tenant delegates (e.g. forms.example.com MX →
    inbound-smtp.eu-central-1.amazonaws.com), positioned as a forms/orders ARCHIVE, never
    as mailboxes and never forwarding.
    RISK: addresses read as `orders@forms.example.com`, which is commercially weak and not
    what a client means by "my email"; still takes custody of third-party mail content, so
    GDPR retention and malware scanning still apply; adds an S3 + rule-set surface to
    operate; and the design MUST use one shared active rule set, because 40 rule sets per
    account is unraisable (§ 3.3) and a per-tenant allocation dies at 40 tenants.
    REWARD: does NOT displace the tenant's mailbox provider — the two coexist cleanly;
    genuinely useful for machine mail (a durable archive of what a form actually received);
    small blast radius; reversible by deleting one MX record.
  - C. Full inbound on the apex: AmodX becomes the receiver and forwards to the tenant's
    real mailbox.
    RISK: highest of any option in this document. You become a mail server in every way
    that matters operationally — spam filtering, loop detection, retries, forwarding that
    breaks SPF and needs SRS, the 40 MB inbound ceiling against a 10 MB v1 send cap
    (§ 3.3, F-EMAIL-9), retention, and ownership of every outage of the client's BUSINESS
    EMAIL rather than merely their website. It directly contradicts the human's own stated
    constraint.
    REWARD: the "we handle your email too" sales pitch, in full.
  RECOMMENDED: A for the sales-facing product. Consider B ONLY when a NAMED tenant asks for
    a forms archive, and then only on a delegated subdomain with retention defined up front.
    Reject C explicitly and permanently — it is the thing the problem statement rules out,
    and the SPF-on-forward problem alone makes it a standing liability.
  BLOCKING_REASON: email-4 is a large phase (CDK, S3, PII retention, GDPR) whose existence
    is entirely conditional on this answer. Authoring its slice doc before ratification
    risks a WITHDRAWN phase and wasted design, and the CDK surface it would add is
    production-sensitive under the standing no-infra-without-named-gain directive.

- ID: D-EMAIL-3
  QUESTION: What is AmodX's stance on recommending a mailbox provider?
  PROBLEM: "Guided DNS for external mailbox providers" means AmodX publishes provider
    recipes, and that is an implicit endorsement. Recommending a provider makes AmodX
    partly accountable for its outages, price changes, and support quality; NOT recommending
    one leaves the client with the choice paralysis that IS the migration friction we set out
    to remove. § 3.1 removed the one in-AWS option: WorkMail support ENDS 2027-03-31, so it
    cannot be a migration target for anyone, eligible or not, and there is no AWS-native
    fallback to point at. Note AWS itself now points at Kopano Cloud, Zoho Mail, and Zoom
    Mail — not Workspace or M365.
  OPTIONS:
  - A. Neutral recipe library (Workspace / M365 / Zoho / keep-existing-host), no
    recommendation, no commercial relationship.
    RISK: the client still has to decide, so the sales cycle stays long and the friction is
    reduced rather than removed.
    REWARD: no liability for a third party's service; no vendor lock; recipes are pure data
    with a "last verified" date, so the smallest possible implementation satisfies the
    requirement and adding a provider is a data edit, not a code change.
  - B. One default recommendation, others available.
    RISK: accountability when the recommended provider has an outage, raises prices, or
    changes its DNS records; a support burden AmodX did not price in; and a subtle
    conflict — "guided" advice that steers.
    REWARD: removes the decision from the client, which is the actual friction.
  - C. Reseller / affiliate relationship (e.g. Google Workspace reseller).
    RISK: contractual and support obligations to the vendor; a billing surface; this becomes
    a business line with its own operations, not a CMS feature; and it puts a financial
    incentive behind "guided" advice, which corrodes the advice.
    REWARD: margin, plus a genuinely one-click provisioning experience.
  RECOMMENDED: A for the shipped product surface — a data-driven recipe list is the smallest
    thing that satisfies the requirement, and it keeps AmodX out of a third party's support
    chain. Express B as SALES GUIDANCE inside email-5's checklist (a human recommending a
    provider in a conversation), not as code. Defer C entirely: it is a business decision,
    not an architectural one, and nothing in the track blocks on it.
  BLOCKING_REASON: determines whether email-2's UI is a neutral picker or a default-plus-
    alternatives flow, and whether the recipe list is product data or a commercial artifact
    with contractual constraints on its content.

- ID: D-EMAIL-4
  QUESTION: Does AmodX ever WRITE tenant DNS, or only read and instruct?
  PROBLEM: "Guided DNS" spans three very different products: (i) instructions the client
    copies into their own DNS panel, (ii) instructions plus a read-only checker that reports
    what is actually published, or (iii) AmodX holding DNS authority and writing records
    itself. This single choice decides whether the track needs a DNS-provider adapter layer,
    a credential store, and a per-provider breaking-change surface — or one Lambda doing
    read-only lookups. The observed estate is the key evidence: four tenant/platform domains
    across FOUR different DNS providers (Bluehost, spatiul.ro, Cloudflare, Route53 — § 2.4),
    with only amodx.net in Route53. There is no dominant provider to build against.
  OPTIONS:
  - A. Instructions + read-only public-DNS checker (resolver queries from a backend Lambda).
    RISK: the client can still mis-enter a record and we can only diagnose, never fix; DNS
    caching means "not published" is indistinguishable from "not yet propagated" in a single
    read, so verdicts must be timestamped and never permanent.
    REWARD: no credentials held for any third party; no adapter layer; no provider matrix;
    no write blast radius. One handler plus one admin card satisfies the ratified behaviour
    that the check must be VISIBLE to the tenant admin.
  - B. Route53 zone delegation for tenants willing to move their DNS to AmodX.
    RISK: taking the zone means owning the client's ENTIRE DNS, not just their email — a bad
    MX edit can take their website down too; migrating existing records (A, CNAME, TXT,
    verification tokens like the four google-site-verification records observed on
    bijuterie.software) is manual and error-prone; and it makes AmodX the on-call for their
    whole domain.
    REWARD: full automation of DKIM, SPF, DMARC, and MX with no client action; DKIM
    verification becomes instant and reliable.
  - C. Registrar / DNS-provider API adapters (Cloudflare, GoDaddy, cPanel, Bluehost, …).
    RISK: N adapters, N credential stores, N authentication models, N breaking-change
    surfaces — and the observed spread means N is not small. This is the textbook
    imagined-variation abstraction the repo's directives forbid without demonstrated need:
    zero concrete callers exist today.
    REWARD: automation without requiring a zone transfer.
  RECOMMENDED: A. It satisfies the ratified behaviour with one Lambda and no credential
    surface, and it is the only option whose failure mode is "unhelpful" rather than
    "outage." Offer B per-tenant on request as an OPERATOR RUNBOOK, not a product feature.
    Reject C until at least two tenants concretely demand it — the four-provider spread
    observed today is exactly the N-adapters trap, and "flexibility" is not a justification.
  BLOCKING_REASON: this is a module-boundary and credential-custody decision. Option C
    implies a new adapter layer and a secrets surface; option B implies AmodX operating
    client DNS. Both are foundational and hard to reverse once tenants depend on them,
    whereas A is additive. email-2 cannot be authored without knowing which it is.

- ID: D-EMAIL-5
  QUESTION: Do we adopt SES Tenants (and therefore migrate the six send sites from the SES
    v1 SDK to v2)?
  PROBLEM: All six send sites use `@aws-sdk/client-ses` (SES v1) — OBSERVED, § 2.1. SES has
    a native multi-tenancy construct: `aws sesv2 list-tenants` succeeds in this
    account/region and returns empty, with a 10,000-tenant quota (§ 3.3). SES Tenants and
    VDM are v2-ONLY. Consequences of staying on v1: no per-tenant reputation isolation, no
    per-tenant deliverability metrics, and a 10 MB message cap instead of 40 MB. This is not
    a defect today — 2 sends in 30 days (§ 2.2) — but it is the ceiling that
    per-tenant reputation reporting runs into, and it is aggravated by the account being
    shared with a foreign workload (F-EMAIL-12).
  OPTIONS:
  - A. Stay on SES v1; no SES Tenants.
    RISK: per-tenant reputation and deliverability metrics are unavailable, so email-3 can
    only ever report DNS-record presence, never actual per-tenant delivery health; the 10 MB
    cap stands (below the 40 MB inbound ceiling, so an inbound-then-resend path could not
    handle its own largest messages).
    REWARD: zero migration; no change to six working handlers; no new IAM actions.
  - B. Migrate the six send sites to SESv2 and adopt SES Tenants once per-tenant identities
    exist (i.e. conditional on D-EMAIL-1 = B or C).
    RISK: touches all six senders plus five IAM grants (F-EMAIL-10) — a broad, low-reward
    change if D-EMAIL-1 lands on A, since without per-tenant identities there is nothing
    meaningful to isolate; new SDK dependency and new API shapes to re-verify against the
    2-sends/30-days reality, i.e. weak production signal that the migration worked.
    REWARD: native per-tenant reputation isolation (a genuine multi-tenant guarantee, in the
    spirit of VISION § "Tenant isolation is absolute"); per-tenant metrics that make
    email-3's panel real; 40 MB cap; VDM dashboards.
  RECOMMENDED: A for now. Revisit ONLY if D-EMAIL-1 resolves to per-tenant identities AND a
    tenant asks for delivery metrics. Adopting SES Tenants under a shared platform identity
    would isolate nothing while costing a full SDK migration.
  BLOCKING_REASON: NOT blocking email-2 and NOT blocking a DNS-record-presence version of
    email-3. It DOES block any per-tenant reputation or delivery-metric surface, so it must
    be answered before email-3's scope is written as "delivery health" rather than
    "authentication configuration." Answer after D-EMAIL-1.

- ID: D-EMAIL-6
  QUESTION: How is F-EMAIL-1 (no per-tenant sender) absorbed into the ratified phase order,
    given that the ROADMAP row does not mention it?
  PROBLEM: The ratified EMAIL row orders the work audit → guided DNS → SES DKIM/DMARC
    health → optional inbound → checklist. The audit found that the sending foundation sits
    UNDERNEATH the middle two and is broken. Concretely: guided DNS (email-2) tells a tenant
    which DKIM records to publish, but with a shared platform identity there IS no
    tenant-domain DKIM to publish and no SPF for AmodX to be included in — the page would
    list records that authorize nothing we do. And a per-tenant DKIM/DMARC health page
    (email-3) on a shared identity reports the health of bijuterie.software for all 99
    tenants: one platform status light rendered 99 times, not a per-tenant surface. Fixing
    F-EMAIL-1 is therefore a PREREQUISITE, not a follow-up — but re-ordering a ratified
    ROADMAP row is not a builder's call. Separately, the CHEAP half of the fix (From display
    name + customer-facing Reply-To, which also addresses F-EMAIL-2) needs no DNS, no IAM
    change, no CDK change, and no answer from D-EMAIL-1 — but it is NOT decision-free: per
    F-EMAIL-2b there is no guaranteed value to put in Reply-To, so the absent-value
    behaviour is a sub-decision of option D below and must be settled with it.
  OPTIONS:
  - A. Fold the per-tenant sender into email-2 as its stated prerequisite; keep the row's
    numbering unchanged.
    RISK: email-2 becomes a large slice spanning schema, CDK, five IAM grants, six send
    sites, and admin UI — which violates the one-deployable-unit slice principle and makes
    rollback reasoning muddy.
    REWARD: no renumbering, no ROADMAP churn, one conversation with the tenant.
  - B. Insert a new slice `email-2a` (sender identity) before email-2, leaving the row's
    other numbers intact.
    RISK: minor ROADMAP churn and one more slice doc to author and review.
    REWARD: keeps each slice one deployable/rollback-reasoned unit per VISION § "How work is
    executed"; the sender change is independently deployable and independently revertible;
    the ratified row's numbering survives.
  - C. Defer the per-tenant sender entirely; ship email-2 and email-3 against the shared
    identity and accept a platform-status-light instead of a per-tenant panel.
    RISK: email-3 ships something that LOOKS like a per-tenant health surface but is not —
    a false-confidence defect of exactly the kind § 4.3 warns about, and one that would need
    rebuilding the moment D-EMAIL-1 resolves to B; the brand-leak defect stays live
    indefinitely.
    REWARD: fastest path to something shipped.
  - D. Split by cost: ship the no-DNS half NOW as a standalone hotfix outside the track
    (From display name + customer Reply-To, narrowing F-EMAIL-2 and half of F-EMAIL-1's
    symptom), and handle the full per-tenant identity as email-2a per option B.
    RISK: two changes to the same send sites at different times, so the second must not
    assume the first is absent; needs a debt note to keep them associated. AND it carries
    the sub-decision below, which must be answered in the same breath.
    REWARD: a live product defect narrows immediately at near-zero risk without waiting on
    D-EMAIL-1; and the remaining work is honestly scoped as its own slice. This is the same
    shape as cache-6 — repair broken deployed behaviour independently of the track that
    surrounds it.
  SUB-DECISION D.i (only if D is chosen) — what is Reply-To when the tenant has NOT
    configured one? Per F-EMAIL-2b, `integrations.contactEmail` is optional, the admin field
    is unvalidated free text, and an unset value may be `undefined` OR the empty string.
    This is a behaviour choice, not an implementation detail, because it decides where a
    real customer's reply lands for every tenant that never filled the field in:
  - D.i-1. Omit ReplyToAddresses entirely when the value is falsy — i.e. today's behaviour
    for unconfigured tenants, corrected behaviour for configured ones.
    RISK: unconfigured tenants keep the exact defect (customer replies reach AmodX), so the
    fix silently covers an unknown fraction of the estate; nobody is told which tenants are
    still affected.
    REWARD: strictly additive; cannot make anything worse; smallest possible change; and it
    is not a new pattern — `backend/src/forms/public-submit.ts:144` ALREADY does exactly
    this (`ReplyToAddresses: submitterEmail ? [submitterEmail] : undefined`), so the fix is
    reuse of a working shape rather than invention, and it makes the estate self-consistent.
  - D.i-2. Fall back to `orderProcessingEmail`, then omit. (Also `.optional()` —
    `packages/shared/src/index.ts:390`.)
    RISK: `orderProcessingEmail` is documented as the FULFILMENT team's address, so customer
    replies would land in a fulfilment queue rather than customer service — plausible for
    most merchants, wrong for some, and chosen on their behalf without telling them.
    REWARD: covers more tenants than D.i-1 with no new schema field.
  - D.i-3. Fall back to the platform address (`FROM_EMAIL`), mirroring the existing
    `contact/send.ts:74` recipient fallback.
    RISK: this is INDISTINGUISHABLE from omitting it — the reply still reaches AmodX — while
    LOOKING in code review like the case was handled. That is a false-confidence defect of
    the kind § 4.3 warns about, and it is worse than D.i-1 for that reason alone.
    REWARD: one uniform code path; no conditional.
  - D.i-4. D.i-1 plus make the gap VISIBLE: surface "customer replies to order mail are not
    reaching you — set a Contact Email" in admin for tenants with no value.
    RISK: a small admin UI change, so the hotfix is no longer purely backend and its blast
    radius grows slightly.
    REWARD: it is the deep-vertical rule applied to this defect — the condition becomes
    visible to the tenant admin who can actually fix it, instead of staying an invisible
    partial fix. Consistent with how every phase in § 4 is required to behave.
  RECOMMENDED: D, with D.i-1 as the shipped behaviour and D.i-4 as a fast follow. D.i-1
    alone is provably safe and cannot regress a working tenant. Reject D.i-3 explicitly: it
    is the same outcome as D.i-1 while reading as a handled case. D.i-2 chooses a
    customer-service policy on the merchant's behalf and should not be made in a hotfix.
    Note this makes the hotfix a CONDITIONAL improvement — "F-EMAIL-2 is fixed for tenants
    that have configured a contact address" — and it must be reported that way, not as
    closed. The full per-tenant identity is then email-2a under option B's reasoning.
  BLOCKING_REASON: this determines the phase boundaries and the slice numbering for the
    whole track, so no email-2 or email-3 slice doc can be authored until it is settled. It
    also touches the ratified ROADMAP row, which a builder must not re-order unilaterally.
```

---

## 7. Architectural boundaries the track must respect

Constraints, not aspirations. Each is drawn from an existing binding document.

1. **Tenant isolation (Critical Rule 3, VISION § 1).** Applied to a non-DynamoDB resource:
   any handler reading SES identity state or DNS for "a domain" must derive that domain
   **from the tenant record**, never from a request parameter. Otherwise tenant A reads
   tenant B's email configuration — the same class of leak as a cross-tenant query.
2. **PD-002 (renderer-proxy) / Track B.** Bounce and complaint events contain recipient
   addresses — customer PII. They must not become renderer-readable. `email-obs` therefore
   either lands after `cmrc-1` or stores nothing in the renderer's IAM reach.
3. **Dependency rule + volatility isolation (`CLAUDE.md` § Clean Architecture 1, 3).** SES,
   DNS resolvers, and mailbox providers are volatile external mechanism. The *policy* —
   "is this SPF record adequate?", "is this DMARC policy sufficient?" — is pure business
   logic and belongs in a pure, unit-testable function over a DTO, in `test-3`'s layer.
   Keeping the two apart is what makes the health check testable without AWS credentials.
4. **Shared-first types (Critical Rule 4).** A DNS-record DTO shared by admin and backend
   goes in `packages/shared/src/index.ts` first — **and only if both actually consume it.**
   If only admin renders the recipes, they stay in admin. One caller is not two.
5. **No new abstraction without demonstrated variation.** Explicitly: **do not** build a
   `MailboxProviderGateway`, a `DnsProviderAdapter`, or a `DeliverabilityCheck` registry.
   Provider recipes are **data**. There are zero concrete callers for a DNS-write adapter
   today (D-EMAIL-4), and the four-provider spread in § 2.4 is the reason such a layer would
   be permanent debt rather than flexibility.
6. **Standing no-CDK-without-named-gain directive (`docs/ROADMAP.md`).** `email-4` (inbound)
   and `email-obs` (bounce visibility) touch `infra/`. Each must state its concrete gain at
   the cdk-diff gate. `email-obs`'s gain is stated in § 4.4 and is real: a live tenant can
   currently stop receiving order notifications with no signal at any layer.
7. **`test-4` named assertions.** Any SES resource added to CDK gets a **named** assertion
   in `infra/test/amodx-stack.test.ts` — not a snapshot. `cache-6`'s lesson applies with
   full force here: *the defect shipped precisely because nothing asserted the list*, and
   § 2.7 shows there is currently nothing at all to assert.
8. **Naming honesty (`CLAUDE.md` § 9 / agent contract).** `integrations.contactEmail` is a
   **recipient**, and its name invites the reader to think it is a sender. Any per-tenant
   sender field must be named unmistakably (`sendFromAddress`, not `email`). Renaming
   `contactEmail` itself is a boundary-touching change — persisted tenant configs, admin UI,
   four backend read sites — and is **not** proposed here. It is recorded as a naming defect
   for a future decision.

---

## 8. Open questions for the human (not blocking § 6)

1. **Is `mocheta.com` an AmodX tenant, or the other application's domain?** § 2.5 concludes
   `INFERRED` that it belongs to a separate workload — it is absent from
   `amodx.config.json`'s tenant list and unreferenced in the repo. Confirmation changes the
   reading of the suppression list in § 2.6 from "worked example" to "live AmodX incident."
2. **Should AmodX have its own AWS account, or its own SES configuration set at minimum?**
   F-EMAIL-12: reputation, quota, enforcement status, and the suppression list are all
   shared with a non-AmodX app today. A separate account is the clean answer and is far
   outside this track; a per-product configuration set is the cheap partial mitigation and
   would fold into `email-obs`.
3. **Is the Cognito → SES invite path actually working?** F-EMAIL-11 — `Policies: {}` on the
   identity, and `backend/src/users/invite.ts` sends its own mail independently, so the
   Cognito template may be dead configuration. One staging invite settles it.
4. **Is `F-EMAIL-8`'s `HOST_NOT_FOUND` benign?** Two consecutive days of
   `get-email-identity` output settles it. It matters because a sustained re-check failure
   revokes the identity and stops all tenant mail, silently.
5. **How were the five existing SES identities created, and is there a record of the DKIM
   setup?** F-EMAIL-7 / § 2.7: CloudFormation and CloudTrail have both been ruled out as
   sources of the answer, so it can only come from the human. It is **not** blocking — no
   phase depends on it — but two things turn on it: (a) if a non-CloudFormation IaC tool
   (Terraform, Pulumi) declares them, then adopting CDK for SES creates a **second owner of
   the same resources**, which is a conflict to design around rather than a gap to fill; and
   (b) if the DKIM CNAMEs were placed manually in third-party zones, nobody holds a record of
   what was published where, which is exactly the state `email-3`'s health surface must
   reconstruct by querying.
6. **How many prospects have actually been lost or delayed over email migration?** The whole
   commercial premise of this track. Even a rough count changes whether `email-5`'s
   checklist should precede `email-2`'s tooling — a checklist a human follows may capture
   most of the value at a fraction of the cost.

---

## 9. References

- `docs/VISION.md` — tenant isolation as a product guarantee; slice execution model.
- `docs/ROADMAP.md` § *Backlog / Discovery Tracks*, EMAIL row — the ratified phase order
  this document decomposes, and the standing no-CDK-without-named-gain directive.
- `docs/platform-decisions.md` — PD-002 (renderer-proxy) bounds where bounce PII may live.
- `docs/documentation.md` — status taxonomy, required slice sections, evidence labels,
  reconciliation rules. Note: this track needs a new `email-` prefix registered in
  § *Naming Conventions* when its first slice doc is authored.
- `infra/ARCHITECTURE.md` § *Certificates & DNS*, § *Testing* — the Route53/ACM surface and
  the named-assertion regime any SES CDK resource must join.
- `docs/TECH-DEBT.md` — **proposed** destination for F-EMAIL-2/2b, F-EMAIL-7, F-EMAIL-8,
  F-EMAIL-10, F-EMAIL-11 and the `contactEmail` naming defect (§ 7.8): these are defects in
  their own right and stay live whether or not this track is promoted. `email-1` did **not**
  write them there — the slice's writable surface is this document plus the ROADMAP row, and
  adjacent debt tracking is out of scope. Recording them is a follow-up action for whoever
  ratifies § 6.
- `docs/shipped/slices/cache-6-distribution-transport-hotfixes.md` — the precedent for
  repairing broken deployed transport independently of the surrounding track (D-EMAIL-6
  option D), and for pinning it with named assertions.
- AWS: `docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html`;
  `docs.aws.amazon.com/general/latest/gr/ses.html` § *Email Receiving endpoints*;
  `docs.aws.amazon.com/ses/latest/dg/quotas.html`. All fetched `EXECUTED` 2026-07-30.
