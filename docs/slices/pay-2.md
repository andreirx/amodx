# PAY-2 — online card payment for orders, and fulfilment when an order becomes paid (SPECIFICATION slice)

Status: **PLANNED (specification, revision 2 of 2026-11-22, not ratified) — four decisions open (§ 15).** Track:
commerce. Depends: `pay-1` (shipped to staging 2026-11-21). Prerequisite of `sched-1h` (booking products),
`invoice-1`, `voucher-1`. Maturity target of the build slices: PROTOTYPE until the sandbox run of § 11.4 passes.
This slice writes the specification; it changes no code. It replaces the stub of 2026-11-20 (decision PAY-PROVIDER
is closed by the human's direction of 2026-11-22, § 1). Revision 1 applies review-0 (PAY2-R01…R09) and the
operator rulings of 2026-11-22; revision 2 applies review-1; the closure record is § 18.

Evidence labels: **OBSERVED** (read in the file at `main` `4fdd89e` on 2026-11-22, or read on a public web page on
2026-11-22 — the URL is given), **EXECUTED** (a command run by the author of this specification), **INFERRED**
(reasoned, not seen), **NOT RUN** (a check that needs a merchant account, a browser or a deployment). "Vendor
fact" means a fact read on the processor's public pages or in its official source code on 2026-11-22.

## 1. Direction of the human (2026-11-22) — settled, not open

1. One payment path for shop orders, digital products and bookings: **the order**.
2. First processor: **Netopia**. The human asks the clients which processor they use. The payment step must accept
   a second processor with no change to orders or bookings.
3. No real shop tenant exists; a demo comes first. No migration of live orders; no protection of card payments that
   do not exist. Existing demo and test data must keep parsing.
4. Booking products ("buy first, then pick the date") are the next specification, `sched-1h`. This document
   defines the event they attach to (§ 7) and nothing of their behaviour.

Operator rulings applied (2026-11-22): **PAY2-NOPROCESSOR-SCOPE = A** — "no change for a tenant without a
processor" applies to the processor behaviour (card method, attempts, notification route). The fulfilment point
"order became paid" (§ 7) applies to every tenant: a bank-transfer order with a digital line that the admin marks
paid gets its delivery. The preservation criterion is row **P0** (§ 11.3): an order with no digital or booking
line and no card payment behaves and is stored as today.

## 2. The problem and the facts

### 2.1 The problem

A visitor can pay for an order only by cash on delivery (and, as stored settings allow, bank transfer — see C21).
A buyer of a course or of a digital file expects to pay by card and to get the item at once. Nothing in the
platform reacts when an order becomes paid, except the "payment received" mail of `pay-1`. The only "buy" button
with online payment (Paddle) never delivered a purchase (§ 2.3).

### 2.2 Facts in the code (OBSERVED at `4fdd89e`)

- **C1** — Payment methods are an enum of two values in three places: the tenant setting, the stored order, the
  order request. `packages/shared/src/index.ts:1285`, `:1816`, `:1872`.
- **C2** — The order is written with `status: "placed"`, `paymentStatus: "pending"`; `total` is computed as a JS
  number (`subtotal + shippingCost - couponDiscount`) and stored as a number. `backend/src/orders/create.ts:349`,
  `:404-432`.
- **C3** — `OrderSchema` declares `subtotal` and `total` as **strings**; no code parses a stored order with
  `OrderSchema` (`grep -rn "OrderSchema[^a-zA-Z]"` over `backend/src renderer/src admin/src packages/shared/src
  tools/mcp-server/src`: only the type export and a comment). `index.ts:1809`, `:1812`.
- **C4** — The order currency is the tenant currency at creation (`tenantConfig.currency || "USD"`).
  `create.ts:337`.
- **C5** — The order handler does not check the request's `paymentMethod` against the tenant's
  `enabledPaymentMethods`; it reads the method only to store it and to label the mail. `create.ts:63-67`, `:418`,
  `:618`.
- **C6** — The mail label of the method is `bank_transfer ? "Bank Transfer" : "Cash on Delivery"` in three
  handlers: a third method would be labelled "Cash on Delivery". `create.ts:618`, `orders/update.ts:227`,
  `orders/update-status.ts:137`.
- **C7** — `paymentTransition(previous, requested)` is the one payment-state rule: `pending → paid`, `paid →
  refunded`; same → no-op; every other pair refused. `packages/shared/src/payment-transition.ts:31-57`.
- **C8** — `changePaymentStatus` is the one place the transition is written: read, rule, conditional write on the
  state read (`attribute_not_exists` or `= :previous`), audit `UPDATE_ORDER_PAYMENT`, then `sendPaidMail` for
  `pending → paid`. It writes `paymentStatus`, `updatedAt`, `paidAt` only. `sendPaidMail` logs and swallows every
  error. `backend/src/orders/update.ts:105-181`, `:189-252`.
- **C9** — The browser posts the order straight to the API (`POST /public/orders`, route without authorizer) and
  then goes to `checkout/confirm?id=<orderId>&email=<email>`. `renderer/src/components/CheckoutPageView.tsx:366-401`;
  `infra/lib/api-commerce.ts:286`.
- **C10** — The confirmation and tracking pages read the order straight from DynamoDB on the server side
  (`getOrderForCustomer`: key `ORDER#<id>`, then the stored email must equal the normalized query email); they are
  served by the dynamic twin (`no-store`). `GET /public/orders/{id}?email=` applies the same rule.
  `renderer/src/components/SitePage.tsx` (`SitePage`, the `checkout-confirm` and `checkout-track` branches); `getOrderForCustomer` in `renderer/src/lib/dynamo-customer-reads.ts`;
  `backend/src/orders/public-get.ts:16-28`; `docs/caching-architecture.md:97-109`.
- **C11** — The renderer's server function can read the whole main table (`grantReadData`).
  `infra/lib/renderer-hosting.ts:272`.
- **C12** — The HTTP API has a default Lambda authorizer whose identity sources are `Authorization` and
  `x-api-key`; the commerce nested stack's `addRoute(…, { noAuth: true })` sets `authorizationType: 'NONE'`.
  `infra/lib/api.ts:109-118`; `infra/lib/api-commerce.ts:104-128`.
- **C13** — Tenant secrets (`recaptcha.secretKey`, `integrations.google.clientSecret`,
  `integrations.braveApiKey`) live in the tenant record `SYSTEM / TENANT#<id>`; `GET /settings` deletes them;
  `GET /settings/secrets` returns them to `TENANT_ADMIN`/`GLOBAL_ADMIN`; `PUT /settings` deep-merges so an absent
  secret is kept. `backend/src/tenant/settings.ts:250-275`, `:363-380`; `backend/src/tenant/settings-secrets.ts:9-60`.
  Platform secrets are AWS Secrets Manager secrets created by CDK (`infra/lib/amodx-stack.ts:106-140`).
- **C14** — Renderer proxies that call the backend with the renderer key exist (`x-api-key`).
  `renderer/src/app/api/contact/route.ts:44`, `leads/route.ts:58`.
- **C15** — Digital products: `productType: "physical" | "digital"`, `paymentLinkId` (Paddle), `resourceId` (a
  file in the private bucket, item `TENANT#<t> / RESOURCE#<id>` with `s3Key`). The admin digital editor saves
  `productType: "digital"`. `index.ts:1628-1632`; `admin/src/pages/DigitalProductEditor.tsx:102`.
- **C16** — Two product surfaces. (a) The slug page (`ProductPageView`, `renderer/src/components/site-page/product-page.tsx`) shows the Paddle button when
  `paymentLinkId` is set, and "Add to cart" only when `commerceEnabled` is true **and** `paymentLinkId` is not set;
  so a digital product without `paymentLinkId` goes to the cart there. (b) The by-id page
  (`renderer/src/components/ProductByIdPage.tsx:136-145`, routes `renderer/src/app/[siteId]/products/[productId]/
  page.tsx` and its `%5Fdyn` twin) has **no cart action at all**: an in-stock product shows the Paddle button when
  `paymentLinkId` is set and nothing otherwise; an out-of-stock one shows a disabled button.
- **C17** — `amountInCents(amount: number)` exists (rounds half up after a float-noise guard).
  `packages/shared/src/coupon.ts:59-61`.
- **C18** — The private bucket is not a prop of the commerce nested stack; a grant on it to a commerce function is
  wired from the parent (precedent: `updateReviewFunc`, REV2A). `infra/lib/api-commerce.ts:15-41`.
- **C19** — The audit bus accepts an actor with an `id` and no email; the authorizer's `SERVICE_KEY_USED` entry is
  the precedent for a non-person actor. `backend/src/lib/events.ts:6-18`; `backend/src/auth/authorizer.ts:195-200`.
- **C20** — `bookingItemsForOrderLine` (`sched-1.md` § 17.2) is not built (`grep -rn bookingItemsForOrderLine
  backend/src packages/shared/src`: no hit).
- **C21** — `mapTenant` is a whitelist and does **not** copy `enabledPaymentMethods`; `SitePage` (`SitePage.tsx`, the `checkout` branch) passes
  `config.enabledPaymentMethods` (always absent) to the checkout, whose default is `["cash_on_delivery"]`
  (`CheckoutPageView.tsx:179`). So today the checkout never offers bank transfer, whatever the stored setting.
  `renderer/src/lib/dynamo.ts:127-209`.
- **C22** — An order line is written with `productId`, `productTitle`, `quantity`, `unitPrice`, `totalPrice`,
  `selectedVariant`, `personalizations`, `imageLink`; nothing about delivery. `create.ts:198-207`;
  `OrderItemSchema` `index.ts:1772-1787`.
- **C23** — A resource's `s3Key` is `<tenantId>/<resourceId>-<filename>`. `backend/src/resources/presign.ts:92`.
- **C24** — The order status writer (`PUT /orders/{id}/status`) writes `status` with no condition.
  `backend/src/orders/update-status.ts:73-79`.

### 2.3 Paddle — the corrected findings

- **P1** — `POST /webhooks/paddle` is behind the default authorizer (no `noAuth`, no override at
  `infra/lib/api.ts:797-801`). A request with no credential answers 401; Paddle's own notification carries no
  platform credential, so it never reached the handler. OBSERVED (code; staging calls in
  `docs/slices/paddle-hook-1.md`).
- **P2** — Since `paddle-hook-1` the handler fulfils nothing (200 `Not processed`, one log line). The function keeps
  grants it does not use: private bucket read, table read, `ses:SendEmail`/`SendRawEmail`. OBSERVED,
  `backend/src/webhooks/paddle.ts:40-43`; `infra/lib/api.ts:781-801`.
- **P3** — The header comment of the handler says "public route". That is not true (P1). Name/comment mismatch,
  recorded in § 16. OBSERVED, `paddle.ts:4`.
- **P4** — The buy buttons send no tenant or product with the checkout (no `passthrough`, no `data-custom-data`).
  A completed Paddle checkout could not be tied to a tenant or a product. OBSERVED, `ProductPageView` (`site-page/product-page.tsx`, the Paddle button),
  `ProductByIdPage.tsx:137-145`.
- **P5** — The buttons use `data-product`. Paddle's current HTML checkout page for `paddle.js` v2 documents
  `data-items` (`[{"priceId":"pri_…","quantity":1}]`) and does not mention `data-product`. The loader calls
  `Paddle.Environment.set` and `Paddle.Setup`; the v2 page documents `Paddle.Initialize({ token })`. So the button
  most likely opens no checkout. Vendor fact (https://developer.paddle.com/paddlejs/html-data-attributes,
  https://developer.paddle.com/paddle-js/about/include-paddlejs, read 2026-11-22); the effect on the site is
  INFERRED, NOT RUN in a browser.
- **P6** — Conclusion: no purchase was ever fulfilled through Paddle on this platform. INFERRED from P1, P4, P5.

### 2.4 Netopia — vendor facts (read 2026-11-22)

Sources (all read 2026-11-22):
[D1] https://doc.netopia-payments.com/docs/payment-api/v2.x/intro ·
[D2] https://doc.netopia-payments.com/docs/payment-api/v2.x/start/start-strc ·
[D3] https://doc.netopia-payments.com/docs/payment-api/v2.x/start/sample-response ·
[D4] https://doc.netopia-payments.com/docs/payment-api/v2.x/start/start-Error ·
[D5] https://doc.netopia-payments.com/docs/payment-api/v1.x ·
[S] https://secure.sandbox.netopia-payments.com/spec (OpenAPI, "NETOPIA Payments - merchant API", version 1.0.0) ·
[K1] https://raw.githubusercontent.com/netopiapayments/composer/master/src/IPN.php ·
[K2] https://raw.githubusercontent.com/netopiapayments/composer/master/src/Status.php ·
[W] https://github.com/netopiapayments/WooCommerce (folder `netopia-payments-payment-gateway/v2/`: `lib/ipn.php`,
`lib/request.php`, `lib/start.php`, `wc-netopiapayments-gateway.php`) ·
[J1] https://raw.githubusercontent.com/netopiapayments/sample-app-js/main/app/routes/cart.js ·
[J2] https://raw.githubusercontent.com/netopiapayments/sample-app-js/main/app/routes/confirmation.js ·
[N] https://app.unpkg.com/netopia-payment2@0.1.7/files/dist/cjs/ipn.js and `…/readme.md`.
Pages that answered 404 on 2026-11-22: `…/v2.x/start/quick-start`, `…/v2.x/start/start-payment`, `…/v2.x/ipn`,
`…/v2.x/verify-auth/verify-payment`. The v2 documentation has **no IPN page** that could be read.

- **N1** — Vendor fact: API v2 is "the latest release … recommended for both new and existing customers"; v1 (XML,
  RSA envelope) "will be phased out". This specification uses v2 only; Source: [D5]
- **N2** — Vendor fact: Start a card payment: `POST /payment/card/start`; sandbox
  `https://secure.sandbox.netopia-payments.com`, live `https://secure.mobilpay.ro/pay`. Header `Authorization: <API
  key>` (raw key, no scheme); the key is generated in the merchant panel under Profile → Security; Source: [S]
  securitySchemes; [D2]; [W] `start.php`
- **N3** — Vendor fact: Request: `config` (required `notifyUrl`, `redirectUrl`, `language`), `payment` (`options`,
  `instrument`), `order` (required `posSignature`, `dateTime`, `description`, `orderID`, `amount`, `currency`,
  `billing`). `billing` requires `email`, `phone`, `firstName`, `lastName`, `city`, `country` (ISO 3166-1 numeric),
  `countryName`, `state`, `postalCode`, `details`. `shipping` and `products` are optional; Source: [S] `Config`,
  `Order`, `Address`
- **N4** — Vendor fact: Hosted page: Netopia's own WooCommerce plugin sends `payment.instrument` as `{ "type": … }`
  with no card fields, then sends the buyer to `payment.paymentURL` of the answer ("payment link for the specific
  order"). The JS sample redirects with `res.redirect(response.data.payment.paymentURL)`; the npm SDK README shows the
  form `https://secure-sandbox.netopia-payments.com/ui/card?p=…`. The card number is typed on Netopia's page; Source:
  [W] `request.php`, `wc-netopiapayments-gateway.php`; [J1]; [S] `Payment.paymentURL`; [N] readme
- **N5** — Vendor fact: Start answer: `payment.ntpID` ("NETOPIA internal id"), `payment.status`, `payment.paymentURL`,
  `error.code`/`message`. Error 56 "duplicated Order ID"; 99 "There is another order with a different price"; Source:
  [S] `Payment`; [D3]; [D4]
- **N6** — Vendor fact: Notification (IPN) body: `{ payment: { method, ntpID, status, amount, currency, instrument: {
  panMasked, … }, token, binding, code, message, data }, order: { orderID, data } }`; Source: [S] `NotifyRequest`,
  `PaymentNotify`, `OrderNotify`
- **N7** — Vendor fact: IPN signature (from official source code; no documentation page): header `Verification-Token`,
  a JWT. Checks in [K1]: `typ` = `JWT`; signature with Netopia's RSA public key (comment: RS512); `iss` = `NETOPIA
  Payments`; `aud` (string or first element of an array) = the merchant's POS signature; `sub` = base64(hash(sha512,
  **raw body**)). The WooCommerce plugin and the npm SDK do the same; both take the algorithm from the token's own
  header; Source: [K1]; [W] `lib/ipn.php`; [N] `ipn.js`
- **N8** — Vendor fact: Status values: [S] lists 3 = paid, 5 = confirmed, 12 = "invalid account" (start answer: 12 =
  rejected, 15 = 3-D Secure required). The SDK constants list 1 NEW … 3 PAID ("capture"), 4 CANCELED, 5 CONFIRMED, 8
  CREDIT ("capture & refund"), 11 ERROR, 12 DECLINED, 13 FRAUD, 14 PENDING_AUTH, 15 3D_AUTH, 23 EXPIRED and others. [K1]
  and [W] treat 3 and 5 as "deliver goods". The sources do not agree on every code; Source: [S]; [K1]; [W] `ipn.php`
- **N9** — Vendor fact: Acknowledgement: [K1], [W] return `{ "errorType": 0|1|2, "errorCode": …, "errorMessage": …
  }` (0 none, 1 temporary, 2 permanent) as JSON with HTTP 200. v1 states that `error_type` 1 makes Netopia "activate a
  resend IPN mechanism". For v2 no source states the retry rule, the interval, or the HTTP status Netopia expects;
  Source: [K1]; [W]; [D5]
- **N10** — Vendor fact: Server-side status read: `POST /operation/status` with `{ posID, ntpID, orderID }`; [S] marks
  it "will be available at a future date", yet the official JS sample calls it on the return page; Source: [S]; [K2];
  [J2]
- **N11** — Vendor fact: Refund: `POST /operation/credit` `{ ntpID, amount }` exists in [S], marked "will be available
  at a future date"; Source: [S]
- **N12** — Vendor fact: Amount: [S] `PaymentNotify.amount`: "amount in decimal units, i.e. 1234 = 12.34" (text and
  example disagree). Every official sample sends major units with decimals (`159.9`, WooCommerce `(float) get_total()`);
  Source: [S]; [W]; [N] readme
- **N13** — Vendor fact: Currency: v1 states other currencies (EUR, USD, GBP) are possible only when Netopia's legal
  department clears the merchant; "the amount will be converted to RON" otherwise. v2 states no currency list; Source:
  [D5]; [S]
- **N14** — Vendor fact: Sandbox console `https://sandbox.netopia-payments.com`; sandbox "mirrors the features of
  production". No test-card page was found; Source: [D1]
- **N15** — Vendor fact: The JS sample's return page does not trust the return: it reads the status from Netopia;
  WooCommerce changes order states only in the IPN handler; Source: [J2]; [W]

**Unknowns** (no readable source; each is a check of the sandbox spike `pay-2a`, § 12):
U1 unit of `amount` in the start request and in the IPN (N12); U2 whether Netopia retries an IPN, on which answer,
how often, for how long (N9); U3 whether the JWT carries `exp`/`iat`; U4 whether the RSA public key is one per
merchant account or one for all merchants, and how it is rotated; U5 the maximum length and the allowed characters
of `order.orderID`; U6 which billing fields may be empty strings (an order without an address); U7 how long a
`paymentURL` stays usable; U8 the status sequence of one sandbox payment (start → 3-D Secure → IPN 3 and/or 5); U9
whether `/operation/status` answers in the sandbox; U10 what Netopia appends to `redirectUrl`.

### 2.5 Fit with VISION and the platform decisions

- VISION guarantee 1 (tenant isolation): every key is under `TENANT#<tenantId>`; the notification binds its tenant
  by three checks, never by its body (§ 6.3).
- VISION guarantee 2 (the renderer is never the authority for private data): the return page is never proof of
  payment (§ 5.1 step 6); the API key is never stored where the renderer's role can read it (§ 4.4; C11 excludes
  the main table).
- VISION guarantee 3 (pure core): the attempt states, the reaction rule, the money rule and the payment-method label
  are pure code in `packages/shared`; Netopia, DynamoDB, S3 and SES stay behind the port and the handlers.
- Critical rules: no scan (§ 9.1: point reads and partition queries only); audit entries carry the order number as
  title (§ 5.3, § 7.5); the processor actor has no email, as the existing service-key actor (C19).
- PD-001: no customer identity is added.
- PD-002: the new browser actions go through a renderer proxy with the renderer key, tenant from the host. The
  access proof for a guest's order is the rule the order page already uses: order id **and** matching email (C10).
  No new authority is created and PD-002 is not amended by this slice. Whether that existing guest rule should be
  replaced (PD-002 names session-derived identity and has no guest-order variant) is recorded as finding PF7 for
  Track B/C. The processor's route is not a customer data action (§ 6.1). PD-003: not touched.

## 3. Domain model (pure; `packages/shared`)

### 3.1 Money and currency

- Amounts in the new types are **integer minor units** (`amountMinor`: bani for RON).
- `orderAmountMinor(total: unknown): Result<number, "total">` — the one money rule. Accepted: a finite number, or
  a text of the machine money form; then `amountInCents` (C17). The result must be a **safe integer > 0**. Refused:
  absent, `NaN`, infinite, ≤ 0, text that is not machine money, a positive total that rounds to 0 (e.g. `0.004`),
  and a total whose minor units exceed `Number.MAX_SAFE_INTEGER`. The order keeps its stored number (C2); the
  attempt copies `amountMinor` once, at attempt creation, from the stored order — never from the browser.
- Currency rule: the Netopia variant accepts **RON only** in this specification. Basis: N13 (other currencies need
  Netopia's clearance, else conversion — a converted amount would fail the amount check of § 5.4). A tenant with
  another currency cannot enable card payment (§ 4.4); an order whose stored currency is not RON gets no attempt.
- Conversion to and from the processor's unit is the adapter's job (U1); the domain compares integers only.

### 3.2 Payment method

`PaymentMethodSchema = z.enum(["cash_on_delivery", "bank_transfer", "card"])`, one definition used at the three
sites of C1. Additive: every stored value parses. `paymentMethodLabel(method)` (exhaustive `switch`, English, for the
backend mails of C6): `Cash on Delivery`, `Bank Transfer`, `Card` — the first two are today's texts.

### 3.3 Entitlement on the order line

The entitlement of a buyer is the **order line as written at purchase**. To deliver later without reading the
product again, a line needs one new optional field (boundary data; decision **PAY2-LINE-ENTITLEMENT**, § 15):

```ts
// OrderItemSchema: + delivery?: LineDelivery   (absent = the line needs no delivery)
export type LineDelivery = { kind: "download"; resourceId: string };   // sched-1h adds { kind: "booking"; … }
```

`create.ts` writes `delivery` only when the product read at purchase has `productType: "digital"` and a non-empty
`resourceId`. A line of any other product is written exactly as today (P0). A later change, deletion or new
`resourceId` of the product changes no stored line.

### 3.4 The payment attempt

One attempt = one try to pay one order at the processor. An order has 0…5 attempts (§ 5.1). The order's
`paymentStatus` (pay-1) stays the only answer to "is this order paid"; attempts are the evidence and the history.

```ts
// packages/shared/src/payment-attempt.ts
export type CardProcessor = "netopia";                         // a second processor adds a member here
export type Money = { amountMinor: number; currency: string };
interface AttemptBase {
    orderId: string; attemptNo: number;                        // 1..5; key and processor reference, § 9.1
    processor: CardProcessor;
    amountMinor: number; currency: string;                     // copied from the order at creation, never changed
    createdAt: string;
}
export type StartFailure = { kind: "refused"; code: string } | { kind: "no-answer" };
export type OrderEffect = "order-paid" | "order-already-paid" | "order-not-payable";
export type RefundedFrom =
    | { state: "succeeded"; succeededAt: string; orderEffect: OrderEffect }
    | { state: "amount-mismatch"; reported: Money }
    | { state: "not-paid" };                                   // refund observed before any payment observation
export type PaymentAttempt =
    | (AttemptBase & { state: "opening" })                     // written BEFORE the processor call
    | (AttemptBase & { state: "open"; processorPaymentId: string; openedAt: string })
    | (AttemptBase & { state: "start-failed"; failure: StartFailure; failedAt: string })
    | (AttemptBase & { state: "declined"; processorPaymentId: string; processorStatus: number; at: string })
    | (AttemptBase & { state: "amount-mismatch"; processorPaymentId: string; reported: Money; at: string })
    | (AttemptBase & { state: "succeeded"; processorPaymentId: string; succeededAt: string;
                       orderEffect: OrderEffect })
    | (AttemptBase & { state: "refunded"; processorPaymentId: string; refundedAt: string;
                       refundReported: Money; from: RefundedFrom });
```

- `opening` exists because the attempt key is the processor's order reference: if the function stops after the
  processor created the payment, the notification still finds its attempt.
- `start-failed` is not final: a `no-answer` failure (timeout) can hide a payment the processor did create.
- **Final financial observations**: `succeeded` (money in), `amount-mismatch` (money in, wrong amount), `refunded`
  (money out). `refunded` is final for every event: once a verified refund is stored, no later event pays the order.
- `order-not-payable`: the money arrived but pay-1 refuses `paid` (the order is `refunded`).

### 3.5 Processor events (the port's output)

```ts
export type AttemptRef = { orderId: string; attemptNo: number };
export type ProcessorEvent =
    | { kind: "paid"; ref: AttemptRef; processorPaymentId: string; reported: Money }
    | { kind: "declined"; ref: AttemptRef; processorPaymentId: string; processorStatus: number }
    | { kind: "refunded"; ref: AttemptRef; processorPaymentId: string; reported: Money }
    | { kind: "informational"; ref: AttemptRef; processorPaymentId: string; processorStatus: number };
```

Netopia mapping (adapter, § 4.3): 3 and 5 → `paid` (N8: both "deliver goods"); 12, 11, 4, 23 → `declined`; 8 →
`refunded`; every other integer (15, 13, 14, 1, 2, chargeback codes, unknown) → `informational` (logged, no state
change). The sandbox run (U8) confirms or corrects this table before `pay-2d` ships.

### 3.6 The reaction rule

`attemptReaction(attempt: PaymentAttempt, event: ProcessorEvent): Reaction` — pure, one arm per state × event kind,
no wildcard arm, a `never` check per `switch` (pattern of `paymentTransition`, C7). "Equal" = `reported` equals the
attempt's `amountMinor` and `currency`. "Same" = the event carries exactly the observation the attempt already stores
(same `processorStatus` for a decline; same `reported` for a mismatch or a refund).

**Rule (closes the replay class): a write happens only when the observation changes the stored attempt.** An event
that repeats the stored observation is `ignore (replay)` and writes nothing. Every attempt write is conditional on the
observation it read: `#state = :stateRead`, and for a stored `declined` also `processorStatus = :statusRead` (§ 5.5).
So two concurrent identical events produce one write: the second fails its condition, reads again, finds the same
observation stored and ignores it.

```ts
export type Reaction =
    | { kind: "pay-order" }                                    // § 5.3: one transaction, order + attempt
    | { kind: "record-declined" }
    | { kind: "record-mismatch" }
    | { kind: "record-refund" }                                // + shop alert (§ 7.5)
    | { kind: "ignore"; why: "replay" | "after-final" | "after-refund" | "informational" };
```

Rows = attempt state; cells in the order paid-equal / paid-not-equal / declined / refunded / informational. OPEN
means `opening`, `open`, `start-failed`; `declined` has its own row.

- **OPEN** — pay-order / record-mismatch / record-declined / record-refund (from `not-paid`) / ignore
  (informational).
- **`declined`** — pay-order / record-mismatch / same status: ignore (replay), other status: record-declined (the
  new status and `at` replace the old) / record-refund (from `not-paid`) / ignore (informational).
- **`succeeded`** — ignore (replay) / ignore (after-final; logged) / ignore (after-final) / record-refund (from
  `succeeded`) / ignore (informational).
- **`amount-mismatch`** — ignore (after-final) / same `reported`: ignore (replay), other: ignore (after-final;
  logged) / ignore (after-final) / record-refund (from `amount-mismatch`) / ignore (informational).
- **`refunded`** — ignore (after-refund; logged at warning) / ignore (after-refund) / ignore (after-final) / same
  `refundReported`: ignore (replay), other: ignore (after-refund; logged) / ignore (informational).

Every pair of events on one attempt, in both orders. Two concurrent events give the same result as the order in which
their writes commit (the rule above).

| First → then | Result |
|---|---|
| paid → refund | order paid, deliveries run; attempt `refunded` (from `succeeded`); shop alert |
| refund → paid | attempt `refunded` (from `not-paid`); the paid event is ignored; order stays pending; alert |
| paid → declined | order paid; decline ignored |
| declined → paid | decline stored, then order paid |
| declined (12) → declined (4) | one write each: the stored status becomes 4 |
| mismatch → refund | attempt `refunded` (from `amount-mismatch`); order stays pending; alert at each step |
| refund → mismatch | mismatch ignored (after-refund) |
| paid → mismatch, mismatch → paid | the first decides; the second is ignored (after-final) and logged |

Repeated events (the same event twice, sequential or concurrent), per kind:

| Event repeated | Writes in total |
|---|---|
| paid (equal) | one transaction (order + attempt); one paid mail; one delivery run |
| paid (not equal) | one attempt write (`amount-mismatch`); one alert |
| declined, same status | one attempt write |
| refunded, same reported | one attempt write; one alert |
| informational | none |

A processor refund never changes the order: the order's `paid → refunded` stays the owner's pay-1 action (packet:
pay-1 transitions are the only way an order becomes paid or refunded). The alert says so (§ 7.5).

## 4. The processor port

### 4.1 Port

```ts
// backend/src/lib/payment-processor.ts
export interface CardPaymentProcessor {
    startPayment(input: StartInput): Promise<Result<{ processorPaymentId: string; redirectUrl: string }, StartFailure>>;
    readNotification(input: { headers: Record<string, string | undefined>; rawBody: string }): NotificationReading;
}
export type NotificationReading =
    | { kind: "unverified"; reason: "no-token" | "bad-token" | "bad-signature" | "wrong-issuer"
                              | "wrong-audience" | "body-hash-mismatch" | "expired" | "not-yet-valid" }
    | { kind: "unusable"; reason: "body-not-json" | "bad-order-reference" | "no-payment-id" | "bad-status"
                            | "bad-amount" | "bad-currency" }
    | { kind: "event"; event: ProcessorEvent };
export function processorFor(settings: CardPaymentSettings, apiKey: string | null): CardPaymentProcessor;
// exhaustive switch on settings.processor — the one place a concrete processor is constructed
```

- `unverified` = the request is not proven to come from the processor → 401, nothing written (§ 6.4).
- `unusable` = verified, but the payload cannot be acted on → acknowledged as permanent, nothing written.
- `StartInput` = `{ ref: AttemptRef; amountMinor; currency; description; buyer: BuyerFields; notifyUrl;
  returnUrl }` (raw DTO; no DynamoDB item, no tenant record crosses).
- `readNotification` is synchronous and pure given the settings (key material is in `settings`): unit-testable with
  a locally generated RSA key, no network.
- Refund is **not** an operation of the port: Netopia's credit operation is "available at a future date" (N11);
  refunds are made in the processor's panel and recorded by the owner (pay-1).

### 4.2 Abstraction line (required)

`CardPaymentProcessor` — users now: the start route and the notification route, with the Netopia adapter; next: a
client's processor (the human asks the clients, § 1 item 2) or Paddle (§ 8); axis: **processor implementations
grow, operations fixed → interface + polymorphism**, chosen once in `processorFor`; rejected alternative: Netopia
calls inline in the two handlers (the ratified direction requires a second processor without a change to orders or
bookings, so the seam is required now).

### 4.3 The first implementation: Netopia (`backend/src/lib/netopia.ts`)

Start (N2-N5): `POST <base>/payment/card/start`, header `Authorization: <apiKey>`, body:

- `config.notifyUrl` = `https://<api host>/public/payments/netopia/<tenantId>` (§ 6).
- `config.redirectUrl` = the order page `https://<tenant host><checkout><confirm>?id=<orderId>&email=<email>` (C9;
  the URL the checkout uses today).
- `config.language` = `ro` when the tenant locale starts with `ro`, else `en`. `config.emailTemplate` = `""`.
- `payment.instrument` = `{ "type": "card" }` only (N4; WooCommerce sends `credit_card` — the sandbox decides, U8).
- `payment.options` = `{ "installments": 0, "bonus": 0 }`.
- `order.posSignature` = tenant setting; `order.dateTime` = now, ISO 8601; `order.description` = `<site name> —
  order <orderNumber>`.
- `order.orderID` = `<orderId>.<attemptNo>` (a new value per attempt: error 56 refuses a repeated id, N5; length
  U5).
- `order.amount` = `amountMinor / 100` as a number in major units (N12, U1); `order.currency` = `RON`.
- `order.billing` = the fields of § 10.3 only. `order.shipping`, `order.products`, `payment.data`: not sent.

Start answer, field by field: HTTP status not 2xx or body not a JSON object → `refused { code: "http-<status>" }`;
`payment.paymentURL` an absolute `https:` URL **and** `payment.ntpID` a non-empty text ≤ 64 characters → `ok`;
otherwise → `refused { code: refusalCode(error.code) }`. `payment.status` and `error.message` are logged (message
cut to 200 characters), never stored. Network error or no answer within 10 s → `no-answer`. The adapter never logs
the request body or the key.

**Rule (closes the adapter/codec class): every value an adapter produces for the domain satisfies the constraint of
the stored field it becomes, and both sides use one definition.** For the refusal code that definition is
`REFUSAL_CODE = /^[A-Za-z0-9_-]{1,16}$/` and `refusalCode(raw: unknown): string` in
`packages/shared/src/payment-attempt.ts`: `raw` when it is text matching `REFUSAL_CODE`, else `"unusable-answer"`
(which matches). `"http-<status>"` matches for every 3-digit status. The attempt codec (A2) checks the same
`REFUSAL_CODE`. The other adapter outputs already share their stored rule: `processorPaymentId` (S3 = A2, text
1-64), `reported` (V19/V20 = `Money`), `processorStatus` (V18 = A2, safe integer ≥ 0).

Notification (N6, N7), with these deliberate differences from the official SDKs:

1. The algorithm is **pinned to RS512**; a token whose header names another algorithm is `bad-token`. (The SDKs
   take the algorithm from the token's own header — the known JWT algorithm-confusion weakness.)
2. The hash is over the **raw body bytes** as received (base64-decoded when API Gateway marks it so). (The JS
   sample re-serializes the parsed body, which can change the bytes.)
3. A missing public key is a refusal, never a pass. (The npm SDK continues with `errorType` none.)
4. `exp` and `nbf` are honoured when present, with 300 s skew (U3). A replay of a genuine notification is harmless
   (§ 3.6), so no replay window is added.
5. Verification uses `node:crypto` (`createPublicKey`, `verify("RSA-SHA512", …)`): no new dependency. Rejected:
   the `netopia-payment2` package (points 1-3) and a general JWT library (one fixed algorithm needs about 40
   lines).

The checks and the decoding of every field are the rows of § 11.1 (V-rows).

### 4.4 Tenant settings: storage, validation, redaction, rotation

New optional tenant attribute (absent = card payment not configured; every stored tenant parses):

```ts
export const CardPaymentSettingsSchema = z.discriminatedUnion("processor", [
    z.object({
        processor: z.literal("netopia"),
        environment: z.enum(["sandbox", "live"]),
        // POS signature format INFERRED from the sample values in [W]; the sandbox run confirms it (pay-2a)
        posSignature: z.string().regex(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/),
        publicKey: z.string().min(1).max(4096),                       // PEM; not a secret
    }).strict(),
]);
// TenantConfig: cardPayments: CardPaymentSettingsSchema.optional()
```

- **The API key is the only secret.** It is never stored in the main table: the renderer's role can read every
  item there (C11), and VISION guarantee 2 forbids that place. Every place outside the renderer's reach needs an
  infra change (Secrets Manager, SSM Parameter Store with a grant, or a KMS key); the commerce-private table does
  not exist yet (`cmrc-1`). So the store is decision **PAY2-SECRET-STORE** (§ 15), with compliant options only.
  The admin sends the key and never reads it back: `GET /settings/secrets` answers `cardPayments.apiKeySet:
  boolean` only; `GET /settings` and the renderer never see it.
- Validation in `PUT /settings`, checked as sent and only when present (the pattern of C13's neighbours): the
  schema; `publicKey` must load with `crypto.createPublicKey` as an RSA key; API key 1-512 characters, no white
  space. `enabledPaymentMethods` containing `card` is refused unless, on the merged record, `commerceEnabled` is
  true, `cardPayments` is complete, the API key is stored, and `currency` is `RON`. Changing `currency` away from
  `RON` while `card` is enabled is refused.
- No call to Netopia at save time (the sandbox run of § 11.4 is the test).
- Rotation: the owner saves a new API key or a new public key; the next start or notification uses it. A
  notification signed with a key the tenant no longer stores is refused (401); U2 and U4 decide how much that
  matters (§ 13).
- Environment switch (`sandbox` ↔ `live`) needs a new API key (INFERRED: stated in a documentation search result
  of 2026-11-22, not on a page read).

## 5. The flows

### 5.1 Checkout with card (happy path and its failures)

1. Visitor chooses "Card", shown only when the mapped `enabledPaymentMethods` contains `card` (`mapTenant` copies
   the stored array from `pay-2e` on, C21). Browser → `POST /public/orders` (unchanged route). `create.ts` refuses
   `card` (400) when the tenant has not enabled it. The order is written `placed` / `pending` / `paymentMethod:
   card`, with `delivery` on its digital lines (§ 3.3). The `placed` mail is sent as today, with the label `Card`.
2. Browser → renderer proxy `POST /api/order-payment` `{ orderId, email }` → backend `POST
   /orders/{id}/payment-attempts` `{ email }` with the renderer key and the tenant from the host.
3. Backend, in order: role `RENDERER` (else 403) → tenant record: card enabled and settings complete (else 409
   `card-unavailable`) → order read (absent, or stored email ≠ normalized request email → 404, rule of C10) →
   `paymentMethod` ≠ `card` → 409 `not-card`; `orderAmountMinor` refused → 409 `total`; currency ≠ `RON` → 409
   `currency` → **allocation, one `TransactWriteItems`**: (a) order `SET paymentAttempts = :n` with condition
   `paymentAttempts` absent (n = 1) or `= :n - 1`, `:n` ≤ 5, payment state pending (absent or `pending`), `status`
   not `cancelled`/`annulled`; (b) `Put` attempt `opening` with `attribute_not_exists(SK)`. Cancelled by (a) →
   read the order again and answer 409 with the reason now true (`already-paid`, `order-cancelled`,
   `too-many-attempts`) or retry once when only the counter moved. Nothing is left half-written.
4. `startPayment`. Then the **start-result write** (unavoidable second write; the processor call lies between):
   - `ok` → attempt `SET state = open, processorPaymentId, openedAt` with condition `state = opening` → **201 `{
     redirectUrl }`**. Condition fails (a verified notification already moved the attempt) → write nothing, answer
     **409 `attempt-settled`**; the browser goes to the order page, which shows the stored truth.
   - `refused` / `no-answer` → attempt → `start-failed` with condition `state = opening` (fails → same 409) →
     **502 `payment-start-failed`**.
   - The start-result write itself errors (DynamoDB) → 500; the attempt stays `opening`; the buyer has no link.
5. Browser: on 201 → `window.location.assign(redirectUrl)`; otherwise → the order page. The cart is already cleared
   (existing behaviour after step 1).
6. Netopia → browser to `redirectUrl` = the order page (`L` = the payment-link lifetime verified by `pay-2a`, U7;
   one constant in `packages/shared/src/payment-attempt.ts`, never guessed). **The return is never proof of
   payment**: the page uses only `id` and `email` (C10) and shows the state it reads from the table at that request:
   - `paymentStatus: paid` → "Payment received" (and the downloads, if PAY2-DOWNLOAD-LINK = B);
   - `pending` and the latest attempt `open` younger than `L` → "We are waiting for the payment confirmation.
     Reload this page in a moment." (no polling script);
   - `pending`, card order, not cancelled, fewer than 5 attempts, and no attempt, or the latest `opening`,
     `declined`, `start-failed`, or `open` older than `L` → "The payment was not completed." + **Pay now** (step 2);
   - any other case (`refunded` or `amount-mismatch` attempt, 5 attempts, cancelled) → the order details as today,
     no payment button.

### 5.2 Notification before return

Usual case (the server-to-server call is faster than the browser). The return page reads `paid`. No special code.

### 5.3 Notification processing (the core sequence)

1. `readNotification` (§ 6.2). `unverified` → 401, nothing read beyond the tenant record, nothing written.
   `unusable` → permanent ack, nothing written.
2. Read the attempt `TENANT#<path tenant> / PAYATTEMPT#<orderId>#<attemptNo>` (`ConsistentRead`). Absent →
   permanent ack, log `unknown-attempt` at error level.
3. If the attempt has a `processorPaymentId` and the event's differs → permanent ack, log `ntp-id-mismatch` at
   error level, no write.
4. `attemptReaction` (§ 3.6). `ignore` → ack. `record-declined`, `record-mismatch`, `record-refund` → one
   conditional `Update` of the attempt (condition: the state read) → ack; `record-mismatch` and `record-refund` also
   write an audit entry `PAYMENT_ANOMALY` and alert the shop (§ 7.5).
5. `pay-order`: read the order (`ConsistentRead`), apply `paymentTransition(stored, "paid")` (pay-1):
   - `apply` → **one `TransactWriteItems`**: (a) order `SET paymentStatus = paid, paidAt, updatedAt`, plus the
     initial delivery marks of § 7.2 when the order has a `delivery` line, with condition: pay-1's condition on the
     payment state read **and** `#status = :statusRead`; (b) attempt → `succeeded`, `orderEffect: order-paid`,
     condition: the attempt state read. Then audit `UPDATE_ORDER_PAYMENT` (actor `{ id: "processor:netopia" }`,
     title = order number, details `{ previous, next, attemptNo, ntpID }`), the `paid` mail (pay-1), the deliveries
     (§ 7.3), then ack.
   - `no-op` (already `paid`) → attempt → `succeeded`, `orderEffect: order-already-paid` + shop alert "possible
     double payment". The order cannot have been paid by this same attempt: (a) and (b) commit together.
   - `refused` (order `refunded`) → attempt → `succeeded`, `orderEffect: order-not-payable` + shop alert.
   - Transaction cancelled (another writer changed the order's payment state or status, or the attempt) → read the
     attempt and the order again and decide once more from step 4 (a concurrent copy of the same notification then
     meets `succeeded` → `ignore (replay)`); a second cancellation → temporary ack (§ 6.4).
   - The paid order's `status` at commit decides the delivery marks (§ 7.2): `cancelled`/`annulled` → every mark
     `failed (order-cancelled)` + alert "paid after cancellation — refund it in the processor panel".

### 5.4 Failure cases

- **Duplicate or replayed notification** — § 3.6: the second is `ignore (replay)`; two concurrent copies produce one
  transition: the loser's transaction is cancelled, it reads again and ignores.
- **Out-of-order notifications** — the pair table of § 3.6; a refund before a delayed paid keeps the order pending.
- **Forged notification** (no token, wrong key, wrong `aud`, body changed) — 401, no write, log the reason only.
- **Genuine notification sent to another tenant's path** — that tenant's key or `aud` fails → 401; if both pass
  (one merchant account on two sites), the attempt key does not exist under that tenant → permanent ack, no write.
- **Amount or currency differs from the attempt** — attempt `amount-mismatch`; order stays `pending`; audit + shop
  alert; permanent ack (a retry cannot fix it).
- **Payment for a cancelled order** (cancelled after the attempt opened) — the money arrived: order → `paid` (pay-1
  does not look at `status`); delivery marks `failed (order-cancelled)`; alert.
- **Cancellation between the read and the paid write** — the condition `#status = :statusRead` fails → read
  again → decided with the new status (previous row).
- **Cancellation after the paid write** — the status writer has no condition (C24). A delivery that is already
  running completes; every later run is refused by its claim condition (§ 7.3).
- **Payment for an already-paid order** (second tab; admin marked it paid) — attempt `succeeded`,
  `order-already-paid`, alert; no second delivery.
- **Abandoned payment** — the attempt stays `open`; after `L` the order page offers "Pay now" (new attempt). No
  automatic cancellation (§ 13). A late success of the old attempt follows the rows above.
- **Admin "Mark as paid" racing a notification** — both use pay-1's conditional write; one wins. Admin loses → 409
  "The payment state changed" (pay-1). Notification loses → reads again → `order-already-paid` + alert.
- **Start call times out but Netopia created the payment** — attempt `start-failed (no-answer)`; the buyer never got
  the link, so normally no payment follows; if one does, its notification is processed (`start-failed` is OPEN).
- **Notification arrives before the start-result write** — the notification writes first (it is conditional on
  the state it read, `opening`); the start-result write fails its condition and changes nothing (§ 5.1 step 4).
- **Function stops after the paid transaction, before the deliveries** — marks stay `pending`; § 7.3 run again.

### 5.5 Idempotency keys and conditional writes (one conditional write per decision)

- **Allocate attempt n** — transaction: order counter + attempt `Put`; condition: counter `= n-1`, `n` ≤ 5,
  payment pending, status not cancelled/annulled; attempt `attribute_not_exists(SK)`.
- **Start result** — attempt `Update`; condition `state = opening`.
- **Record declined / mismatch / refund** — attempt `Update`; condition `state = :stateRead`, plus
  `processorStatus = :statusRead` when the state read is `declined` (§ 3.6 rule).
- **Pay the order** — transaction: order + attempt; condition: pay-1 payment condition and `#status = :statusRead`;
  attempt `state = :stateRead`.
- **Admin marks paid** — order `Update` (pay-1); condition: pay-1 payment condition, plus `#status = :statusRead`
  when a `delivery` line exists.
- **Run a delivery** — run 1: the paid write itself; "Run again": transaction of the order mark claim and a
  `ConditionCheck` on the paying attempt (§ 7.3).
- **End a delivery run** — order `Update` of one mark; condition `run = :myRun`.
- **Processor side** — `order.orderID = <orderId>.<n>`; Netopia refuses a repeated id (error 56, N5).

The two unavoidable second writes and their recovery: the start result after the processor call (§ 5.1 step 4) and
the end of a delivery run after its side effect (§ 7.3).

## 6. The notification route

### 6.1 Reachability

`POST /public/payments/netopia/{tenantId}` in the commerce nested stack with `noAuth: true` (C12): Netopia sends no
platform credential, so a route behind the authorizer would answer 401 before the handler (the reason Paddle never
reached its handler, P1). The route is safe without a platform credential because:

- its only authority is the processor's signature (§ 6.2); before it passes, the handler does exactly one
  `GetItem` (the tenant record named by the path) and writes nothing;
- the body is limited to 16 KB (larger → 413, before any read);
- the stage throttling of the API applies (`infra/lib/api.ts`, 50 rps / burst 100, shared);
- the route returns no data: only the acknowledgement JSON.

This is not a customer data action, so PD-002 does not govern it: no browser calls it, and it returns nothing
private. The sentence "No backend route becomes anonymous" of PD-002 closes its "Booking-token variant" section,
which applies to scheduling (`docs/platform-decisions.md` § PD-002; reading INFERRED).

### 6.2 Verification

`verification-token` header (API Gateway v2 gives lower-case names) → tenant record → `cardPayments.processor` must
be `netopia` (else 401) → the API key is not needed → `processorFor(...).readNotification` (§ 4.1). The answer for
"unknown tenant", "no settings" and every `unverified` reason is the same 401 body, so the route does not reveal
which tenants exist.

### 6.3 Tenant binding

The tenant in the path is only a lookup hint. The binding is three checks together: the signature verifies with
**that tenant's** stored public key; `aud` contains **that tenant's** POS signature; the attempt key exists **under
that tenant** (`TENANT#<path tenant>`). The body never selects a tenant; the attempt key is read under the path
tenant only.

### 6.4 Acknowledgement

- **`event` processed, or ignored by § 3.6** — HTTP 200, `{"errorType":0,"errorCode":null,"errorMessage":""}`.
- **`unusable`, unknown attempt, ntpID mismatch, amount mismatch recorded** (authenticated, never processable) —
  HTTP 200, `{"errorType":2,"errorCode":<n>,"errorMessage":"<reason>"}`.
- **`unverified`, unknown tenant, no settings** (not authenticated) — HTTP 401,
  `{"errorType":2,"errorCode":401,"errorMessage":"unverified"}`.
- **Body larger than 16 KB** — HTTP 413, same body shape, `errorType` 2.
- **A dependency failed** (DynamoDB error, a second transaction cancellation) — HTTP 503,
  `{"errorType":1,"errorCode":503,"errorMessage":"retry"}`.

Basis: N9. The HTTP statuses of the error rows are this specification's choice; U2 decides whether Netopia retries
on them. If Netopia never retries, the 503 row leaves the order `pending` and the shop sees the open attempt (§ 9.3);
the owner can mark the order paid after checking the panel.

### 6.5 Logging

One structured line per request: `tenantId`, `orderId`, `attemptNo`, `ntpID`, `status` code, reading reason or
reaction, `orderEffect`. Never logged: the body, the token, any header value, the email, `instrument` (it holds
`panMasked`), `token`, `binding`, the API key, the public key. Card data never reaches the platform (§ 10.1).

## 7. "Order became paid" — the one fulfilment point

### 7.1 What is guaranteed (four separate statements)

1. **The paid transition happens once per order.** It is pay-1's conditional write `pending → paid`, from either
   source — the admin switch (`PUT /orders/{id}`, C8) or a notification (§ 5.3). Both call one backend function,
   `recordOrderPaid` (new `backend/src/lib/order-paid.ts`, extracted from `changePaymentStatus`). Only the caller
   whose condition passes continues to the mail and the deliveries; replays, the losing writer and later
   notifications never do.
2. **Each delivery has a durable mark on the order**, written in the same write as `paid`: `pending`, then `done` or
   `failed` (§ 7.2). An order without a `delivery` line gets no mark (P0).
3. **A delivery runs at the paid transition and again only when an admin presses "Run again"** on the order page.
   There is no queue and no scheduled retry: a `pending` or `failed` mark waits for the admin, visibly. No case
   needs more: the admin action covers every stuck or failed mark, and under PAY2-DOWNLOAD-LINK = B the buyer can
   also download from the order page without the mail.
4. **A mail can repeat after an uncertain send**: SES timeout after acceptance, the function stopping after the
   send, or the end-of-run write failing all leave the mark `pending` or `failed`, and "Run again" sends again.

The `paid` mail of pay-1 is unchanged: it is sent after the paid transition from both sources, best effort, its
failure logged; it has no mark and no "Run again" (preservation, P0).

### 7.2 The marks

```ts
export type DeliveryName = "downloadMail";                       // sched-1h adds its name
export type DeliveryFailure =
    | { reason: "order-cancelled" }
    | { reason: "product-removed"; lines: number[] } | { reason: "resource-removed"; lines: number[] }
    | { reason: "resource-invalid"; lines: number[] } | { reason: "entitlement-unreadable"; lines: number[] }
    | { reason: "send-failed"; error: string };                    // error = the error's name, ≤ 100 characters
export type DeliveryMark =
    | { state: "pending"; run: number; since: string }             // run started and not ended (or never started)
    | { state: "done"; run: number; at: string }
    | { state: "failed"; run: number; at: string; failure: DeliveryFailure };
// order attribute: fulfilment?: Partial<Record<DeliveryName, DeliveryMark>>
```

Which mark a line calls for: a line whose `delivery` attribute is present calls for `downloadMail` when its value
parses as `{ kind: "download", … }` **or does not parse at all** (an unreadable entitlement must still reach a mark
that reports it). `sched-1h`, when it adds a kind, restates this rule for its own name. Lines without the attribute
call for nothing.

Initial marks, in the paid write: one per delivery the lines call for, `{ state: "pending", run: 1, since: now }`, or
`{ state: "failed", run: 0, at: now, failure: { reason: "order-cancelled" } }` when the status at commit is
`cancelled` or `annulled`. Every mark written anywhere carries every field its state requires (§ 11.1 O5).

### 7.3 Running a delivery

**Rule (closes the eligibility class): every fact that decides whether a delivery may run is checked by the write
that claims the run.** The facts are: the order's payment state is `paid`; its status is not `cancelled` or
`annulled`; the paying attempt, when one exists, is not `refunded`; the mark's run number and state allow a run.

- The paying attempt is the attempt whose `orderEffect` is `order-paid`. It is fixed for the life of the order (it
  is written once, in the paid transaction). An order paid by the admin has none.
- **Run 1** is claimed by the paid write itself (§ 5.3, § 5.5: that write checks payment state and status; the
  paying attempt is the one being written as `succeeded` in the same transaction) and starts right after it, in the
  same function.
- **Run again** = `PUT /orders/{id}` `{ "runDeliveryAgain": "<name>" }` alone (pay-1's one-concern-per-request rule;
  roles of the status route). It reads the order and its attempts, then claims with **one `TransactWriteItems`**:
  (a) order `SET fulfilment.<name> = { state: "pending", run: n + 1, since: now }` with condition
  `fulfilment.<name>.run = :n`, payment state `paid`, `status` not `cancelled`/`annulled`, and the mark's state is
  `failed`, or `pending` with `since` older than 2 minutes, or (for `downloadMail` only) `done` — a re-send;
  (b) when a paying attempt exists, a `ConditionCheck` on it: `#state = :succeeded`. A refund stored at any time
  before the claim commits cancels the transaction → read again → 409 `refunded-at-processor`.
- **A refund or a cancellation stored after a successful claim does not stop the run already claimed** (the side
  effect may already be under way); every later claim is refused by (a) or (b).
- **End of run** = `SET fulfilment.<name> = { state: "done", run, at } | { state: "failed", run, at, failure }` with
  condition `run = :myRun`: a stale run never overwrites a newer one. If this write fails, the mark stays `pending`
  and "Run again" is offered after 2 minutes.
- The 2-minute age is above the function timeout (29 s), so run 1 and a "Run again" never overlap; two admins at
  once: one claim wins (409 `claimed-by-another` for the other).
- Time budget: the deliveries run after the paid transaction inside the same 29 s; a function stopped by the
  timeout leaves `pending` (statement 4 of § 7.1).
- A failed delivery never changes the payment state and never blocks another delivery.

### 7.4 The deliveries named now

- **`downloadMail`** — the file comes **only from the order line** (`delivery.resourceId`); the product is read only
  to check that it still exists. For every line that calls for this mark (§ 7.2), all checks first:
  1. `delivery` does not parse as `{ kind: "download", resourceId }` → `entitlement-unreadable`;
  2. `GetItem TENANT#<order's tenant> / PRODUCT#<line.productId>` with `ProjectionExpression: "SK"` — absent
     (products are deleted by `DeleteCommand`, `backend/src/products/delete.ts:33`) → `product-removed`;
  3. `GetItem TENANT#<order's tenant> / RESOURCE#<resourceId>` — absent → `resource-removed`;
  4. its `s3Key` does not start with `<order's tenant>/<resourceId>-` (C23) → `resource-invalid`.

  **If any line fails, nothing is sent**; the mark is `failed` with the first failing reason in the order above and
  the numbers of the lines that fail it; nothing else is substituted (an edited product's new `resourceId` is never
  used). The owner fixes the cause, then "Run again". Otherwise **one mail per order** lists every download line,
  to `order.customerEmail`, template key `download` (default English text, tenant override, like `paid`). Content
  per PAY2-DOWNLOAD-LINK: B = a link to the order page; A = one signed S3 link per line (GET on the `s3Key` checked
  in step 4).
- **next: `sched-1h`** — its own `DeliveryName` and `LineDelivery` kind. Defined by `sched-1h` only.

### 7.5 Shop alerts

Not deliveries: one mail to `integrations.contactEmail` and `orderProcessingEmail`, sent inline, best effort, plus
the audit entry `PAYMENT_ANOMALY` (title = order number). Cases: amount mismatch; possible double payment; paid after
cancellation; payment for a refunded order; refund observed at the processor ("the order stays paid until you mark
it refunded; check the deliveries"). A failed alert mail is logged; the attempt on the order page shows the case.

### 7.6 Booking products: the boundary only

`sched-1h` attaches one `DeliveryName` and one `LineDelivery` kind. Finding PF4: `sched-1.md` § 17.2 commits
booking items **inside the order transaction at order creation**, with the run chosen in the cart; "buy first, then
pick the date" moves the attachment to the paid event and the date choice to after payment; `sched-1h` must revise
§ 17.2.

## 8. Paddle

The facts are § 2.3. Paddle's current terms (read 2026-11-22):

- Acceptable Use Policy, https://paddle.com/support/aup/ ("Last Updated 13 April 2026"): "Paddle is built to serve
  software companies (including B2B SaaS, Consumer Software, and Games)"; prohibited: "Physical products or
  products that require physical delivery"; "Human services that are not related to a software offering" (examples
  include "pure consulting or advisory services"); "any certifications or courses for which the business is not the
  owner or creator of the underlying product". The policy does not use the words "in-person services"; the nearest
  rule is "Human services that are not related to a software offering".
- Terms, https://www.paddle.com/legal/terms ("Last updated: 6 October 2026"): "Product" means "the Supplier's software
  product(s) and/or digital content agreed to be resold and distributed"; clause 2.1: Paddle is appointed as
  "non-exclusive reseller"; clause 3.4: "As Merchant of Record, Paddle reserves the right to set the price".

So Paddle can sell a tenant's own digital content or software; it cannot sell physical goods, and an in-person
course or service falls under the human-services rule (INFERRED reading of the quoted text). The decision is
**PAY2-PADDLE** (§ 15).

## 9. Storage, API, admin, visitor texts, infra

### 9.1 Storage (main table; no scan; tenant partition only)

- **Attempt** — `PK = TENANT#<tenantId>`, `SK = PAYATTEMPT#<orderId>#<attemptNo>`; the `PaymentAttempt` of § 3.4,
  `Type: "PaymentAttempt"`; < 1 KB.
- **Order (existing)** — `ORDER#<orderId>`; + `paymentAttempts` (card orders only), `fulfilment` (orders with a
  `delivery` line only), lines + `delivery` (digital lines only). An order with none of these is stored as today.
- **Tenant (existing)** — `SYSTEM / TENANT#<tenantId>`; + `cardPayments` (§ 4.4). The API key is **not** here.

Reads: one attempt by key (`GetItem`, notification); the attempts of one order by `Query` `PK = TENANT#<t> AND
begins_with(SK, "PAYATTEMPT#<orderId>#")` with a `ProjectionExpression` (admin order page, order page, "Run
again", download route) — at most 5 items; for rollback (§ 12.3) the attempts of one tenant by `Query` `PK =
TENANT#<t> AND begins_with(SK, "PAYATTEMPT#")` with a projection. Consistency rule: the order's `paymentStatus` is
the truth; an attempt's `succeeded / order-paid` is written in the same transaction as the order's `paid` (§ 5.3).
Attempts move with the orders when Track B (`cmrc-4`) moves them (same key shape).

### 9.2 API

- **`POST /public/orders` (existing)** — request: `paymentMethod` may be `card`; answer unchanged; no auth
  (existing); new refusal: 400 when `card` is not enabled. Digital lines get `delivery` (§ 3.3).
- **`POST /orders/{id}/payment-attempts` (new)** — request `{ email }`, `x-tenant-id` from the renderer; answer 201
  `{ redirectUrl }`; role `RENDERER`; refusals: 400 body, 403 role, 404 order or email (C10 rule), 409
  `card-unavailable`, `not-card`, `total`, `currency`, `already-paid`, `order-cancelled`, `too-many-attempts`,
  `attempts-unreadable`, `attempt-settled`; 502 `payment-start-failed`; 500.
- **`POST /public/payments/netopia/{tenantId}` (new)** — request: Netopia IPN, raw JSON; answer § 6.4; no platform
  auth, processor signature; refusals: 401, 413, 503.
- **`GET /orders/{id}` (existing)** — answer + `attempts: PaymentAttempt[]` (the stored items without `PK`/`SK`) and
  the stored `fulfilment`; roles unchanged.
- **`PUT /orders/{id}` (existing)** — request + `{ runDeliveryAgain: DeliveryName }` alone; answer 200 `{ fulfilment
  }`; roles unchanged (EDITOR, TENANT_ADMIN); refusals: 400 unknown name or other fields, 404, 409 with the reason
  (`not-paid`, `order-cancelled`, `refunded-at-processor`, `mark-state`, `mark-unreadable`, `claimed-by-another`).
- **`POST /orders/{id}/downloads` (new, only if PAY2-DOWNLOAD-LINK = B)** — request `{ email, line }`; answer 200
  `{ url }` (S3 GET link, 15 min); role `RENDERER`. It writes nothing; it reads the order and the paying attempt
  in one `TransactGetItems` (one consistent snapshot), then the checks of § 7.4 for that line. Refusals: 404 order,
  email or line; 409 `not-paid`, `order-cancelled`, `refunded-at-processor`, `not-a-download`,
  `entitlement-unreadable`; 410 `product-removed`, `resource-removed`, `resource-invalid`.
- **`PUT /settings`, `GET /settings/secrets` (existing)** — request + `cardPayments`, + API key (write-only);
  answer + `cardPayments.apiKeySet`; refusals § 4.4 and § 11.1.

Renderer proxies (new, pattern C14; tenant from the host, never from the body): `POST /api/order-payment` `{
orderId, email }` → the attempt route; (B only) `POST /api/order-download` `{ orderId, email, line }` → the
download route. The email is the one in the order page's address — the access rule of C10, unchanged.

Settings to checkout (`pay-2e`): `mapTenant` (`renderer/src/lib/dynamo.ts`) copies `enabledPaymentMethods` when it
is an array of known methods, else leaves it absent (the checkout then keeps its default); `SitePage` (`SitePage.tsx`, the `checkout` branch)
already passes it. Effect on existing tenants: a stored `bank_transfer` becomes visible at checkout (C21; finding
PF6) — checked before deploy (§ 12.2, `pay-2e`).

Product surfaces after PAY2-PADDLE = A (`pay-2f`): (a) slug page — "Add to cart" when `commerceEnabled` is true, for
physical and digital products alike (the `!product.paymentLinkId` part of the condition is removed); (b) by-id page
— no Paddle button; it behaves for every product as it does today for a product without `paymentLinkId` (no cart
action, C16 b). Under B or C both surfaces stay as they are.

MCP: the new routes go into `tools/mcp-server/routes.json`; no new tool (`npm --prefix tools/mcp-server test`).

### 9.3 Admin (English)

- Settings → payment methods: checkbox "Card (online, Netopia)", disabled with the reason until the card settings
  are complete (§ 4.4). New card "Card payments": Environment (Sandbox / Live), POS signature, API key (write-only;
  "Saved" when set), Netopia public key (text area). Help text: the values come from the Netopia merchant panel.
- Order page: a "Payment attempts" table (number, state, amount, Netopia id, time); `amount-mismatch`, `refunded`,
  `order-already-paid`, `order-not-payable` shown as warnings with one line of advice ("Check the payment in the
  Netopia panel and refund it there if needed"). A "Deliveries" block: one row per mark, its state, run number and
  failure reason, and "Run again" (or "Send again" for a `done` download mail). Payment method label "Card".
- Email Templates page: new key `download` (label "Download", variables of `paid` plus `{{downloads}}`).

### 9.4 Visitor texts (tenant locale table; `CommerceStringsSchema` + packs `en.ts`, `ro.ts`)

- `cardPayment` — EN "Card"; RO "Card bancar".
- `cardPaymentDesc` — EN "Pay online by card on the secure page of our payment processor."; RO "Plătiți online cu
  cardul, pe pagina securizată a procesatorului de plăți."
- `paymentWaiting` — EN "We are waiting for the payment confirmation. Reload this page in a moment."; RO "Așteptăm
  confirmarea plății. Reîncărcați pagina în câteva momente."
- `paymentReceived` — EN "Payment received."; RO "Plata a fost primită."
- `paymentNotCompleted` — EN "The payment was not completed."; RO "Plata nu a fost finalizată."
- `payNow` — EN "Pay now"; RO "Plătește acum".
- `paymentStartFailed` — EN "We could not open the payment page. Try again."; RO "Nu am putut deschide pagina de
  plată. Încercați din nou."
- (B only) `downloads` — EN "Your downloads"; RO "Descărcările dumneavoastră". `download` — EN "Download"; RO
  "Descarcă".

Mails stay English backend defaults with tenant override (pay-1 finding F1; not changed here).

### 9.5 Infra (each change with its concrete gain)

- **Function + route `POST /orders/{id}/payment-attempts`** (authorizer; table read/write; read of the API key per
  PAY2-SECRET-STORE) in `infra/lib/api-commerce.ts` — gain: a buyer can reach the payment page.
- **Function + route `POST /public/payments/netopia/{tenantId}`** (`noAuth`; table read/write; `ses:SendEmail` on
  the sending identity; `SES_FROM_EMAIL`; events through the stack-wide grant) in `infra/lib/api-commerce.ts` —
  gain: the processor can report a payment, so an order becomes paid with no admin action.
- **Private bucket access for signing, per PAY2-DOWNLOAD-LINK.** Pattern of `infra/lib/amodx-stack.ts:301-305`
  (C18): the function is exposed by `CommerceApi` as a `public readonly` field; the parent adds one statement
  `s3:GetObject` on `${privateBucket.bucketArn}/*` (no `s3:List*`, so no function can enumerate the bucket) and the
  variable `PRIVATE_BUCKET`. Tenant scoping is the `s3Key` prefix check of § 7.4 step 4 (keys of every tenant share
  the bucket, C23). Gain: the file can be signed only by the functions that deliver it.
  - **Link A** — the signer is whichever function runs `downloadMail`: `UpdateOrderFunc` (admin mark-paid and "Run
    again"; `pay-2c`) and the notification function (`pay-2d`). Both get the statement and the variable.
  - **Link B** — the signer is only the new download function (`POST /orders/{id}/downloads`; table read;
    `pay-2c`); `UpdateOrderFunc` and the notification function get no bucket access.
- **The API key store** per PAY2-SECRET-STORE: write for the settings function (`infra/lib/api.ts`), read for the
  attempt function — gain: the key is outside the renderer's IAM reach (C11, VISION guarantee 2).
- **(PAY2-PADDLE = A) remove `PaddleWebhookFunc`, its route and its grants** (`infra/lib/api.ts:780-801`) — gain: a
  route that any authenticated caller can reach loses its function and three unused grants (private bucket read,
  table read, SES).
- **`UpdateOrderFunc`** — it already has table read/write and SES (pay-1 R1); under link B nothing else; under link
  A the bucket statement above.

Resource estimate (INFERRED; 4 per function, 3 per route): commerce stack 221 (pay-1 record) + 2 or 3 functions and
routes ≈ 235-242 of 500.

## 10. Security and privacy

### 10.1 PCI scope

The buyer types the card data on Netopia's page (N4). The platform never receives, sends, stores or logs a card
number, expiry, CVV or 3-D Secure data. The start request carries no card field (`instrument: { type }` only). The
IPN carries a masked card number (N6); the handler does not read it and nothing stores it. INFERRED consequence:
the merchant's PCI DSS self-assessment is the short form for a fully outsourced page; the client confirms its
category with Netopia.

### 10.2 Secrets

The Netopia API key: store per PAY2-SECRET-STORE; never in a log, an audit entry, an answer, the renderer, or the
admin after saving. The public key and the POS signature are not secrets (the POS signature is in every token's
`aud`). No platform-wide Netopia secret exists: every key is the tenant's.

### 10.3 Order data that leaves to Netopia

Start request only (§ 4.3); nothing else is ever sent:

- **`billing.email`** — Value: `order.customerEmail`; Why: required by Netopia (N3); used by Netopia for its payment
  receipt (INFERRED)
- **`billing.phone`** — Value: `order.customerPhone` or `""`; Why: required (N3)
- **`billing.firstName`, `lastName`** — Value: `customerName` split at the last space; Why: required (N3)
- **`billing.city`, `state`, `postalCode`, `details`, `country`, `countryName`** — Value: the shipping address, or
  `""` / Romania (642) when absent (U6); Why: required (N3)
- **`order.description`** — Value: site name + order number; Why: required (N3)
- **`config.redirectUrl`** — Value: contains `orderId` and the email (C9); Why: the return page needs them; the email
  is already sent as `billing.email`
- **`order.amount`, `currency`, `orderID`, `posSignature`** — Value: § 4.3; Why: required

Not sent: items, product names, birthday, company details, notes, delivery date, coupon.

## 11. Evidence

Each row is a test a builder binds (unit unless named). "Permanent ack" = HTTP 200 with `errorType` 2; "401" =
the `unverified` answer of § 6.4.

### 11.1 Field taxonomy (absent / valid / malformed)

**Tenant settings** (`PUT /settings`; `pay-2d`)

- T1 `cardPayments` — absent: card unavailable, tenant parses as before; valid: saved, `GET /settings` returns it;
  malformed (not an object, unknown key): 400 naming the field.
- T2 `cardPayments.processor` — absent: 400; valid `netopia`; other value: 400.
- T3 `cardPayments.environment` — absent: 400; valid `sandbox` / `live` (selects the base URL of N2); other: 400.
- T4 `cardPayments.posSignature` — absent: 400; valid: the format of § 4.4; other text or type: 400.
- T5 `cardPayments.publicKey` — absent: 400; valid: PEM that loads as an RSA public key, ≤ 4096 characters;
  non-RSA key, not PEM, too long, not text: 400.
- T6 API key — absent (never saved): `card` cannot be enabled, `apiKeySet: false`; valid: 1-512 characters, no
  white space → stored per PAY2-SECRET-STORE, `apiKeySet: true`, never in `GET /settings` or the renderer's record;
  empty, white space, too long, not text: 400.
- T7 `enabledPaymentMethods` containing `card` — valid only with T1-T6 complete, `commerceEnabled`, `currency` RON;
  each missing condition: 400 naming it. T8 currency changed from RON while `card` is enabled: 400.

**Order** (`create.ts`, the start route, the paid write)

- O1 `paymentMethod: card` — valid when enabled: stored, mail label `Card`; not enabled: 400.
- O2 `paymentAttempts` — absent: 0; valid: integer 0-5 (5 = exhausted → start answers 409 `too-many-attempts`);
  not a safe integer, < 0, > 5: start answers 409 `attempts-unreadable`, no write.
- O3 line `delivery` — absent: the line needs no delivery and calls for no mark; valid `{ kind: "download",
  resourceId }` with `resourceId` text 1-64 characters without `/` (resource ids are UUIDs,
  `backend/src/resources/presign.ts:91`), written only for a digital product with a resource; present but any other
  value (other `kind`, missing or bad `resourceId`, not an object): the line calls for `downloadMail` (§ 7.2), whose
  run marks `failed (entitlement-unreadable)` with the line number; the download route answers 409
  `entitlement-unreadable`. Line numbers in marks are 0-based indexes into the order's `items`.
- O4 `fulfilment` — absent: no delivery for this order, no "Run again"; valid: per § 7.2; a mark that does not parse:
  shown "unreadable", "Run again" 409 `mark-unreadable`.
- O5 a mark, per state (the mark codec; every listed field required, every other field forbidden):
  `pending` — `run` safe integer ≥ 1, `since` ISO 8601; `done` — `run` ≥ 1, `at` ISO 8601; `failed` — `run`
  safe integer ≥ 0, `at` ISO 8601, `failure` one of the `DeliveryFailure` members with exactly its fields (`lines`: a
  non-empty array of distinct valid line indexes; `error`: text 1-100 characters). A missing field, a field of
  another state, an unknown state or reason, a value outside its form → the mark is unreadable (O4).
- O6 stored `total` — `orderAmountMinor` rows: number 12.5 → 1250; text `"12.50"` → 1250; absent, `NaN`, `-1`,
  `0`, `0.004`, `1e300`, `"12,50"`, `"abc"` → 409 `total`, no write.
- O7 stored `currency` — `RON`: valid; absent or other: 409 `currency`.
- O8 stored `status` — `cancelled`/`annulled`: start 409 `order-cancelled`; any other text: allowed.

**Attempt item** (codec in `packages/shared`)

- A1 `orderId`, `attemptNo`, `processor`, `amountMinor`, `currency`, `createdAt` — present on every state; valid:
  UUID, integer 1-5, `netopia`, safe integer > 0, three upper-case letters, ISO 8601.
- A2 `state` and its fields — every listed field required, every other field forbidden (besides A1 and the storage
  attributes `PK`, `SK`, `Type`). Forms: `processorPaymentId` text 1-64; times ISO 8601; `processorStatus` safe
  integer ≥ 0; `Money` = `amountMinor` safe integer > 0 and `currency` three upper-case letters.
  - `opening` — no further field.
  - `open` — `processorPaymentId`, `openedAt`.
  - `start-failed` — `failure` (`{ kind: "refused", code }` with `code` matching `REFUSAL_CODE` (§ 4.3), or `{
    kind: "no-answer" }` with no `code`), `failedAt`.
  - `declined` — `processorPaymentId`, `processorStatus`, `at`.
  - `amount-mismatch` — `processorPaymentId`, `reported` (Money), `at`.
  - `succeeded` — `processorPaymentId`, `succeededAt`, `orderEffect` (`order-paid`, `order-already-paid`,
    `order-not-payable`).
  - `refunded` — `processorPaymentId`, `refundedAt`, `refundReported` (Money), `from`: `{ state: "succeeded",
    succeededAt, orderEffect }`, `{ state: "amount-mismatch", reported }` or `{ state: "not-paid" }`, each with
    exactly its fields.
- A3 any A1/A2 field absent or malformed on a stored item → `StoredDataInvalidError` (the error class of
  `backend/src/lib/scheduling-db.ts:93`): the route answers 500 (start, "Run again", download) or 503 temporary
  ack (notification); no write. Only manual edits produce this (the platform writes attempts through the codec).

**Notification — the token** (`readNotification`)

- V0 positive verification — (a) a token built by the test's own encoder (separate from the verifier: header and
  claims encoded and signed with `crypto.sign("RSA-SHA512", …)` and a key pair generated in the test) for a given
  body verifies and yields the expected event; (b) the genuine sandbox notification captured by `pay-2a` (body,
  token, Netopia public key, POS signature; `exp` ignored for the recorded clock) verifies. Without (b), `pay-2d`
  does not pass.
- V1 header `verification-token` — absent: 401 (`no-token`); present: next rows.
- V2 token shape (compact JWS, RFC 7515 § 3.1, https://www.rfc-editor.org/rfc/rfc7515.html#section-3.1, read
  2026-11-22) — exactly three parts separated by `.`, each non-empty base64url: else 401 (`bad-token`). Each part is
  decoded separately: V2a the **header** part decodes to a JSON object, else `bad-token`; V2b the **claims** part
  decodes to a JSON object, else `bad-token`; V2c the **signature** part decodes to bytes (never parsed as JSON) and
  is checked only cryptographically (V6).
- V3 JWT header `alg` — `RS512`: valid; absent or other: 401 (`bad-token`).
- V4 JWT header `typ` — `JWT`: valid; absent or other: 401 (`bad-token`) (as [K1]).
- V5 other JWT header fields (`kid`, …) — ignored.
- V6 signature — verifies with the tenant's key: valid; other key, one byte changed: 401 (`bad-signature`).
- V7 claim `iss` — `NETOPIA Payments`: valid; absent, other text, not text: 401 (`wrong-issuer`).
- V8 claim `aud` — a text or an array of texts containing the tenant's POS signature: valid; absent, no match,
  other type: 401 (`wrong-audience`).
- V9 claim `sub` — base64 of SHA-512 of the raw body (decoded first when API Gateway marks it base64): valid;
  absent, not text, body changed by one byte: 401 (`body-hash-mismatch`).
- V10 claim `exp` — absent: accepted; a number of seconds not more than 300 s in the past: valid; older: 401
  (`expired`); not a number: 401 (`bad-token`).
- V11 claim `nbf` — absent: accepted; not more than 300 s in the future: valid; later: 401 (`not-yet-valid`); not a
  number: 401 (`bad-token`).
- V12 claim `iat` and any other claim — ignored (not checked, not logged).
- V13 path `tenantId` — unknown tenant, or tenant without `cardPayments`: 401, same body as V6.
- V14 body size — > 16 KB: 413, no read.

**Notification — the body** (only after V1-V13 pass)

- V15 body — not a JSON object: permanent ack (`body-not-json`).
- V16 `order.orderID` — `<uuid>.<1-5>`: valid; absent, other shape, `.0`, `.6`, not text: permanent ack
  (`bad-order-reference`).
- V17 `payment.ntpID` — text 1-64 characters: valid; absent, empty, longer, not text: permanent ack
  (`no-payment-id`); valid but different from the attempt's stored id: permanent ack, error log.
- V18 `payment.status` — a safe integer ≥ 0: valid (mapped by § 3.5; an unknown value is `informational`);
  absent, text, fraction, negative: permanent ack (`bad-status`).
- V19 `payment.amount` — read only for statuses mapped to `paid` or `refunded`: a finite number > 0 whose minor
  units (unit rule of U1) are a safe integer > 0: valid; absent, ≤ 0, not a number, rounding to 0, overflow:
  permanent ack (`bad-amount`). For other statuses: ignored.
- V20 `payment.currency` — read only with V19: three upper-case letters: valid (a value ≠ the attempt's → the
  mismatch path for `paid`, stored as reported for `refunded`); absent or other shape: permanent ack
  (`bad-currency`).
- V21 `payment.method`, `payment.code`, `payment.message`, `payment.data`, `order.data` — ignored (not stored);
  `payment.code` is logged when it is 1-16 word characters.
- V22 `payment.instrument` (incl. `panMasked`), `payment.token`, `payment.binding` — ignored; never stored, never
  logged.
- V23 any unknown field — ignored.

**Start answer from Netopia** (adapter; § 4.3)

- S1 HTTP status not 2xx, or body not a JSON object → `refused { code: "http-<status>" }`.
- S2 `payment.paymentURL` — absolute `https:` URL: valid; absent or other → `refused` (S4).
- S3 `payment.ntpID` — text 1-64 characters: valid; absent or other → `refused` (S4).
- S4 `error.code` — becomes the refusal code through `refusalCode` (§ 4.3): `"56"` → `"56"`; `"http_x-1"` →
  itself; absent, `""`, `"A.B"`, a 17-character text, a number, `null` → `unusable-answer`. For each row the resulting
  `start-failed` item is written and read back through the attempt codec (A2) without error. `error.message` logged
  (≤ 200 characters); `payment.status` logged; other fields ignored.
- S5 no answer within 10 s, network error → `no-answer`.

### 11.2 Behaviour and interleaving rows

- R1 `attemptReaction`: every cell of § 3.6 → its reaction; an added attempt state fails to compile (temp-copy
  check, as pay-1).
- R2 every pair of § 3.6, both orders, on the handler with a fake table: the pair table's result; refund → paid
  leaves the order pending and runs no delivery.
- R3 start: each refusal of § 5.1 step 3 → its status and code; no attempt written, no processor call.
- R4 start ok → one allocation transaction, attempt `opening` then `open` with the ntpID; 201; processor called once
  with the § 4.3 body (no card field; amount from the stored order).
- R5 start refused / timeout → attempt `start-failed` (`refused` code / `no-answer`); 502.
- R6 allocation transaction cancelled because the status became `cancelled` → 409 `order-cancelled`, no attempt.
- R7 two starts at once on attempt 4 → one 201, one 409 `too-many-attempts` (the counter condition serialises them).
- R8 a notification moves the attempt between the processor call and the start-result write (fake client order) →
  start answers 409 `attempt-settled`; the attempt keeps the notification's state.
- R9 notification paid, order pending, a download line → one transaction (order + attempt) with the initial mark;
  audit; paid mail; download mail; mark `done`; ack 0.
- R10 the same notification twice, sequential and concurrent, for each kind of the repeated-events table of § 3.6
  (paid equal, paid not equal, declined same status, refunded same reported, informational) → exactly the writes,
  mails and alerts of that table; declined 12 then declined 4 → two writes, stored status 4.
- R11 notification paid for an order already paid by the admin → `order-already-paid`, alert, no delivery.
- R12 status set to `cancelled` between the order read and the paid transaction (fake client) → the transaction is
  cancelled; second decision: paid with marks `failed (order-cancelled)`, alert.
- R13 notification paid for a refunded order → `order-not-payable`, alert, order unchanged.
- R14 admin mark-paid and notification race (fake client forcing the payment condition to fail once) → one paid
  write; the loser path of § 5.4.
- R15 function stops after the paid transaction (test stops before the deliveries) → mark `pending`; "Run again"
  refused before 2 minutes, claimed after.
- R16 download mail: SES error → `failed (send-failed)`; payment state unchanged; "Run again" → second run `done`.
- R17 end-of-run write fails → mark stays `pending`; "Run again" after 2 minutes sends again (the documented repeat).
- R18 two "Run again" at once → one claim, one 409 `claimed-by-another`.
- R19 "Run again" when the order is cancelled, not paid, or its paying attempt is `refunded` → 409 with the reason.
- R19a a refund of the paying attempt commits after "Run again" read the attempts and before its claim (fake client
  order) → the claim transaction is cancelled by the `ConditionCheck`; 409 `refunded-at-processor`; nothing sent.
- R19b a refund (or a cancellation) commits after a successful claim → the claimed run completes and ends `done`;
  the next "Run again" → 409.
- R20 download lines: two lines → one mail with both; one resource removed → `failed (resource-removed, [n])`, no
  mail; `s3Key` of another tenant → `failed (resource-invalid)`; product deleted after purchase → `failed
  (product-removed, [n])`, no mail; product edited to another `resourceId` after purchase → the mail uses the line's
  `resourceId`; a line with an unreadable `delivery` → `failed (entitlement-unreadable, [n])`; an initial
  `order-cancelled` mark carries `at` (O5).
- R21 admin marks a bank-transfer order with a download line paid → the same marks and the download mail (second
  source, operator ruling PAY2-NOPROCESSOR-SCOPE = A).
- R22 (B) download route: id + matching email + paid + line with `delivery` → 200 URL for that tenant's key; wrong
  email → 404; not paid → 409; paying attempt `refunded` → 409; product removed or resource removed → 410.
- R23 checkout (`renderer/test/unit/pay-2e.test.ts`, fake `fetch`): with "Card" selected, the page posts the order
  with `paymentMethod: "card"`, then `POST /api/order-payment` with `{ orderId, email }`, then goes to the returned
  URL; a proxy failure goes to the order page. The whole path from stored settings to a paid order is § 11.4
  step 2 (not provable in the serving suite: the browser's requests do not run there).

### 11.3 Preservation rows

- **P0 (bound by the operator ruling)** — an order with no `delivery` line and `paymentMethod` ≠ `card`: creation
  writes the same item attributes and line keys as before `pay-2c` (the test captures the order `Put` with the fake
  client, as `storedOrder()` of `backend/test/unit/order-checkout-1.test.ts:56`, and compares it with the same
  capture run on the tree before `pay-2c` in a separate worktree); the admin's mark-paid writes exactly
  `paymentStatus`, `updatedAt`, `paidAt` with pay-1's condition,
  publishes the same audit entry and sends the same `paid` mail; no `fulfilment`, `paymentAttempts` or attempt item
  is written. Every pay-1 row of `backend/test/unit/pay-1.test.ts` passes unchanged.
- **P1** — a tenant without `cardPayments`: the checkout offers no card; the notification route answers 401 for it;
  no attempt can be created (`card-unavailable`).
- **P2** — the CM1 reference capture (51 URLs) after `pay-2e` equals the capture before it, except the checkout of a
  tenant whose stored `enabledPaymentMethods` lists `bank_transfer` (C21, PF6).

### 11.4 Staging plan with the Netopia sandbox

Needs from the human: a Netopia sandbox account (POS signature, sandbox API key, Netopia public key), and a demo
tenant with currency RON and commerce enabled. Steps (operator, after `pay-2d` and `pay-2e` are on staging), each
starting from stored tenant settings, never from injected page props:

1. Settings saved through the admin; `GET /settings` shows no key; `GET /settings/secrets` shows `apiKeySet: true`.
2. On the site: product page → "Add to cart" (a digital product with a resource and a physical product) → checkout
   shows "Card" (from the stored setting through `mapTenant`) → order → Netopia sandbox page → pay.
3. Read back: order `paid`; one attempt `succeeded / order-paid`; audit `UPDATE_ORDER_PAYMENT`; the paid mail and
   the download mail sent (function log; a test mailbox); mark `done`; the return page shows "Payment received".
4. A declined sandbox payment; then "Pay now" and success on attempt 2.
5. A forged notification (own RSA key) → 401; the genuine notification of step 3 re-sent (if the sandbox offers a
   resend) → ack 0, no second mail.
6. Admin marks a bank-transfer order with a digital product paid → the download mail is sent (R21).
7. P2 capture.

### 11.5 What cannot be proven without a live merchant account

Live keys and the live host; real 3-D Secure with a real bank; settlement and payout; Netopia's IPN retry behaviour
in live; currency clearance (N13); refund through the credit operation (N11); the merchant's PCI category (§ 10.1).
These are the client's onboarding steps with Netopia; the first live order on a client site is the evidence.

## 12. Build slices

### 12.1 Scope rule

Processor behaviour (the `card` method, attempts, the start and notification routes, the card settings) changes
nothing for a tenant without `cardPayments` (P1). The fulfilment point (§ 7) applies to every tenant: from `pay-2c`
on, a digital line gets `delivery` and a paid order with such a line gets its marks and its download mail, whatever
the payment method (ruling PAY2-NOPROCESSOR-SCOPE = A). Every other order behaves and is stored as today (P0).

Common gates of every slice: `npm run build`, `npm run typecheck`, the unit suites of the changed workspaces
(`npm --prefix <workspace> test` or `run test:unit` for backend and admin), `git diff --check`; renderer slices
also `npm --prefix renderer run test:serving`; route slices also `npm --prefix tools/mcp-server test`; infra slices
also `npm --prefix infra test` with the named assertions.

### 12.2 Slices, allocation, acceptance

**`pay-2a` — sandbox spike.** Answer U1-U10 with one sandbox payment, a declined one and a captured notification;
write the answers into § 2.4 and correct §§ 3.5, 4.3, 6.4, 11.1 where they differ. Throwaway code only under
`.agent-manager/slices/PAY-2A/`; a temporary capture endpoint named `pay-2a-*`, deleted at the end. Allocation:
`docs/slices/pay-2.md`. Depends: the human's sandbox account. Acceptance: every **required** unknown has an
answer with its evidence — sandbox evidence, or a written answer from Netopia (the human asks) when the sandbox
cannot show it. Required before `pay-2d` (and so before `pay-2e`): U1 (amount unit), U2 (retries and the answer
they follow), U3 (`exp`/`nbf`), U4 (public key per account and its rotation), U5 (`orderID` length), U6 (empty
billing fields), U7 (payment-link lifetime `L`; whether a payment can still arrive for a `declined` or
`start-failed` attempt; and which statuses shown in the Netopia panel mean that no further payment can arrive for
that payment), U8 (status sequence). Not required: U9, U10 (no rule depends on them). **While a required
unknown is open, `pay-2d` does not start.** Also produced: the captured genuine notification for row V0 (b).
Rollback: none (nothing deployed is kept).

**`pay-2b` — pure domain.** `PaymentMethodSchema` + `card` at the three sites of C1, `paymentMethodLabel`,
`orderAmountMinor`, `LineDelivery` on `OrderItemSchema`, attempt types + codec + `attemptReaction`, `DeliveryMark`
+ codec, `CardPaymentSettingsSchema`, the commerce string keys of § 9.4. Allocation:
`packages/shared/src/payment-attempt.ts` (new), `packages/shared/src/index.ts`,
`packages/shared/src/language-packs/en.ts`, `packages/shared/src/language-packs/ro.ts`,
`packages/shared/src/language-packs/types.ts`, `packages/shared/test/pay-2.test.ts` (new),
`packages/shared/ARCHITECTURE.md`. Depends: `pay-2a`. Acceptance: R1, R2 (pure part), O2-O6, A1-A3 codec rows.
Infra: none. Rollback: revert; nothing stored uses the types yet.

**`pay-2c` — the fulfilment point.** `recordOrderPaid`, marks, run 1, "Run again", the download mail, alerts;
`delivery` written by `create.ts`; `paymentMethodLabel` at the three mail sites; admin "Deliveries" block and the
`download` template; (link B) the download route, its proxy and the downloads on the order page. Allocation:
`backend/src/lib/order-paid.ts` (new), `backend/src/orders/update.ts`, `backend/src/orders/create.ts`,
`backend/src/orders/update-status.ts`, `backend/src/orders/get.ts`, `backend/src/lib/order-email.ts`,
`backend/test/unit/pay-2-order-paid.test.ts` (new), `backend/test/unit/pay-1.test.ts` (unchanged rows must pass;
P0 rows added), `backend/test/unit/order-email.test.ts`, `admin/src/pages/OrderDetail.tsx`,
`admin/src/pages/OrderDetail.test.ts`, `admin/src/pages/OrderEmails.tsx`, `docs/commerce.md`,
`backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`; link B adds `backend/src/orders/download.ts` (new),
`backend/test/unit/pay-2-download.test.ts` (new), `renderer/src/app/api/order-download/route.ts` (new),
`renderer/src/components/SitePage.tsx`, `renderer/src/lib/dynamo.ts`, `renderer/test/unit/pay-2c-downloads.test.ts`
(new), `renderer/test/serving-contract/contract.test.mjs`, `renderer/test/serving-contract/fixtures.mjs`,
`infra/lib/api-commerce.ts`, `infra/lib/amodx-stack.ts`, `infra/test/amodx-stack.test.ts`,
`tools/mcp-server/routes.json`, `renderer/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`; link A instead adds
`infra/lib/api-commerce.ts` (expose `updateOrderFunc`), `infra/lib/amodx-stack.ts` (statement and variable on it),
`infra/test/amodx-stack.test.ts`, `infra/ARCHITECTURE.md`. Depends: `pay-2b` and the decisions
PAY2-LINE-ENTITLEMENT and PAY2-DOWNLOAD-LINK. Acceptance (admin source only; attempts do not exist yet): P0, R15-R18,
R19 (not paid, cancelled), R19b (cancellation), R20, R21, R22 (B; no attempt). Infra assertions of the chosen
branch: (A) `UpdateOrderFunc`'s role has exactly one statement `s3:GetObject` on `<private bucket ARN>/*`, no
`s3:List*`, and the variable `PRIVATE_BUCKET`; (B) only the download function has that statement and variable, and
its route is `CUSTOM`.

**`pay-2d` — the processor.** Port, Netopia adapter, settings validation and the API key store, the start route,
the notification route, the `card` check in `create.ts`, attempts in `GET /orders/{id}`, admin "Card payments"
card and "Payment attempts" table. Allocation: `backend/src/lib/payment-processor.ts` (new),
`backend/src/lib/netopia.ts` (new), `backend/src/lib/payment-secret.ts` (new; the store of PAY2-SECRET-STORE),
`backend/src/payments/start.ts` (new), `backend/src/payments/netopia-notify.ts` (new),
`backend/src/orders/create.ts`, `backend/src/orders/get.ts`, `backend/src/tenant/settings.ts`,
`backend/src/tenant/settings-secrets.ts`, `backend/test/unit/pay-2-netopia.test.ts` (new),
`backend/test/unit/pay-2-start.test.ts` (new), `backend/test/unit/pay-2-notify.test.ts` (new),
`backend/test/unit/pay-2-settings.test.ts` (new), `admin/src/pages/Settings.tsx`, `admin/src/pages/Settings.test.ts`,
`admin/src/pages/OrderDetail.tsx`, `admin/src/pages/OrderDetail.test.ts`, `infra/lib/api-commerce.ts`,
`infra/lib/api.ts`, `infra/test/amodx-stack.test.ts`, `tools/mcp-server/routes.json`, `docs/commerce.md`,
`backend/ARCHITECTURE.md`, `admin/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`; link A adds `infra/lib/amodx-stack.ts`
(statement and variable on the exposed notification function). Depends: `pay-2c`, PAY2-SECRET-STORE, and `pay-2a`
with every required unknown answered. Acceptance: T1-T8, O1, O7, O8, V0-V23, S1-S5, R2-R14, R19 (refund), R19a,
P1; infra assertions: the notification route has `authorizationType: NONE` and the start route `CUSTOM`; the start
function can read the key store and the notification function cannot; no new grant on the renderer's role; (A) the
notification function has the one `s3:GetObject` statement and `PRIVATE_BUCKET`, (B) it has no bucket access.
Infra: two routes; the key store.

**`pay-2e` — the renderer.** `mapTenant` copies `enabledPaymentMethods`; checkout card option; proxy
`order-payment`; order page states and "Pay now"; attempts read for the order page. Allocation:
`renderer/src/lib/dynamo.ts`, `renderer/src/components/CheckoutPageView.tsx`, `renderer/src/components/SitePage.tsx`,
`renderer/src/app/api/order-payment/route.ts` (new), `renderer/test/unit/pay-2e.test.ts` (new),
`renderer/test/serving-contract/contract.test.mjs`, `renderer/test/serving-contract/fixtures.mjs`,
`renderer/ARCHITECTURE.md`. Depends: `pay-2d`. Acceptance: serving rows that start from a stored tenant item in the
DynamoDB stub (`renderer/test/serving-contract/ddb-stub.mjs`) and reach the checkout and the order page: card shown
only with a stored `card`; each order-page state of § 5.1 step 6 from stored attempts; query parameters other than
`id`, `email` change nothing; the proxy takes the tenant from the host and ignores a body `tenantId`; R23; P2. Deploy
precondition (operator): list which tenants store `bank_transfer` in `enabledPaymentMethods` (one `GetItem` per
tenant record) and confirm with the human before deploy (PF6).

**`pay-2f` — Paddle, per PAY2-PADDLE.** Under A: remove both buttons (§ 9.2 product surfaces), `PaddleLoader` and
its two uses, the admin Paddle tab and settings card, the webhook function, route and grants; keep `paymentLinkId`
and `integrations.paddle` in the schemas so data parses. Allocation: `renderer/src/components/SitePage.tsx`,
`renderer/src/components/ProductByIdPage.tsx`, `renderer/src/components/PaddleLoader.tsx` (deleted),
`renderer/src/app/[siteId]/layout.tsx`, `renderer/src/app/%5Fbook/[siteId]/layout.tsx`,
`admin/src/pages/DigitalProductEditor.tsx`, `admin/src/pages/DigitalProducts.tsx`, `admin/src/pages/Settings.tsx`,
`backend/src/webhooks/paddle.ts` (deleted), `infra/lib/api.ts`, `infra/test/amodx-stack.test.ts`,
`tools/mcp-server/routes.json`, `renderer/test/serving-contract/contract.test.mjs`,
`renderer/test/serving-contract/fixtures.mjs`, `docs/commerce.md`, `renderer/ARCHITECTURE.md`,
`admin/ARCHITECTURE.md`, `backend/ARCHITECTURE.md`, `infra/ARCHITECTURE.md`. Depends: `pay-2c` (digital delivery
exists first). Acceptance: serving rows from stored products — slug page of a digital product shows "Add to cart"
when commerce is on and no Paddle markup; by-id page shows no Paddle markup; the route is absent from the synthesized
API (infra assertion). Under B or C: its own packet.

### 12.3 Deploy order and rollback

Deploy order: `2a` (nothing) → `2b` → `2c` → `2d` → `2e`; `2f` any time after `2c`.

- **`pay-2b`** — revert at any time before `2c` is deployed.
- **`pay-2c`** — reverse dependencies first: `pay-2e` and `pay-2d` are reverted (with the `pay-2d` drain below)
  and `pay-2f` is reverted (else digital products are sold through the cart with no delivery) before `pay-2c`. Then
  the revert leaves `delivery` and `fulfilment` on orders; the pay-1 code ignores both. Digital delivery stops;
  before the revert the operator lists paid orders whose download mark is not `done` (per tenant `Query PK =
  TENANT#<t> AND begins_with(SK, "ORDER#")` with a projection) and hands the list to the owners. Under link B the
  download route goes too: buyers then get files by hand.
- **`pay-2d`** — never removed while a payment can still arrive. An attempt can still receive a payment while it is
  `opening`, `open`, `start-failed` or `declined` (the OPEN and `declined` rows of § 3.6 accept `paid`). Order:
  (1) revert `pay-2e` first, if deployed (no new starts from the checkout); (2) on each tenant with `card`, the owner
  or operator removes `card` from the enabled methods: the start route then refuses `card-unavailable`, also for
  "Pay now"; (3) **rule: every attempt in one of those four states (per card tenant, the attempts query of § 9.1)
  needs evidence that it cannot receive another payment**, and only these count: (a) it is older than `L` and
  `pay-2a` (sandbox or Netopia's written answer) established that no payment can arrive after `L` for an attempt in
  its state (U7); (b) the Netopia panel shows for this payment a status that `pay-2a` established as terminal (U7);
  (c) the money arrived and the owner marked the order paid (pay-1). A panel label alone ("failed", "declined",
  "closed") is not evidence unless (b) covers that label; (4) keep the notification route deployed until (3) holds
  for every such attempt — no time limit replaces the evidence; (5) then deploy the revert.
  Rollback check RB1 (operator, before step 5): for each card tenant, the list of attempts in the four states with
  the evidence (a), (b) or (c) for each; one attempt without evidence — for example a `declined` attempt whose panel
  label is "failed" when that label is not established as terminal — stops the removal. A secret created under
  PAY2-SECRET-STORE is deleted by hand (listed in the `pay-2d` rollback notes).
- **`pay-2e`** — revert: the checkout no longer offers card and the order page loses "Pay now". Card orders keep
  their state: paid ones stay paid; pending ones become paid if a notification still arrives (`pay-2d` stays) or
  stay pending; open payment pages keep working until they expire. The owner can ask a pending buyer for a bank
  transfer.
- **`pay-2f`** — revert restores the Paddle buttons and route (non-functional, as before).

## 13. Risks, and what is deliberately not built

- **Netopia's undocumented IPN behaviour (U2-U4) differs from the official code read** — `pay-2a` before any code
  depends on it; § 6.4 makes every outcome visible on the order page.
- **No retry by Netopia + a transient failure → order stays pending though paid** — the attempt stays `open` on
  the order page; the owner checks the panel and marks it paid (pay-1). A reconciliation job using
  `/operation/status` (N10) is not built until it is available and needed.
- **Netopia rotates its public key** — refusals (401) until the owner pastes the new key; U4 decides whether a
  second key slot is needed.
- **A buyer pays twice** (two tabs, "Pay now" after a slow notification) — detected (`order-already-paid` + alert);
  refund by hand in the panel.
- **Cancelled order paid late** — detected; deliveries marked `order-cancelled`; refund by hand.
- **The `placed` mail is sent before the card payment** — accepted: same as bank transfer today; the paid mail
  follows.
- **A mail repeats after an uncertain send** — accepted (§ 7.1 statement 4).
- **A refund or cancellation stored after a delivery run was claimed** — that run completes (one mail); every later
  run is refused (§ 7.3 rule).

Not built: subscriptions; saved cards / tokens; instalments; partial or processor-executed refunds (N11); invoices
(`invoice-1`, a later delivery of § 7); automatic cancellation or expiry of unpaid card orders (`sched-1h` has no
hold: buy first, pick the date later); a reconciliation job; a queue or scheduled retry of deliveries; a checkout
without address for carts of digital products only; a second currency; a second processor; "test connection" in
settings; a customer-facing refund flow.

## 14. Abstractions introduced (one line each)

- `CardPaymentProcessor` — users: start route, notification route; implementation: Netopia; axis: processor
  implementations (Netopia now, a client's processor or Paddle next — § 1 item 2); dispatch: interface, chosen in
  `processorFor`; rejected: Netopia calls inline in two handlers.
- `PaymentAttempt` + `attemptReaction` — users: start route, notification route, admin order page, order page,
  "Run again"; axis: attempt states fixed, operations growing → sum type + exhaustive `switch`; rejected: a status
  string with nullable `ntpID`/`reported` fields (the defect shape the rules forbid).
- `NotificationReading` (three-way result) — users: the notification route; axis: the outcome kinds are fixed
  (unverified / unusable / event) and decide the answer; rejected: one refusal union for both 401 and permanent
  ack (review-0 R07: it mixed authentication and payload failures).
- `CardPaymentSettingsSchema` (discriminated union with one member) — users: settings save, `processorFor`, admin
  card; axis: the processor (as the port); rejected: flat `integrations.netopia*` fields.
- `DeliveryMark` + `LineDelivery` — users: both paid sources, "Run again", the download route; deliveries:
  `downloadMail` now, `sched-1h` next; axis: deliveries grow, the contract is fixed → closed name unions;
  rejected: a call with no stored state (a failure after the paid write would be lost) and a read of the product at
  delivery time (review-0 R06).
- `recordOrderPaid` (function) — users: `orders/update.ts`, the notification handler; reason: two concrete callers
  of the same non-trivial write; rejected: a copy in each handler.
- `orderAmountMinor` (function) — users: the start route, the notification amount check; reason: one money rule
  for two callers; rejected: inline `amountInCents` calls without the safe-integer bounds.

## 15. Decisions (the human's)

DECISION_REQUIRED: PAY2-SECRET-STORE
- QUESTION: Each shop's Netopia API key must be stored. With it, a caller can start payments for the shop and, when
  Netopia opens its refund operation, send money back to cards. The usual place for shop secrets is the shop's
  record in the main table — but the public site server can read every item of that table, and VISION guarantee 2
  forbids keeping private data where it can. Every place outside the site server's reach needs one infra change.
  Which place?
- OPTIONS:
  - A. AWS Secrets Manager, one secret per shop (`amodx/<stage>/payments/<tenantId>`); the settings function may
    create and update secrets under that prefix, the start function may read them. Reward: the mechanism the
    platform already uses for its own secrets (C13); access logged by AWS; nothing in the table. Risk: a small
    monthly cost per shop with card payments (price not read today: INFERRED); a rollback leaves the secrets (deleted
    by hand).
  - B. SSM Parameter Store, one `SecureString` parameter per shop, same prefix grants. Reward: no per-secret price
    for standard parameters (INFERRED, not read today); the platform reads SSM at deploy time already
    (`infra/lib/amodx-stack.ts:158-165`). Risk: a second secret mechanism at run time; encryption key grants to add.
  - C. The key encrypted with a new KMS key and stored in the shop record; only the start and settings functions may
    use the KMS key. Reward: one item, no per-shop resource. Risk: the site server can read the ciphertext; encrypt
    and decrypt code to write and test; one KMS key resource and its cost.
- RECOMMENDED: A.
- BLOCKING_REASON: `pay-2d` cannot write the settings handler, the start route or the infra without it.

DECISION_REQUIRED: PAY2-LINE-ENTITLEMENT
- QUESTION: A buyer pays for a digital file. The delivery can run late (an admin presses "Run again" days later).
  If the delivery reads the product at that time, a deleted product loses the purchase and a changed file setting
  delivers a different file. To deliver what was bought, the order line must keep the file's id at purchase. That
  adds one field to every digital order line — a change to stored order data. Is the field added?
- OPTIONS:
  - A. Add `delivery: { kind: "download", resourceId }` to digital order lines at purchase (§ 3.3). Reward: the
    purchase is fixed when it is made; product edits change nothing bought; `sched-1h` adds its booking kind the
    same way. Risk: one more field in stored orders (optional; other lines unchanged, P0); orders placed before
    `pay-2c` have no field and get no automatic delivery.
  - B. Add no field; digital delivery is not built in this slice. Reward: no order data change. Risk: digital
    products are sold through the order with no delivery; the owner sends every file by hand; the human's direction
    (digital products fulfilled by the order) is not met.
- RECOMMENDED: A.
- BLOCKING_REASON: `pay-2b` (the type) and `pay-2c` (the writer and the delivery) depend on it.

DECISION_REQUIRED: PAY2-DOWNLOAD-LINK
- QUESTION: The packet asks for "the download mail with a signed link". An S3 link signed by a Lambda function stops
  working when the function's role session ends, even if it was signed for longer ("A presigned URL expires at
  either its configured expiration time or when its associated credentials expire, whichever occurs first" —
  https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html, read 2026-11-22). The disarmed
  Paddle code signed for 24 h; such a link can stop working after a few hours. How does the buyer get the file?
- OPTIONS:
  - A. The mail carries a signed S3 link per file (as the packet says). Reward: no new route; smallest. Risk: the
    link can stop working before the time it states; the buyer must ask the shop, which sends it again ("Send
    again"); the order-update function needs private bucket read.
  - B. The mail links to the order page; the page shows a "Download" button per paid file; the button asks the
    backend (renderer proxy, the order page's id + email rule) for a 15-minute signed link at click time. Reward:
    the download works whenever the buyer comes back; no long-lived link in a mailbox. Risk: one route, one proxy,
    one page block and one bucket grant more.
- RECOMMENDED: B.
- BLOCKING_REASON: the allocation and the infra of `pay-2c` differ between A and B.

DECISION_REQUIRED: PAY2-PADDLE
- QUESTION: Digital products have a Paddle "Buy now" button on two product pages (C16). It never delivered a
  purchase: Paddle's notifications could not reach the handler, the buttons send no shop or product, and the button
  uses an attribute Paddle's current script does not document (§ 2.3). Paddle's terms allow software and the
  seller's own digital content and prohibit physical products and "Human services that are not related to a
  software offering" (§ 8). The human's direction is one payment path: the order. What happens to the Paddle path?
- OPTIONS:
  - A. Retire it (`pay-2f`): remove both buttons, the script loader, the admin Paddle tab, the webhook function and
    its grants; keep `paymentLinkId` and `integrations.paddle` in the schemas so stored data parses. The slug page
    shows "Add to cart" for digital products; the by-id page shows no purchase action, as for physical products
    today (§ 9.2). Reward: one path; no unverified route; three unused grants removed. Risk: a client who sells
    software through Paddle loses the button; Paddle comes back only as a second processor behind the port, where
    its merchant-of-record model (it sets the price, clause 3.4) does not fit the order flow well.
  - B. Repair it: `data-items` with price ids, `data-custom-data` with shop and product, a Paddle Billing webhook
    verified by HMAC-SHA256 (`Paddle-Signature`, per-destination secret —
    https://developer.paddle.com/webhooks/signature-verification, read 2026-11-22) that creates an order and marks
    it paid. Reward: Paddle handles VAT as merchant of record for digital sales. Risk: a second order source and a
    second checkout; not usable for courses held in person or physical goods (§ 8); more code than the whole card
    path.
  - C. Keep it as it is. Reward: no work. Risk: a visible button that most likely does nothing (P5, NOT RUN in a
    browser), and an unused route with grants.
- RECOMMENDED: A.
- BLOCKING_REASON: not blocking `pay-2a`…`pay-2e`; blocks `pay-2f` only.

What the human provides before `pay-2a`: a Netopia sandbox account (POS signature, sandbox API key, public key) and
the name of the demo tenant (currency RON).

## 16. Findings outside this slice (not fixed here)

- **PF1 name/comment mismatch** — `backend/src/webhooks/paddle.ts:4` says "public route"; the route is behind the
  authorizer (P1). True behaviour: reachable by any authenticated caller only. Proposed: correct the comment in
  `pay-2f`, or delete the file under PAY2-PADDLE = A.
- **PF2 type mismatch** — `OrderSchema.subtotal`/`total` are strings; `create.ts` stores numbers (C2, C3).
  Proposed: a later order-schema slice; `orderAmountMinor` reads both forms (§ 3.1).
- **PF3 method not checked** — `create.ts` accepts `bank_transfer` (and any enum value) when the tenant has not
  enabled it (C5). `pay-2d` checks `card` only. Proposed: check every method in a commerce fix slice.
- **PF4 for `sched-1h`** — § 7.6.
- **PF5** — `docs/ROADMAP.md` row `pay-2` still says "DRAFT — PAY-PROVIDER"; `docs/TECH-DEBT.md` § "Netopia
  Payments (future)" says "webhook … update paymentStatus". Outside this slice's allocation; the operator updates
  them at ratification.
- **PF6 bank transfer never offered** — C21: the stored `enabledPaymentMethods` never reaches the checkout. `pay-2e`
  maps it (card needs it), which makes a stored `bank_transfer` visible; the deploy precondition of `pay-2e` lists
  the affected tenants first.
- **PF7 guest order access** — the order page and `GET /public/orders/{id}` give access by order id + matching email
  (C10). PD-002 names session-derived identity and has no guest-order variant. This slice reuses the existing rule
  unchanged and adds no authority; replacing it is a question for Track B/C.
- **PF8 existing tenant secrets** — `recaptcha.secretKey` and `integrations.braveApiKey` are in the main table,
  which the renderer's role can read (C11, C13). Not touched here.

## 17. Exit criterion

On staging with the Netopia sandbox: a visitor orders a digital product and a physical product by card, pays on
Netopia's page, and with no admin action the order becomes `paid`, the "payment received" mail and the download
mail are sent, and the order page shows "Payment received"; a forged notification is refused and changes nothing;
an owner marks a bank-transfer order with a digital product paid and the download mail is sent (§ 11.4).

## 18. Revision 1 — closure of review-0 (2026-11-22)

Each finding is named with the class of defect it belongs to and the one rule that closes the class here.

- **PAY2-R01** — class: two scope statements that cannot both hold. Rule: one scope rule (§ 12.1), set by the
  operator ruling PAY2-NOPROCESSOR-SCOPE = A, with the preservation row P0 bound to it. § 1, § 7.1, § 12 and P0-P2
  use only that rule.
- **PAY2-R02** — class: a public flow specified from its end without its stored-data path. Rule: every visitor row
  starts from a stored item (serving stub) and names each hop: stored setting → `mapTenant` → page → request
  (§ 9.2 "Settings to checkout", product surfaces; `pay-2e`/`pay-2f` acceptance; C16 and C21 corrected and added).
- **PAY2-R03** — class: a financial observation dropped because it arrived in an unexpected order. Rule: every
  verified financial observation (`succeeded`, `amount-mismatch`, `refunded`) is stored and final; `refunded` is
  final for every event; the pair table of § 3.6 states both orders of every pair.
- **PAY2-R04** — class: a decision taken on facts that the deciding write does not check. Rule: one conditional
  write per decision, and every fact that decides it is in its condition (§ 5.5): allocation is one transaction;
  the paid write checks payment state and status; claims check payment state, status and the run number. The two
  unavoidable second writes have a one-line recovery each (§ 5.1 step 4, § 7.3).
- **PAY2-R05** — class: a guarantee stated stronger than the mechanism. Rule: § 7.1 states four separate
  guarantees, each limited to what its write proves; no queue and no scheduled retry (the admin action covers every
  stuck mark); repeats after an uncertain send are named.
- **PAY2-R06** — class: a late action that reads mutable data instead of the purchase. Rule: the entitlement is the
  order line as written (§ 3.3); the field it needs is decision PAY2-LINE-ENTITLEMENT; every failure has a named
  reason; nothing is substituted; one mail per order.
- **PAY2-R07** — class: an inventory by group instead of by field. Rule: § 11.1 lists every new field and every
  notification and start-answer field, ignored ones included; authentication failure (`unverified`, 401) and
  payload failure (`unusable`, permanent ack) are separate result kinds (§ 4.1); money passes one rule
  (`orderAmountMinor`); `paidBy` is removed (the paying attempt records the source; absence = the admin, whose
  audit entry names the actor).
- **PAY2-R08** — class: an option or claim that breaches a binding invariant. Rule: a decision offers only options
  inside VISION and the PDs; PAY2-ORDER-ACCESS is withdrawn (the existing id + email rule is used, PF7);
  PAY2-SECRET-STORE offers only stores outside the renderer's reach, each with its infra gain.
- **PAY2-R09** — class: a rollback stated as "revert" without the live state it must drain. Rule: each slice
  states its exact paths and acceptance rows, and each rollback names what is still in flight and how it is drained
  before removal (§ 12.3).

### Revision 2 — closure of review-1 (2026-11-22)

- **PAY2-R03 (repeated events)** — class: a write that repeats a stored observation, and a condition that cannot
  tell two identical observations apart. Rule: a write happens only when the observation changes the stored
  attempt, and every attempt write is conditional on the observation it read (§ 3.6, § 5.5). `declined` has its own
  row (same status: replay; other status: one update). The repeated-events table states the writes per event kind;
  R10 tests each kind, sequential and concurrent.
- **PAY2-R04 (delivery claim)** — class: an eligibility fact read outside the deciding write. Rule (§ 7.3): every
  fact that decides whether a delivery may run is checked by the write that claims the run; "Run again" is one
  transaction of the mark claim and a `ConditionCheck` on the paying attempt. A refund or cancellation after a
  successful claim does not stop the claimed run; later claims are refused. The unratified "accepted window" is
  removed (§ 7.3, § 13); rows R19a, R19b.
- **PAY2-R06 (deleted product)** — class: a delivery that ignores a named loss of the purchase. Rule: the file comes
  only from the order line; the product is read only to check that it exists; a deleted product is
  `product-removed` (§ 7.2, § 7.4, R20, R22). An edited product never changes the file delivered.
- **PAY2-R07 (token and codecs)** — class: a decoding rule stated for a whole value instead of for each of its
  parts. Rule: each token segment and each state-dependent field has its own row (V2a-V2c per RFC 7515 § 3.1; A2 and
  O5 per state, required and forbidden fields); every mark written carries every field its state requires (the
  initial `order-cancelled` mark has `at`); a present but unreadable `delivery` reaches the `downloadMail` mark (§ 7.2,
  O3); positive rows V0 (own encoder; captured sandbox token).
- **PAY2-R09 (drain)** — class: a removal gated on a guessed time instead of on evidence. Rule: the notification
  route stays until every attempt that can still receive a payment (`opening`, `open`, `start-failed`, `declined`)
  is shown closed by verified expiry (U7), the Netopia panel, or a recorded payment; the 2-hour value is replaced by
  `L`, verified by `pay-2a`; `pay-2d` does not start while a required unknown (U1-U8) is open; `pay-2c` is reverted
  only after its dependents (§ 12.2, § 12.3).
- **PAY2-R09 (link A allocations)** — class: a decision branch whose infra is listed for one caller only. Rule: each
  branch of PAY2-DOWNLOAD-LINK names every signing function, its single `s3:GetObject` statement and variable, the
  exact paths and the infra assertions (§ 9.5, `pay-2c`, `pay-2d`).

### Revision 3 — closure of review-2 (2026-11-22)

- **PAY2-R07 (refusal code)** — class: an adapter output whose rule differs from the rule of the stored field it
  becomes. Rule (§ 4.3): every value an adapter produces for the domain satisfies the stored-field constraint, from
  one shared definition; `REFUSAL_CODE` and `refusalCode` are used by the adapter and the codec; the other adapter
  outputs are checked against their stored rules (V18 tightened to a safe integer ≥ 0); S4 rows read each
  resulting item back through the codec.
- **PAY2-R09 (drain evidence)** — class: alternatives of one gate that prove different conditions. Rule (§ 12.3
  step 3): every drain alternative proves the same condition — the attempt cannot receive another payment; a panel
  label counts only when `pay-2a` established it as terminal (U7 extended); check RB1 stops the removal for any
  attempt without such evidence.

## Appendix R. Document review and decision review (operator, 2026-11-22)

- Document review: builder `claude-opus-5-5`, reviewer `gpt-6.1-sol` (Codex), four build cycles; review-3
  verdict: approved (the document only; separate invocations, not assurance by independent providers).
- Operator ruling PAY2-NOPROCESSOR-SCOPE = A: "no-op without a processor" covers the processor behaviour; the
  fulfilment point "order became paid" applies to every tenant.
- Decision review: four decisions, four converged. PAY2-SECRET-STORE = A and PAY2-LINE-ENTITLEMENT = A stand.
  Two recommendations were corrected; the corrections are applied to the text above after the human ratifies:
  - **PAY2-DOWNLOAD-LINK: A, not B.** Cause: B lets "order id + email typed in the browser" release private
    files repeatedly, which PD-002 does not allow (the browser never supplies email as an authority; the
    sessionless amendment covers scheduling only). A: the mail to the stored customer address carries one signed
    link per file; the text promises no lifetime; the shop can send it again ("Send again").
  - **PAY2-PADDLE: A, revised.** Retire the Paddle path, but keep the price input of the digital product editor
    outside the removed Paddle card, labelled as the sale price, in the tenant's currency; this part moves to
    `pay-2c`, where the order starts to charge for digital products (an "informational" price would otherwise
    become the real charge, and a product without it cannot be ordered). Test: author a digital product →
    cart → order price.
- State: waits for the human's ratification of the four decisions and for a Netopia sandbox account.
