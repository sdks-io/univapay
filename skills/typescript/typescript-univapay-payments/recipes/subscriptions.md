# Run subscriptions with UnivaPay: monthly plans, "pay ¥X in N payments", pause, resume, cancel

Use this when UnivaPay charges the customer's card on a schedule by itself. If your app decides when to charge a saved card, use `saved-cards.md`. If the first charge needs 3-D Secure, use this recipe together with `three-ds-server-charges.md`.

## Before you start

- **Keys:** server only, with `{secret}.{jwt}`; subscriptions are created from the server (`createSubscription.32`).
- **Card token:** a card token of type `subscription` (collected for this signup) or `recurring` (a saved card), from UnivaPay's widget, inline form or link form. Never post card numbers to your server (`createTransactionToken.4`).
- **Console:** check the retry count and the status a subscription ends in after failed retries (`background.62`, `background.63`), and which emails UnivaPay already sends (`createSubscription.1`). `three_ds.mode: skip` works only if UnivaPay support turned it on (`createSubscription.33`).
- **Webhook:** triggers `subscription_created`, `subscription_payment`, `subscription_failure`, `subscription_suspended`, `subscription_canceled`, `subscription_completed`, `charge_updated`, `charge_finished`, set up as in `shared/webhooks.md`.
- **Templates to copy:** `subscription-plan.ts`, `payment-status.ts`, `univapay-errors.ts`, `idempotency.ts`, `webhook-receiver.ts`.

## Steps

1. **Keep the plans in a catalogue on your server.** The browser sends a plan id; the server sets every amount. Pick one of three plan kinds:
   - **Plain recurring:** `{ amount, period }`. `amount` is charged every period until the subscription stops.
   - **"Pay ¥X in N payments":** `fixedCountPlan(total, N, period)` from `subscription-plan.ts`. It sends the **total** as `amount` with `subscription_plan: { plan_type: "fixed_cycles", fixed_cycles: N }` (`createSubscription.24` (amount is the total, divided by N)). The first charge is payment 1 of N (`background.61`). N must be 2 or more (`simulateSubscriptionPlan.3`).
   - **"Pay ¥T, ¥P each time":** `fixedAmountPlan(total, perPayment, period)`. `amount` is the total and `fixed_cycle_amount` is each payment, lower than the total (`createSubscription.23`).
   - Never use `installment_plan` for "pay in 3": it is card-company installments, a different product (`createSubscription.22`).
   - **Period:** send exactly one of `period` (`daily`, `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `semiannually`, `annually`) or `cyclical_period` (`createSubscription.10`, `createSubscription.50`). `bimonthly` works although the definition leaves it out (`createSubscription.42`). A `cyclical_period` must be at least one day (`createSubscription.11`).

2. **Preview the schedule before you create anything.** Call `previewPlan(client, storeId, fields)` (it calls `client.subscriptions.simulateStoreSubscriptionPlan`). Nothing is created (`simulateSubscriptionPlan.1`). Compare the returned amounts with what your catalogue says each payment is; if they differ, don't create the subscription: log it and show an error. When the total doesn't divide evenly, the preview shows which payment takes the remainder, e.g. ¥1,000 in 3 → 333, 333, 334 (`createSubscription.24`).

3. **Check the token on the server.** Call `client.transactionTokens.getTransactionToken({ storeId, id })` and require `type` `subscription` or `recurring`, `paymentType` `card`, and `active` not false (`createSubscription.9` (one-time tokens are refused)). For a saved card, look the token up from the signed-in customer's own record, never from the request. Create the subscription within 5 minutes of making a `subscription` token (`createSubscription.40`).

4. **Create the subscription with one key per signup.**
   ```ts
   const key = idempotencyKey("subscription", customer.id, signupId, planId);
   const r = await withIdempotentRetry(key, (k) => client.subscriptions.createSubscription({ idempotencyKey: k, body: {
     transactionTokenId, currency: "JPY", ...planFields,          // fixedCountPlan / fixedAmountPlan / { amount, period }
     threeDs: { mode: "normal", redirectEndpoint: returnUrl },    // always explicit
     scheduleSettings: { zoneId: "Asia/Tokyo" },
     metadata: { orderId: signupId, additionalProperties: { customerId: customer.id } },
   } }));
   ```
   - The same key on a retry or a double submit returns the first subscription instead of making a second one (`every-request.21`).
   - Send `three_ds.mode` every time: the sources disagree on the default (`createSubscription.28`). Use `skip` only from the server and only if support enabled it (`createSubscription.32`, `createSubscription.33`).
   - Two subscriptions on the same card within 30 seconds are refused with `CHARGE_TOO_QUICK` (`createSubscription.25`). Show "please try again in a minute"; don't retry in a loop.
   - Set `zone_id`; scheduled charges run from 07:00 in that zone (`createSubscription.44`).
   - Put your own reference in `metadata`; it is copied to every charge the subscription makes (`background.57`). In the SDK, `metadata.orderId` goes out as `order_id`; any other key goes under `metadata.additionalProperties`, is sent at the top level, and comes back under `additionalProperties` (SDK, tested).

5. **Wait for the first charge before you give access.** A new subscription is `unverified` (`createSubscription.41`). Call `settleSubscription(client, storeId, id)` from `payment-status.ts` (bounded re-reads with `polling=true`, `getSubscription.1`). Then read the first charge with `client.subscriptions.getSubscriptionLatestCharge({ storeId, subscriptionId })`; a 404 with no body means no charge yet (`getSubscriptionLatestCharge.1`).
   - `current`: give access.
   - First charge `awaiting`: the bank wants 3-D Secure. Hand the customer off as in `three-ds-server-charges.md` (`createSubscription.39`). The subscription stays `unverified` meanwhile.
   - **The 3-D Secure return for a subscription carries `univapaySubscriptionId`, not `univapayChargeId`** (`createSubscription.38`). Your return route reads `univapaySubscriptionId`, ignores ids you didn't create (show nothing), re-reads the subscription with `settleSubscription`, and decides from that GET.
   - `unconfirmed`: the first payment failed and nothing is running (`background.25`). Ask for another card.

6. **Track renewals with webhooks, and confirm each one with a GET.** UnivaPay runs later charges by itself and tells you only by webhook or GET (`background.46`). Find your row by the subscription id (`data.id` on `subscription_*` events, `data.subscription_id` on `charge_*` events), ignore events you don't know, then re-read with `getSubscription` before changing anything (`background.19`). Events:
   - `subscription_created` (`unverified`), `charge_finished`, `subscription_payment` (`current`) for a new subscription (`createSubscription.43`). `subscription_payment` extends access (`background.23`).
   - `subscription_failure`: `unpaid` means a retry is coming; `unconfirmed` means the first charge failed (`background.25`).
   - `subscription_suspended`: also sent when the retries run out, not only when you pause (`background.27`, `background.47`).
   - `subscription_canceled` (`background.26`); `subscription_completed`: every payment of a fixed plan is done (`background.24`).

7. **Give or end access from the GET status,** in one function (keep whether the customer had access before):
   - `current` → access on. `completed` → the normal end of a fixed plan: keep what was paid for (`background.73`).
   - `unpaid` after a failed renewal → **keep access** while UnivaPay retries (`background.66`, `background.62`, `background.65`, `background.25`). Show "payment retrying: please check your card".
   - `unpaid` after a resume → no access until `subscription_payment` arrives (`unsuspendSubscription.2`). So `unpaid` keeps access only for a customer who already had it; it never grants it.
   - `suspended` or `canceled` → end access (`background.63`, `background.27`, `background.26`). `unconfirmed` → no access.

8. **Pause.** Only from `current` or `unpaid` (`suspendSubscription.2`): check your stored status first, then call `pauseSubscription`. It returns `suspended` at once (`suspendSubscription.3`). With `termination_mode: on_next_payment`, the pause happens only on the next payment date (`suspendSubscription.4`).

9. **Resume.** Only from `suspended` (`unsuspendSubscription.1`): call `resumeSubscription`. It comes back `unpaid`, not `current` (`unsuspendSubscription.2`). Store that status from the response: no webhook follows (`unsuspendSubscription.3`). Show the next charge date from `nextPayment.dueDate` (`unsuspendSubscription.4`, `unsuspendSubscription.7`). For a fixed-count plan, missed payments move to the end of the schedule (`unsuspendSubscription.6`).

10. **Cancel.** Call `cancelSubscriptionSafely`. Success is 204 with no body; the subscription is canceled for good (`cancelSubscription.1`, `updateSubscription.4`). While the first charge is still `awaiting` (3-D Secure or an unpaid konbini first charge), cancel returns 403 with an empty body (`cancelSubscription.3`): the template turns that into `first-payment-still-pending`; tell the customer to try again later. To stop at the next payment date instead, set `next_payment.terminate_with_status` (`updateSubscription.11`).

**Plans already created with the wrong amount:** don't patch them (`updateSubscription.7`, `updateSubscription.21`); follow `shared/recovery-runbooks.md` (b).

## Traps

- **¥30,000 in 3 payments sent as `amount: 10000`** charges ¥3,333 a payment (`createSubscription.24`). A common mistake. Build fixed plans with `fixedCountPlan` / `fixedAmountPlan` and check the preview (step 2).
- **`installment_plan` for "pay in 3"** is a different product (`createSubscription.22`).
- **Accepting any token id from the browser** (a common mistake): a one-time token can't start a subscription (`createSubscription.9`; a one-time konbini token too, while a `subscription` konbini token is accepted: `createSubscription.8`). Check the token yourself (step 3).
- **Giving access on the 201.** A new subscription is `unverified` (`createSubscription.41`).
- **Cutting access the moment a renewal is `unpaid`** while UnivaPay is still retrying, or treating `unpaid` as paid (`background.25`, `background.66`). See step 7. After a resume, `unpaid` is normal (`unsuspendSubscription.2`).
- **A 3-D Secure return page that reads only `univapayChargeId`**: for a subscription it isn't there (`createSubscription.38`), so the customer sees an error although the subscription may be `current`.
- **Waiting for a webhook after resume.** None comes (`unsuspendSubscription.3`).
- **Trusting the status inside a webhook.** Events can arrive after later changes (`background.19`, `background.75`). Always re-read.
- **Parsing a body from cancel's 204, or crashing on its empty 403** (`cancelSubscription.1`, `cancelSubscription.3`).
- **Treating `completed` as a failure** (`background.73`).
- **No Idempotency-Key.** When you pass none, the SDK sends no key (SDK, tested), so a retry creates a second subscription and a second charge (`every-request.21`; see `idempotency.ts`).
- **Patching the amount of a fixed plan** (`updateSubscription.7`).
- **Webhook receiver mistakes** (`Bearer`, slow replies): `shared/webhooks.md` traps.

## Test checklist

Unit tests (no network):
- The plan builders send the total as `amount` (`7530` for 3 × 2,510), and `fixed_cycle_amount` for fixed-amount plans.
- `/subscribe` never calls create for a one-time or non-card token.
- `/subscribe` refuses to create when the simulated schedule doesn't match the catalogue.
- A double submit sends the same Idempotency-Key; the amount sent ignores any amount from the browser; `three_ds.mode` is always present.
- Access: `unpaid` keeps access for a customer who had it; `unpaid` after a resume grants none; `suspended`, `canceled` and `unconfirmed` end it; `current` and `completed` give it.
- Cancel: 204 → canceled; 403 with no body → "first payment still pending".

Test-mode run (with the webhook through a tunnel):
- Preview of a fixed-count plan: each payment equals the catalogue price and the sum is the total.
- A fixed-count subscription: `amount` = total, `fixed_cycles` = N, first charge = total / N, status `current`.
- A plain monthly subscription becomes `current`; `subscription_created`, `charge_finished` and `subscription_payment` arrive and are re-read by GET.
- The 3-D Secure return with `univapaySubscriptionId` re-reads the subscription (`current`, access on); an unknown id, or a return with only `univapayChargeId`, shows nothing.
- Pause → `suspended` (`subscription_suspended` arrives); resume → `unpaid` stored; a second resume is refused by your status check.
- Cancel → `canceled` (`subscription_canceled` arrives); pause after cancel is refused.
- With a first charge waiting for 3-D Secure: the app says "needs 3-D Secure", and cancel gives the "try later" message. Left alone, that charge fails with error 327 after about 5 minutes; the subscription turns `unconfirmed` (`subscription_failure`), and cancel then works (`createSubscription.51`, `createCharge.46`).
- A re-sent delivery is answered 200 and not processed twice.

## What test mode can't show

- **Later scheduled charges, retries and the end of a fixed plan** (`background.46`, `background.62`, `background.63`, `background.24`): they happen on billing dates a month or more later, so a test run sees only the first charge. Test your `subscription_payment`, `subscription_failure` and `subscription_completed` handling with recorded event bodies.
- **A renewal failing on its own, and access during the retries** (step 7): the test card on file keeps succeeding, so `unpaid` and the retries can't be triggered on demand. Cover the access rule with unit tests.
- **Finishing 3-D Secure on the first charge:** it needs a person in a browser (see `three-ds-server-charges.md`).
