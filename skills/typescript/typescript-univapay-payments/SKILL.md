---
name: "typescript-univapay-payments"
description: "Use for ANY work on UnivaPay payment code in a TypeScript/Node app (`univapay-public-api` SDK): building it, fixing a bug, debugging a failing call or webhook, or reviewing existing code. Covers the checkout widget, payment links, holds and capture, refunds, subscriptions and \"pay in N\" plans, saved cards, 3-D Secure, konbini, bank transfer and PayPay, webhooks, outage recovery and going live. Typical fixes: a webhook that gets 401 or was switched off, a charge stuck in awaiting, a wrong subscription amount, a refused refund. Gives the job → recipe map, a review checklist, tested templates and the business-rule ids for each step. Works with typescript-integrate-univapay-public-api (SDK workflow, contract sheet); this skill says WHAT to build. TypeScript/JavaScript only."
---

# UnivaPay payments: recipes, checks and templates

The payments layer on top of `typescript-integrate-univapay-public-api`, whose workflow still applies (plan file, contract sheet, SDK map). It says what to build for each payment job, in what order, and which business rules govern each step.

## The hard rule: open the business rules

**Before you build, fix or review any UnivaPay code, open `<plugin-root>/business-rules/` for every operation involved** (the plugin root holds `skills/`): `rules.md` (the index), `every-request.md`, `background.md` for webhooks, renewals or retries, and the `operations/` section of each operation the code calls.

- The rules say how UnivaPay behaves; this skill says what to build. Follow each cited rule id for the detail.
- `(SDK, tested)` marks a fact about the SDK, not the API, checked against the SDK version this skill is built on.
- If a recipe line and a rule seem to disagree, say so and quote both.

## Job → recipe

Pick every recipe the request touches.

| The user wants to… | Read |
|---|---|
| take a one-off payment on their own site (widget or inline form) | `recipes/checkout-widget.md` |
| send a link the customer pays on UnivaPay's page | `recipes/payment-links.md` |
| hold a card payment, then capture or cancel it | `recipes/authorize-capture.md` |
| refund a paid order, fully or partly | `recipes/refunds.md` |
| charge on a schedule: plans, "pay ¥X in N", pause, resume, cancel | `recipes/subscriptions.md` |
| save a card and charge it later from the server | `recipes/saved-cards.md` |
| run 3-D Secure on a server charge | `recipes/three-ds-server-charges.md` |
| take konbini, bank transfer or PayPay by API | `recipes/konbini-bank-paypay-api.md` |
| receive webhooks (every recipe) | `shared/webhooks.md` |
| go live | `shared/go-live.md` |
| repair damage: switched-off webhook, missed events, wrong subscriptions, stuck orders | `shared/recovery-runbooks.md` |

The recipe's steps become the plan's scope and the contract sheet's operations: put each step's rule ids on the row of the function that implements it, and count a field a step requires (e.g. `metadata: { orderId }`, `threeDs.mode`) as required.

## Fixing and reviewing

1. **Start with `shared/review-checklist.md`**: every section the code touches, "Check these first" above all.
2. **Open the rules** for every operation the code calls. For an error, search `business-rules/` for the error code, payment error number or `errors[].field`.
3. **Fix from the rule's "Do:" and the matching recipe step**, not from memory. Name the rule id (or checklist line) for every finding or fix.
4. **If data is already wrong**, finish with `shared/recovery-runbooks.md`.

## Templates (`templates/`)

Type-checked (`tsc --strict`), unit-tested and run in test mode. Each recipe lists the ones it needs.

- **Copy the template files a step needs into the project (a file copy); don't read them whole.** Copy only the files that step needs.
- Read a template only for the function you are adapting. Every SDK call in it still gets a contract-sheet row.

| Template | For |
|---|---|
| `webhook-receiver.ts` | the receiver, `processPending`, `ensureWebhookActive`, `chargesCreatedSince` |
| `payment-status.ts` | status → outcome maps; bounded waits (`settleCharge`, …) |
| `univapay-errors.ts` | every SDK error shape in one typed result; `chargeErrorCode` |
| `idempotency.ts` | one `idempotencyKey` per business action; safe retries |
| `payment-link.ts` | `buildPaymentLink`; `checkLinkPayment` (any charge vs the order) |
| `subscription-plan.ts` | "pay in N" plans, schedule preview, safe pause, resume, cancel |
| `charge-saved-card.ts` | saved-card charge and 3-D Secure hand-off |

## What test mode can't show

Each recipe ends with its own list; `shared/go-live.md` has them all, with rule ids. Say plainly which ones your work could not test, and how the user can check them after launch.
