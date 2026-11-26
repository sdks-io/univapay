---
name: "typescript-univapay-payments"
description: "Use for ANY work on UnivaPay payment code in a TypeScript/Node app (UnivaPay's own SDK `univapay-client-sdk` 1.2.3): building it, fixing a bug, debugging a failing call or webhook, or reviewing existing code. Covers the checkout widget, payment links, holds and capture, refunds, subscriptions and \"pay in N\" plans, saved cards, 3-D Secure, konbini, bank transfer and PayPay, webhooks, outage recovery and going live. Typical fixes: a webhook that gets 401 or was switched off, a charge stuck in awaiting, a wrong subscription amount, a refused refund, an SDK call that fails on a reply it can't read. Gives the job → recipe map, a review checklist, tested templates, the business-rule ids for each step, and safe code for the known problems in SDK 1.2.3. Works with typescript-integrate-univapay-public-api (SDK workflow, contract sheet); this skill says WHAT to build. TypeScript/JavaScript only."
---

# UnivaPay payments: recipes, checks and templates

The payments layer on top of `typescript-integrate-univapay-public-api`, whose workflow still applies (plan file, contract sheet, SDK map). It says what to build for each payment job, in what order, and which business rules govern each step. The code here uses UnivaPay's own SDK, npm `univapay-client-sdk`, pinned to exactly `1.2.3`.

## The hard rule: open the business rules

**Before you build, fix or review any UnivaPay code, open `<plugin-root>/business-rules/` for every operation involved** (the plugin root holds `skills/`): `rules.md` (the index), `every-request.md`, `background.md` for webhooks, renewals or retries, and the `operations/` section of each operation the code calls.

- The rules say how UnivaPay behaves; this skill says what to build. Follow each cited rule id for the detail.
- `(SDK, tested)` marks a fact about the SDK, not the API, checked against `univapay-client-sdk` 1.2.3 by a unit test or a test-mode run.
- `(SDK 1.2.3 bug X)` marks a problem in that SDK version and the safe code that works around it (list below). When UnivaPay fixes it, that note and its safe code can go.
- If a recipe line and a rule seem to disagree, say so and quote both.

## UnivaPay's SDK 1.2.3: how the code calls it (SDK, tested)

- **Install:** `npm install --save-exact univapay-client-sdk@1.2.3`, and keep the lockfile: the SDK's own runtime packages (`@apimatic/core`, `@apimatic/schema`, …) use `^` ranges, so without a lockfile they can move under you (SDK 1.2.3 bug N5).
- **Client:** `new Client({ bearerAuthCredentials: { secretKey, jwtToken } })`. The SDK's README shows `accessToken`; the real field names are `secretKey` and `jwtToken` (SDK 1.2.3 bug N3). It sends `Authorization: Bearer {secret}.{jwt}` on every call. Server only.
- **Calls:** `client.charges`, `client.refunds`, `client.cancels`, `client.subscriptions`, `client.transactionTokens`, `client.webhooks`, `client.stores`, … Arguments are **positional**, in the method's own order: e.g. `getCharge(storeId, id, polling?)`, `createCharge(idempotencyKey, body)`, `createRefund(storeId, chargeId, body, idempotencyKey)`. Read the order from the method; it differs between methods.
- **Replies:** every call returns an `ApiResponse`: the object is in `.result`, with `.statusCode` and `.headers` (lower-case names, e.g. `headers["idempotency-status"]`). A capture's empty 200 gives `result: undefined` (`captureCharge.2`).
- **Enums:** enum fields are TypeScript enums. Strict `tsc` refuses a plain string: write `ChargeCreateRequestThreeDsMode.Skip`, `SubscriptionPeriod.Monthly`, `TransactionTokenCreateRequestPaymentType.Konbini`, `RefundReasonRequest.CustomerRequest`, `WebhookTrigger.ChargeFinished`.
- **Tokens:** `getTransactionToken` gives `data` as a union of every payment type's data, and `paymentType` as a plain string, so a check on `paymentType` doesn't narrow it. Use `cardTokenData(token)` from `charge-saved-card.ts`.
- **Metadata:** `metadata.orderId` is sent as `order_id`; any other key goes under `metadata.additionalProperties`, is sent at the top level, and comes back under `additionalProperties`, konbini numbers included (SDK 1.2.3 bug S4). Use only text, numbers or booleans as metadata values: UnivaPay refuses an object value (`updateCharge.6`) and stores an array as separate `name[0]`, `name[1]` keys (`updateCharge.7`), and SDK 1.2.3 drops an object value before sending, without an error, so it is lost silently (SDK, tested). Metadata keys can't be removed later: an update only adds or changes keys (`updateCharge.8`).
- **Errors:** read every failure with `readUnivapayError` from `univapay-errors.ts`. It covers `ApiError` and its subclass `ExternalApiError` (error status), `ResponseValidationError` (a 2xx the SDK can't read), `ArgumentsValidationError` (not sent) and network errors (SDK, tested). The message of an `ArgumentsValidationError` repeats the value you passed, card number and CVV included: never log it; `readUnivapayError` keeps only the path and the reason (SDK 1.2.3 bug N6) (SDK, tested).
- **Running it (SDK 1.2.3 bug N2):** plain Node can't load the SDK as an ES module (`import` crashes with `ERR_MODULE_NOT_FOUND`); `require()` works. Run TypeScript with `tsx` (`npx tsx server.ts`), or load the SDK with CommonJS `require`. In Vitest, add `test.server.deps.inline: ["univapay-client-sdk"]` (SDK, tested).
- **TypeScript settings (SDK 1.2.3 bug N14):** in an ES-module project with `moduleResolution: node16`/`nodenext`, the SDK's own `.d.ts` files fail to compile (TS2834) unless `skipLibCheck: true`; with `module: commonjs`, set `esModuleInterop: true` or `skipLibCheck: true` (TS1259). `RequestOptions` isn't exported: write `{ abortSignal }` inline (SDK, tested). The templates are checked with `module: NodeNext` and `skipLibCheck: true`.
- **Logging (SDK 1.2.3 bug M10):** never turn on `logging.logRequest.logBody`: it writes card numbers and CVVs to your logs.
- **Logging (SDK 1.2.3 bug N11):** any `logging` object, even `{}`, writes every request and response line to the console, and `logLevel` changes only the label; a client from `Client.fromEnvironment(...)` always does (SDK, tested). Build the client with `new Client({ bearerAuthCredentials })` and no `logging`, or pass your own `logger`.
- **Retries (SDK 1.2.3 bug N12):** keep the SDK's own retries off (their default) and retry with `withIdempotentRetry`. When turned on, `maxNumberOfRetries` does nothing until `maximumRetryWaitTime` is above 0, and then a GET is retried on 400, 401, 403, 404 and 409 too; a 429 ignores `Retry-After` (SDK, tested).

## Known problems in SDK 1.2.3, and where this skill handles them

| Bug (`SDK 1.2.3 bug …`) | What goes wrong | Handled in |
|---|---|---|
| M1 | its webhook handlers can't read real deliveries | `webhook-receiver.ts` reads the raw JSON; `shared/webhooks.md` |
| S6 | its `isXxxEvent()` guards match several events at once | switch on the raw `event` string; `shared/webhooks.md` |
| H3 | it misspells the trigger `token_three_ds_updated`, so it can't create, read or list a webhook that has it | `listWebhooksRaw`, `createWebhookRaw`, `updateWebhookRaw`, `getWebhookRaw`, `ensureWebhookActive`; `shared/webhooks.md` |
| N1 | one value outside its closed lists (e.g. a `bimonthly` subscription) fails the whole reply or list page | `readUnivapayError` names it; `storeSubscriptions`, `chargesCreatedSince` read such a page from the raw reply |
| H1 | one number in `metadata.order_id` fails the charge and its whole list page | always send text; same safe code as N1 |
| M9 | a token whose payment type it doesn't know can't be read | `readUnivapayError` names it |
| M5 | it adds a new random Idempotency-Key to every write without one, so retries aren't protected | always pass your own key (`idempotency.ts`) |
| M2/L2 | some errors are a plain `ApiError` whose `result` is undefined | `readUnivapayError` parses `body` |
| S7 | `listWebhooks` can't ask for switched-off webhooks | GET by the stored id |
| N2 | plain Node ESM import crashes | run with `tsx`, or CommonJS `require` |
| M10 | body logging writes card data to logs | never enable `logBody` |
| N6 | an `ArgumentsValidationError` message holds the value you passed, card data included | `readUnivapayError` keeps only path and reason |
| N8 | an online token with an unlisted `brand` or `callMethod` is sent with camelCase keys | build it from the SDK's enums; check strings first (`konbini-bank-paypay-api.md`) |
| N11 | any `logging` object (and every `fromEnvironment` client) logs every request line | no `logging`, or your own `logger` |
| N12 | the SDK's own retries: off unless `maximumRetryWaitTime` > 0, then they retry client errors too (SDK, tested) | keep them off; `withIdempotentRetry` |
| N14 | its `.d.ts` files need `skipLibCheck` (ESM, node16) or `esModuleInterop` (CommonJS) | TypeScript settings above |
| S4, S5, N3, N4, N5, M7 | smaller ones: metadata and issuer-token fields under `additionalProperties`, README names, cancel `reason`, unpinned runtime packages, merchant-scoped subscription-charge list | a note where a recipe touches them |

## Job → recipe

Pick every recipe the request touches.

| The user wants to… | Read |
|---|---|
| take a one-off payment on their own site (widget or inline form) | `recipes/checkout-widget.md` |
| send a link the customer pays on UnivaPay's page | `recipes/payment-links.md` |
| hold a card payment, then capture or cancel it | `recipes/authorize-capture.md` |
| refund a paid order, fully or partly | `recipes/refunds.md` |
| charge on a schedule: plans, "pay ¥X in N", pause, resume, cancel | `recipes/subscriptions.md` |
| save a card and charge it later from the server | `recipes/saved-cards.md` |
| run 3-D Secure on a server charge | `recipes/three-ds-server-charges.md` |
| take konbini, bank transfer or PayPay by API | `recipes/konbini-bank-paypay-api.md` |
| receive webhooks (every recipe) | `shared/webhooks.md` |
| go live | `shared/go-live.md` |
| repair damage: switched-off webhook, missed events, wrong subscriptions, stuck orders | `shared/recovery-runbooks.md` |

The recipe's steps become the plan's scope and the contract sheet's operations: put each step's rule ids on the row of the function that implements it, and count a field a step requires (e.g. `metadata: { orderId }`, `threeDs.mode`) as required.

## Fixing and reviewing

1. **Start with `shared/review-checklist.md`**: every section the code touches, "Check these first" above all.
2. **Open the rules** for every operation the code calls. For an error, search `business-rules/` for the error code, payment error number or `errors[].field`.
3. **Fix from the rule's "Do:" and the matching recipe step**, not from memory. Name the rule id (or checklist line) for every finding or fix.
4. **If data is already wrong**, finish with `shared/recovery-runbooks.md`.

## Templates (`templates/`)

Type-checked (`tsc --strict`), unit-tested against UnivaPay's SDK 1.2.3, and run in test mode. Each recipe lists the ones it needs.

- **Copy the template files a step needs into the project (a file copy); don't read them whole.** Copy only the files that step needs.
- Read a template only for the function you are adapting. Every SDK call in it still gets a contract-sheet row.

| Template | For |
|---|---|
| `webhook-receiver.ts` | the receiver, `processPending`; webhook calls over plain HTTPS (`listWebhooksRaw`, `createWebhookRaw`, `updateWebhookRaw`, `getWebhookRaw`, `ensureWebhookActive`); `chargesCreatedSince` |
| `payment-status.ts` | status → outcome maps; bounded waits (`settleCharge`, …) |
| `univapay-errors.ts` | every SDK error shape in one typed result; why a reply couldn't be read; `chargeErrorCode` |
| `idempotency.ts` | one `idempotencyKey` per business action; safe retries |
| `payment-link.ts` | `buildPaymentLink`; `checkLinkPayment` (any charge vs the order) |
| `subscription-plan.ts` | "pay in N" plans, schedule preview, safe pause, resume, cancel; `storeSubscriptions` |
| `charge-saved-card.ts` | saved-card charge with an explicit 3-D Secure mode, the 3-D Secure hand-off, `cardTokenData` |

## What test mode can't show

Each recipe ends with its own list; `shared/go-live.md` has them all, with rule ids. Say plainly which ones your work could not test, and how the user can check them after launch.
