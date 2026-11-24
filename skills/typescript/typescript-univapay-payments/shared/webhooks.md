# Receive UnivaPay webhooks

The one webhook receiver every recipe uses. It is built on `templates/webhook-receiver.ts`: copy the template, then follow the steps. Webhooks tell you that something changed. A GET tells you what the state is now.
For a webhook that was switched off, or for events missed during an outage, use `recovery-runbooks.md` (a).

## Before you start

- **One webhook per URL.** A second webhook on a URL that is already active is refused with 409 `WEBHOOK_URL_EXISTS` (`createWebhook.4`). Add triggers to the existing one instead. A store can have at most 20 webhooks (`createWebhook.5`).
- **Triggers:** use the exact event names, e.g. `token_three_ds_updated` (`createWebhook.7`). An update that sends `triggers` replaces the whole list (`updateWebhook.2`), so always send the full list.
- **Auth token:** at least 6 characters (`createWebhook.3`). Keep it in a secret store and read it from an environment variable. Webhook objects returned by create and GET contain it in plain text, so never log them (`createWebhook.8`). Sending `auth_token: null` in an update removes it (`updateWebhook.3`).
- **Store the webhook id in your config** when you create it. A switched-off webhook doesn't appear in the webhook list, so the id is how you find it again (verified live in test mode).
- **The URL must be public.** Test mode also accepted `http://localhost`, so check the URL yourself (`createWebhook.1`). Point the webhook at the final URL: a redirect stops it (`background.14`).
- **Templates to copy:** `webhook-receiver.ts` (`univapayWebhookRouter`, `processPending`, `ensureWebhookActive`, `chargesCreatedSince`), `payment-status.ts` (`settleCharge`, `settleRefund`, `settleCancel`, `settleSubscription`), `univapay-errors.ts`.

## Steps

1. **Mount the router before any global `express.json()`.** `univapayWebhookRouter` reads the raw body: it needs the exact bytes to detect duplicates.

2. **Check the password: the raw header, no `Bearer`.** The `Authorization` header is exactly the webhook's `auth_token`. There is no `Bearer ` prefix and no signature (`background.9`). The template compares the whole header in constant time (`isUnivapayAuthorization`). Only a wrong or missing password gets an error reply (401).

3. **Reply 200 within 3 seconds, then process.** A reply after 3 seconds counts as failed, and the same event is sent again (`background.11`). A 2xx in time counts as delivered (`background.13`). The template stores the event, replies 200, then processes it with `setImmediate`. Never do database-heavy work, emails or API calls before the reply.
   - Every authenticated delivery gets 200, even events you ignore. Replies of 4xx, 500, 501 or 502 are retried up to 10 times, and then the webhook is switched off (`background.15`).
   - If your event store is down, the template answers 503. Other 5xx codes and timeouts are retried but don't switch the webhook off (`background.16`).
   - Never answer with a redirect (3xx): the webhook stops at once (`background.14`).

4. **Store first, then process.** Back `EventStore` with a table that has a UNIQUE key column. `saveIfNew` must be fast: it runs before the reply. Events whose processing failed stay unprocessed. Run `processPending` on a timer and at startup to finish them.

5. **Skip duplicates without a delivery id.** The body has only `event` and `data`, with no delivery id (`background.10`). The same event can arrive more than once (`background.18`), with retries minutes apart (`background.12`).
   - The template's key is a hash of the raw body (`eventKey`). An identical re-sent delivery got 200 and was not processed again (verified live in test mode).
   - Also make the processing step idempotent: it moves each record forward only (e.g. `paid` never goes back to `waiting`). Then a duplicate in other bytes, a late event or a catch-up run changes nothing.

6. **Find your record, and ignore everything else.** Every webhook on the store gets every store event, including other apps' events (verified live in test mode). For an event you can't match, reply 200 and do nothing.
   - Charge events: `data.metadata.order_id`. The SDK's `metadata.orderId` is sent and delivered as `order_id` (verified live in test mode). Or match `data.id` with the charge id you stored.
   - Refund and cancel events: `data.charge_id`.
   - Subscription events (`subscription_*`): `data.id`. Charges made by a subscription: `data.subscription_id`.
   - Token events: `data.id` against your saved-card table.

7. **Re-read the resource by GET before acting.** Webhooks are best effort, and their bodies can be out of date (`background.19`). In a test, `subscription_suspended` arrived after the resume, when GET already said `unpaid` (verified live in test mode). So act only on a GET:

   | Event | Re-read with | Then |
   |---|---|---|
   | `charge_updated`, `charge_finished` | `settleCharge(client, storeId, id, { maxPolls: 1 })` | map with `chargeOutcome()`; only `successful` is paid (`createCharge.26`) |
   | `refund_finished` | `settleRefund(…, chargeId, refundId, { maxPolls: 1 })` | `refunds.md` |
   | `cancel_finished` | `settleCancel(…, chargeId, cancelId, { maxPolls: 1 })` | `authorize-capture.md` |
   | `subscription_*` | `client.subscriptions.getSubscription` | `subscriptions.md` |
   | `recurring_token_deleted`, `token_replaced`, `token_three_ds_updated` | `client.transactionTokens.getTransactionToken` | `saved-cards.md` |

8. **What each event means** (the recipes say what to do with it):
   - `charge_updated`: a charge became `authorized` (a hold, not paid), or `awaiting` for konbini, bank transfer or a wallet (`background.20`). It also arrived for a card charge waiting for 3-D Secure (verified live in test mode).
   - `charge_finished`: a charge reached `successful`, `failed` or `error` (`background.21`), including a konbini, bank or wallet payment that was paid or expired (`background.48`). A cancelled hold sends `cancel_finished`, not `charge_finished` (`background.21`).
   - `refund_finished` (`background.32`) and `cancel_finished` (`background.35`): final results of refunds and cancels.
   - `subscription_created`, `subscription_payment` (`background.23`, `createSubscription.43`), `subscription_failure` (`background.25`), `subscription_suspended` (also when the retries run out: `background.27`, `background.47`), `subscription_canceled` (`background.26`), `subscription_completed` (`background.24`). Resuming sends no event (`background.27`).
   - `recurring_token_deleted` (`background.33`), `token_replaced` (`background.34`), `token_three_ds_updated` (`background.37`), `bank_transfer_status_updated` (`background.22`).

9. **Keep the webhook switched on.** A stopped webhook gets nothing until it is re-enabled (`background.17`).
   - On a timer, `getWebhook` with your stored id. If `active` is false, alert someone. Fix the endpoint first, then call `ensureWebhookActive` with `{ expectedUrl: yourReceiverUrl }`. If the endpoint still fails, the webhook is switched off again.
   - Slow replies don't switch the webhook off (`background.16`), so `active` alone won't tell you about them. Log your own reply times and failures. The webhook's delivery log can't be read with a store app token: it answers 401 with an empty body (`listWebhookEvents.1`).
   - **A deleted webhook still answers GET with `active: false`, and `ensureWebhookActive` switches it back on** (verified live in test mode). When you delete a webhook on purpose, remove its id from your config first, and always pass `expectedUrl`: the template then leaves a webhook that points anywhere else alone (verified live in test mode).

10. **Catch up after any outage** with GET and list calls (`background.17`, `background.19`). UnivaPay doesn't re-send events from while the webhook was off. Follow `recovery-runbooks.md` (a).

## Traps

- **`Bearer ` expected in the header.** Every real delivery gets 401, and after 10 tries the webhook is switched off (`background.9`, `background.15`).
- **Slow replies:** work done before `res.status(200)`. Each delivery is sent again, up to 10 times (`background.11`, `background.16`).
- **No duplicate check, or a check keyed on `body.id`.** There is no delivery id (`background.10`, `background.18`).
- **Acting on the webhook body.** It can be stale or out of order. GET first (`background.19`).
- **Acting on other apps' or other orders' events.** Unknown → 200 and ignore.
- **Error replies for events you don't handle**, or 4xx/500–502 for processing errors. These switch the webhook off (`background.15`).
- **A redirect** (HTTP→HTTPS, a trailing slash) on the webhook URL (`background.14`).
- **`express.json()` before the router**: the raw body is gone, and duplicates can't be detected.
- **Logging the webhook object or the `Authorization` header** (`createWebhook.8`).
- **Re-enabling a webhook on a timer without checking that it is yours**: a deleted one comes back (step 9).
- **Waiting for UnivaPay to re-send what you missed** while the webhook was off. It doesn't (`background.17`).

## Test checklist

- Unit tests (as in `test/webhook-receiver.test.ts`):
  - the exact token → 200; `Bearer <token>`, a wrong token or no header → 401;
  - the reply comes before slow processing;
  - the same body twice → processed once, both 200;
  - a failed handler → the event stays unprocessed, and `processPending` finishes it;
  - an authenticated body that isn't `{event, data}` → 200, not processed;
  - an event for an unknown order → 200, nothing changed.
- Test-mode run, with real deliveries through a public URL:
  - `charge_finished`, `charge_updated` (konbini `awaiting`, card `authorized`), `refund_finished`, `cancel_finished` arrive and are re-read by GET;
  - replies take well under 3 s;
  - a re-sent delivery is not processed twice;
  - `Bearer` → 401;
  - switched off (`updateWebhook` with `active: false`) → `ensureWebhookActive` → on again.

## What test mode can't show

- **Live-mode deliveries.** Test them once after go-live with a small real payment (`go-live.md`).
- **The full switch-off sequence on demand.** Retries are spaced up to 15 minutes apart (`background.12`), so 10 failed deliveries take more than an hour. Switch the webhook off with `updateWebhook` to test your recovery path instead.
