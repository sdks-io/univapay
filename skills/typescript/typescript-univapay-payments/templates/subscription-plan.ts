// UnivaPay subscriptions run by UnivaPay: build plans with the RIGHT amount, preview the schedule before creating,
// and pause / resume / cancel safely.
//
// Rules this encodes (see `business-rules/`):
// - A fixed-count plan (`subscription_plan.plan_type: fixed_cycles`): `amount` is the TOTAL, divided by the number of
//   cycles (createSubscription.24): ¥30,000 in 3 payments is amount 30000, not 10000 (sending 10000 charged ¥3,333).
// - `fixed_cycle_amount`: amount is the total, fixed_cycle_amount is each payment, and must be lower (createSubscription.23).
// - The first charge counts as one of the fixed payments (background.61).
// - `installment_plan` is card-company installments, a different product (createSubscription.22); don't use it for "pay in 3".
// - `simulate_plan` returns the schedule without creating anything (simulateSubscriptionPlan.1); fixed_cycles must be
//   at least 2 (simulateSubscriptionPlan.3); both plans at once is refused (simulateSubscriptionPlan.2).
// - The amount of a fixed-count plan can't be changed afterwards (updateSubscription.7).
// - Suspend only from current/unpaid (suspendSubscription.2); resume only from suspended (unsuspendSubscription.1) and it
//   comes back as `unpaid`, not `current` (unsuspendSubscription.2).
// - DELETE (cancel) returns 204 with no body (cancelSubscription.1) and is refused with 403 and an empty body while the
//   first charge is still waiting (cancelSubscription.3).
import type { UnivapayPublicApiClient } from "univapay-public-api";
import { readUnivapayError } from "./univapay-errors.js";

export type Period = "daily" | "weekly" | "biweekly" | "monthly" | "bimonthly" | "quarterly" | "semiannually" | "annually";

/** Request body fields for "pay `total` in `payments` equal payments", one every `period`. */
export function fixedCountPlan(total: number, payments: number, period: Period = "monthly") {
  if (!Number.isInteger(total) || total <= 0) throw new Error("total must be a positive integer (smallest currency unit)");
  if (!Number.isInteger(payments) || payments < 2) throw new Error("payments must be an integer of at least 2");
  return { amount: total, period, subscriptionPlan: { planType: "fixed_cycles" as const, fixedCycles: payments } };
}

/** Request body fields for "pay `total`, `perPayment` each time" (the last payment may be smaller). */
export function fixedAmountPlan(total: number, perPayment: number, period: Period = "monthly") {
  if (!(perPayment > 0 && perPayment < total)) throw new Error("perPayment must be positive and lower than total");
  return { amount: total, period, subscriptionPlan: { planType: "fixed_cycle_amount" as const, fixedCycleAmount: perPayment } };
}

type PlanFields = ReturnType<typeof fixedCountPlan> | ReturnType<typeof fixedAmountPlan>;

/** Ask UnivaPay for the schedule (nothing is created) and check it adds up to the total. */
export async function previewPlan(client: UnivapayPublicApiClient, storeId: string, plan: PlanFields, currency = "JPY", paymentType: "card" = "card") {
  const schedule = await client.subscriptions.simulateStoreSubscriptionPlan({ storeId, body: { ...plan, currency, paymentType, scheduleSettings: { zoneId: "Asia/Tokyo" } } });
  const amounts = (schedule ?? []).map((p) => Number(p.amount));
  const sum = amounts.reduce((a, b) => a + b, 0);
  return { amounts, sum, addsUp: sum === plan.amount };
}

export type PauseResult = { ok: true; status: string | undefined } | { ok: false; reason: string };

/** Pause. Allowed only from current or unpaid. */
export async function pauseSubscription(client: UnivapayPublicApiClient, storeId: string, id: string): Promise<PauseResult> {
  try { const s = await client.subscriptions.suspendSubscription({ storeId, subscriptionId: id }); return { ok: true, status: s.status }; }
  catch (e) { const f = readUnivapayError(e); if (!f) throw e; return { ok: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind }; }
}

/** Resume. Allowed only from suspended; UnivaPay returns it as `unpaid` (store that, don't assume `current`). */
export async function resumeSubscription(client: UnivapayPublicApiClient, storeId: string, id: string): Promise<PauseResult> {
  try { const s = await client.subscriptions.unsuspendSubscription({ storeId, subscriptionId: id }); return { ok: true, status: s.status }; }
  catch (e) { const f = readUnivapayError(e); if (!f) throw e; return { ok: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind }; }
}

export type CancelResult = { canceled: true } | { canceled: false; reason: "first-payment-still-pending" | string };

/** Cancel for good. A 403 with no body means the first charge is still waiting (e.g. 3-D Secure or an unpaid konbini). */
export async function cancelSubscriptionSafely(client: UnivapayPublicApiClient, storeId: string, id: string): Promise<CancelResult> {
  try { await client.subscriptions.cancelSubscription({ storeId, id }); return { canceled: true }; }
  catch (e) {
    const f = readUnivapayError(e); if (!f) throw e;
    if (f.kind === "refused-empty-body" && f.status === 403) return { canceled: false, reason: "first-payment-still-pending" };
    return { canceled: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind };
  }
}
