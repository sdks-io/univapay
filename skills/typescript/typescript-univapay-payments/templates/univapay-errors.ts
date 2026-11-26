// UnivaPay error reader: turn any failure from UnivaPay's SDK (`univapay-client-sdk` 1.2.3) into one plain, typed outcome.
//
// Why this exists (each line is a business rule in `business-rules/`, cited by id):
// - A refused request carries `code` plus `errors[].field` / `errors[].reason`; a validation failure is
//   `VALIDATION_ERROR` with the real reason in `errors[]` (every-request.11, createCharge.20, createCharge.41).
// - Some refusals come with an EMPTY body (getCurrentMerchant.1, cancelSubscription.3, getSubscriptionLatestCharge.1,
//   disableTokenThreeDs.1, every-request.18 for 429). The SDK still gives the status (`statusCode`) and `body: ""`.
// - A 2xx whose body the SDK can't read means the action DID happen on UnivaPay's side: reconcile with a GET or a list
//   instead of repeating the call without the same Idempotency-Key (every-request.21).
// - 429 and 502/503/504 are temporary (every-request.16, every-request.18, getCharge.3, every-request.14).
// - A failed charge's `error.code` is a number, e.g. 309 (getCharge.7).
//
// How the SDK reports failures (SDK, tested: test/univapay-errors.test.ts):
// - An error status → `ApiError` (`ExternalApiError` is a subclass). Always read `statusCode` and the raw text in `body`.
//   (SDK 1.2.3 bug M2/L2) Which class you get depends on the operation and the status: createSubscription,
//   listStoreSubscriptions and listAllSubscriptions, and every 409, 429 and 5xx, throw a plain `ApiError` whose `result`
//   is undefined even when the body is JSON. So this reader parses `body` itself and never relies on `result`.
// - A 2xx the SDK can't map → `ResponseValidationError` (`statusCode`, raw `body`, `errors[]` with the wire path and value).
//   (SDK 1.2.3 bug N1) Every enum is closed: ONE value outside the SDK's list (e.g. a `bimonthly` subscription) fails the
//   whole reply, a whole list page included. (SDK 1.2.3 bug H1) A number in `metadata.order_id` does the same.
//   (SDK 1.2.3 bug M9) So does a token whose `payment_type` the SDK doesn't know. `problems` names the cause.
// - A 2xx with an empty or non-JSON body where JSON was expected → a plain `Error` ("Could not parse body as JSON…")
//   with no status at all.
// - Nothing sent (a value didn't match the SDK's types) → `ArgumentsValidationError`. (SDK 1.2.3 bug N6) Its `message`
//   repeats the value you passed, card number and CVV included: never log `err.message` or `String(err)` for it.
//   `readUnivapayError` keeps only the argument, the path and the reason (`safeArgumentsDetail`).
// - No answer → an axios error (`isAxiosError: true`), `code` ECONNABORTED on a timeout, e.g. ECONNRESET on a drop.
import { ApiError, ArgumentsValidationError, ResponseValidationError } from "univapay-client-sdk";

export type UnivapayErrorDetail = { field?: string; reason?: string };

/** Why the SDK could not read a 2xx reply. `path` is in API (wire) names, e.g. "metadata.order_id" (on a list page, with "items" and the position in front). */
export type ReplyProblem = {
  path: string;
  /** "unknown-value": a value outside the SDK's closed list (SDK 1.2.3 bug N1).
   *  "number-order-id": `metadata.order_id` is a number (SDK 1.2.3 bug H1).
   *  "unknown-payment-type": a token whose `payment_type` the SDK doesn't know (SDK 1.2.3 bug M9). */
  kind: "unknown-value" | "number-order-id" | "unknown-payment-type" | "other";
  /** The value at `path` (for "unknown-payment-type": the payment_type). */
  value?: unknown;
};

export type UnivapayFailure =
  /** UnivaPay answered with an error status and a readable body. */
  | { kind: "refused"; status: number; code: string | null; details: UnivapayErrorDetail[]; temporary: boolean }
  /** UnivaPay answered with an error status and NO body (the status is still known). */
  | { kind: "refused-empty-body"; status: number; temporary: boolean }
  /** UnivaPay answered 2xx, so a write happened, but the SDK could not read the reply. Reconcile; don't blindly repeat.
   *  For a read, the data exists but this SDK version can't map it: see `problems`. `rawBody` is the reply as JSON
   *  (API names), or undefined when the body was empty or not JSON; `status` is null when the SDK gave none. */
  | { kind: "succeeded-unreadable"; status: number | null; detail: string; problems: ReplyProblem[]; rawBody: unknown }
  /** No answer arrived (network or timeout). A write may or may not have happened: retry ONLY with the same Idempotency-Key. */
  | { kind: "no-answer"; cause: "connection" | "timeout"; detail: string }
  /** The SDK refused to send the request (a value didn't match its type). Nothing reached UnivaPay. */
  | { kind: "not-sent"; detail: string };

const TEMPORARY_STATUS = new Set([429, 502, 503, 504]);
const TEMPORARY_CODES = new Set(["SERVICE_UNAVAILABLE_TRY_AGAIN"]);
const KNOWN_TOKEN_TYPES = new Set(["card", "konbini", "online", "bank_transfer", "paidy", "qr_scan", "qr_merchant"]);

function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Classify each schema error of a ResponseValidationError (SDK 1.2.3 bugs N1, H1, M9). */
function replyProblems(err: ResponseValidationError): ReplyProblem[] {
  return (err.errors ?? []).map((e) => {
    const path = e.path.join(".");
    const last = e.path[e.path.length - 1];
    const v = e.value as { payment_type?: unknown } | null;
    if (last === "order_id" && typeof e.value === "number") return { path, kind: "number-order-id", value: e.value };
    if (typeof e.type === "string" && e.type.includes("Enum<") && typeof e.value === "string") return { path, kind: "unknown-value", value: e.value };
    if (v !== null && typeof v === "object" && typeof v.payment_type === "string" && !KNOWN_TOKEN_TYPES.has(v.payment_type))
      return { path: path ? `${path}.payment_type` : "payment_type", kind: "unknown-payment-type", value: v.payment_type };
    return { path, kind: "other" };
  });
}

/** (SDK 1.2.3 bug N6) What was refused, without the value: "<argument> at <path>: <reason>" per problem. The SDK's
 *  message continues with "Given value: …" (the whole value, e.g. a card number and CVV); that part is dropped, and any
 *  run of 6 or more digits left is masked as well. */
export function safeArgumentsDetail(err: ArgumentsValidationError): string {
  const parts: string[] = [];
  for (const [arg, errs] of Object.entries(err.errors ?? {})) {
    for (const e of errs) {
      const reason = String(e.message ?? "").split(/\n\s*Given value:/)[0]!.replace(/\s+/g, " ").trim().replace(/\d{6,}/g, "[digits]");
      parts.push(`${arg}${e.path.length ? ` at ${e.path.join(".")}` : ""}: ${reason || "invalid"}`);
    }
  }
  return parts.join("; ") || "an argument failed the SDK's checks";
}

/** Read any thrown value from an SDK call. Returns null when it is not a UnivaPay SDK failure (rethrow those). */
export function readUnivapayError(err: unknown): UnivapayFailure | null {
  // `UnivapayHttpError` comes from the plain HTTPS webhook calls in webhook-receiver.ts (SDK 1.2.3 bug H3).
  const isHttpError = err instanceof Error && err.name === "UnivapayHttpError" && typeof (err as { statusCode?: unknown }).statusCode === "number";
  if (err instanceof ApiError || isHttpError) {
    const e = err as unknown as { statusCode: number; body: unknown; result?: unknown };
    // (SDK 1.2.3 bug M2/L2) `result` is undefined for plain ApiError even with a JSON body: read `body` instead.
    const parsed = parseJson(e.body) ?? (e.result);
    const body = parsed as { code?: unknown; errors?: unknown } | undefined;
    const temporaryStatus = TEMPORARY_STATUS.has(e.statusCode);
    if (body === undefined || body === null || typeof body !== "object") return { kind: "refused-empty-body", status: e.statusCode, temporary: temporaryStatus };
    const code = typeof body.code === "string" ? body.code : null;
    const details = Array.isArray(body.errors)
      ? (body.errors as unknown[]).filter((d): d is UnivapayErrorDetail => typeof d === "object" && d !== null)
          .map((d) => ({ ...(typeof d.field === "string" ? { field: d.field } : {}), ...(typeof d.reason === "string" ? { reason: d.reason } : {}) }))
      : [];
    return { kind: "refused", status: e.statusCode, code, details, temporary: temporaryStatus || (code !== null && TEMPORARY_CODES.has(code)) };
  }
  if (err instanceof ResponseValidationError) {
    return { kind: "succeeded-unreadable", status: err.statusCode, detail: "the reply did not match the SDK's types", problems: replyProblems(err), rawBody: parseJson(err.body) };
  }
  if (err instanceof ArgumentsValidationError) return { kind: "not-sent", detail: safeArgumentsDetail(err) };
  const ax = err as { isAxiosError?: unknown; code?: unknown; message?: unknown; response?: unknown };
  if (ax !== null && typeof ax === "object" && ax.isAxiosError === true && ax.response === undefined) {
    const timeout = ax.code === "ECONNABORTED" || ax.code === "ETIMEDOUT";
    return { kind: "no-answer", cause: timeout ? "timeout" : "connection", detail: `${String(ax.code ?? "")} ${String(ax.message ?? "")}`.trim() };
  }
  // No answer to a plain HTTPS call (webhook-receiver.ts): fetch throws TypeError "fetch failed", or a TimeoutError.
  if (err instanceof Error && (err.name === "TimeoutError" || (err instanceof TypeError && err.message === "fetch failed"))) {
    return { kind: "no-answer", cause: err.name === "TimeoutError" ? "timeout" : "connection", detail: err.message };
  }
  // A 2xx whose body was empty or not JSON where the SDK expected JSON: a plain Error, no status.
  if (err instanceof Error && err.message.startsWith("Could not parse body as JSON")) {
    return { kind: "succeeded-unreadable", status: null, detail: err.message.split("\n")[0]!, problems: [], rawBody: undefined };
  }
  return null;
}

/** True when the failure names this code or this `errors[].reason` (e.g. "CAPTURE_ONLY_FOR_CARD_PAYMENT"). */
export function hasReason(f: UnivapayFailure, codeOrReason: string): boolean {
  return f.kind === "refused" && (f.code === codeOrReason || f.details.some((d) => d.reason === codeOrReason));
}

/** One line per problem, tagged with the SDK bug id so it is easy to search for in logs. */
export function describeReplyProblem(p: ReplyProblem): string {
  switch (p.kind) {
    case "unknown-value": return `${p.path} is "${String(p.value)}", a value SDK 1.2.3 doesn't know (SDK 1.2.3 bug N1)`;
    case "number-order-id": return `${p.path} is a number, SDK 1.2.3 needs text (SDK 1.2.3 bug H1)`;
    case "unknown-payment-type": return `${p.path} is "${String(p.value)}", a token type SDK 1.2.3 doesn't know (SDK 1.2.3 bug M9)`;
    case "other": return `${p.path || "(whole reply)"} doesn't match SDK 1.2.3's types`;
  }
}

/** One line for logs or staff screens: status, code and every field/reason. Never includes request data. */
export function describeUnivapayFailure(f: UnivapayFailure): string {
  switch (f.kind) {
    case "refused": {
      const d = f.details.map((x) => [x.field, x.reason].filter(Boolean).join(": ")).join("; ");
      return `UnivaPay refused the request (HTTP ${f.status}${f.code ? ` ${f.code}` : ""}${d ? `: ${d}` : ""})${f.temporary ? "; temporary, try again later" : ""}`;
    }
    case "refused-empty-body": return `UnivaPay refused the request (HTTP ${f.status}, no details given)${f.temporary ? "; temporary, try again later" : ""}`;
    case "succeeded-unreadable": {
      const why = f.problems.length ? `: ${f.problems.map(describeReplyProblem).join("; ")}` : "";
      return `UnivaPay answered${f.status !== null ? ` (HTTP ${f.status})` : ""} but the SDK could not read the reply${why}; if it was a write, it happened: check the resource before retrying`;
    }
    case "no-answer": return `No answer from UnivaPay (${f.cause}); the outcome is unknown`;
    case "not-sent": return `Request not sent: ${f.detail.split("\n")[0]}`;
  }
}

/** A failed charge's payment error code, read as a number (e.g. 309). Null when there is none. */
export function chargeErrorCode(charge: { error?: { code?: number | string | null } | null }): number | null {
  const c = charge.error?.code;
  if (c === null || c === undefined) return null;
  const n = typeof c === "number" ? c : Number(c);
  return Number.isFinite(n) ? n : null;
}
