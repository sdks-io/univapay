// Charge a saved card (recurring token) from the server, and hand the customer to 3-D Secure when the bank asks.
//
// Rules this encodes (see `business-rules/`):
// - A charge on a recurring token whose 3-D Secure is enabled but not completed (never authenticated, or failed) is
//   accepted with three_ds.mode `normal` and becomes `awaiting`: the customer must verify (createCharge.42,
//   createCharge.45, createCharge.66). So a "one-tap" charge can need the customer after all.
// - The verification hand-off comes from GET …/charges/{id}/three_ds/issuer_token while the charge is `awaiting`:
//   call_method http_post, a content type, an issuer_token URL and a payload to POST there (getChargeThreeDsIssuerToken.2).
//   Not available for a charge that isn't awaiting 3-D Secure (getChargeThreeDsIssuerToken.1). In an iframe it can be
//   blocked; a full-page redirect is safer (getChargeThreeDsIssuerToken.3).
// - A charge awaiting 3-D Secure can't be cancelled (createCancel.5).
// - `three_ds.mode: skip` needs the secret and an account option enabled by UnivaPay (createCharge.43); don't assume it.
// - Two charges for the same amount on the same card within 30 s can be refused as CHARGE_TOO_QUICK (createCharge.37);
//   use one Idempotency-Key per order (idempotency.ts) so a double tap is the same request, not a second charge.
import type { ChargeCreateRequestThreeDsMode, Client, TokenResponseCardData } from "univapay-client-sdk";
import { settleCharge, type ChargeOutcome } from "./payment-status.js";

export type SavedCardCharge = {
  storeId: string;
  /** The customer's OWN saved recurring token, looked up on the server from the signed-in customer, never from the client. */
  tokenId: string;
  /** From YOUR order on the server, in the smallest unit. */
  amount: number;
  currency?: string;
  /** From idempotency.ts: idempotencyKey("charge", order.id, order.amount, order.attempt). Required: without it the SDK
   *  sends a new random key on every call, so a retry is a second charge (SDK 1.2.3 bug M5). */
  idempotencyKey: string;
  /** Send it every time: left out, the store's default applies (createCharge.42). `skip` only if UnivaPay enabled it (createCharge.43). */
  threeDsMode?: `${ChargeCreateRequestThreeDsMode}`;
  /** Where the customer comes back after 3-D Secure (your page). */
  threeDsReturnUrl?: string;
  /** `orderId` must be text: a number can't be sent, and one charge with a number in order_id breaks reading it and
   *  the whole charge-list page it is on (SDK 1.2.3 bug H1). */
  metadata?: { orderId?: string };
};

export type ThreeDsHandOff = { method: "POST"; url: string; contentType: string; fields: Record<string, string> };

export type SavedCardResult =
  | { outcome: "paid" | "failed" | "canceled" | "needs-attention" | "processing" | "held"; chargeId: string }
  | { outcome: "needs-3ds"; chargeId: string; handOff: ThreeDsHandOff }
  | { outcome: "waiting-for-customer"; chargeId: string };

/** Create the charge, wait for it to settle, and if it waits for 3-D Secure return the hand-off for the browser. */
export async function chargeSavedCard(client: Client, req: SavedCardCharge): Promise<SavedCardResult> {
  const threeDs = {
    ...(req.threeDsReturnUrl ? { redirectEndpoint: req.threeDsReturnUrl } : {}),
    ...(req.threeDsMode ? { mode: req.threeDsMode as ChargeCreateRequestThreeDsMode } : {}),
  };
  const { result: created } = await client.charges.createCharge(req.idempotencyKey, {
    transactionTokenId: req.tokenId, amount: req.amount, currency: req.currency ?? "JPY",
    ...(Object.keys(threeDs).length ? { threeDs } : {}),
    ...(req.metadata ? { metadata: req.metadata } : {}),
  });
  const { charge, outcome } = await settleCharge(client, req.storeId, created.id!);
  if (outcome !== "waiting-for-customer") return { outcome: outcome as Exclude<ChargeOutcome, "waiting-for-customer">, chargeId: charge.id! };
  // `awaiting` on a card charge = 3-D Secure. Fetch the hand-off.
  const { result: it } = await client.charges.getChargeThreeDsIssuerToken(req.storeId, charge.id!);
  return { outcome: "needs-3ds", chargeId: charge.id!, handOff: { method: "POST", url: it.issuerToken, contentType: it.contentType, fields: payloadToWireFields(it.payload) } };
}

/** Rebuild the form fields with the names the issuer expects. The SDK renames `request_data` to `requestData`, keeps
 *  `sSpcd`, `sCptok` and `sTerkn` as they are, and puts every other field in `additionalProperties` (wire names)
 *  (SDK 1.2.3 bug S5) (SDK, tested: test/charge-saved-card.test.ts). */
export function payloadToWireFields(payload: { requestData?: string; sSpcd?: string; sCptok?: string; sTerkn?: string; additionalProperties?: Record<string, unknown> } | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!payload) return out;
  const put = (k: string, v: unknown) => { if (v !== null && v !== undefined) out[k] = typeof v === "string" ? v : JSON.stringify(v); };
  put("request_data", payload.requestData); put("sSpcd", payload.sSpcd); put("sCptok", payload.sCptok); put("sTerkn", payload.sTerkn);
  for (const [k, v] of Object.entries(payload.additionalProperties ?? {})) put(k, v);
  return out;
}

/** An HTML page that auto-submits the 3-D Secure hand-off (a full-page POST, not an iframe). Values are HTML-escaped. */
export function threeDsHandOffPage(h: ThreeDsHandOff): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inputs = Object.entries(h.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Verifying your card…</title><form id="f" method="post" action="${esc(h.url)}" enctype="application/x-www-form-urlencoded">${inputs}<noscript><button>Continue</button></noscript></form><script>document.getElementById("f").submit()</script>`;
}

/** After the customer returns from 3-D Secure: re-read the charge (never trust the return URL alone). */
export async function afterThreeDs(client: Client, storeId: string, chargeId: string) {
  return settleCharge(client, storeId, chargeId);
}

/** The card part of a token read with getTransactionToken (brand, last four, `threeDs.enabled` / `threeDs.status`).
 *  The SDK types `data` as a union of every payment type's data and `paymentType` as a plain string, so a check on
 *  `paymentType` doesn't narrow it by itself (SDK, tested: strict tsc). Undefined for a token that isn't a card. */
export function cardTokenData(token: { paymentType?: string; data?: unknown }): TokenResponseCardData | undefined {
  return token.paymentType === "card" ? (token.data as TokenResponseCardData | undefined) : undefined;
}
