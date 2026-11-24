# Run 3-D Secure on a charge your server makes

Use this when your server charges a saved card (recurring token) and the bank wants the customer to verify: the charge waits (`awaiting`) until the customer finishes 3-D Secure in their browser. Saving the card and charging it later is `saved-cards.md`; card payments made in the widget run 3-D Secure inside the widget (`checkout-widget.md`).

## Before you start

- **Keys:** the store app token and its secret, on the server only. Charges, issuer tokens and `skip` are server calls with `{secret}.{jwt}` (`createCharge.43`).
- **Account:** 3-D Secure runs only when the merchant has it set up (`createCharge.51`); from April 2025 UnivaPay sets it up even for older merchants that never applied (`createCharge.28`), so expect it. Ask UnivaPay before relying on `three_ds.mode: skip` (`createCharge.43`).
- **A return page** on your site (HTTPS), e.g. `https://shop.example/3ds/return`.
- **Webhook** with `charge_updated` and `charge_finished` (`shared/webhooks.md`).
- **Templates to copy:** `charge-saved-card.ts` (`chargeSavedCard`, `payloadToWireFields`, `threeDsHandOffPage`, `afterThreeDs`), `payment-status.ts`, `idempotency.ts`, `univapay-errors.ts`, `webhook-receiver.ts`.
- **Card tokens** that may go through 3-D Secure need the customer's real email and phone number (`createTransactionToken.23`).

## Steps

1. **Pick `three_ds.mode` and send it explicitly.** When it is left out, the one store tested used `normal`, but the definition says the store's default applies (`createCharge.42`). Modes:
   - `normal`: 3-D Secure runs when the token hasn't passed it (never done or failed); the charge waits (`createCharge.42`, `createCharge.45`, `createCharge.66`). On a token whose 3-D Secure succeeded it pays without the customer (`createCharge.39`).
   - `require` / `force`: always ask (`force` always challenges); use them when you want 3-D Secure (and its chargeback protection) on every charge (`createCharge.40`).
   - `if_available`: ask only if the token hasn't done 3-D Secure (`createCharge.44`). Live, on a token whose 3-D Secure failed, it waited for 3-D Secure like `normal` (verified live in test mode).
   - `skip`: no 3-D Secure. Only from the server with the secret, and only after UnivaPay enables it (`createCharge.43`). Live, `skip` with the app token alone got 401 `INVALID_DOMAIN` (verified live in test mode).
   - `provided` is refused with 400 `VALIDATION_ERROR` (`three_ds.mode: RESTRICTED_PARAMETER`); external 3-D Secure data uses six other fields (`createCharge.41`, `createCharge.50`).

2. **Create the charge from the server.** Amount from YOUR order; token from the signed-in customer's own saved card; one Idempotency-Key per order attempt (`idempotencyKey("charge", order.id, order.amount, order.attempt)`, `every-request.21`).
   ```ts
   client.charges.createCharge({ idempotencyKey, body: { transactionTokenId, amount, currency: "JPY",
     threeDs: { mode, redirectEndpoint: "https://shop.example/3ds/return" }, metadata: { orderId: order.id } } })
   ```
   `chargeSavedCard(…)` does this plus steps 3–4, but it sends no `mode`, so UnivaPay picks one (`normal` on the store tested, `createCharge.42`). To send a mode, call `createCharge` as above and then `settleCharge` and `getChargeThreeDsIssuerToken` yourself (with the template's `payloadToWireFields`).

3. **Wait for the charge to leave `pending`.** `settleCharge(client, storeId, id)` (`getCharge.1`). A charge that needs 3-D Secure becomes `awaiting`: outcome `waiting-for-customer` (`createCharge.45`). Set the order to "needs 3-D Secure", not paid and not failed.

4. **Get the hand-off.** While the charge is `awaiting`: `client.charges.getChargeThreeDsIssuerToken({ storeId, id })` returns `call_method: http_post`, a `content_type`, the `issuer_token` URL and a `payload` (`getChargeThreeDsIssuerToken.2`). Before `awaiting`, or on a charge made with `skip`, it is a 404 (`getChargeThreeDsIssuerToken.1`; seen live on a `skip` charge). Don't use `getChargeIssuerToken` (no `three_ds` in the path): it refuses a card charge awaiting 3-D Secure with `UNSUPPORTED_PAYMENT_TYPE` (`getChargeIssuerToken.7`).
   - The SDK renames `payload` fields (`request_data` → `requestData`, others under `additionalProperties`). Rebuild the wire names with `payloadToWireFields(it.payload)`; never post the SDK names.
   - Fetch a fresh hand-off each time you show the page.

5. **Send the customer there as a full-page POST, not an iframe.** Serve `threeDsHandOffPage(handOff)`: an auto-submitting `<form method="post">` to the `issuer_token` URL with the payload as hidden fields. An iframe can be blocked by the page's CSP; a redirect is the safer choice (`getChargeThreeDsIssuerToken.2`, `getChargeThreeDsIssuerToken.3`).

6. **The return URL only tells you WHICH charge.** After 3-D Secure the browser comes back with a GET to `redirectEndpoint` with `univapayChargeId`, `univapayTokenId` and the charge's metadata (here `order_id`) as query parameters (`createCharge.52`; verified live in test mode). Find the order by `univapayChargeId`, then re-read the charge with `afterThreeDs(client, storeId, chargeId)`. The charge status alone decides; the 3-D Secure result itself can't be read (`getCharge.9`). Anyone can open the return URL with any query: ignore everything in it except the charge id.
   - `successful` → paid. `awaiting` → "verification not finished": offer the hand-off page again. `failed` → step 7.

7. **Handle a failed or abandoned check.** Read `chargeErrorCode(charge)`:
   - 327: not finished in time. An unfinished charge fails by itself about 5 minutes after it was created (`createCharge.46`; seen live: `failed` with 327 "Confirmation period has expired" 5.2 minutes after creation, followed by `charge_finished`, in test mode). Offer "try again".
   - 356: the card isn't registered for 3-D Secure; ask for another card (`createCharge.90`).
   - 358: the customer's check failed; let them try again. 359: the card company refused; another card or call the card company (`createCharge.91`).
   - A new try is a NEW charge: increase `order.attempt` so the key changes (the failed charge is stored under the old key, `every-request.21`).

8. **Don't cancel a charge that waits for 3-D Secure.** `createCancel` refuses it with 400 `CANCEL_NOT_ALLOWED` (`createCancel.5`; seen live). If the customer gives up, tell them nothing was charged and let it fail by itself (`createCharge.46`).

9. **Webhooks.** `charge_updated` with `status: awaiting` arrived for a card charge waiting for 3-D Secure (verified live in test mode; `background.20` lists it only for konbini, bank transfer and wallets). `charge_finished` arrives when it ends: `successful` or `failed` (`background.21`). Find the order from `data.metadata.order_id`, ignore orders you don't know (every webhook on the store gets every event), and re-read the charge before acting (`background.19`). Webhooks are best effort: the return page's re-read and a timer re-check are the main path.

## Traps

- **Treating `awaiting` as failed or as paid.** It means the customer must act (`createCharge.45`). A one-tap charge can need the customer after all (`createCharge.66`).
- **Trusting the return URL.** Re-read the charge (`createCharge.52`, `getCharge.9`).
- **Running the issuer page in an iframe** (`getChargeThreeDsIssuerToken.3`). Use a full-page POST.
- **Posting the SDK field names** (`requestData`) to the issuer. Use `payloadToWireFields`.
- **Calling the wrong issuer-token endpoint** (`getChargeIssuerToken.7`).
- **Cancelling a waiting charge** → `CANCEL_NOT_ALLOWED` (`createCancel.5`).
- **Retrying a failed 3-D Secure charge with the same key**: it returns the old failed charge (`every-request.21`).
- **Leaving `three_ds.mode` out** and assuming `normal` (`createCharge.42`).
- **`skip` from the browser or without UnivaPay enabling it** (`createCharge.43`).
- **Sending `three_ds.mode: provided`** (`createCharge.41`).

## Test checklist

Unit tests:
- the charge body has `three_ds.mode`, `three_ds.redirect_endpoint` and `metadata.order_id`, and the amount from the order;
- `awaiting` → hand-off with wire field names; paying again while waiting makes no second charge;
- a return with `status=successful` in the query leaves a waiting order unpaid; the re-read `successful` makes it paid;
- 327 → failed with "try again" and a new attempt; 356/358/359 messages.

Test-mode run (with a saved test card whose 3-D Secure is `failed`, so `normal` charges on it wait):
- `normal` → `awaiting`, our return URL stored, hand-off page posts to the `issuer_token` URL;
- cancel while waiting → 400 `CANCEL_NOT_ALLOWED`;
- a forged return → still waiting; an unknown charge id → 404;
- `skip` with the secret → paid, and its hand-off is a 404; `skip` with the app token alone → 401; `provided` → 400;
- `charge_updated` (`awaiting`) reaches the webhook; left alone, the charge fails with 327 and `charge_finished` (`failed`) arrives; paying again makes a new charge;
- user step: finish UnivaPay's test 3-D Secure page in a browser → the return page re-reads → paid (UnivaPay's test emails with `+3ds-failure` make it fail: `createTransactionToken.41`).

## What test mode can't show

- **A real bank's challenge screen and risk-based "frictionless" passes** for `require` (`createCharge.40`). Test mode shows UnivaPay's test 3-D Secure page instead.
- **Chargeback protection** after 3-D Secure: no disputes happen in test mode.
