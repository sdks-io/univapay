# Recovery runbooks

Step-by-step fixes for damage that is already done: a webhook that was switched off, subscriptions created with the wrong amount, and orders left in the wrong state. Each runbook ends with a test-mode run to repeat.
Fix the code first (the matching recipe, and `review-checklist.md`), then repair the data. Each runbook is safe to run twice.

## (a) A webhook that was switched off

**Signs:** UnivaPay tells you the webhook was stopped; `getWebhook` says `active: false`; or orders stopped moving and your logs show 401, 4xx or 500–502 replies. Failed deliveries switch it off (`background.15`), and it then gets nothing until switched back on (`background.17`).

1. **Fix the endpoint and deploy it first**, as in `webhooks.md` steps 2–3: raw `Authorization` compare with no `Bearer` (`background.9`), 200 within 3 seconds (`background.11`) for every authenticated event. Otherwise the webhook is switched off again.

2. **Find the webhook by the id you stored.** `client.webhooks.getWebhook({ storeId, id })` shows `active: false`.
   - The default webhook list leaves switched-off and deleted webhooks out (`listWebhooks.2`). `active=inactive` or `all` lists them and `true`/`false` are refused (`listWebhooks.1`), but the SDK can't send `inactive` or `all`: its `active` filter is typed boolean (SDK, tested). So GET by the stored id.
   - A deleted webhook also reads `active: false` (`deleteWebhook.1`). Make sure the id is one you still use.
   - **No stored id?** Look it up in the console. Or create a new webhook on the same URL with a new auth token: a switched-off webhook doesn't block its URL (`createWebhook.4`). Deploy the new token first, and don't switch the old webhook back on as well.

3. **Switch it back on:** `ensureWebhookActive(client, storeId, id, { expectedUrl: yourReceiverUrl })` (`webhook-receiver.ts`) → `{ wasActive: false, nowActive: true }`. It sends only `active: true`, so the URL, the triggers and the auth token stay the same (`updateWebhook.5`). New events flow from now on (`background.17`).

4. **Set the catch-up window.**
   - Start: the first failed or slow reply in your logs, or the last event you processed, minus a safety margin (an hour or more).
   - End: now.
   - UnivaPay doesn't re-send events from the window (`background.17`), and its delivery log can't be read with a store app token (`listWebhookEvents.1`): your own data and GET calls are the only source.

5. **Catch up on charges** with the webhook handler's "apply" function (it decides from a GET and only moves orders forward).
   - Every charge created in the window: `for await (const ch of chargesCreatedSince(client, storeId, start))`, which pages until `has_more` is false (`every-request.26`, `every-request.27`); `listStoreCharges({ storeId, from })` gives the same set (`listAllCharges.2`).
   - Keep only charges of your orders (`ch.metadata?.orderId`, or a charge id you stored). Ignore the rest: they belong to other apps.
   - One charge with a number in `metadata.order_id` (e.g. made by another system) makes the SDK fail that whole `listStoreCharges` page (SDK, tested). Your own code must always send `order_id` as a string.
   - GET each one (`getCharge({ storeId, id, polling: true })`) and apply its status. Don't read the status from the list: lists lag (`listAllCharges.5`).
   - Also re-read **every order still waiting**, by its stored charge id. A konbini or bank charge created before the window can be paid during it (`background.48`).

6. **Catch up on everything else you track,** each by GET:
   - refunds still `pending` → `settleRefund` (`background.32`);
   - cancels still `pending` → `settleCancel` (`background.35`);
   - each live subscription → `getSubscription`. Its charges come from `listSubscriptionCharges({ merchantId, storeId, subscriptionId })`. UnivaPay reports scheduled charges only by webhook or GET (`background.46`);
   - saved cards → `getTransactionToken`. `active: false` means the card was removed (`background.33`).

7. **Run the catch-up a second time.** It must change nothing. Keep `processPending` on its timer. Then add the `active` check from `webhooks.md` step 9, so you hear about the next switch-off.

**Test-mode run:**
- switch the webhook off and find it by its stored id;
- re-enable it: URL, triggers and auth token unchanged;
- charges made during the outage are found by `chargesCreatedSince`, re-read, and their orders paid;
- a second run changes nothing.

## (b) Subscriptions created with the wrong amount ("¥3,333 instead of ¥10,000")

**Cause:** a "pay ¥X in N payments" plan sent the per-payment price as `amount`. For `fixed_cycles`, `amount` is the total, split over the payments (`createSubscription.24`). ¥30,000 in 3 sent as `amount: 10000` charges about ¥3,333 a payment; ¥8,790 in 3 sent as `2930` charges ¥976 first.

1. **Fix the code and deploy:** `fixedCountPlan(total, N)` and a `previewPlan` check before every create (`subscriptions.md` steps 1–2). No new wrong subscription may start while you repair the old ones.

2. **Find every wrong subscription.**
   - Start from your own table, or page `listStoreSubscriptions({ storeId, limit: 100, cursor })` until `has_more` is false (`every-request.26`, `every-request.27`).
   - `search` matches metadata values, e.g. your plan id or order id (`listAllSubscriptions.1`).
   - GET each one (`listStoreSubscriptions.2`). It is wrong when `subscriptionPlan.planType === "fixed_cycles"` and `amount` isn't your catalogue's total for that plan.

3. **Don't try to patch them.**
   - `amount` on a fixed-count plan is refused (`updateSubscription.7`).
   - `next_payment.amount` is refused too (`updateSubscription.21`).

4. **Count what each customer has paid.**
   - Get `merchantId` from `client.merchants.getCurrentMerchant()`.
   - Page `client.subscriptions.listSubscriptionCharges({ merchantId, storeId, subscriptionId, limit: 100 })`. GET each charge and add up the `successful` ones' `chargedAmount`.
   - `owed = catalogue total − paid`; `paymentsLeft = N − number of successful charges`. Example: paid 976, owed 7,814, 2 payments left.

5. **Decide per subscription, by its GET status:**

   | Status | What to do |
   |---|---|
   | `unverified` (first payment still pending) | Wait. Cancel returns 403 with an empty body until it settles (`cancelSubscription.3`). |
   | `unconfirmed` (first payment failed, nothing paid: `background.25`) | Cancel. The customer signs up again on the fixed plan. |
   | `current` or `unpaid` | Cancel now. Collect `owed` with a replacement in `paymentsLeft` payments (2 or more), or with one saved-card charge if 1 is left. A fixed plan needs at least 2 payments (`simulateSubscriptionPlan.3`); the single charge follows `saved-cards.md`. |
   | `suspended` (paused by the customer) | Cancel now. Store what is owed, and create the replacement when the customer resumes. |
   | `completed` or `canceled` | Nothing is running. The shortfall is a business decision: one saved-card charge with the customer's consent (`saved-cards.md`), or write it off. |

6. **Tell each customer before you change anything.** For example: "Your plan charged ¥976 instead of ¥2,930. You still owe ¥7,814 of the ¥8,790 total. We will take it in 2 payments of ¥3,907, on <date> and <date>. Reply if you'd rather do something else."
   - UnivaPay may also email the customer when the old subscription is cancelled (`suspendSubscription.1`) and when the new one's first payment succeeds (`createSubscription.1`). Check the console notifications, so your message comes first and matches.

7. **Cancel the wrong subscription.**
   - `cancelSubscriptionSafely(client, storeId, id)` → 204 and `canceled`, from `current` or `suspended` (`cancelSubscription.1`).
   - In your table, record "cancelled for repair: owed ¥X in N payments, next due date D" **before** creating anything.

8. **Create the replacement on the old next due date** (a job that runs on D), or right away if the customer agreed to pay early.
   - The replacement's first charge runs at once (`createSubscription.41`, `createSubscription.43`), and `schedule_settings.start_on` doesn't delay it: it moves only the later payments (`createSubscription.52`). So the date is set by when your job runs.
   - Wait at least 30 seconds after the cancel before using the same recurring token (`createSubscription.26`); the old subscription's recurring token can then start the replacement. A `subscription`-type token can't start another subscription after 5 minutes (`createSubscription.40`): ask the customer for the card again.
   - Build with `fixedCountPlan(owed, paymentsLeft)` and check `previewPlan(...).addsUp` (`simulateSubscriptionPlan.1`).
   - Key: `idempotencyKey("subscription", oldSubscriptionId, "replacement")` (`every-request.21`).
   - Metadata: your order id plus `replaces: <old subscription id>`.
   - `three_ds.mode` as on the old subscription (`createSubscription.28`).
   - Then `settleSubscription` → `current`, first charge = `owed / paymentsLeft` (`createSubscription.24`). Example: ¥3,907 at once, the next ¥3,907 a month later; 976 + 7,814 = 8,790.

9. **Re-running must create nothing.**
   - Skip a subscription when your table says it was repaired.
   - If the table was lost, `listStoreSubscriptions({ search: oldId })` finds the replacement by its `replaces` metadata.
   - Within 24 hours, the same key returns the same replacement (`every-request.21`, `every-request.22`).

**Test-mode run:**
- create 3 subscriptions (2 wrong, 1 right): the paged list plus GET flags exactly the 2 wrong ones;
- both patches are refused;
- paid / owed / payments left come from the subscription's charges;
- the current and the paused one are cancelled, and the replacement charges the right amounts;
- a second run creates nothing (table, `search`, same key);
- cancel everything afterwards.

## (c) Orders left in the wrong state after a bug

**Typical causes:**
- konbini or bank charges refused (e.g. `capture` sent: `createCharge.20`), so orders were marked failed;
- "201 means paid" (the create reply is `pending`: `createCharge.26`);
- a konbini deadline passed but the order stayed paid;
- a bank payment arrived but the order says failed;
- a return URL carried another order's charge.

1. **Fix the bug, and note when it shipped.** That is the window start.

2. **List the suspect orders:** every order in the window with a delayed method (konbini, bank transfer, PayPay), whatever its state. If unsure, take every order in the window.

3. **Re-check each one from the API, never from your own state:**
   - Charge id stored → `getCharge({ storeId, id })`.
   - No charge id → search the charges created in the window for `metadata.orderId === order.id` (`chargesCreatedSince`, `listAllCharges.2`).
   - No charge at all → none was created (e.g. it was refused with 400, as a konbini charge with `capture` is: `createCharge.20`). The customer never got payment details: contact them and offer a new attempt.
   - The charge's `metadata.orderId` isn't this order → "needs attention" for staff. Don't change the order.

4. **Map each charge with `chargeOutcome()` and compare the amount,** then write a report: order, stored state, charge status, new state, action.

   | Charge (GET) | New state | Action |
   |---|---|---|
   | `successful`, amount matches | paid | If it was marked failed: mark paid, fulfil, tell the customer. Only `successful` is paid (`createCharge.26`). A bank payment above the amount is also `successful`: return the excess yourself (`background.52`). |
   | `awaiting` | waiting for the customer | Marked failed → re-send how to pay: konbini number and slip from `metadata.additionalProperties` (`createCharge.83`), bank account from the token (`getTransactionToken.3`), and the deadline. Marked paid → stop fulfilment; it isn't paid yet (`createCharge.31`). |
   | `failed` | failed | Marked paid → stop fulfilment and contact the customer. Show the numeric `error.code` (`getCharge.7`), e.g. 309. Paying again needs a new token and charge (`background.51`, `background.54`). |
   | `canceled` | not paid | Nothing was taken. |
   | `pending` or `error` | unchanged | Re-check later: `error` can still change (`getCharge.11`). |

5. **Staff review the report before you apply it.** Pay special attention to "paid → not paid" lines: goods may have shipped. Then apply. Run the re-check again: it must propose no change.

6. **Tell the customers.**
   - Wrongly failed but still waiting: "Your order is still open. Pay at <store> with number <n> by <deadline>."
   - Wrongly paid but not paid: "We haven't received your payment yet; we'll ship when it arrives." Or, if expired: "The payment deadline passed. Here is a new way to pay."
   - Wrongly failed but paid: "Your payment arrived; your order is on its way."
   - For konbini or bank refunds that were recorded but never went through, follow `refunds.md` step 3.

**Test-mode run** (orders with real charges):
- konbini `awaiting` marked failed → waiting, number present;
- konbini `awaiting` marked paid → not paid;
- konbini `failed` (error 309) marked paid → failed;
- bank transfer `successful` marked failed → paid;
- bank transfer `awaiting` marked paid → not paid, account present;
- lost charge id → found by order id;
- another order's charge → needs attention;
- the second re-check proposes no change.
