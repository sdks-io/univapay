# Run subscriptions with UnivaPay: monthly plans, "pay ¥X in N payments", pause, resume, cancel

Use this when UnivaPay charges the customer's card on a schedule by itself. If your app decides when to charge a saved card, use `saved-cards.md`. If the first charge needs 3-D Secure, use this recipe together with `three-ds-server-charges.md`.

## Before you start

- **Keys:** the store's app token and its secret, on the server only. Subscriptions are created from the server (`createSubscription.32`).
- **Card token:** a card token of type `subscription` (collected for this signup) or `recurring` (a saved card). It comes from UnivaPay's widget, inline form or link form. Never post card numbers to your server (`createTransactionToken.4`).
- **Console:** check the retry count and the status a subscription ends in after failed retries (`background.62`, `background.63`), and which emails UnivaPay already sends (`createSubscription.1`). `three_ds.mode: skip` works only if UnivaPay support turned it on for the store (`createSubscription.33`).
- **Webhook:** one webhook with the triggers `subscription_created`, `subscription_payment`, `subscription_failure`, `subscription_suspended`, `subscription_canceled`, `subscription_completed`, `charge_updated`, `charge_finished`. Use the receiver in `shared/webhooks.md`.
- **Templates to copy:** `subscription-plan.ts`, `payment-status.ts`, `univapay-errors.ts`, `idempotency.ts`, `webhook-receiver.ts`.

## Steps

1. **Keep the plans in a catalogue on your server.** The browser sends a plan id. The server sets every amount. Pick one of three plan kinds:
   - **Plain recurring:** `{ amount, period }`. `amount` is charged every period until the subscription stops.
   - **"Pay ¥X in N payments":** `fixedCountPlan(total, N, period)` from `subscription-plan.ts`. It sends the **total** as `amount` with `subscription_plan: { plan_type: "fixed_cycles", fixed_cycles: N }` (`createSubscription.24` (amount is the total, divided by N)). The first charge is payment 1 of N (`background.61`). N must be 2 or more (`simulateSubscriptionPlan.3`).
   - **"Pay ¥T, ¥P each time":** `fixedAmountPlan(total, perPayment, period)`. `amount` is the total and `fixed_cycle_amount` is each payment, lower than the total (`createSubscription.23`).
   - Never use `installment_plan` for "pay in 3". It is card-company installments, a different product (`createSubscription.22`).
   - **Period:** send exactly one of `period` (`daily`, `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `semiannually`, `annually`) or `cyclical_period` (`createSubscription.10`, `createSubscription.50`). `bimonthly` works although the definition leaves it out (`createSubscription.42`). A `cyclical_period` must be at least one day (`createSubscription.11`).

2. **Preview the schedule before you create anything.** Call `previewPlan(client, storeId, fields)` (it calls `client.subscriptions.simulateStoreSubscriptionPlan`). Nothing is created (`simulateSubscriptionPlan.1`). Compare the returned amounts with what your catalogue says each payment is. If they differ, don't create the subscription: log it and show an error. When the total doesn't divide evenly, the simulation shows which payment takes the remainder: ¥1,000 in 3 gave 333, 333, 334 (verified live in test mode).

3. **Check the token on the server.** Never trust a token id from the browser without checking it. Call `client.transactionTokens.getTransactionToken({ storeId, id })` and require `type` `subscription` or `recurring`, `paymentType` `card`, and `active` not false (`createSubscription.9` (one-time tokens are refused)). For a saved card, look the token up from the signed-in customer's own record, never from the request. Create the subscription within 5 minutes of making a `subscription` token (`createSubscription.40`).

4. **Create the subscription with one key per signup.**
   ```ts
   const key = idempotencyKey("subscription", customer.id, signupId, planId);
   const r = await withIdempotentRetry(key, (k) => client.subscriptions.createSubscription({ idempotencyKey: k, body: {
     transactionTokenId, currency: "JPY", ...planFields,          // fixedCountPlan / fixedAmountPlan / { amount, period }
     threeDs: { mode: "normal" },                                 // always explicit
     scheduleSettings: { zoneId: "Asia/Tokyo" },
     metadata: { orderId: signupId, additionalProperties: { customerId: customer.id } },
   } }));
   ```
   - The same key on a retry or a double submit returns the first subscription instead of making a second one (`every-request.21`).
   - Send `three_ds.mode` every time: the sources disagree on the default (`createSubscription.28`). Use `skip` only from the server and only if support enabled it (`createSubscription.32`, `createSubscription.33`).
   - Two subscriptions on the same card within 30 seconds are refused with `CHARGE_TOO_QUICK` (`createSubscription.25`). Show "please try again in a minute"; don't retry in a loop.
   - Set `zone_id`; scheduled charges run from 07:00 in that zone (`createSubscription.44`).
   - Put your own reference in `metadata`. It is copied to every charge the subscription makes (`background.57`). In the SDK, `metadata.orderId` goes out as `order_id`, and any other key goes under `metadata.additionalProperties` and is sent at the top level (verified live in test mode).

5. **Wait for the first charge before you give access.** A new subscription is `unverified` (`createSubscription.41`). Call `settleSubscription(client, storeId, id)` from `payment-status.ts`. It re-reads with `polling=true` a few times, bounded (`getSubscription.1`). Then read the first charge with `client.subscriptions.getSubscriptionLatestCharge({ storeId, subscriptionId })`. A 404 with no body means no charge yet (`getSubscriptionLatestCharge.1`).
   - `current`: give access.
   - First charge `awaiting`: the bank wants 3-D Secure. Hand the customer off as in `three-ds-server-charges.md` (`createSubscription.39`). The subscription stays `unverified` meanwhile.
   - `unconfirmed`: the first payment failed and nothing is running (`background.25`). Ask for another card.

6. **Track renewals with webhooks, and confirm each one with a GET.** UnivaPay runs later charges by itself and tells you only by webhook or GET (`background.46`). In the handler, find your row by the subscription id (`data.id` on `subscription_*` events, `data.subscription_id` on `charge_*` events), ignore events you don't know, then re-read with `getSubscription` before changing anything (`background.19`). Events:
   - `subscription_created` (`unverified`), `charge_finished`, `subscription_payment` (`current`) for a new subscription (`createSubscription.43`). `subscription_payment` extends access (`background.23`).
   - `subscription_failure`: `unpaid` means a retry is coming; `unconfirmed` means the first charge failed (`background.25`).
   - `subscription_suspended`: also sent when the retries run out, not only when you pause (`background.27`, `background.47`).
   - `subscription_canceled`: end access (`background.26`).
   - `subscription_completed`: every payment of a fixed plan is done (`background.24`). `completed` is the normal end, so keep what was paid for (`background.73`).
   - The receiver answers 200 at once and processes after (`background.11`), and skips repeats (`background.18`). Deliveries have no id (`background.10`).

7. **Pause.** Only from `current` or `unpaid` (`suspendSubscription.2`): check your stored status first, then call `pauseSubscription`. It returns `suspended` at once (`suspendSubscription.3`). If you created the subscription with `termination_mode: on_next_payment`, the pause happens only on the next payment date (`suspendSubscription.4`).

8. **Resume.** Only from `suspended` (`unsuspendSubscription.1`): call `resumeSubscription`. It comes back `unpaid`, not `current` (`unsuspendSubscription.2`). Store that status from the response: no webhook follows (`unsuspendSubscription.3`). Show the next charge date from `nextPayment.dueDate` (`unsuspendSubscription.4`, `unsuspendSubscription.7`). For a fixed-count plan, missed payments move to the end of the schedule (`unsuspendSubscription.6`). Whether the customer keeps access until that date is your business rule; don't show it as `current` before `subscription_payment` arrives.

9. **Cancel.** Call `cancelSubscriptionSafely`. Success is 204 with no body; the subscription is canceled for good and can't be resumed (`cancelSubscription.1`, `updateSubscription.4`). While the first charge is still `awaiting` (3-D Secure or an unpaid konbini first charge), cancel returns 403 with an empty body (`cancelSubscription.3`). The template turns that into `first-payment-still-pending`: tell the customer to try again later. To stop at the next payment date instead of now, set `next_payment.terminate_with_status` (`updateSubscription.11`).

## Plans already created with the wrong amount (pointer)

The full runbook goes in `shared/recovery-runbooks.md`. What to check and fix:

- **Find them all.** Page through `listStoreSubscriptions` until `has_more` is false (`every-request.26`, `every-request.27`), or start from your own table. A wrong plan has `subscription_plan.fixed_cycles` and an `amount` equal to the per-payment price. Read each one with `getSubscription`, not from the list (`listStoreSubscriptions.2`).
- **Don't patch the amount.** A fixed-count subscription's amount can't be changed (`updateSubscription.7`).
- **Count what each customer already paid** from that subscription's charges, and decide with the business how to collect the rest.
- **Stop the wrong one** with `cancelSubscriptionSafely` (`cancelSubscription.1`, `cancelSubscription.3`), or schedule the stop with `next_payment.terminate_with_status` (`updateSubscription.11`).
- **Start the replacement safely:** wait 30 seconds after canceling before using the same recurring token again (`createSubscription.26`). A `subscription` token can't start a second subscription after 5 minutes (`createSubscription.40`), so use a `recurring` token or ask the customer for the card again (`createSubscription.9`). Derive the Idempotency-Key from the old subscription id (`every-request.20`, `every-request.21`), and mark each one as migrated so a re-run creates nothing new.

## Traps

- **¥30,000 in 3 payments sent as `amount: 10000`** charges ¥3,333 a payment (`createSubscription.24`). This is a common mistake. Always build fixed plans with `fixedCountPlan` / `fixedAmountPlan` and check the preview (step 2). Live, simulating `amount` 2510 in 3 gave 836, 837, 837 instead of 2510 each.
- **`installment_plan` for "pay in 3"** is a different product (`createSubscription.22`).
- **Accepting any token id from the browser** (a common mistake): a one-time token can't start a subscription (`createSubscription.9`). Check the token yourself (step 3). A one-time konbini token is refused with `NOT_SUBSCRIPTION_TOKEN`, while a konbini token of type `subscription` is accepted (`createSubscription.8`); both verified live in test mode through this SDK.
- **Giving access on the 201.** A new subscription is `unverified` (`createSubscription.41`).
- **Treating `unpaid` as canceled** or as paid (`background.25`). After a resume, `unpaid` is normal (`unsuspendSubscription.2`).
- **Waiting for a webhook after resume.** None comes (`unsuspendSubscription.3`).
- **Trusting the status inside a webhook.** Events can arrive after later changes: live, `subscription_suspended` arrived after the resume, and the GET already said `unpaid` (`background.19`; verified live in test mode). Always re-read.
- **Parsing a body from cancel's 204, or crashing on its empty 403** (`cancelSubscription.1`, `cancelSubscription.3`).
- **Treating `completed` as a failure** (`background.73`).
- **No Idempotency-Key.** The SDK makes a new random key on every call when you pass none, so a retry creates a second subscription and a second charge (`every-request.21`; see `idempotency.ts`).
- **Patching the amount of a fixed plan** (`updateSubscription.7`).
- **Webhook check with `Bearer `, or slow replies** (`background.9`, `background.11`).

## Test checklist

Unit tests (no network):
- The plan builders send the total as `amount` (`7530` for 3 × 2,510), and `fixed_cycle_amount` for fixed-amount plans.
- `/subscribe` never calls create for a one-time or non-card token.
- `/subscribe` refuses to create when the simulated schedule doesn't match the catalogue.
- A double submit sends the same Idempotency-Key; the amount sent ignores any amount from the browser; `three_ds.mode` is always present.
- Cancel: 204 → canceled; 403 with no body → "first payment still pending".

Test-mode run (with the webhook through a tunnel):
- Preview of a fixed-count plan: each payment equals the catalogue price and the sum is the total.
- A fixed-count subscription: `amount` = total, `fixed_cycles` = N, first charge = total / N, status `current`.
- A plain monthly subscription becomes `current`; `subscription_created`, `charge_finished` and `subscription_payment` arrive and are re-read by GET.
- Pause → `suspended` (`subscription_suspended` arrives); resume → `unpaid` stored; a second resume is refused by your status check.
- Cancel → `canceled` (`subscription_canceled` arrives); pause after cancel is refused.
- With a first charge waiting for 3-D Secure: the app says "needs 3-D Secure", and cancel gives the "try later" message. In test mode that charge fails after about 5 minutes with error 327 (`createCharge.46`); the subscription then turns `unconfirmed` (`subscription_failure`) and cancel works (verified live in test mode).
- A re-sent delivery is answered 200 and not processed twice.

## What test mode can't show

- **Later scheduled charges, retries and the end of a fixed plan** (`background.46`, `background.62`, `background.63`, `background.24`): they happen on the billing dates, a month or more later, so a test run sees only the first charge. Test your `subscription_payment`, `subscription_failure` and `subscription_completed` handling with recorded event bodies.
- **A renewal failing on its own:** the test card on file keeps succeeding, so `unpaid` and the retries can't be triggered on demand.
- **Finishing 3-D Secure on the first charge:** it needs a person in a browser (see `three-ds-server-charges.md`).
