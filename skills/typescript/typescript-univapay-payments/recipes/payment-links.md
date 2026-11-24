# Take a payment with a payment link (link form)

Use this when the customer pays on UnivaPay's hosted page from a link you send (email, chat, QR code, an `<a>` tag), for example an invoice or an order taken by staff. The server builds the link from the order and confirms the payment by webhook and GET.
Use `checkout-widget.md` when the customer pays inside your own site. The docs recommend the widget for sites that can render pages (docs: guide/implement/link). Paidy works only through the link form or the widget (`createTransactionToken.49`).

## Before you start

- **A link form in the console.** Store → payment form → link form settings (EC form settings) → create one for Test and later one for Live.
  - Its **form id** is in the URL code tab, between `forms/` and `?appId` (docs: guide/implement/link).
  - Keep it in config, e.g. `UNIVAPAY_LINK_FORM_ID`. Test and live forms differ.
  - The form's settings decide the required customer fields. One test form required the name in katakana (verified live in test mode).
- **The store's app token** (the JWT) goes in the link as `appId`. Never the secret: `buildPaymentLink` refuses a `secret.jwt` value.
- **A webhook** for `charge_updated` and `charge_finished`, pointing at your receiver. Keep its auth token secret (`createWebhook.8`). One webhook per URL (`createWebhook.4`).
- **Templates to copy:**
  - `payment-link.ts`: `buildPaymentLink`, `checkLinkPayment`;
  - `webhook-receiver.ts`;
  - `payment-status.ts`;
  - `univapay-errors.ts`.

## Steps

1. **Create the order and its link together, on the server.** Staff pick a product (or the order comes from your system). They never type an amount or paste a link made by hand in the console. Call `buildPaymentLink` with:
   - `formId`, `appId`;
   - `amount: order.amount`, `currency: "JPY"`;
   - `orderId: order.id`: sent as `order_id`. It arrives on the charge as metadata `order_id`, which is `charge.metadata.orderId` in the SDK (verified live in test mode);
   - `paymentMethods` (one method is sent as `paymentMethods[]`, as the docs require);
   - `successRedirectUrl` and `failureRedirectUrl`, plus `extra: { pendingRedirectUrl }` for konbini and bank transfer (docs: guide/implement/link/param-basic), all pointing at `/orders/<id>/return`.

   Store the link on the order and send it.

2. **Receive the webhook with `univapayWebhookRouter`.**
   - The raw `Authorization` header equals the token. There is no `Bearer` (`background.9`).
   - Reply within 3 seconds and process afterwards (`background.11`).
   - Duplicates happen (`background.18`).
   - For `charge_*` events, find the order by `data.metadata.order_id`. Ignore events for unknown orders: every webhook on the store gets every event.

3. **Decide from a GET.** Read the charge with `charges.getCharge({ storeId, id, polling: true })` (`getCharge.1`) and run `checkLinkPayment(client, storeId, chargeId, { amount: order.amount, currency: order.currency })`.
   - **Paid** only when `outcome === "paid" && matchesOrder` and `charge.metadata.orderId === order.id`. Only `successful` is paid (`createCharge.26`).
   - **Paid but not matching** (amount or currency differs: the link's query string was edited) → "needs attention" for staff: refund, then send a correct link. Never "paid".
   - **`awaiting`** (konbini or bank transfer from the link) → "waiting for the customer" (`createCharge.31`). For konbini, the payment number is in the charge metadata (`createCharge.83`), if staff or the customer need it.
   - **`failed`** → "payment failed". Show staff the numeric `error.code` (`getCharge.7`) and a "send a new link" action. The new link is for the same order, amount and order id. An event for the old failed charge must not reopen the failure.
   - **`error`** → re-check later (`getCharge.11`).

4. **The redirect only says which order to re-check.**
   - The success redirect carries `order_id`, `univapayChargeId` and `univapayTokenId` (verified live in test mode). Use `univapayChargeId` to run step 3 early, then show the stored state.
   - The redirect URL is visible to the customer, so don't decide the result from it (docs: guide/implement/link; `background.19`).

5. **Catch up.**
   - On a timer, run `processPending`.
   - Look for open orders' charges with `chargesCreatedSince` (match `metadata.orderId`), then GET each one (`listAllCharges.5`).
   - Re-enable a stopped webhook with `ensureWebhookActive(client, storeId, id, { expectedUrl })` (`background.17`); see `shared/webhooks.md`.

6. **Staff screen.** Each order shows its state and what to do:
   - waiting for payment;
   - paid → deliver;
   - payment failed (code) → contact the customer and send a new link;
   - needs attention → the problem, e.g. "amount 2,240 ≠ order 2,210: refund".

## Traps

- **Links made by hand in the console** (a common mistake). Nothing ties them to the order's amount or id, so a payment can't be matched or checked. Build every link on the server with `orderId`.
- **Trusting the link.** It is a plain URL. Anyone holding it can change `amount`. Compare every payment with the order (`checkLinkPayment`) before marking it paid.
- **A failed payment nobody sees** (a common mistake). The order stayed "unpaid" and staff never knew. Show `failed` with its code and offer a new link (`getCharge.7`).
- **A webhook check that wants `Bearer`** (a common mistake). Every real delivery got 401, and the webhook is switched off after 10 tries (`background.9`, `background.15`).
- **"Paid" from the success redirect.** It can be opened by hand or replayed with another order's charge id (`background.19`).
- **`awaiting` treated as paid,** for konbini or bank transfer from the link (`createCharge.31`).
- **The secret in a link.** Only the app token goes there.
- **Acting on other orders' or apps' events.** Unknown order → reply 200 and ignore.
- **Status read from a list.** GET the single charge (`listAllCharges.5`).
- **Slow replies or redirects from the webhook endpoint** (`background.11`, `background.14`).

## Test checklist

- Unit tests:
  - the link has the order's amount, `order_id` and return URLs;
  - paid only when matching;
  - edited amount → needs attention, with a refund action;
  - failed → staff see the code; a new link reopens the order; a late event for the old charge doesn't undo it;
  - another order's charge → ignored;
  - `awaiting` → waiting.
- Test-mode run, with real webhooks through a tunnel:
  - the link opens the hosted form;
  - a charge with the order's `order_id` → webhook → GET → paid;
  - a different amount → flagged;
  - a failed konbini payment (phone number ending in 1111, `createCharge.34`) → staff see it → new link → paid;
  - a faked return URL → not paid;
  - an unknown order's event → ignored;
  - webhook off → reconcile finds the payment;
  - `Bearer` → 401.
- In a browser, in test mode: pay a link built by the app with a published test card (`createCharge.32`). The order becomes paid from the webhook, and `checkLinkPayment` agrees.
- Optionally, pay a link whose `amount` was edited, and check that the order is flagged.

## What test mode can't show

- **Real money arriving** for konbini or bank transfer paid from a link. Test-mode konbini completes by itself after about 10 minutes (`background.50`).
- **Live-mode currencies and acquirer lag.** Test mode accepts every currency (`createCharge.35`). Some acquirers settle minutes later (`createCharge.19`).
- **The live link form's own settings** (required fields, methods, redirects). Test the live form id once before launch, with a small real payment if your process allows.
