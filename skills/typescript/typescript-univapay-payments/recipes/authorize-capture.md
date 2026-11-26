# Hold a card payment, then capture it (all or part) or cancel it

Use this when the money should be held at checkout and taken later: at shipping, when stock is confirmed, or after a service is done. To take the money at once, leave `capture` out (it defaults to a sale, `createCharge.22`) and use `checkout-widget.md` or `saved-cards.md`. To give money back after a capture, use `refunds.md`: a captured charge is refunded, never cancelled.

## Before you start

- **Keys:** server only, every call with `{secret}.{jwt}` (`getCancel.2` (cancels need the secret)).
- **Card only.** Only card charges can be held; `capture` on a konbini, bank-transfer or wallet charge is refused (`createCharge.20`). The card gateway must support authorization (`createCharge.25` (AUTH_NOT_SUPPORTED)); debit and prepaid cards need their own account switches (`createCharge.12`).
- **Ask UnivaPay** whether partial capture is enabled for your account (`captureCharge.4` (PARTIAL_CAPTURE_NOT_ALLOWED)). Plan for the January 2027 change now (step 6).
- **Webhook:** triggers `charge_updated`, `charge_finished` and `cancel_finished` (`shared/webhooks.md`).
- **Templates to copy:** `payment-status.ts`, `idempotency.ts`, `univapay-errors.ts`, `webhook-receiver.ts`; `charge-saved-card.ts` if you hold a saved card.
- **Your data:** an order table with `amount`, `lines`, `state`, `charge_id`, `authorized_amount`, `captured_amount`, `held_at`.

## Steps

1. **Price the order on the server.** The browser sends items, never an amount. Hold only the signed-in customer's own card: a token from this checkout, or their own saved card looked up on the server (`saved-cards.md`).

2. **Create the hold.** `client.charges.createCharge(idempotencyKey("charge", order.id, order.amount), { transactionTokenId, amount, currency: "JPY", capture: false, metadata: { orderId } })`.
   - Send `capture: false` every time. Left out, the charge is captured at once (`createCharge.22`).
   - A `one_time` token charges only once (`createCharge.57`). If you may need to hold again later (step 6), hold a saved `recurring` token.
   - 3-D Secure applies as for any card charge. A saved card whose 3-D Secure is not done waits for the customer (`createCharge.42`); follow `three-ds-server-charges.md`. Send `threeDs: { mode: ChargeCreateRequestThreeDsMode.Skip }` only if UnivaPay enabled it for you (`createCharge.43`).
   - The key makes a double click on "pay" the same request (`every-request.20`, `every-request.21`). Without your own key, the SDK sends a new random one each time, so a double click is two holds (SDK 1.2.3 bug M5).

3. **Wait for the result; held is not paid.** The create reply is `pending` (`createCharge.26`, `createCharge.27`). Call `settleCharge(client, storeId, chargeId)` and map with `chargeOutcome()`:
   - `held` (status `authorized`) → order "held": the money is reserved, NOT paid (`createCharge.21`). Store `authorized_amount = charge.requestedAmount` and `held_at`. Don't send "payment received" yet.
   - `processing` → leave it to the webhook. `waiting-for-customer` on a card → 3-D Secure (`three-ds-server-charges.md`). `failed` → show the failure. `needs-attention` (`error`) → may still change, re-check later (`getCharge.11`).
   - Don't read `charged_amount` to decide: it already equals the hold on an `authorized` charge (`getCharge.12`). Only `status` tells held from paid.

4. **Capture at shipping.** Compute the amount on the server from the shipped lines.
   - Re-read the charge first: capture only when `status === "authorized"` (`captureCharge.12`). `successful` → "already captured" (`captureCharge.10`); `canceled` → "hold released, take a new payment" (`captureCharge.11`).
   - Refuse more than the hold yourself (`captureCharge.6`, capture above the hold).
   - Full: `client.charges.captureCharge(storeId, chargeId, key)` with no body captures the whole hold (`captureCharge.8`). Partial: `captureCharge(storeId, chargeId, key, { amount, currency: charge.requestedCurrency })`; another currency is refused (`captureCharge.7`).
   - The reply is 200 with no body (`captureCharge.2`); the SDK's `result` is `undefined` (SDK, tested). Don't read a result from it.
   - Set the order to "capturing", then `settleCharge`. Only `successful` is paid; `authorized` after a capture means "still capturing", not "held" (`captureCharge.1`). Store `captured_amount = charge.chargedAmount` (`captureCharge.3`).

5. **Stop double captures in your app.** Capture and cancel ignore the `Idempotency-Key` (`captureCharge.16`, `createCancel.14`; compare `every-request.19`). So:
   - run one action per order at a time (a lock or a row-level guard);
   - on `ALREADY_CAPTURED` (`captureCharge.10`), re-read the charge with `settleCharge` and show the order from it: another request captured first;
   - on a "no answer" failure, re-read before trying again; the capture may have happened.

6. **Short shipments: today and from January 2027.**
   - Today: a partial capture works where UnivaPay enabled it (`captureCharge.3`, `captureCharge.4`, `captureCharge.5`). Read `charged_amount` after it.
   - From January 2027 a capture must equal the hold (`captureCharge.9`). Do this instead: cancel the hold (step 7), hold the new amount on the same saved card with a NEW key (`idempotencyKey("charge", order.id, newAmount)`), then capture it in full. Make it a setting so you can switch on the date.

7. **Cancel before shipping (release the hold).** Re-read the charge: cancel only `authorized` (`createCancel.6`). A `successful` charge needs a refund (`refunds.md`); a card charge waiting for 3-D Secure can't be cancelled (`createCancel.5`).
   - `client.cancels.createCancel(storeId, chargeId, key, {})`. The reply is `pending` (`createRefund.3`). Wait with `settleCancel(client, storeId, chargeId, cancel.id)`, then re-read the charge: `canceled` = released (`createCancel.3`).
   - `failed` → the hold is still there; show it (`createCancel.13`).
   - Cancelling an already-cancelled charge is refused (`createCancel.10`). Treat it as "re-read the charge".

8. **Holds that are never captured.** From January 2027 an uncaptured hold is cancelled automatically after 25 days (`background.39`). Run a daily job: find orders held for more than about 20 days; capture, or cancel and hold again. A capture after a hold expired fails with payment error 313 (`captureCharge.13`). A hold the platform cancelled carries cancel `reason: expired` (`createCancel.12`); SDK 1.2.3 has no `reason` field on a cancel, so read it as `cancel.additionalProperties?.["reason"]` (SDK 1.2.3 bug N4) (SDK, tested). To capture automatically at a set time, send `capture_at` with the hold (`createCharge.23`).

9. **Webhooks** (receiver: `shared/webhooks.md`):
   - `charge_updated` with `authorized` = the hold is ready, not a payment (`createCharge.30`, `background.20`).
   - `charge_finished` = a capture finished (`createCharge.29`, `background.21`).
   - `cancel_finished` = a cancel finished (`background.35`). A cancelled hold sends no `charge_finished` (`background.21`).
   - Find the order from the charge id (`data.id` for charge events, `data.charge_id` for cancels). Ignore charges you don't know. Re-read the charge by GET before changing the order, and never move "held" to "paid" from a webhook body (`background.19`).

## Traps

- **`authorized` marked the order paid** (a common mistake). Held is not paid (`createCharge.21`, `captureCharge.1`). Use `chargeOutcome()`; a capture is still needed.
- **The `pending` create reply, or the capture's empty 200, treated as final** (a common mistake). Wait with `settleCharge` (`createCharge.26`, `captureCharge.1`, `captureCharge.2`).
- **`capture` left out**: the charge is a sale, not a hold (`createCharge.22`).
- **Trusting the Idempotency-Key on capture or cancel.** They ignore it (`captureCharge.16`, `createCancel.14`). Guard in the app and re-read on `ALREADY_CAPTURED`.
- **Capture amount from the browser**, or more than the hold (`captureCharge.6`), or in another currency (`captureCharge.7`).
- **Partial capture assumed to work forever.** It needs an account switch today (`captureCharge.4`) and stops in January 2027 (`captureCharge.9`).
- **Cancel used on a captured charge**, or refund used on a hold. Cancel = hold; refund = captured (`createCancel.6`, `createRefund.6`).
- **"Released" shown from the cancel's 201** (`createRefund.3`, `createCancel.3`).
- **Holds left to expire** (`background.39`, `captureCharge.13`).
- **`capture` sent on konbini, bank-transfer or wallet charges** (`createCharge.20`).
- **Capturing the 1-yen card-check authorization** made when a card is saved with CVV authorization (`captureCharge.15`, `createCancel.7`).
- **Duplicate emails.** UnivaPay can email the customer on hold, capture and cancel (`createCharge.17`, `createCharge.15`, `createCancel.2`); check the console notifications before sending your own.

## Test checklist

Unit tests (fake UnivaPay):
- the order amount comes from the server catalogue; a browser `amount` is ignored;
- `authorized` → held, never paid; `pending` → still processing; `authorized` after a capture → still capturing; `error` → needs attention;
- capture refused locally above the hold; only staff can capture or cancel;
- `ALREADY_CAPTURED` from capture → re-read → paid, no error to staff;
- a webhook whose body says `successful` while GET says `authorized` leaves the order held; a webhook for an unknown charge gets 200 and is ignored;
- the stale-hold job finds holds older than the limit.

Test-mode run:
- hold → create reply `pending` → `authorized`, order held; a second "pay" click makes no new charge;
- full capture → `successful`, `charged_amount` = hold; partial capture (2,000 of 2,360) → `charged_amount` 2,000;
- two "ship" clicks at once → one capture; capture again → `ALREADY_CAPTURED`, also with the same key;
- capture above the hold → `CAPTURE_AMOUNT_TOO_LARGE`; another currency → `INVALID_CURRENCY`;
- cancel → cancel `successful`, charge `canceled`; capture after cancel → `INVALID_CHARGE_STATUS`; cancel again → `CANCEL_NOT_ALLOWED`; cancel a captured charge → `CANCEL_NOT_ALLOWED`;
- konbini with `capture: false` → `CAPTURE_ONLY_FOR_CARD_PAYMENT`;
- 2027 mode: old hold `canceled`, new hold for the shipped amount captured in full;
- webhooks reach the app: `charge_updated` (authorized), `charge_finished` (successful), `cancel_finished`; each re-read by GET.

## What test mode can't show

- **A hold expiring.** It takes days (25 days from January 2027, `background.39`), so the 313 error (`captureCharge.13`) and the platform's automatic cancel (`createCancel.12`) can't be produced on demand. Only unit tests cover the stale-hold job.
- **The January 2027 rule itself.** It isn't in force yet (`captureCharge.9`). The test store accepts partial captures today, so it can't show whether your live account will (`captureCharge.4`).
- **A capture stuck in `authorized`** during an acquirer outage (`captureCharge.1`): test captures finish within seconds. Unit-test the "capturing" state.
- **Debit or prepaid card rules and `AUTH_NOT_SUPPORTED`** depend on live account settings and real cards (`createCharge.12`, `createCharge.25`).
