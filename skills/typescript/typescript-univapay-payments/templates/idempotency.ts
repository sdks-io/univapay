// UnivaPay duplicate-charge guard: one stable Idempotency-Key per business action, and safe retries with it.
//
// Rules this encodes (see `business-rules/`):
// - A repeated POST/PATCH with the same Idempotency-Key within 24 h is NOT executed again; the first result comes
//   back (every-request.20, every-request.21). Even with a DIFFERENT body, the first stored result is returned and no
//   error is raised (updateCharge.1), so the key must change when the action really changes (e.g. a new amount).
// - After 24 h the key expires and the request runs again (every-request.22): re-check the resource before resending late.
// - The same key on a different resource or operation is refused with IDEMPOTENCY_KEY_CONFLICT (every-request.23).
// - When you pass no `idempotencyKey`, the SDK sends NO key for calls that take one (createCharge, createRefund, …),
//   so an app-level retry runs the write again and can charge twice. Always pass `idempotencyKey`.
//   (Calls without that field, e.g. deleteTransactionToken, get a new random key each time.) (SDK, tested)
// - Capture and cancel IGNORE the key (captureCharge.16, createCancel.14): a repeat with the same
//   key is refused (ALREADY_CAPTURED, CANCEL_NOT_ALLOWED), not replayed. Stop double clicks in your app, and on those
//   errors re-read the charge: it was probably done by the first click.
// - A replayed refund returns the FIRST reply (still `pending` even after it succeeded): read the status with a GET
//   (createRefund.23).
import { createHash } from "node:crypto";
import { readUnivapayError, type UnivapayFailure } from "./univapay-errors.js";

export type IdempotentAction = "charge" | "capture" | "cancel" | "refund" | "subscription" | "token" | "update";

/**
 * A deterministic key for one business action, e.g. idempotencyKey("charge", order.id, order.amount).
 * Same inputs → same key, so a double click, a retry or a crash-and-resume reuses it.
 * Put everything that makes the action different into `parts` (the amount, a partial-refund number, an attempt
 * number you increase on purpose for a genuinely new attempt).
 */
export function idempotencyKey(action: IdempotentAction, ...parts: (string | number)[]): string {
  const h = createHash("sha256").update([action, ...parts.map(String)].join("\u001f")).digest("hex");
  // Formatted like a UUID (version nibble 5, RFC 4122 variant) for readability in logs.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export type RetryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; failure: UnivapayFailure; attempts: number };

/**
 * Run a write with ONE key, retrying only when it is safe: no answer arrived, or UnivaPay said "temporary"
 * (429 / 502 / 503 / 504). Stops at once on a refusal, and on "succeeded-unreadable" (the action happened: re-read it).
 * `call` receives the key and must pass it as `idempotencyKey`.
 */
export async function withIdempotentRetry<T>(key: string, call: (idempotencyKey: string) => Promise<T>, opts: { attempts?: number; delayMs?: number } = {}): Promise<RetryResult<T>> {
  const max = opts.attempts ?? 3;
  let last: UnivapayFailure | null = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    try { return { ok: true, value: await call(key), attempts: attempt }; }
    catch (e) {
      const f = readUnivapayError(e); if (f === null) throw e; last = f;
      const retryable = f.kind === "no-answer" || ((f.kind === "refused" || f.kind === "refused-empty-body") && f.temporary);
      if (!retryable || attempt === max) return { ok: false, failure: f, attempts: attempt };
      await new Promise((r) => setTimeout(r, (opts.delayMs ?? 1000) * attempt));
    }
  }
  return { ok: false, failure: last!, attempts: max };
}
