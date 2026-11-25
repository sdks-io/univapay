# Review checklist: silent mistakes in UnivaPay code

Use this when you review, fix or debug code that calls UnivaPay. Go through every section the code touches. Also open `business-rules/` for each operation the code calls: these mistakes compile, pass happy-path tests and still lose money or orders.
Each line: **what to look for in the code** → what is right, then the rule ids. Lines marked "app rule" are app safety, not API behaviour.

## Check these first (most often missed in reviews)

- **Webhook auth expects `Bearer `**: e.g. `` === `Bearer ${secret}` `` or `.replace("Bearer ", "")` with a strict compare. The header is the raw auth token, so every real delivery gets 401 and the webhook is switched off. `background.9`, `background.15`
- **Webhook handler `await`s work before replying**: DB writes, emails, `fetch`, UnivaPay calls before `res.sendStatus(200)`. Reply within 3 s, then process. `background.11`, `background.13`
- **`createRefund` called for konbini or bank transfer**: no branch on the payment method before `refunds.createRefund`. Paid ones are refunded outside UnivaPay; unpaid ones are cancelled. `createRefund.2`, `createRefund.8`, `createRefund.6`, `createCancel.4` (`refunds.md`)
- **"Pay ¥X in N" sends the per-payment price as `amount`**: e.g. `amount: pricePerPayment` next to `subscriptionPlan: { planType: "fixed_cycles" }`. `amount` is the total, so ¥30,000 in 3 sent as 10000 charges ¥3,333. Use `fixedCountPlan`, preview with `previewPlan`, and fix plans already created with `recovery-runbooks.md` (b). `createSubscription.24`, `simulateSubscriptionPlan.1`
- **Saved-card charge with no 3-D Secure handling**: `createCharge` on a recurring token with no `threeDs.mode`, no check of the token's `data.threeDs.status`, and no branch for `awaiting`. It waits for the customer instead of paying. `createCharge.42`, `createCharge.45`, `createCharge.66`, `getTransactionToken.2` (`saved-cards.md`, `three-ds-server-charges.md`)

## Webhooks (`webhooks.md`)

- **No duplicate check**, or one keyed on `body.id` / `event.id`. There is no delivery id, and events repeat. `background.10`, `background.18`
- **The order changed from the webhook body**, e.g. `if (data.status === "successful") markPaid()`, with no GET. Bodies can be stale or out of order. `background.19`
- **Fulfilment on `charge_updated`.** It fires for `authorized` (a hold) and `awaiting` (not paid yet). Fulfil only on a GET that says `successful`. `background.20`, `createCharge.21`, `createCharge.31`
- **Error replies for events the app doesn't handle**, or a thrown error that becomes a 4xx/500 reply. These switch the webhook off. `background.15`
- **A redirect on the webhook route** (HTTP→HTTPS, a trailing slash, auth middleware). `background.14`
- **No check that the event belongs to this app**: no lookup by `data.metadata.order_id` or by stored id, so other apps' events are acted on. `background.76`
- **Events matched with the SDK's `parseUnivapayPublicApiWebhookEvent` guards** (`isRefundFinished()`, `isSubscriptionPayment()`, …): all but the two charge guards compare camelCase names and never match the real snake_case events, so those events are silently ignored. Switch on the raw `event` string, as `webhook-receiver.ts` does. (SDK, tested)
- **`express.json()` mounted before the webhook route**: the raw body is lost.
- **The webhook object or the `Authorization` header is logged.** `createWebhook.8`
- **No way back from a switched-off webhook**: no stored webhook id, no `active` check, no catch-up job. `background.17` (`recovery-runbooks.md` (a))
- **Catch-up built on `listWebhookEvents`.** It answers 401 to a store app token. `listWebhookEvents.1`
- **`ensureWebhookActive` run on a timer for every webhook id in the config, or without `expectedUrl`**: a deleted webhook reads like a switched-off one, and switching it on brings it back. Call it only for the id in use now, with `expectedUrl`. `deleteWebhook.1`
- **A missing entry in the webhook list taken as "no webhook"**: the default list leaves switched-off and deleted webhooks out, and the SDK's boolean `active` filter can't ask for them (SDK, tested). GET by the stored id. `listWebhooks.2`, `listWebhooks.1`

## Charge status

- **Paid when the create call returns** (`status: "paid"` right after `createCharge`). The reply is `pending`. `createCharge.26`, `createCharge.27`
- **`authorized` treated as paid.** It is a hold. `createCharge.21`, `captureCharge.1`
- **`awaiting` treated as paid or as failed.** The customer still has to act (konbini, bank, wallet, 3-D Secure). `createCharge.31`, `createCharge.45`
- **`error` treated as final.** It can still change. `getCharge.11`
- **Status read from a list** (`listStoreCharges`, `listRefunds`, `listStoreSubscriptions`). Lists lag, so GET the single resource. `listAllCharges.5`, `listRefunds.1`, `listStoreSubscriptions.2`
- **`error.code` typed or compared as a string** (`case "309":`). It is a number. `getCharge.7`
- **Paid from a return URL, a redirect query, a PayPay return or a widget callback.** They only say which charge to GET. `background.19`, `createCharge.52`, `createCharge.54`
- **A `failed` charge nobody sees**: the order stays "unpaid" with no code shown and no retry or new link offered. `getCharge.7`
- **Transaction history filtered with `status: "errored"`.** The value is `error`. `listTransactionHistory.10`

## Amounts, ownership and keys (app safety)

- **The amount comes from the request body**, a hidden field or a `data-amount` the server didn't set. Price on the server from your own catalogue or order. (app rule)
- **"Paid" without matching the charge to the order**: no check of `charge.metadata.orderId` and of the amount and currency (`checkLinkPayment`). (app rule; `createCharge.26`)
- **`metadata.order_id` sent as a number** (e.g. `order_id: order.id` with a numeric id, or set by another system). The SDK then fails to read that charge and the whole `listStoreCharges` page, which breaks catch-up. Always send it as a string. (SDK, tested)
- **A token id from the browser charged or subscribed without a server check**: no `getTransactionToken`, no `type` / `paymentType` / `active` check, no owner check. `createTransactionToken.9`, `createSubscription.9`; charging another customer's card is an app rule.
- **The secret in browser code or in a payment link**, or server calls made with the app token alone. `every-request.1`, `every-request.8`, `getCheckoutInfo.1`
- **Payment links made by hand** (in the console or pasted), with no `order_id` from the server, so payments can't be matched to an order. Build links with `buildPaymentLink` (`payment-links.md`). (app rule)
- **No startup check of the widget's allowed domains** in the app token: the widget then won't open on the site (`go-live.md`). `createTransactionToken.51`
- **`three_ds.mode: "skip"` set from the browser, or without UnivaPay enabling it.** `createCharge.43`, `createSubscription.32`

## Idempotency and retries (`templates/idempotency.ts`)

- **No `idempotencyKey` on `createCharge`, `createRefund`, `createSubscription` or `createTransactionToken`.** The SDK then sends no key (SDK, tested), so a retry or a double click charges twice. `every-request.20`, `every-request.21`
- **A new random key on each retry**, e.g. `randomUUID()` inside the retry loop. Same action → same key. `every-request.21`
- **A new order made on each tap of "pay"** (e.g. "pay with saved card"): each order has its own key, so a double tap charges twice. Create the order once, before the pay button. (app rule)
- **One key reused for a different amount or action.** The first result comes back silently, or you get 409. `updateCharge.1`, `every-request.23`
- **The same key reused after a failed charge**: it returns the old failed charge. A new attempt needs a new key. `every-request.21`
- **Capture or cancel protected only by the key.** They ignore it, so guard in the app. `captureCharge.16`, `createCancel.14`
- **Status read from a replayed create reply.** It is the first stored reply, e.g. still `pending`. `createRefund.23`
- **No branch for `CHARGE_TOO_QUICK` or payment error 311** on repeat charges or subscriptions on one card. Test mode never returns it, so only a unit test catches a missing branch. `createCharge.37`, `createCharge.36`, `createSubscription.25`, `createSubscription.26`
- **A 400 retried unchanged**, or a 500 retried without first checking what happened. `every-request.11`, `every-request.13`

## Holds and capture (`authorize-capture.md`)

- **`capture` left out on a hold.** It is then a sale. `createCharge.22`
- **`capture` sent on konbini, bank-transfer or wallet charges** (even `true`): 400. `createCharge.20`
- **Capture amount from the browser, above the hold, or in another currency.** `captureCharge.6`, `captureCharge.7`
- **A result read from capture's empty 200.** `captureCharge.2`
- **Partial captures assumed after January 2027, or holds left uncaptured for weeks.** `captureCharge.9`, `background.39`
- **Cancel used on a captured charge, or refund used on a hold.** `createCancel.6`, `createRefund.6`
- **The 1-yen card-check authorization captured** (made when a card is saved with CVV authorization). `captureCharge.15`, `createCancel.7`
- **Your own emails on hold, capture, cancel or refund** without checking UnivaPay's notifications: customers get two. `createCharge.17`, `createCharge.15`, `createCancel.2`

## Refunds (`refunds.md`)

- **A `pending` refund counted as refunded** ("refund complete" email right after create). `createRefund.3`, `background.32`
- **An unpaid konbini order told "can't be refunded".** It is cancelled instead. `createRefund.6`, `createCancel.4`
- **No check of what is left** (charged − refunds, pending ones included). `createRefund.10`, `createRefund.11`
- **Waiting for the charge to say "refunded".** It stays `successful`. `getCharge.8`
- **One key for every partial refund of a charge.** `every-request.21`
- **Refund in the requested currency of a converted charge.** `createRefund.12`
- **Partial card or PayPay refunds assumed in live mode, or on MCP charges.** `createRefund.14`, `createRefund.4`

## Subscriptions (`subscriptions.md`)

- **`installment_plan` used for "pay in N".** It is card-company installments. `createSubscription.22`
- **No schedule preview before creating a fixed plan.** `simulateSubscriptionPlan.1`
- **Access given on the 201.** The subscription is `unverified` until the first charge. `createSubscription.41`
- **`unpaid` read as canceled or as paid**, or a webhook awaited after resume. `background.25`, `unsuspendSubscription.2`, `unsuspendSubscription.3`
- **Access cut the moment a renewal is `unpaid`**, while UnivaPay is still retrying; end it on `suspended` or `canceled` (`subscriptions.md` step 7). `background.66`, `background.63`
- **A subscription's 3-D Secure return page that reads `univapayChargeId`.** It carries `univapaySubscriptionId`. `createSubscription.38`
- **A JSON body parsed from cancel's 204, or a crash on its empty 403.** `cancelSubscription.1`, `cancelSubscription.3`
- **`completed` treated as a failure.** `background.73`
- **The amount PATCHed on a fixed-count plan.** It is refused. `updateSubscription.7`
- **`three_ds.mode` left out.** The sources disagree on the default. `createSubscription.28`

## Saved cards and 3-D Secure (`saved-cards.md`, `three-ds-server-charges.md`)

- **No hand-off when the bank asks**, the issuer page in an iframe, or the wrong issuer-token endpoint. `getChargeThreeDsIssuerToken.2`, `getChargeThreeDsIssuerToken.3`, `getChargeIssuerToken.7`
- **SDK field names (`requestData`) posted to the issuer** instead of the wire names (`payloadToWireFields`). `getChargeThreeDsIssuerToken.2`
- **A charge waiting for 3-D Secure cancelled.** `createCancel.5`
- **`three_ds.mode: "provided"` sent, or `three_ds.mode` left out on server charges** and `normal` assumed. `createCharge.41`, `createCharge.42`
- **A bounded recurring token (`usage_limit`) charged twice in its period.** `createCharge.60`
- **No handlers for `recurring_token_deleted` or `token_replaced`**: a dead token keeps being charged. `background.33`, `background.34`
- **A token deleted while subscriptions still use it.** `deleteTransactionToken.1`
- **A card saved without paying, with no `cvvAuthorize`.** Later charges fail. `createTransactionToken.31`, `createCharge.65`

## Konbini, bank transfer and PayPay (`konbini-bank-paypay-api.md`, `checkout-widget.md`)

- **No payment number, slip or bank account shown to the customer**, or read from the create reply. Read them once the charge is `awaiting`. `createCharge.83`, `getTransactionToken.3`, `getCharge.2`
- **`metadata.internal_convenience_payment_number` read at the top level** of the SDK's `metadata`. It is under `metadata.additionalProperties`. (SDK, tested)
- **Pay-easy without the institution number 58091.** `createCharge.84`
- **A token reused after a failed or expired attempt.** Make a new token and charge. `background.51`, `background.54`, `background.49`
- **Bank-transfer amounts not compared with the order.** `background.52`, `background.53`
- **A redirect to the test-mode dummy issuer token, or a hand-off that fails on it** (it is `test-issuer-token`, not a URL). `getChargeIssuerToken.3`
- **A konbini deadline left to the console for an event booking**, or a time of day trusted for 7-Eleven, Seicomart or Pay-easy. `createTransactionToken.28`, `createCharge.24`
- **`expiration_time_shift` sent as a duration (`PT23H59M`).** `createTransactionToken.26`, `createTransactionToken.27`

## Errors and responses (`templates/univapay-errors.ts`)

- **Error handling that needs a JSON body.** Some 401, 403 and 429 replies have none. `every-request.10`, `every-request.18`, `cancelSubscription.3`
- **Every refusal shown as "payment failed".** Branch on `code`, `errors[].field` and `errors[].reason`. `every-request.10`, `every-request.11`

## Keys and modes (`go-live.md`)

- **A test-mode app token (or its tokens) used in production, or tokens mixed across modes.** `every-request.31`, `createCharge.14`, `createCharge.59`
- **A base URL other than `https://api.univapay.com`.** `every-request.9`
