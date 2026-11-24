---
name: "typescript-univapay-payments"
description: "UnivaPay payment flows for a TypeScript/Node app built on the `univapay-public-api` SDK: checkout with the widget or inline form, payment links, holds with capture or cancel, refunds, subscriptions and \"pay in N\" plans, saved cards, 3-D Secure on server charges, konbini, bank transfer and PayPay by API, webhooks, recovery after an outage, and going live. Load it when a user wants to take, hold, refund or repeat a payment through UnivaPay, AND when fixing, debugging or reviewing existing UnivaPay code (a webhook that gets 401 or was switched off, a charge stuck in awaiting, a wrong subscription amount, a refused refund). It gives the job → recipe map, the review checklist, tested templates and the business-rule ids for each step. It does not replace typescript-integrate-univapay-public-api (the SDK workflow and contract sheet); it says WHAT to build and in which order. TypeScript/JavaScript only."
---

# UnivaPay payments: recipes, checks and templates for a Node/TypeScript app

This skill is the payments layer on top of `typescript-integrate-univapay-public-api`. That skill's workflow still applies (plan file, contract sheet, lookups in the SDK map). This one says what to build for each payment job, in what order, and which business rules govern each step.

## What it builds

The server side of UnivaPay payments: the routes that create orders and charges, the webhook receiver, status checks, refunds, subscriptions and saved-card charges. The browser only shows UnivaPay's widget, inline form, link form or 3-D Secure page; the server sets every amount and decides "paid".

## The hard rule: open the business rules

**Before you build, fix or review any UnivaPay code, open `<plugin-root>/business-rules/` for every operation involved** (the plugin root is the folder that holds `skills/`). Read `rules.md` (the index), `every-request.md`, `background.md` when webhooks, renewals or retries are involved, and the `operations/` section of each operation the code calls.

- The rules say what UnivaPay does. The recipes and guides here never restate a behaviour without its rule id, so follow the id to the rule when you need the detail.
- Where a recipe line says "verified live in test mode", the behaviour was seen in test mode but has no rule yet.
- If a recipe line and a rule seem to disagree, say so in your answer and quote both.

## Job → recipe

Pick every recipe the request touches. Each recipe has: before you start, steps in order, traps, a test checklist, and what test mode can't show.

| The user wants to… | Recipe |
|---|---|
| take a one-off payment on their own site (widget popup or inline card form; card, konbini and other methods) | `recipes/checkout-widget.md` |
| send a link the customer pays on UnivaPay's hosted page (invoice, chat, QR code) | `recipes/payment-links.md` |
| hold a card payment and capture it later (all or part), or cancel the hold | `recipes/authorize-capture.md` |
| refund a paid order, fully or partly, by payment method | `recipes/refunds.md` |
| charge on a schedule: monthly plans, "pay ¥X in N payments", pause, resume, cancel | `recipes/subscriptions.md` |
| save a customer's card and charge it later from the server | `recipes/saved-cards.md` |
| run 3-D Secure on a charge the server makes (saved card, the bank asks to verify) | `recipes/three-ds-server-charges.md` |
| take konbini, bank-transfer or PayPay payments by API on their own pages | `recipes/konbini-bank-paypay-api.md` |
| receive webhooks (every recipe needs this) | `shared/webhooks.md` |
| move from test mode to live mode | `shared/go-live.md` |
| repair damage already done: a switched-off webhook, missed events, wrong subscriptions, orders in the wrong state | `shared/recovery-runbooks.md` |

How to use a recipe with the integrate skill: the recipe's steps, in order, become the plan's scope, and the plan names the recipe each part comes from. The operations those steps call are the in-scope operations of the contract sheet; write each step's rule ids on the row of the function that implements it. A field a recipe step requires (for example `metadata: { orderId }` on a charge, or an explicit `threeDs.mode`) counts as required on the sheet's OPTIONAL FIELDS table: name the recipe and step there.

## Fixing and reviewing

For a bug report, a failing call, or "review this code":

1. **Start with `shared/review-checklist.md`.** Go through every section the code touches; its "Check these first" section lists the mistakes reviews miss most (webhook `Bearer` check, a slow webhook reply, konbini and bank-transfer refunds, the "pay in N" amount, 3-D Secure on saved-card charges).
2. **Then open the rules** for every operation the code calls (the hard rule above). For an error, search `business-rules/` for the error code, the payment error number, or the field name in `errors[].field`.
3. **Fix from the rule's "Do:" and the matching recipe step**, not from memory. Name the rule id (or the checklist line) for every finding or fix.
4. **If data is already wrong** (missed events, wrong subscriptions, orders stuck), finish with `shared/recovery-runbooks.md`.

## Templates (`templates/`)

TypeScript built on the real SDK, each type-checked under `tsc --strict`, unit-tested and run in test mode. Copy them into the project and adapt the storage; the recipes say which ones each job needs. Every SDK call in them still gets a contract-sheet row.

| Template | What it is for |
|---|---|
| `webhook-receiver.ts` | Express receiver: raw `Authorization` compare, store, reply fast, then process; duplicate detection; `processPending`; `ensureWebhookActive`; `chargesCreatedSince` for catch-up |
| `payment-status.ts` | map a charge, refund, cancel or subscription status to what the app does (`chargeOutcome`, …), and wait for the final status with a bounded poll (`settleCharge`, …) |
| `univapay-errors.ts` | read every error shape the SDK can throw (including empty-body replies) into one typed result; `chargeErrorCode` for a failed charge |
| `idempotency.ts` | one stable `idempotencyKey` per business action, and safe retries with it |
| `payment-link.ts` | build a payment link on the server (`buildPaymentLink`), and check the paid charge against the order (`checkLinkPayment`; works for any charge) |
| `subscription-plan.ts` | build "pay in N" plans with the right amount (`fixedCountPlan`, `fixedAmountPlan`), preview the schedule (`previewPlan`), pause, resume and cancel safely |
| `charge-saved-card.ts` | charge a saved card and hand the customer to 3-D Secure when the bank asks (`chargeSavedCard`, `threeDsHandOffPage`, `afterThreeDs`) |

## Shared guides (`shared/`)

- `webhooks.md`: the one webhook receiver every recipe uses, step by step.
- `review-checklist.md`: the silent mistakes to look for, each with its rule id. For reviews, fixes and debugging.
- `recovery-runbooks.md`: (a) a webhook switched off and the events missed; (b) subscriptions created with the wrong amount; (c) orders left in the wrong state after a bug.
- `go-live.md`: keys and modes, the widget's domains, the live webhook, what to confirm with UnivaPay, and a final checklist.

## What test mode can't show

Each recipe ends with its own list. The main ones (details and rule ids in `shared/go-live.md`):

- a real konbini or bank payment arriving, a short payment, an overpayment or a deadline passing (`background.50`, `getChargeIssuerToken.5`, `background.51`, `background.52`, `background.53`);
- PayPay's real page and its time limit (`background.49`, `getChargeIssuerToken.3`);
- `CHARGE_TOO_QUICK` and payment error 311 on repeat charges (`createCharge.36`, `createCharge.37`): cover these branches with unit tests;
- a real bank's 3-D Secure screen (`createCharge.40`);
- live-mode refund rules and failed refunds (`createRefund.14`, `createRefund.18`);
- later subscription charges, retries and the end of a fixed plan (`background.46`, `background.62`, `background.24`);
- a hold expiring (`background.39`);
- the widget on the production domain, and the live link form's settings.

Say plainly in your answer which of these your work could not test, and how the user can check them after launch.
