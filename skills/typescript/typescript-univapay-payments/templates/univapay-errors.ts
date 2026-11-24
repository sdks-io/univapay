// UnivaPay error reader: turn any failure from the `univapay-public-api` SDK into one plain, typed outcome.
//
// Why this exists (each line is a business rule in `business-rules/`, cited by id):
// - A refused request carries `code` plus `errors[].field` / `errors[].reason`; a validation failure is
//   `VALIDATION_ERROR` with the real reason in `errors[]` (every-request.11, createCharge.20, createCharge.41).
// - Some refusals come with an EMPTY body (getCurrentMerchant.1, cancelSubscription.3, getSubscriptionLatestCharge.1,
//   disableTokenThreeDs.1, every-request.18 for 429). The SDK reports those as a DecodeError that still carries the status.
// - A 2xx whose body the SDK can't read means the action DID happen on UnivaPay's side: reconcile with a GET or a list
//   instead of repeating the call without the same Idempotency-Key (every-request.21).
// - 429 and 502/503/504 are temporary (every-request.16, every-request.18, getCharge.3, every-request.14).
// - A failed charge's `error.code` is a number, e.g. 309 (getCharge.7).
import { ApiError, ConnectionError, DecodeError, EncodeError, TimeoutError } from "univapay-public-api";

export type UnivapayErrorDetail = { field?: string; reason?: string };

export type UnivapayFailure =
  /** UnivaPay answered with an error status and a readable body. */
  | { kind: "refused"; status: number; code: string | null; details: UnivapayErrorDetail[]; temporary: boolean }
  /** UnivaPay answered with an error status and NO body (the status is still known). */
  | { kind: "refused-empty-body"; status: number; temporary: boolean }
  /** UnivaPay answered 2xx, so the action happened, but the reply could not be read. Reconcile; don't blindly repeat. */
  | { kind: "succeeded-unreadable"; status: number; detail: string }
  /** No answer arrived (network or timeout). A write may or may not have happened: retry ONLY with the same Idempotency-Key. */
  | { kind: "no-answer"; cause: "connection" | "timeout"; detail: string }
  /** The SDK refused to send the request (a value didn't match its type). Nothing reached UnivaPay. */
  | { kind: "not-sent"; detail: string };

const TEMPORARY_STATUS = new Set([429, 502, 503, 504]);
const TEMPORARY_CODES = new Set(["SERVICE_UNAVAILABLE_TRY_AGAIN"]);

function bodyOf(err: ApiError): unknown {
  const p = err.payload as { kind: string; body?: unknown; rawBody?: ArrayBuffer };
  if (p.kind !== "undeclared") return p.body;
  if (!p.rawBody || p.rawBody.byteLength === 0) return undefined;
  try { return JSON.parse(new TextDecoder().decode(p.rawBody)); } catch { return undefined; }
}

/** Read any thrown value from an SDK call. Returns null when it is not a UnivaPay SDK failure (rethrow those). */
export function readUnivapayError(err: unknown): UnivapayFailure | null {
  if (err instanceof ApiError) {
    const body = bodyOf(err) as { code?: unknown; errors?: unknown } | undefined;
    const code = typeof body?.code === "string" ? body.code : null;
    const details = Array.isArray(body?.errors)
      ? (body.errors as unknown[]).filter((d): d is UnivapayErrorDetail => typeof d === "object" && d !== null)
          .map((d) => ({ ...(typeof d.field === "string" ? { field: d.field } : {}), ...(typeof d.reason === "string" ? { reason: d.reason } : {}) }))
      : [];
    if (body === undefined) return { kind: "refused-empty-body", status: err.status, temporary: TEMPORARY_STATUS.has(err.status) };
    return { kind: "refused", status: err.status, code, details, temporary: TEMPORARY_STATUS.has(err.status) || (code !== null && TEMPORARY_CODES.has(code)) };
  }
  if (err instanceof DecodeError) {
    if (err.status >= 200 && err.status < 300) return { kind: "succeeded-unreadable", status: err.status, detail: err.message };
    // An error status whose body is empty (or not JSON) arrives as a DecodeError.
    return { kind: "refused-empty-body", status: err.status, temporary: TEMPORARY_STATUS.has(err.status) };
  }
  if (err instanceof ConnectionError) return { kind: "no-answer", cause: "connection", detail: err.message };
  if (err instanceof TimeoutError) return { kind: "no-answer", cause: "timeout", detail: err.message };
  if (err instanceof EncodeError) return { kind: "not-sent", detail: err.message };
  return null;
}

/** True when the failure names this code or this `errors[].reason` (e.g. "CAPTURE_ONLY_FOR_CARD_PAYMENT"). */
export function hasReason(f: UnivapayFailure, codeOrReason: string): boolean {
  return f.kind === "refused" && (f.code === codeOrReason || f.details.some((d) => d.reason === codeOrReason));
}

/** One line for logs or staff screens: status, code and every field/reason. Never includes request data. */
export function describeUnivapayFailure(f: UnivapayFailure): string {
  switch (f.kind) {
    case "refused": {
      const d = f.details.map((x) => [x.field, x.reason].filter(Boolean).join(": ")).join("; ");
      return `UnivaPay refused the request (HTTP ${f.status}${f.code ? ` ${f.code}` : ""}${d ? `: ${d}` : ""})${f.temporary ? "; temporary, try again later" : ""}`;
    }
    case "refused-empty-body": return `UnivaPay refused the request (HTTP ${f.status}, no details given)${f.temporary ? "; temporary, try again later" : ""}`;
    case "succeeded-unreadable": return `UnivaPay accepted the request (HTTP ${f.status}) but the reply could not be read; check the resource before retrying`;
    case "no-answer": return `No answer from UnivaPay (${f.cause}); the outcome is unknown`;
    case "not-sent": return `Request not sent: ${f.detail}`;
  }
}

/** A failed charge's payment error code, read as a number (e.g. 309). Null when there is none. */
export function chargeErrorCode(charge: { error?: { code?: number | string | null } | null }): number | null {
  const c = charge.error?.code;
  if (c === null || c === undefined) return null;
  const n = typeof c === "number" ? c : Number(c);
  return Number.isFinite(n) ? n : null;
}
