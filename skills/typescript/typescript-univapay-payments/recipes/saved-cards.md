# Save a customer's card and charge it later

Use this when a signed-in customer saves a card once and your server charges it later ("one-tap" reorders, top-ups, pay-later orders). For a fixed schedule UnivaPay runs for you, use `subscriptions.md`. When the bank asks for 3-D Secure on a later charge, this recipe hands over to `three-ds-server-charges.md`.

## Before you start

- **Keys:** the store app token and its secret, on the server only. Every call below is made with `{secret}.{jwt}`: listing recurring tokens and `three_ds.mode: skip` refuse the app token alone (`listAllTransactionTokens.2` (recurring list needs the secret), `createCharge.43` (skip needs the secret)). Live, a server charge with `skip` and the app token alone got 401 `INVALID_DOMAIN` (verified live in test mode).
- **Account options to ask UnivaPay about:** recurring tokens (`createTransactionToken.13` (RECURRING_TOKEN_DISABLED)), unlimited recurring tokens or a `usage_limit` (`createTransactionToken.14` (usage_limit required)), and `three_ds.mode: skip` if you want it (`createCharge.43`). Don't assume any of them.
- **Webhook:** one webhook with these triggers: `charge_finished`, `charge_updated`, `recurring_token_deleted`, `token_replaced`, `token_three_ds_updated`, `token_cvv_auth_updated`. See `shared/webhooks.md`.
- **Templates to copy:** `charge-saved-card.ts`, `idempotency.ts`, `payment-status.ts`, `univapay-errors.ts`, `webhook-receiver.ts`.
- **Your data:** a customer table, a saved-card table (`customer_id`, `token_id`, brand, last four, `three_ds_status`, `removed`), and an order table with `amount`, `state`, `attempt`, `charge_id`.

## Steps

1. **Pick the token type.** Only a `recurring` token can be charged again later. A `one_time` token charges once, within 5 minutes; a `subscription` token only starts a subscription (`createCharge.56` (one_time expires after 5 min), `createCharge.57` (one_time used once), `createCharge.58` (subscription token can't make a charge)). A recurring token is checked with 3-D Secure when it is created; one_time and subscription tokens are checked when charged (`createTransactionToken.37` (when 3-D Secure runs)).

2. **Save the card in UnivaPay's form, never through your server.** Use the widget or inline form with `checkout: "token"` and `tokenType: "recurring"` to save without paying, or `checkout: "payment"` + `tokenType: "recurring"` to save while paying (`createTransactionToken.2`, `createTransactionToken.4` (raw card data needs PCI DSS)).
   - Saving without a payment: turn on `cvvAuthorize: true`. Without it the CVV expires after 5 minutes and later charges fail (`createTransactionToken.31` (CVV authorization), `createCharge.65` (CVV expires)).
   - To tag the card with your customer, get a store-scoped UUID with `stores.createCustomerId({ storeId, body: { customerId: yourCustomerId } })` and pass it as `univapayCustomerId` (`data-univapay-customer-id`). Repeating the call is safe and gives the same UUID (`createCustomerId.1`, `createCustomerId.2`). The token then carries metadata `univapay-customer-id`, and `transactionTokens.listStoreTransactionTokens({ storeId, customerId })` finds it (`listAllTransactionTokens.5`).

3. **Link the token to YOUR customer on the server.** The browser only sends the token id. On the server:
   - `transactionTokens.getTransactionToken({ storeId, id })`;
   - check `paymentType === "card"`, `type === "recurring"` and `active !== false`. The widget can return a `one_time` token even when you asked for recurring (`createTransactionToken.9` (check the created token's type));
   - if `metadata["univapay-customer-id"]` is set, it must equal the signed-in customer's UUID (`listAllTransactionTokens.5`);
   - refuse a token already linked to another customer;
   - store `data.threeDs.enabled` and `data.threeDs.status` (`getTransactionToken.2` (read the token's 3-D Secure result)). If the status is `pending` or `awaiting`, re-read with `polling: true` a few times (`getTransactionToken.1`).

4. **Choose the 3-D Secure mode for each later charge from the token's CURRENT state.** Re-read the token just before charging (step 3's GET):
   - `status: "successful"` → send no mode (or `normal`); the charge succeeds without the customer (`createCharge.39`). Don't add `skip` for these.
   - anything else (`failed`, `error`, `null`, never done) → a charge in the default mode waits for 3-D Secure (`awaiting`) (`createCharge.42`, `createCharge.45`, `createCharge.66`, `createTransactionToken.36`). Either send `threeDs: { mode: "skip" }` when UnivaPay has enabled skip for you (`createCharge.43`), or run 3-D Secure with the customer present: `three-ds-server-charges.md`.

5. **Charge the order from the server.** The amount comes from YOUR order, the token from the signed-in customer's own saved card, never from the request body.
   - Key: `idempotencyKey("charge", order.id, order.amount, order.attempt)` (`idempotency.ts`). One key per order attempt; send it on every try (`every-request.20`, `every-request.21`).
   - Card: when step 4 says no `skip`, call `chargeSavedCard(client, { storeId, tokenId, amount, idempotencyKey, threeDsReturnUrl, metadata: { orderId } })`. It waits for the result and returns `needs-3ds` with a hand-off when the bank asks. `chargeSavedCard` has no mode option, so for `skip` call `client.charges.createCharge({ idempotencyKey, body: { transactionTokenId, amount, currency: "JPY", threeDs: { mode: "skip" }, metadata: { orderId } } })` and then `settleCharge(client, storeId, id)`.
   - Wrap the call in `withIdempotentRetry(key, …)`: it retries only "no answer" and temporary errors, with the same key.
   - Map the outcome (`payment-status.ts`): `paid` → order paid. `held` → NOT paid (`createCharge.21`, `captureCharge.1`). `needs-3ds` → send the customer to the hand-off page (`three-ds-server-charges.md`). `processing` → leave it to the webhook (`createCharge.26`, `createCharge.27`). `failed` → read `chargeErrorCode(charge)`; increase `order.attempt` so a new try gets a new key.

6. **Handle the 30-second rule.** A same-amount charge on the same card or recurring token within 30 seconds can be refused with 400 `CHARGE_TOO_QUICK` or fail with payment error 311 (`createCharge.37`).
   - 400 `CHARGE_TOO_QUICK` (`hasReason(f, "CHARGE_TOO_QUICK")`): nothing was charged. Set the order to "retry later" for 30 seconds and retry with the SAME key. A refused request is not stored under its key (verified live in test mode: after a 400 and after a 404, the same key with a valid request created the charge).
   - A `failed` charge with error 311: that failed charge IS stored under the key (`every-request.21`; only a refused request is not stored, `createCharge.97`), so the retry needs `attempt + 1` (a new key).
   - Support can shorten the interval to 1 second if you send an Idempotency-Key on every charge (`createCharge.38`).

7. **Webhooks** (`webhook-receiver.ts`; `background.9`, `background.11`, `background.18`, `background.19`):
   - `charge_finished` (`background.21`) and `charge_updated` (`background.20`): find the order from `data.metadata.order_id` (the SDK's `metadata.orderId` is sent as `order_id`; verified live in test mode). Ignore events for orders you don't know: every webhook on the store gets every event. Re-read the charge with `settleCharge` before changing the order.
   - `recurring_token_deleted` (`background.33`): mark that saved card removed; never charge it again.
   - `token_replaced` (`background.34`): `data` is the NEW token. Swap it in for the old one. The webhook guide's example payload has `data.previous_id` for the old token id (docs example; not yet in the rules or seen live). Re-read the new token's 3-D Secure state.
   - `token_three_ds_updated` (`background.37`): re-read the token and update the stored 3-D Secure state.

8. **Remove a saved card.** Check that it is the signed-in customer's card. Check for subscriptions on the token first: deleting it stops their charges (`deleteTransactionToken.1`). Then `transactionTokens.deleteTransactionToken({ storeId, id })` (204) and mark the card removed. Afterwards the token reads `active: false`, and `recurring_token_deleted` arrives (verified live in test mode).

## Traps

- **An `authorized` charge marked the order paid** (a common mistake). `authorized` is a hold; only `successful` is paid (`createCharge.21`, `captureCharge.1`). Use `chargeOutcome()`.
- **Treating the 201 as paid.** A charge starts `pending` (`createCharge.26`, `createCharge.27`). Wait with `settleCharge` or the webhook.
- **No handling of `CHARGE_TOO_QUICK` / error 311** (a common mistake). It shows up as a 400 or as a failed charge (`createCharge.37`). Test mode never returns it (`createCharge.36`), so only unit tests catch a missing branch.
- **No Idempotency-Key, or a new one per try.** For `createCharge` the SDK sends no `Idempotency-Key` at all when you don't pass one (verified in a unit test), so a retry or a double tap is a second charge. A key re-sent with a different body returns the first result silently (`updateCharge.1`). After 24 hours the key no longer protects (`every-request.22`). Never reuse a key for another action (`every-request.23`).
- **The token's 3-D Secure state was never read** (a common mistake). A charge on a token whose 3-D Secure failed or never ran waits for the customer instead of paying (`createCharge.45`, `createCharge.66`). Read `data.threeDs.status` before every charge (`getTransactionToken.2`).
- **No 3-D Secure step when the bank asks** (a common mistake). `needs-3ds` must send the customer to the hand-off page and finish by re-reading the charge: `three-ds-server-charges.md`. A charge waiting for 3-D Secure can't be cancelled (`createCancel.5`).
- **`skip` used without asking UnivaPay**, or from the browser (`createCharge.43`).
- **No webhook for a replaced or deleted card** (a common mistake). Without `recurring_token_deleted` and `token_replaced` you keep charging a dead token (`background.33`, `background.34`).
- **Charging a card that isn't the signed-in customer's,** or taking the amount from the browser. Look the token up from your own saved-card table and the amount from your order.
- **Trusting the widget's token type.** Check `type === "recurring"` on the server (`createTransactionToken.9`).
- **A bounded token (`usage_limit`) charged twice in its period** (`createCharge.60`).
- **Deleting a token that still has subscriptions** (`deleteTransactionToken.1`).

## Test checklist

Unit tests (fake UnivaPay behind the real SDK):
- a 400 `CHARGE_TOO_QUICK` → "retry later", the retry sends the same key;
- a failed charge with error 311 → "retry later", the retry sends a new key;
- `authorized` → held, not paid; `awaiting` → hand-off, not paid;
- a token with 3-D Secure `successful` is charged without `skip`;
- a `one_time` token is refused as a saved card; another customer's card is refused;
- `token_replaced` swaps the token, `recurring_token_deleted` removes it, an unknown order's event is ignored;
- `createCharge` without `idempotencyKey` sends no key (so your code must always pass one).

Test-mode run:
- the saved card's type and `data.three_ds` are read;
- a later charge → order paid only after `successful`; `charge_finished` arrives and the re-read keeps it paid;
- the same order twice (double tap, and two parallel sends with one key) → one charge;
- token 3-D Secure not successful and no `skip` → `needs-3ds` and a full-page POST hand-off, never paid;
- `charge_updated` (`authorized`) → order held;
- delete a token → `active: false` and `recurring_token_deleted` arrives;
- a fresh card saved in the widget (user step): `type: recurring`, 3-D Secure `successful`, a later charge succeeds without `skip`.

## What test mode can't show

- **`CHARGE_TOO_QUICK` and error 311.** Test mode lets same-amount charges through even 1 second apart (`createCharge.36`; seen again in test mode: two orders of the same amount 3.5 s apart both succeeded). Cover these branches with unit tests.
- **`token_replaced`.** It is sent when a recurring token is replaced, e.g. after card details are updated (`background.34`). We found no way to cause it through the API without card data, so it was not seen live. Test the handler with a unit test.
