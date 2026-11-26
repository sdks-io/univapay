// UnivaPay subscriptions run by UnivaPay: build plans with the RIGHT amount, preview the schedule before creating,
// pause / resume / cancel safely, and list a store's subscriptions even when the SDK can't read one of them.
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
//
// SDK 1.2.3 notes (SDK, tested: test/subscription-plan.test.ts, test/sdk-1.2.3-bugs.test.ts):
// - (SDK 1.2.3 bug N1) The SDK's period list has no `bimonthly`: sending it is refused before sending, and ONE
//   `bimonthly` subscription makes getSubscription fail and the whole listStoreSubscriptions page with it. So `Period`
//   below leaves it out, and `storeSubscriptions` falls back to the raw reply for a page the SDK can't read.
// - Create and simulate use different enum types with the same values (PlanSettingsType vs SimulationPlanSettingsType,
//   SubscriptionPeriod vs SubscriptionSimulationPeriod); `previewPlan` converts.
// - (SDK 1.2.3 bug M5) Every POST/PATCH without a key gets a new random Idempotency-Key, so pass your own on each write.
import { randomUUID } from "node:crypto";
import {
  PlanSettingsType, SimulationPlanSettingsType, SubscriptionPeriod, SubscriptionSimulationPeriod, TransactionTokenPaymentType,
  type Client, type Subscription,
} from "univapay-client-sdk";
import { readUnivapayError } from "./univapay-errors.js";

/** The periods SDK 1.2.3 can send and read. `bimonthly` is missing (SDK 1.2.3 bug N1). */
export type Period = `${SubscriptionPeriod}`;

const toPeriod = (p: Period) => p as SubscriptionPeriod;

/** Request body fields for "pay `total` in `payments` equal payments", one every `period`. */
export function fixedCountPlan(total: number, payments: number, period: Period = "monthly") {
  if (!Number.isInteger(total) || total <= 0) throw new Error("total must be a positive integer (smallest currency unit)");
  if (!Number.isInteger(payments) || payments < 2) throw new Error("payments must be an integer of at least 2");
  return { amount: total, period: toPeriod(period), subscriptionPlan: { planType: PlanSettingsType.FixedCycles, fixedCycles: payments } };
}

/** Request body fields for "pay `total`, `perPayment` each time" (the last payment may be smaller). */
export function fixedAmountPlan(total: number, perPayment: number, period: Period = "monthly") {
  if (!(perPayment > 0 && perPayment < total)) throw new Error("perPayment must be positive and lower than total");
  return { amount: total, period: toPeriod(period), subscriptionPlan: { planType: PlanSettingsType.FixedCycleAmount, fixedCycleAmount: perPayment } };
}

export type PlanFields = ReturnType<typeof fixedCountPlan> | ReturnType<typeof fixedAmountPlan>;

/** Ask UnivaPay for the schedule (nothing is created) and check it adds up to the total. Nothing is created, so a
 *  fresh key per call is fine (passing one also keeps the SDK from inventing one, SDK 1.2.3 bug M5). */
export async function previewPlan(client: Client, storeId: string, plan: PlanFields, currency = "JPY") {
  const sp = plan.subscriptionPlan;
  const { result: schedule } = await client.subscriptions.simulateStoreSubscriptionPlan(storeId, randomUUID(), {
    amount: plan.amount, currency, paymentType: TransactionTokenPaymentType.Card,
    period: plan.period as string as SubscriptionSimulationPeriod, // same values, different enum type
    subscriptionPlan: { planType: sp.planType as string as SimulationPlanSettingsType, ...("fixedCycles" in sp ? { fixedCycles: sp.fixedCycles } : { fixedCycleAmount: sp.fixedCycleAmount }) },
    scheduleSettings: { zoneId: "Asia/Tokyo" },
  });
  const amounts = (schedule ?? []).map((p) => Number(p.amount));
  const sum = amounts.reduce((a, b) => a + b, 0);
  return { amounts, sum, addsUp: sum === plan.amount };
}

export type PauseResult = { ok: true; status: string | undefined } | { ok: false; reason: string };

/** Pause. Allowed only from current or unpaid. `idempotencyKey`: e.g. idempotencyKey("update", id, "suspend", requestId). */
export async function pauseSubscription(client: Client, storeId: string, id: string, idempotencyKey: string): Promise<PauseResult> {
  try { const { result: s } = await client.subscriptions.suspendSubscription(storeId, id, idempotencyKey); return { ok: true, status: s.status }; }
  catch (e) { const f = readUnivapayError(e); if (!f) throw e; return { ok: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind }; }
}

/** Resume. Allowed only from suspended; UnivaPay returns it as `unpaid` (store that, don't assume `current`). */
export async function resumeSubscription(client: Client, storeId: string, id: string, idempotencyKey: string): Promise<PauseResult> {
  try { const { result: s } = await client.subscriptions.unsuspendSubscription(storeId, id, idempotencyKey); return { ok: true, status: s.status }; }
  catch (e) { const f = readUnivapayError(e); if (!f) throw e; return { ok: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind }; }
}

export type CancelResult = { canceled: true } | { canceled: false; reason: "first-payment-still-pending" | string };

/** Cancel for good. A 403 with no body means the first charge is still waiting (e.g. 3-D Secure or an unpaid konbini).
 *  (cancelSubscription is a DELETE: the SDK takes no Idempotency-Key for it.) */
export async function cancelSubscriptionSafely(client: Client, storeId: string, id: string): Promise<CancelResult> {
  try { await client.subscriptions.cancelSubscription(storeId, id); return { canceled: true }; }
  catch (e) {
    const f = readUnivapayError(e); if (!f) throw e;
    if (f.kind === "refused-empty-body" && f.status === 403) return { canceled: false, reason: "first-payment-still-pending" };
    return { canceled: false, reason: f.kind === "refused" ? (f.code ?? `HTTP ${f.status}`) : f.kind };
  }
}

/** The fields a repair or reconcile job needs, read from the SDK model or, for a page the SDK can't read, from the raw reply. */
export type SubscriptionRef = {
  id: string; status: string | undefined; amount: number | undefined; period: string | undefined;
  planType: string | undefined; fixedCycles: number | undefined; createdOn: string | undefined;
  /** `metadata.order_id` as sent, as text. */
  orderId: string | undefined;
  /** "raw": this page could not be read by SDK 1.2.3 (SDK 1.2.3 bug N1), so the fields come from the reply as sent. */
  readBy: "sdk" | "raw";
};

type SdkSub = Pick<Subscription, "id" | "status" | "amount" | "period" | "createdOn" | "metadata"> & { subscriptionPlan?: { planType?: string; fixedCycles?: number } };
const fromSdk = (s: SdkSub): SubscriptionRef => ({
  id: s.id!, status: s.status, amount: s.amount, period: s.period, planType: s.subscriptionPlan?.planType,
  fixedCycles: s.subscriptionPlan?.fixedCycles ?? undefined, createdOn: s.createdOn, orderId: s.metadata?.orderId, readBy: "sdk",
});
type RawSub = { id?: unknown; status?: unknown; amount?: unknown; period?: unknown; created_on?: unknown; subscription_plan?: { plan_type?: unknown; fixed_cycles?: unknown } | null; metadata?: { order_id?: unknown } | null };
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const fromRaw = (s: RawSub): SubscriptionRef => ({
  id: String(s.id), status: str(s.status), amount: num(s.amount), period: str(s.period), planType: str(s.subscription_plan?.plan_type),
  fixedCycles: num(s.subscription_plan?.fixed_cycles), createdOn: str(s.created_on),
  orderId: s.metadata?.order_id === undefined || s.metadata?.order_id === null ? undefined : String(s.metadata.order_id), readBy: "raw",
});

/** Every subscription of the store, page by page (has_more + cursor). A page that SDK 1.2.3 can't read (one
 *  `bimonthly` subscription is enough: SDK 1.2.3 bug N1) is read from the error's raw reply instead of failing the job.
 *  `search` matches metadata values (listAllSubscriptions.1). GET each one before acting: lists lag (listStoreSubscriptions.2). */
export async function* storeSubscriptions(client: Client, storeId: string, opts: { search?: string; pageSize?: number } = {}): AsyncGenerator<SubscriptionRef> {
  let cursor: string | undefined;
  for (;;) {
    let refs: SubscriptionRef[]; let hasMore: boolean;
    try {
      const { result: page } = await client.subscriptions.listStoreSubscriptions(storeId, opts.search, undefined, undefined, opts.pageSize ?? 100, cursor);
      refs = (page.items ?? []).map(fromSdk); hasMore = page.hasMore === true;
    } catch (e) {
      const f = readUnivapayError(e);
      const raw = f?.kind === "succeeded-unreadable" ? (f.rawBody as { items?: RawSub[]; has_more?: unknown } | undefined) : undefined;
      if (!raw || !Array.isArray(raw.items)) throw e;
      refs = raw.items.map(fromRaw); hasMore = raw.has_more === true;
    }
    for (const r of refs) yield r;
    if (!hasMore || refs.length === 0) return;
    cursor = refs[refs.length - 1]!.id;
  }
}
