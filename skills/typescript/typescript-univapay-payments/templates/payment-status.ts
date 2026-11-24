// UnivaPay payment status: turn a charge / refund / cancel / subscription status into what the app should do,
// and wait for the final answer the right way (server-side long polling, bounded).
//
// Rules this encodes (see `business-rules/`):
// - A charge is processed asynchronously: it starts `pending` (createCharge.26). Only `successful` means paid.
// - `authorized` is a hold, not a payment (createCharge.21, captureCharge.1).
// - `awaiting` means the customer still has to act (konbini, bank transfer, wallet, 3-D Secure) and can last days
//   (createCharge.31, background.20); don't wait for it in a request; show instructions and rely on webhooks or re-checks.
// - `error` is abnormal and may still change later (getCharge.11): don't treat it as a final failure.
// - Refunds and cancels go `pending` → `successful` / `failed` / `error` (createRefund.3).
// - `polling=true` makes UnivaPay hold the GET until the status changes or about 3 s pass (getCharge.1, getCharge.2,
//   getCharge.5); loop a bounded number of times instead of sleeping.
// - A new subscription is `unverified` until its first charge completes (createSubscription.41).
import type { UnivapayPublicApiClient } from "univapay-public-api";

export type ChargeOutcome = "paid" | "held" | "waiting-for-customer" | "processing" | "failed" | "canceled" | "needs-attention";
export type RefundOutcome = "refunded" | "processing" | "failed" | "needs-attention";
export type CancelOutcome = "canceled" | "processing" | "failed" | "needs-attention";
export type SubscriptionOutcome = "active" | "starting" | "first-payment-failed" | "payment-retrying" | "paused" | "canceled" | "completed" | "unknown";

export function chargeOutcome(status: string | undefined): ChargeOutcome {
  switch (status) {
    case "successful": return "paid";
    case "authorized": return "held";
    case "awaiting": return "waiting-for-customer";
    case "pending": return "processing";
    case "failed": return "failed";
    case "canceled": return "canceled";
    default: return "needs-attention"; // "error" (may still change) or a status this code doesn't know
  }
}

export function refundOutcome(status: string | undefined): RefundOutcome {
  return status === "successful" ? "refunded" : status === "pending" ? "processing" : status === "failed" ? "failed" : "needs-attention";
}

export function cancelOutcome(status: string | undefined): CancelOutcome {
  return status === "successful" ? "canceled" : status === "pending" ? "processing" : status === "failed" ? "failed" : "needs-attention";
}

export function subscriptionOutcome(status: string | undefined): SubscriptionOutcome {
  switch (status) {
    case "current": return "active";
    case "unverified": return "starting";
    case "unconfirmed": return "first-payment-failed";
    case "unpaid": return "payment-retrying";
    case "suspended": return "paused";
    case "canceled": return "canceled";
    case "completed": return "completed";
    default: return "unknown";
  }
}

export type WaitOptions = { maxPolls?: number };

/** Re-read a charge with server-side polling until it leaves `pending` (at most `maxPolls` reads, default 5 ≈ 15 s). */
export async function settleCharge(client: UnivapayPublicApiClient, storeId: string, chargeId: string, opts: WaitOptions = {}) {
  let charge = await client.charges.getCharge({ storeId, id: chargeId, polling: true });
  for (let i = 1; i < (opts.maxPolls ?? 5) && chargeOutcome(charge.status) === "processing"; i++)
    charge = await client.charges.getCharge({ storeId, id: chargeId, polling: true });
  return { charge, outcome: chargeOutcome(charge.status) };
}

/** Re-read a refund until it leaves `pending` (bounded). */
export async function settleRefund(client: UnivapayPublicApiClient, storeId: string, chargeId: string, refundId: string, opts: WaitOptions = {}) {
  let refund = await client.refunds.getRefund({ storeId, chargeId, id: refundId, polling: true });
  for (let i = 1; i < (opts.maxPolls ?? 5) && refundOutcome(refund.status) === "processing"; i++)
    refund = await client.refunds.getRefund({ storeId, chargeId, id: refundId, polling: true });
  return { refund, outcome: refundOutcome(refund.status) };
}

/** Re-read a cancel until it leaves `pending` (bounded). */
export async function settleCancel(client: UnivapayPublicApiClient, storeId: string, chargeId: string, cancelId: string, opts: WaitOptions = {}) {
  let cancel = await client.cancels.getCancel({ storeId, chargeId, id: cancelId, polling: true });
  for (let i = 1; i < (opts.maxPolls ?? 5) && cancelOutcome(cancel.status) === "processing"; i++)
    cancel = await client.cancels.getCancel({ storeId, chargeId, id: cancelId, polling: true });
  return { cancel, outcome: cancelOutcome(cancel.status) };
}

/** Re-read a subscription until it leaves `unverified` (bounded). */
export async function settleSubscription(client: UnivapayPublicApiClient, storeId: string, subscriptionId: string, opts: WaitOptions = {}) {
  let sub = await client.subscriptions.getSubscription({ storeId, id: subscriptionId, polling: true });
  for (let i = 1; i < (opts.maxPolls ?? 5) && subscriptionOutcome(sub.status) === "starting"; i++)
    sub = await client.subscriptions.getSubscription({ storeId, id: subscriptionId, polling: true });
  return { subscription: sub, outcome: subscriptionOutcome(sub.status) };
}
