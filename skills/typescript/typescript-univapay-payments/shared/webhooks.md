# Receive UnivaPay webhooks

The one webhook receiver every recipe uses, built on `templates/webhook-receiver.ts`: copy the template, then follow the steps. Webhooks say that something changed; a GET says what the state is now.
For a webhook that was switched off, or events missed during an outage, use `recovery-runbooks.md` (a).

## Before you start

- **One webhook per URL** (`createWebhook.4`): add triggers to the existing one instead. At most 20 active per store; switched-off and deleted ones don't count (`createWebhook.5`).
- **Triggers:** the exact event names, e.g. `token_three_ds_updated` (`createWebhook.7`). An update that sends `triggers` replaces the whole list (`updateWebhook.2`), so always send the full list.
- **Creating and changing webhooks (SDK 1.2.3 bug H3):** the SDK spells that trigger `token_three_d_s_updated`. Sending the real name is refused by the SDK before it leaves your server, and sending the SDK's spelling is refused by UnivaPay with 400 `VALIDATION_ERROR` (`createWebhook.7`). `getWebhook` and `listWebhooks` also fail on a webhook that has the real name; for `listWebhooks` one such webhook anywhere on the page is enough, even another app's (SDK, tested). So list, create, read and change webhooks with `listWebhooksRaw`, `createWebhookRaw`, `getWebhookRaw` and `updateWebhookRaw` from `webhook-receiver.ts`: plain HTTPS calls with the same credentials, `auth = { secretKey, jwtToken }`.
- **Auth token:** at least 6 characters (`createWebhook.3`), kept in a secret store and read from an environment variable. Webhook objects contain it in plain text, so never log them (`createWebhook.8`). `auth_token: null` in an update removes it (`updateWebhook.3`).
- **Store the webhook id in your config** when you create it. The default webhook list leaves switched-off and deleted webhooks out (`listWebhooks.2`); only `active=inactive` or `all` lists them (`listWebhooks.1`), and the SDK can't send those values because its `active` filter is typed boolean (SDK 1.2.3 bug S7). So keep the id and GET it.
- **The URL must be public.** Test mode also accepts `http://localhost`, so check the URL yourself (`createWebhook.1`). Use the final URL: a redirect stops the webhook (`background.14`).
- **Templates to copy:** `webhook-receiver.ts`, `payment-status.ts`, `univapay-errors.ts`.

## Steps

1. **Mount the router before any global `express.json()`.** `univapayWebhookRouter` needs the raw bytes to detect duplicates.

2. **Check the password: the raw header, no `Bearer`.** The `Authorization` header is exactly the webhook's `auth_token`, with no prefix and no signature (`background.9`). The template compares the whole header in constant time (`isUnivapayAuthorization`). Only a wrong or missing password gets an error reply (401).

3. **Reply 200 within 3 seconds, then process** (`background.11`, `background.13`). The template stores the event, replies 200, then processes it with `setImmediate`. No database-heavy work, emails or API calls before the reply.
   - Every authenticated delivery gets 200, even events you ignore: 4xx and 500–502 replies switch the webhook off after retries (`background.15`).
   - If your event store is down, the template answers 503: retried, but it doesn't switch the webhook off (`background.16`).
   - Never answer with a redirect (`background.14`).

4. **Store first, then process.** Back `EventStore` with a table that has a UNIQUE key column; `saveIfNew` must be fast. Failed events stay unprocessed: run `processPending` on a timer and at startup.

5. **Skip duplicates without a delivery id.** There is no delivery id (`background.10`), and the same event can arrive more than once, minutes apart (`background.18`, `background.12`).
   - The template's key is a hash of the raw body (`eventKey`): an identical re-sent delivery gets 200 and is not processed again.
   - Make processing idempotent too: move each record forward only (e.g. `paid` never goes back to `waiting`), so a duplicate in other bytes, a late event or a catch-up run changes nothing.

6. **Find your record, and ignore everything else.** Events from other apps on the same store can reach your webhook too (`background.76`): ignore what isn't yours. For an event you can't match, reply 200 and do nothing.
   - Do this by switching on the raw `event` string, as the template does. Don't use the SDK's webhook handlers (`ChargeHandler`, `TokenHandler`, …): they need `id` and `created_on` in the body, which real deliveries don't have, so every real delivery comes out as an unknown event (SDK 1.2.3 bug M1). Their `isXxxEvent()` guards check only the shape, so several are true for one event, e.g. a `subscription_payment` is also "created", "failure" and "canceled" (SDK 1.2.3 bug S6).
   - Charge events: `data.metadata.order_id` in the raw body (`background.20`, `background.21`); the SDK's `metadata.orderId` is sent as `order_id` (SDK, tested). Or match `data.id` with the charge id you stored.
   - Refund and cancel events: `data.charge_id`. Subscription events: `data.id`; charges made by a subscription: `data.subscription_id`. Token events: `data.id` against your saved-card table.

7. **Re-read the resource by GET before acting.** Bodies can be stale or out of order, e.g. `subscription_suspended` after the subscription was already resumed (`background.19`, `background.75`). Act only on a GET:

   | Event | Re-read with | Then |
   |---|---|---|
   | `charge_updated`, `charge_finished` | `settleCharge(client, storeId, id, { maxPolls: 1 })` | map with `chargeOutcome()`; only `successful` is paid (`createCharge.26`) |
   | `refund_finished` | `settleRefund(…, chargeId, refundId, { maxPolls: 1 })` | `refunds.md` |
   | `cancel_finished` | `settleCancel(…, chargeId, cancelId, { maxPolls: 1 })` | `authorize-capture.md` |
   | `subscription_*` | `client.subscriptions.getSubscription(storeId, id)` | `subscriptions.md` |
   | `recurring_token_deleted`, `token_replaced`, `token_three_ds_updated` | `client.transactionTokens.getTransactionToken(storeId, id)` | `saved-cards.md` |

8. **What each event means** (the recipes say what to do with it):
   - `charge_updated`: a charge became `authorized` (a hold, not paid), or `awaiting`: konbini, bank transfer, a wallet, or a card charge waiting for 3-D Secure (`background.20`).
   - `charge_finished`: a charge reached `successful`, `failed` or `error` (`background.21`), including a konbini, bank or wallet payment that was paid or expired (`background.48`). A cancelled hold sends `cancel_finished`, not `charge_finished` (`background.21`).
   - `refund_finished` (`background.32`), `cancel_finished` (`background.35`): final results.
   - `subscription_created`, `subscription_payment` (`background.23`, `createSubscription.43`), `subscription_failure` (`background.25`), `subscription_suspended` (also when retries run out: `background.27`, `background.47`), `subscription_canceled` (`background.26`), `subscription_completed` (`background.24`). Resuming sends no event (`background.27`).
   - `recurring_token_deleted` (`background.33`), `token_replaced` (`background.34`), `token_three_ds_updated` (`background.37`), `bank_transfer_status_updated` (`background.22`).

9. **Keep the webhook switched on.** A stopped webhook gets nothing until re-enabled (`background.17`).
   - On a timer, `getWebhookRaw(auth, storeId, id)` with your stored id. If `active` is false, alert someone, fix the endpoint, then call `ensureWebhookActive(auth, storeId, id, { expectedUrl: yourReceiverUrl })`.
   - Slow replies don't switch the webhook off (`background.16`), so log your own reply times and failures. The delivery log answers 401 with an empty body to a store app token (`listWebhookEvents.1`).
   - **A deleted webhook still reads `active: false`, and switching it on brings it back** (`deleteWebhook.1`, `updateWebhook.5`). When you delete one on purpose, remove its id from your config first, and always pass `expectedUrl`: the template then leaves a webhook that points anywhere else alone.

10. **Catch up after any outage** with GET and list calls: UnivaPay doesn't re-send what was missed (`background.17`, `background.19`).
    - Run `processPending`; find charges of open orders with `chargesCreatedSince` (match its `orderId`), then GET each one: lists lag (`listAllCharges.5`). Full procedure: `recovery-runbooks.md` (a).
    - Always send `metadata.order_id` as a string. One charge with a number in `order_id` (e.g. made by another system) makes the SDK fail to read that charge and the whole `listStoreCharges` page (SDK 1.2.3 bug H1); a value outside the SDK's lists does the same (SDK 1.2.3 bug N1). `chargesCreatedSince` then reads that page from the raw reply, so the catch-up still sees every charge.

## Traps

- **`Bearer ` expected in the header.** Every real delivery gets 401, and the webhook is switched off (`background.9`, `background.15`).
- **Slow replies:** work done before `res.status(200)` (`background.11`, `background.16`).
- **No duplicate check, or one keyed on `body.id`** (`background.10`, `background.18`).
- **Acting on the webhook body** instead of a GET (`background.19`).
- **Acting on other apps' or other orders' events.** Unknown → 200 and ignore (`background.76`).
- **The SDK's webhook handlers or their `isXxxEvent()` guards:** real deliveries come out as unknown events (SDK 1.2.3 bug M1), and the guards match several events at once (SDK 1.2.3 bug S6). Switch on the raw `event`.
- **A webhook created with the SDK and the trigger `token_three_ds_updated`:** refused one way or the other (SDK 1.2.3 bug H3) (SDK, tested). Use `createWebhookRaw`.
- **Webhooks listed with the SDK's `listWebhooks`:** it fails as soon as one listed webhook has `token_three_ds_updated` (SDK 1.2.3 bug H3) (SDK, tested). Use `listWebhooksRaw`.
- **Error replies for events you don't handle**, or 4xx/500–502 for processing errors (`background.15`).
- **A redirect** (HTTP→HTTPS, a trailing slash) on the webhook URL (`background.14`).
- **`express.json()` before the router**: the raw body is gone.
- **Logging the webhook object or the `Authorization` header** (`createWebhook.8`).
- **Re-enabling a webhook on a timer without checking that it is yours**: a deleted one comes back (step 9).
- **Waiting for UnivaPay to re-send what you missed** (`background.17`).

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
  - switched off (`updateWebhookRaw` with `active: false`) → `ensureWebhookActive` → on again.

## What test mode can't show

- **Live-mode deliveries.** Test them once after go-live with a small real payment (`go-live.md`).
- **The full switch-off sequence on demand.** Retries are spaced up to 15 minutes apart (`background.12`), so 10 failed deliveries take more than an hour. Switch the webhook off with `updateWebhookRaw(auth, storeId, id, { active: false }, key)` to test your recovery path instead.
