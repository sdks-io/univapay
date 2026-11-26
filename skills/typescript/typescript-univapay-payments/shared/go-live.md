# Go live: from test mode to live mode

Use this when an app that works in test mode is about to take real payments. It covers the keys, the widget's domains, the live webhook, what test mode never showed, and a final checklist.

## Keys and app tokens per mode

- **The app token decides the mode.** A test-mode app token makes test requests. Real payments need a live-mode app token from the console (`every-request.31`). Live mode is refused with 400 `LIVE_MODE_NOT_ENABLED_WHEN_UNVERIFIED` until UnivaPay has finished reviewing the account (`every-request.32`).
- **Nothing carries over between modes.** A transaction token can only be charged with an app token of the mode that created it: otherwise 400 `PROCESSING_MODE_MISMATCH` (`createCharge.14`, `createCharge.59`).
  - Saved cards and subscriptions made in test mode don't work in live mode. Customers save their cards again in live mode.
  - Don't copy test token ids into live data.
- **Two places, as in test mode.** The server sends `Bearer {secret}.{jwt}` on every call (`every-request.1`). The browser gets only the app token, for the widget. The app token alone from a server is refused (`getCheckoutInfo.1`). A lost secret means making a new app token (`every-request.5`).
- **Config per environment:** the server's app token and secret, the browser's app token, the webhook id and auth token, the link form id (test and live link forms differ: `payment-links.md`), and the expected mode. Keep them in environment variables or a secret store, never in code.
- **The widget's allowed domains are inside the app token** (`createTransactionToken.51`): the JWT payload has a `domains` list, set in the console when the token is made, and the widget won't open on a host that isn't in it.
  - List every host your checkout runs on. Wildcard forms are untested.
  - Making a new token with the domains on it works; editing an existing token's list is untested. After any change, check the payload of the token text you deploy.
  - The browser and the server may use different app tokens of the same store: one with your site's domains for the widget, one with its secret for the server (`every-request.33`).
  - Calls with the app token alone are accepted only from UnivaPay's own widget and link-form pages. From any other origin they get 403 with an empty body, even an origin listed in the token's `domains`; with no origin they get 401 `INVALID_DOMAIN` (`getCheckoutInfo.5`, `getCheckoutInfo.1`, `every-request.2`). So your own pages never call the API with the app token: the widget makes its calls from its own frame, and your server uses `{secret}.{jwt}`.
- **Check the mode and the domains at startup**, so a wrong key fails at deploy and not at checkout:
  - `(await client.checkout.getCheckoutInfo()).result.mode` with the server client; it must equal your config's mode (`getCheckoutInfo.2`).
  - Decode the browser app token's payload and check that your site's host is in its `domains` (`createTransactionToken.51`).
- **Base URL:** `https://api.univapay.com` in both modes (`every-request.9`).

## Webhooks for live

- **Create the live webhook** on your final production HTTPS URL with a new auth token, as in `webhooks.md` (Before you start), and store its id. Test mode accepts `http://localhost`, so a webhook that "worked" in test mode proves nothing about your live URL (`createWebhook.1`).
- **Ignore the other mode's events.** Whether a store's webhook receives events from both modes is untested. Your handler already re-reads each resource by GET, and charges and subscriptions carry `mode` (`test` or `live`): compare it with your environment's mode and ignore the rest.
- **Switch on the monitoring job from day one:** the `active` check and your own reply-time and failure logs (`webhooks.md` step 9). Know where the catch-up runbook is (`recovery-runbooks.md` (a)).
- **After launch,** make one small real payment and check that the webhook arrives, the order is paid from a GET, and your logs show the reply in under 3 seconds (`background.11`).

## Ask UnivaPay, or check the console, before launch

Test mode allows things your live account may not. Confirm each one:
- **Methods enabled.** Konbini disabled gives `CONVENIENCE_PROCESSING_DISABLED` (`createCharge.68`). Test mode accepts every currency; live mode doesn't (`createCharge.35`).
- **Holds:** partial capture (`captureCharge.4`) and authorization support (`createCharge.25`).
- **Refunds:** enabled (`createRefund.9`), partial refunds by method in live mode (`createRefund.14`), `refund_percent_limit` (`createRefund.1`).
- **Saved cards:** recurring tokens allowed (`createTransactionToken.13`), `usage_limit` rules (`createTransactionToken.14`), `three_ds.mode: skip` enabled if you use it (`createCharge.43`).
- **3-D Secure** set up for your merchant (`createCharge.51`, `createCharge.28`).
- **Subscriptions:** the retry count and the status after failed retries (`background.62`, `background.63`).
- **Konbini and bank:** the default payment deadline (`createTransactionToken.25`).
- **Emails UnivaPay sends to customers,** so yours don't duplicate them: `createCharge.15`, `createCharge.16`, `createCharge.17`, `createCharge.18`, `background.43`, `createSubscription.1`, `suspendSubscription.1`.

## What test mode can't show (from the recipes)

Plan a check for each in live mode, or cover it with unit tests:
- **Real konbini and bank payments.** Test mode completes konbini by itself (`background.50`), and bank transfer only for the exact amount when the issuer token is fetched (`getChargeIssuerToken.5`). Deadlines passing (`background.51`, `background.54`), short payments (`background.53`) and overpayments (`background.52`) need live payments.
- **PayPay's real page and its 5-minute limit** (`background.49`). The test issuer token is a dummy (`getChargeIssuerToken.3`).
- **`CHARGE_TOO_QUICK` and payment error 311.** Test mode lets repeat charges through (`createCharge.36`, `createCharge.37`). Unit-test those branches.
- **Real 3-D Secure screens and frictionless passes** (`createCharge.40`). Test mode shows UnivaPay's test page.
- **Partial refunds and their live rules** (`createRefund.14`), failed refunds (`createRefund.18`), and slow overseas card refunds (`createRefund.21`).
- **Acquirer lag:** some acquirers finish minutes later (`createCharge.19`). Hold expiry after 25 days, from January 2027 (`background.39`).
- **Later subscription charges, retries and the end of a fixed plan** happen on billing dates (`background.46`, `background.62`, `background.24`).
- **The live IP block:** 10 failed payments in a row from one IP block it for 12 hours (`createCharge.88`).
- **The widget on your production domain, and the live link form's settings.** Check both with the live tokens before launch.

## Final checklist

- [ ] Live app token(s) and secret in the production secret store; test keys absent from production config.
- [ ] Startup check: `getCheckoutInfo().mode === "live"`, and the browser token's `domains` match the site's host.
- [ ] The widget opens on the production domain; the live link form id is configured (if you use links).
- [ ] Live webhook created with a new auth token; its id and token are in config; triggers cover every recipe you use.
- [ ] Receiver: raw `Authorization` compare, 200 within 3 s, store-then-process, duplicates skipped, GET before acting, unknown and other-mode events ignored (`webhooks.md`).
- [ ] Monitoring: webhook `active` check, reply-time and failure logs, `processPending` timer, catch-up runbook known.
- [ ] Every write passes your own `idempotencyKey` (`templates/idempotency.ts`; SDK 1.2.3 bug M5).
- [ ] `univapay-client-sdk` pinned to exactly 1.2.3 with a lockfile; the app starts the way it was tested (`tsx` or CommonJS `require`: SDK 1.2.3 bug N2); request and response body logging off (SDK 1.2.3 bug M10).
- [ ] Amounts come from the server's order; only the signed-in customer's own saved card is charged.
- [ ] Fixed-count plans built with `fixedCountPlan` and checked with `previewPlan`.
- [ ] Konbini, bank and PayPay customers see how to pay (number, slip, account, deadline).
- [ ] Refund paths branch on the payment method; konbini and bank refunds are done outside UnivaPay.
- [ ] Account options confirmed with UnivaPay (section above); customer email templates don't duplicate UnivaPay's.
- [ ] `review-checklist.md` run over the whole codebase.
- [ ] One small real payment after launch: webhook received, order paid from a GET, then refunded or cancelled.
