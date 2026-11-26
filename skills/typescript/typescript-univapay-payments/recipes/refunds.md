# Refund a payment, fully or partly, by payment method

Use this when staff (or your rules) give money back on a **paid** order: card, PayPay and other online wallets through the API; konbini and bank transfer outside UnivaPay. If the order is not paid yet (a card hold, or a konbini or bank-transfer request the customer hasn't paid), cancel it instead: see step 2 here and `authorize-capture.md`.

## Before you start

- **Keys:** server only, refund calls with `{secret}.{jwt}`.
- **Ask UnivaPay** that refunds are enabled for your merchant and store (`createRefund.9` (REFUND_NOT_ALLOWED)), whether a `refund_percent_limit` is set (`createRefund.1`), and which methods allow partial refunds in live mode (`createRefund.14`).
- **Webhook:** triggers `refund_finished` and `cancel_finished` (plus your charge events), set up as in `shared/webhooks.md`.
- **Templates to copy:** `payment-status.ts` (`settleRefund`, `refundOutcome`, `settleCancel`), `idempotency.ts`, `univapay-errors.ts`, `webhook-receiver.ts`.
- **Your data:** on each order, the payment **method** (saved at checkout), `charge_id`, `charged_amount`; a refunds table (`refund_id`, `amount`, `status`, `request_id`, `error_code`); a manual-refunds table for konbini and bank transfer (`amount`, `state` to-do/done, `request_id`).

## Steps

1. **Re-read the charge first.** `(await client.charges.getCharge(storeId, chargeId)).result`. Decide from its `status`, then from the order's method. Never from the order's own old state.

2. **Not paid yet → cancel, don't refund.** Only a `successful` charge can be refunded: an `authorized` hold or an `awaiting` konbini or bank-transfer charge is refused (`createRefund.6`).
   - Card hold: cancel it (`authorize-capture.md` step 7; `createCancel.3`).
   - Unpaid konbini: cancel the payment request; the customer's payment number stops working (`createCancel.4`).
   - Unpaid bank transfer: cancel the `awaiting` charge (`createCancel.16`). Don't cancel one that has received money (`createCancel.11`).
   - Tell staff the real reason: "The customer hasn't paid yet, so there is nothing to refund. Cancel the payment request instead." Never "konbini can't be refunded" for an unpaid order (a common mistake).
   - `failed` or `canceled` → nothing was taken; nothing to refund.

3. **Paid by konbini or bank transfer → refund outside UnivaPay.** UnivaPay refuses both refunds (`createRefund.2` bank transfer, `createRefund.8` konbini), and a paid konbini charge can't be cancelled either (`createCancel.6`). So don't call `createRefund` for them:
   - record a manual refund (`to-do`, amount);
   - **tell staff:** "UnivaPay can't refund konbini (bank-transfer) payments, so nothing was sent to UnivaPay. Return ¥X to the customer yourself, for example by bank transfer to their account, then press 'Mark refund done'.";
   - **tell the customer:** "We'll return ¥X to you directly. We'll contact you to get your bank account details." Not "refunded";
   - count it as refunded only when staff mark it done.

4. **Check the amount yourself.** remaining = `charged_amount` − successful refunds − pending refunds − manual refunds. Refuse more than remaining before calling (`createRefund.10`, `createRefund.11`). Full refund = remaining. Use the charge's `chargedCurrency` (`createRefund.12`).
   - Partial refunds by method: card and PayPay online partial refunds succeed in test mode (`createRefund.13`). In live mode the sources disagree for card and PayPay online (`createRefund.14`): be ready for a partial refund to be refused or to fail with payment error 318, and offer "refund in full and charge again". MCP (paid in another currency in the widget) is full only (`createRefund.4`), at the rate of the payment (`createRefund.5`). Konbini and bank transfer: step 3.
   - Card refunds are possible for about 180 days (other methods: `createRefund.20`). After that the refund ends in error; refund outside UnivaPay.

5. **Create the refund with one key per refund request.** Make a `requestId` when the staff member opens the refund form (or per automated refund). Then `client.refunds.createRefund(storeId, chargeId, { amount, currency, reason: RefundReasonRequest.CustomerRequest, metadata: { orderId } }, idempotencyKey("refund", order.id, requestId, amount))` (the key is the 4th argument here).
   - createRefund honours the key: a repeat returns the same refund (`every-request.21`, `createRefund.23`). Without your own key the SDK sends a new random one, so a repeat is a second refund (SDK 1.2.3 bug M5). A second, genuine partial refund needs a new `requestId`. Never reuse the key with another amount (`updateCharge.1` (same key, different body: first result)).
   - A replayed reply carries the status as first stored (`createRefund.23`); you can see it is a replay in `response.headers["idempotency-status"]` (SDK, tested). Never read the status from a create reply; GET it.
   - Reasons: `customer_request`, `duplicate` or `fraud` only (`updateRefund.1`).
   - Also guard in your app: one refund per order at a time, and "already requested" for a `requestId` you have seen.

6. **A pending refund is not refunded.** The create reply is `pending` (`createRefund.3`, `createRefund.13`). Store the refund as **processing**: it blocks that amount from new refunds, but the order is not "refunded" and the customer sees "Your refund of ¥X is being processed". Then `settleRefund(client, storeId, chargeId, refund.id)`:
   - `refunded` (`successful`) → add to the refunded total;
   - `processing` → leave it to `refund_finished`; card refunds through an overseas acquirer can stay pending for 1–2 weeks (`createRefund.21`);
   - `failed` → free the amount again, show the error code (`createRefund.18`; codes 500–504: `createCharge.92`–`createCharge.95`);
   - `needs-attention` (`error`) → may still change; check later.
   - Read a refund by id with `getRefund`, not from `listRefunds`: the list lags (`listRefunds.1`). Polling (`getRefund(storeId, chargeId, refundId, true)`) is what `settleRefund` does (`getRefund.1`).

7. **"Fully refunded" comes from your refunds, not the charge.** A fully refunded charge keeps `status: successful` (`getCharge.8`). Show `fully-refunded` when successful + manual-done refunds reach `charged_amount`.

8. **Webhook `refund_finished`** (`createRefund.17`, `background.32`; receiver: `shared/webhooks.md`): find the order from `data.charge_id`, ignore charges you don't know, then `settleRefund(…, { maxPolls: 1 })` on `data.id` and update that refund from the GET. Don't trust the body alone (`background.19`). `cancel_finished` does the same for step 2's cancels (`background.35`).

9. **What else to tell staff** (read every refusal with `readUnivapayError`, then `hasReason`):
   - `REFUND_EXCEEDS_CHARGE_AMOUNT` or `VALIDATION_ERROR`/`REFUND_NOT_WITHIN_BOUNDS` → more than is left; reload (`createRefund.11`, `createRefund.10`);
   - `REFUND_NOT_ALLOWED` on a card → refunds not enabled; contact UnivaPay (`createRefund.9`);
   - `REFUND_EXCEEDS_SALES` → this month's sales don't cover it; try later or return the money directly (`createRefund.15`);
   - "no answer" → press refund again: the same `requestId` can't refund twice.
   - The card fee is not returned (`createRefund.22`). UnivaPay may email the customer about the refund (`createCharge.15`); check the console before sending your own.

## Traps

- **A pending refund counted as refunded** (a common mistake). The create reply is `pending` (`createRefund.3`); wait with `settleRefund` or `refund_finished`, and keep "processing" separate from "refunded".
- **A misleading konbini message** (a common mistake). An UNPAID konbini order is cancelled (`createRefund.6`, `createCancel.4`); only a PAID one is refunded outside UnivaPay (`createRefund.8`). Decide by status first, then method.
- **Calling `createRefund` for bank transfer or paid konbini** and showing the 400 as a generic error (`createRefund.2`, `createRefund.8`). Branch on the method; give staff the manual-refund instruction.
- **Waiting for the charge to become "refunded"**: it stays `successful` (`getCharge.8`).
- **Over-refund**: more than the charge (`createRefund.10`) or than what is left, counting pending refunds (`createRefund.11`).
- **One key for every refund of a charge**: the second partial refund silently returns the first (`every-request.21`). One `requestId` per refund.
- **Reading the status from a replayed create reply**: it is the old stored status (`createRefund.23`). GET the refund.
- **Refund in the requested currency of a converted charge** instead of `charged_currency` (`createRefund.12`).
- **Partial refunds assumed in live mode** for card or PayPay (`createRefund.14`), or for MCP (`createRefund.4`).
- **A refund read from `listRefunds` right after creating it** (`listRefunds.1`).

## Test checklist

Unit tests (fake UnivaPay):
- a refund that stays `pending` → order "refund-processing", refunded 0, customer sees "being processed";
- `refund_finished` whose GET still says `pending` changes nothing; after GET says `successful` → refunded;
- failed refunds free the amount; fully refunded comes from refunds while the charge stays `successful`;
- `authorized` / `awaiting` → "cancel instead" (konbini wording says "hasn't paid", never "can't refund");
- paid konbini / bank transfer → manual refund with staff and customer wording, and no `createRefund` call;
- amount above what's left, zero, or on a fully refunded order → refused locally;
- the same refund form twice → one `createRefund`.

Test-mode run:
- card partial refund 410 of 2,410: create reply `pending` → `successful`; order partly refunded, 2,000 left;
- same form twice at once → one refund; createRefund with the same key → same refund id, `retrieved_idempotent_response`, stale `pending` body;
- over the charge → `REFUND_NOT_WITHIN_BOUNDS`; over what's left → `REFUND_EXCEEDS_CHARGE_AMOUNT`; other currency → `CURRENCY_MUST_MATCH_CHARGE`;
- refund the rest → fully refunded, charge still `successful`; one more yen → `REFUND_EXCEEDS_CHARGE_AMOUNT`;
- full card refund; PayPay online partial refund 470 of 2,470;
- card hold, unpaid konbini, unpaid bank transfer → `CANNOT_REFUND_UNSUCCESSFUL_CHARGE`; each cancelled instead → `canceled`;
- paid bank transfer and paid konbini → `REFUND_NOT_ALLOWED`; the app records a manual refund; marked done → refunded;
- `refund_finished` and `cancel_finished` reach the app and are re-read by GET.

## What test mode can't show

- **Live-mode partial refund rules** for card and PayPay online (`createRefund.14`): test mode accepts them (`createRefund.13`). Error 318 can't be produced here.
- **A failed refund** needs a charge made with test card 4242 4242 4242 4242 (`createRefund.18`). That card is typed in the widget, so it needs a browser session; the "failed" branch is covered by unit tests only.
- **Slow overseas card refunds** (`createRefund.21`), the 180-day refund period (`createRefund.20`), `REFUND_EXCEEDS_SALES` (`createRefund.15`) and `refund_percent_limit` (`createRefund.1`) need live money, months, or account settings.
- **MCP charges** (`createRefund.4`) need a customer paying in another currency in the widget.
- **The money actually reaching the customer** after a manual konbini or bank-transfer refund happens outside UnivaPay.
