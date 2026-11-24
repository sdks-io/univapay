# Take konbini, bank-transfer and PayPay payments by API, on your own checkout page

Use this when you build your own payment screens and call the API from your server, without UnivaPay's widget or link form. If you use the widget or inline form, use `checkout-widget.md`; for payment links, `payment-links.md`; for refunds, `refunds.md`.

## Before you start

- **Keys:** the store's app token and its secret, on the server only. Konbini, bank-transfer and PayPay tokens carry no card data, so your server may create them with `POST /tokens` (`createTransactionToken.11`).
- **Console:** the methods must be enabled for the store; konbini refused for the store is `CONVENIENCE_PROCESSING_DISABLED` (`createCharge.68`). Check the default payment deadline (`createTransactionToken.25`) and which emails UnivaPay already sends: the "how to pay" email (`createCharge.18`) and the deadline and failure emails (`background.43`, `createCharge.16`).
- **Webhook:** triggers `charge_updated` and `charge_finished`. Add `bank_transfer_status_updated` if you want deposit updates (`background.22`). Use the receiver in `shared/webhooks.md`.
- **Templates to copy:** `payment-status.ts` (`settleCharge`, `chargeOutcome`), `univapay-errors.ts`, `idempotency.ts`, `webhook-receiver.ts`, and from `charge-saved-card.ts` the two helpers `payloadToWireFields` and `threeDsHandOffPage` (they also build the PayPay `http_post` hand-off).

## Steps

1. **Start from your order on the server.** The amount comes from the order, never from the browser. One payment attempt = one token + one charge, numbered per order (attempt 1, 2, …).

2. **Collect and check the customer's details before calling UnivaPay.**
   - **Konbini:** name, email (`createTransactionToken.18`), a Japanese phone number (`createTransactionToken.24`), and the store (`seven_eleven`, `family_mart`, `lawson`, `mini_stop`, `seico_mart`, `pay_easy`, …). Send the phone as `{ countryCode: "81", localNumber }`. A refused phone comes back as `ONLY_JAPANESE_PHONE_NUMBER_ALLOWED`; read it with `hasReason` and show a form error.
   - **Bank transfer:** email (`createTransactionToken.18`).
   - **PayPay online:** nothing from the form; email is optional for online tokens (`createTransactionToken.18`). The customer pays on their phone in PayPay.

3. **Create the token on the server** with `client.transactionTokens.createTransactionToken({ idempotencyKey: idempotencyKey("token", order.id, attempt, method), body })`:
   - Konbini: `{ paymentType: "konbini", type: "one_time", email, data: { customerName, convenienceStore, phoneNumber, expirationPeriod: "P3D" } }`.
   - Bank transfer: `{ paymentType: "bank_transfer", type: "one_time", email, data: { brand: "aozora_bank", expirationPeriod: "P3D" } }` (`createTransactionToken.30`). Bank transfer allows only `one_time` and `recurring` (`createTransactionToken.12`).
   - PayPay: `{ paymentType: "online", type: "one_time", data: { brand: "pay_pay_online", callMethod: "http_post" } }`. Online tokens must be `one_time` (`createTransactionToken.12`); `http_post` is the call method the docs list for PayPay (`createTransactionToken.21`).
   - **Deadline (`expiration_period`):** 30 minutes to 60 days; left out, the console deadline applies (`createTransactionToken.25`). It reads back as hours, e.g. `P3D` → `PT72H` (`createTransactionToken.29`). A konbini `expiration_time_shift` is a time with zone such as `23:59:00+09:00`, and needs a period of one day or more (`createTransactionToken.26`, `createTransactionToken.27`). 7-Eleven, Seicomart and Pay-easy ignore the time of day: the deadline is the end of that day (`createTransactionToken.28`).
   - A token created without `expiration_period` comes back with `expiration_period: null`. The SDK this skill is built on reads this fine for konbini and bank tokens (verified live in test mode).

4. **Create the charge** with `client.charges.createCharge({ idempotencyKey: idempotencyKey("charge", order.id, attempt, order.amount), body })`:
   ```ts
   { transactionTokenId, amount: order.amount, currency: "JPY",
     metadata: { orderId: order.id },
     captureAt: deadline,                                               // konbini and bank: the exact deadline
     redirect: { endpoint: "https://your.shop/paypay/return" } }        // PayPay only
   ```
   - **No `capture` field** for these methods, not even `true` (`createCharge.20`).
   - `capture_at` (UTC) becomes the payment deadline and wins over the token's period (`createCharge.24`). The charge returns it as `captureAt`, so you can show the exact deadline (verified live in test mode). Example: 23:59 JST three days ahead.
   - `redirect.endpoint` is for PayPay (and Alipay) online charges (`createCharge.54`).
   - The same key on a double submit returns the same charge: no second slip, account or PayPay charge (`every-request.21`). Also reuse a still-waiting attempt instead of starting a new one.

5. **Wait until the charge is `awaiting`.** It starts `pending` (`createCharge.26`). Call `settleCharge(client, storeId, chargeId)`; `polling=true` returns on the first change (`getCharge.2`). `awaiting` means "waiting for the customer to pay" and can last days (`createCharge.31`). `failed` here means the application failed; in test mode a konbini phone number ending in 1111 makes this happen (`createCharge.34`).

6. **Show the customer how to pay** (a common mistake is to show nothing):
   - **Konbini:** the payment number and the slip URL from the charge's metadata, once it is `awaiting` (`createCharge.83`). In the SDK they are under `charge.metadata.additionalProperties`: `internal_convenience_payment_number` and `internal_convenience_payment_url` (verified live in test mode). Show the deadline from `captureAt`. For Pay-easy, also show the institution number 58091, which is not in the charge (`createCharge.84`).
   - **Bank transfer:** once the charge is `awaiting`, read the account from `client.transactionTokens.getTransactionToken({ storeId, id: tokenId })`: `data.bankName`, `branchName`, `branchCode`, `accountNumber`, `accountHolderName` (`getTransactionToken.3`). `client.charges.getChargeIssuerToken` gives the same account (`getChargeIssuerToken.6`), but in test mode fetching it completes the charge (`getChargeIssuerToken.5`), so read the token if your test charges must stay waiting. Show the deadline from `captureAt`.
   - **PayPay:** show a "Pay with PayPay" link to your hand-off route (step 7).

7. **PayPay hand-off** (when the customer clicks): GET the charge; continue only while it is `awaiting` (`getChargeIssuerToken.1`, `getChargeIssuerToken.2`). Call `client.charges.getChargeIssuerToken({ storeId, id })` (not the 3-D Secure one) and follow `callMethod`:
   - `http_get`: redirect the browser to `issuerToken`.
   - `http_post`: send `threeDsHandOffPage({ method: "POST", url: issuerToken, contentType: "application/x-www-form-urlencoded", fields: payloadToWireFields(payload) })`, an auto-submitting form.
   - Redirect only to an `https://` URL. In test mode the issuer token is the dummy `test-issuer-token` with `call_method: http_get`; never redirect to it (`getChargeIssuerToken.3`).
   - The customer has 5 minutes to pay in PayPay; after that the charge fails with error 327 (`background.49`).

8. **PayPay return page** (`redirect.endpoint`): the query has `univapayChargeId` and your metadata (`createCharge.54`). It only tells you which charge. Find your attempt by that charge id (404 if it isn't yours), re-read the charge with `settleCharge`, and mark the order paid only if the charge is `successful` (`background.19`).

9. **Learn when the money arrives.** A paid konbini, bank or PayPay charge sends `charge_finished` (`background.48`); `charge_updated` with `awaiting` means still waiting (`createCharge.31`, `background.20`). In the handler, find the order by charge id, ignore charges you don't know, re-read the charge by GET, and apply:
   - `successful` → paid. For bank transfer, compare `chargedAmount` with the order: more than due is still `successful` and you return the extra yourself, outside UnivaPay (`background.52`); less than due stays `awaiting` until the deadline (`background.53`). A deposit can take up to about an hour to show (`background.56`).
   - `failed` → the attempt ended: konbini deadline passed (`background.51`), bank deadline passed (`background.54`), or PayPay not finished in time (`background.49`). Paying again needs a **new token and a new charge** (attempt + 1).
   - Also run a catch-up job that re-reads every waiting attempt by GET on a timer, because webhooks are best effort (`background.19`).

10. **The customer withdraws.** Cancel the waiting charge with `client.cancels.createCancel` and settle it with `settleCharge` (`createCancel.4`). Live: waiting konbini, bank-transfer and PayPay charges canceled to `canceled`; a waiting Pay-easy charge was refused with `CANCEL_NOT_ALLOWED` (verified live in test mode). A bank charge that already received money can't be canceled (`createCancel.11`). Paid charges need a refund (`refunds.md`); bank transfer has no refund (`createRefund.2`).

## Traps

- **Showing the konbini or bank customer nothing** (a common mistake): read the number, slip URL and account after `awaiting` (step 6).
- **Reading details from the create response.** It is still `pending` and has no payment number (`getCharge.2`, `createCharge.83`, `getTransactionToken.3`).
- **Looking for `metadata.internal_convenience_payment_number` at the top level** of the SDK's `metadata`: the SDK moves unknown keys into `metadata.additionalProperties` (verified live in test mode).
- **Sending `capture`** on these charges → 400 `CAPTURE_ONLY_FOR_CARD_PAYMENT` (`createCharge.20`).
- **Marking the order paid on `awaiting`, on `charge_updated`, or on the PayPay return redirect** (`createCharge.31`, `createCharge.54`, `background.19`).
- **Wrong issuer-token endpoint:** konbini has no issuer token, and card 3-D Secure uses its own endpoint (`getChargeIssuerToken.7`). Fetching it after the charge is `successful` is refused with `INVALID_CHARGE_STATUS` (`getChargeIssuerToken.1`).
- **Redirecting to the test-mode dummy issuer token** (`getChargeIssuerToken.3`).
- **Reusing a token after a failed or expired attempt.** Make a new token and charge (`background.51`, `background.54`, `background.49`).
- **Not checking bank amounts** (`background.52`, `background.53`).
- **No Idempotency-Key:** a double submit makes two konbini slips or two bank accounts (`every-request.21`).
- **`expiration_time_shift` as `PT23H59M`** → 400 (`createTransactionToken.26`); with a period under one day → 400 (`createTransactionToken.27`).
- **Webhook check with `Bearer `, slow replies, no dedupe** (`background.9`, `background.11`, `background.18`).

## Test checklist

Unit tests (no network):
- Form checks: konbini needs name, email, store and a Japanese phone; bank needs email; PayPay needs nothing.
- Token bodies: konbini sends `countryCode: "81"` and a period; bank sends `aozora_bank`; PayPay is `one_time` with `http_post`; no charge body has `capture`.
- The deadline is 23:59 JST N days ahead, sent in UTC.
- The konbini number is read from `metadata.additionalProperties`.
- Order state: paid only on `successful`; bank overpayment flagged; `failed` ends the attempt; `error` leaves the order for a re-check.
- PayPay hand-off: `http_get` redirects; `http_post` auto-submits the payload; a non-`https` issuer token is never redirected to.

Test-mode run (webhook through a tunnel):
- Konbini (FamilyMart and Pay-easy): `awaiting`, payment number, slip URL, deadline, and 58091 for Pay-easy; the order stays unpaid; `charge_updated` (`awaiting`) leaves it unpaid.
- Konbini with a phone ending in 1111: the attempt fails; paying again creates a new token and charge.
- Bank transfer: `awaiting`, bank, branch, account number, holder and deadline shown; the order stays unpaid on its own.
- Test-mode completions: fetch the bank issuer token → `successful` with the exact amount, `charge_finished` pays the order once; a konbini charge turns `successful` on its own after several minutes (`background.50`).
- PayPay: `awaiting`, `redirect.endpoint` set, the hand-off shows the test page (dummy issuer token), the charge turns `successful` within seconds (`getChargeIssuerToken.4`), the return page re-reads it and marks the order paid; a return for a charge that isn't yours gets 404.
- A re-sent `charge_finished` is not processed twice; the catch-up job re-reads waiting orders.
- Withdrawing a konbini payment cancels the charge.

## What test mode can't show

- **A real store payment, a real bank deposit, a short payment, an overpayment or an expired bank deadline:** test mode completes konbini charges on its own (`background.50`; seen after 5 to 9 minutes) and completes a bank charge only when its issuer token is fetched, always for the exact amount (`getChargeIssuerToken.5`).
- **The real PayPay page and its 5-minute limit** (`background.49`): the test issuer token is a dummy (`getChargeIssuerToken.3`), and a test PayPay charge whose issuer token was never fetched stayed `awaiting` for over 9 minutes instead of failing (verified live in test mode). Test the PayPay page in live mode.
- **A konbini deadline passing:** the shortest useful deadline is still 30 minutes (`createTransactionToken.25`), and test charges complete before that.
