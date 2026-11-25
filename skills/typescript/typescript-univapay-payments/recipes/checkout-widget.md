# Take a one-off payment with the UnivaPay widget

Use this when the customer pays on your own site: card, konbini and the other methods in UnivaPay's widget popup, or card only in the inline form (docs: guide/first/form). The browser shows the form. Your server sets the amount and decides "paid".
Use `payment-links.md` when you send a link instead, `konbini-bank-paypay-api.md` for konbini, bank transfer or PayPay without the widget, and `saved-cards.md` for later charges on a saved card.

## Before you start

- **Two credentials, two places.** The browser gets only the store's app token (the JWT). The server uses `secret.jwt`; never send the secret to the browser. A server call with the app token alone is refused (`getCheckoutInfo.1`).
- **Register your site's domain on the app token** (console: App tokens → store token → domains). The list is inside the token (the JWT payload's `domains`), and the widget won't open on a host that isn't in it (`createTransactionToken.51`). Use the token text issued with the domain on it, and check it when the app starts (`shared/go-live.md`), so a wrong token fails fast instead of breaking checkout.
- **Webhook:** triggers `charge_updated` and `charge_finished`, set up as in `shared/webhooks.md`.
- **Templates to copy:** `webhook-receiver.ts`, `payment-status.ts` (`chargeOutcome`, `settleCharge`), `payment-link.ts` (`checkLinkPayment` works for any charge), `univapay-errors.ts`.

## Steps

1. **Create the order on the server, once, before the pay button.** Take the price from your own catalog: the browser sends only a product id (and quantity). Give the order an id that can't be guessed; you will put it on the charge. A reload or a second tap reuses this order instead of making a new one.

2. **Render the checkout page from the order.** Load `https://widget.univapay.com/client/checkout.js`, then add a form whose action is your return URL (`/checkout/<orderId>/return`, method GET). Inside the form, put the widget `<span>`:
   - `data-app-id` = the app token;
   - `data-checkout="payment"`: the widget makes a one-time token **and the charge** in the browser, the documented choice for one-off payments (docs: guide/first/token). The server creates no charge;
   - `data-amount` = the order's amount, `data-currency="jpy"`;
   - `data-payment-methods="card,konbini"` (or the methods you sell with);
   - `data-metadata="order_id:<orderId>"`: puts your order id on the charge;
   - `data-auto-submit="true"`: when the customer closes the widget, it submits the form by GET with `univapayChargeId` added (docs: guide/implement/widget/param-basic).

   Because the browser makes the charge, someone can edit the amount in the page. Steps 4–5 catch that.
   *The other way:* `data-checkout="token"` plus a server `charges.createCharge` with the order's amount. The server must then charge within 5 minutes (`createCharge.56`) and run 3-D Secure itself (`three-ds-server-charges.md`). That path is not covered here.

   **Konbini for an event** (a class, a booking): the payment deadline must fall before the event. The console's deadline and the widget's `data-expiration-period` (docs: guide/implement/widget/param-basic) are not a substitute: a period counts from when the token is made (`createTransactionToken.25`), not back from the event. Take that payment with a server charge whose `capture_at` is before the event (`createCharge.24`, `createCharge.100`): `konbini-bank-paypay-api.md` steps 3–4. For 7-Eleven, Seicomart and Pay-easy, count the deadline as the end of that day (`createTransactionToken.28`).

3. **Receive webhooks** with the receiver from `shared/webhooks.md`. In `handle`, for `charge_*` events, find the order by `data.metadata.order_id`, ignore unknown orders, then go to step 4.

4. **Decide from a GET, in one function.** Read the charge with `client.charges.getCharge({ storeId, id, polling: true })` (`getCharge.1`, `getCharge.2`) and `checkLinkPayment(client, storeId, chargeId, { amount, currency })`. Then, in this order:
   1. `charge.metadata?.orderId` must equal the order id (the SDK name for `order_id`). Otherwise, ignore the charge.
   2. One order, one charge. A second paid charge for the same order is a double payment for staff to refund. After a `failed` attempt, a new charge may replace the old one.
   3. `check.matchesOrder` must be true: same amount and currency. If not, set the order to "needs attention", never "paid".
   4. Map `check.outcome` (`chargeOutcome`):
      - `paid` (status `successful`) → paid. Only `successful` is paid (`createCharge.26`).
      - `waiting-for-customer` (`awaiting`) → waiting: konbini or bank transfer applied for, or 3-D Secure not finished (`createCharge.31`, `background.20`).
      - `processing` (`pending`) → keep waiting.
      - `failed` → failed. Store `chargeErrorCode(charge)`, a number such as 309 (`getCharge.7`).
      - `held` (`authorized`) → not paid (`createCharge.21`, `captureCharge.1`).
      - `needs-attention` (`error`) → re-check later. `error` can still change (`getCharge.11`).

5. **The return page only points at a charge.**
   - Take `univapayChargeId` from the query and run step 4 on it. Then show the order's state as stored on the server.
   - Never mark an order paid from the query string or from a browser callback alone (`background.19`).
   - If the GET returns 502/503/504, retry it (`getCharge.3`).

6. **Konbini: show the payment details yourself.** The widget's own konbini screen shows no payment number (`getCharge.13`).
   - When a konbini charge is `awaiting`, read the payment number and the slip URL from the charge metadata (`createCharge.83`). In the SDK they are `charge.metadata.additionalProperties["internal_convenience_payment_number"]` and `["internal_convenience_payment_url"]`: the SDK declares only a few metadata keys and puts the rest under `additionalProperties` (SDK, tested).
   - Show them on the order page. For Pay-easy, also show the collecting institution number 58091 (`createCharge.84`).
   - UnivaPay may also email the details (`createCharge.18`), but don't rely on the email.
   - When the customer pays, `charge_finished` arrives (`background.48`). If they never pay, the charge becomes `failed` at the deadline (`background.51`).

7. **Catch up on missed webhooks** as in `shared/webhooks.md` step 10 (`processPending`, `chargesCreatedSince`, GET each charge), and re-enable a stopped webhook with `ensureWebhookActive(client, storeId, id, { expectedUrl })`.

8. **Tell the customer the truth.**
   - "Paid" only after step 4 says paid.
   - Konbini: the payment number.
   - Failed: a "try again" link back to the checkout page for the same order.
   - Mismatch: "we'll contact you", and staff see the problem.

## Traps

- **No konbini payment number shown.** The widget's screen doesn't show it (`getCharge.13`); read it from the charge metadata, under `additionalProperties` in the SDK (`createCharge.83`).
- **Amount from the browser.** Take the amount from your order, and compare the charge with `checkLinkPayment` before marking paid (`createCharge.26`).
- **A new order on every tap of "pay".** Create the order once (step 1).
- **"Paid" from the return page or a widget callback.** The return URL can be faked or replayed with another order's charge id. Always GET the charge, and match `metadata.orderId` (`background.19`).
- **`awaiting` treated as paid.** Konbini, bank transfer and 3-D Secure wait for the customer (`createCharge.31`). `authorized` is a hold (`createCharge.21`). `error` isn't final (`getCharge.11`).
- **Webhook receiver mistakes** (`Bearer`, slow replies, acting on other apps' events, logging the webhook object): `shared/webhooks.md` traps.
- **Status read from a list.** Lists lag. GET the single charge (`listAllCharges.5`).
- **The secret in the page,** or a server call made with the app token alone (`getCheckoutInfo.1`).
- **Domain not on the app token**: the widget won't open (`createTransactionToken.51`). Check at startup.
- **A konbini deadline after the event** the customer booked (step 2).
- **Pay-easy without 58091** (`createCharge.84`).

## Test checklist

- Unit tests for the decision function:
  - paid only for `successful` + matching amount + this order's id;
  - another order's id → ignored;
  - different amount → needs attention;
  - `awaiting` konbini → payment number shown;
  - `failed` → numeric code, and a new charge accepted afterwards;
  - second paid charge → flagged;
  - `authorized` → not paid.
- Test-mode run, with real webhooks through a tunnel (plus the receiver checks in `shared/webhooks.md`):
  - a card charge carrying the order id → webhook → GET → paid;
  - the return URL with another order's charge → not paid;
  - a charge for a different amount → needs attention;
  - konbini → `awaiting` → payment number and slip on the order page;
  - konbini with a phone number ending in 1111 → failed, with a retry offered (`createCharge.34`);
  - an event for an unknown order → ignored;
  - webhook switched off → reconcile finds the charge.
- In a browser, in test mode:
  - pay with a published test card (`createCharge.32`) → the order is paid, the charge carries your `order_id`, and the return page had `univapayChargeId`;
  - choose konbini → the order page shows the payment number.
- Test-mode konbini completes by itself about 10 minutes later (`background.50`). Check that the order then becomes paid from `charge_finished`.

## What test mode can't show

- **A customer actually paying at a convenience store.** In test mode the payment completes automatically (`background.50`), so the deadline and expiry paths (`background.51`) aren't exercised.
- **Live-mode currency and acquirer behaviour.** Test mode accepts every currency (`createCharge.35`). Some acquirers settle with a lag of minutes (`createCharge.19`).
- **Whether the widget runs on your production domain.** Test with the live app token's domain list before launch.
