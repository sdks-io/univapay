// UnivaPay payment links (the hosted "link form"): build the link on the server, and verify the resulting charge.
//
// Sources: the link-form guide (docs: guide/implement/link, link/param-basic). A link is
//   https://checkout.univapay.com/forms/<the store's form id>?appId=<app token>&amount=…&currency=…
// with lowerCamelCase parameters sent as a plain GET (no quotes). The form id is in the console:
// store → payment form tab → link form settings → URL code.
//
// Why the verification step matters:
// - Anyone holding the link can edit its query string, including `amount`. So never trust the link: when a payment
//   arrives, check the charge's amount, currency and status against YOUR order.
// - The docs warn not to decide the result from the redirect page (the customer sees and can fake it). Decide from a
//   GET of the charge, or from a webhook re-read with a GET (see webhook-receiver.ts and payment-status.ts).
// - Only `successful` means paid (createCharge.26); konbini / bank transfer from a link stay `awaiting` until the
//   customer pays (createCharge.31).
import type { Client } from "univapay-client-sdk";
import { chargeOutcome, type ChargeOutcome } from "./payment-status.js";

export type LinkPaymentMethod = "card" | "konbini" | "bank_transfer" | "pay_pay_online" | "paidy" | "we_chat_online" | "alipay_online" | "alipay_plus_online" | "d_barai_online";

export type PaymentLinkInput = {
  /** The store's link-form id (console: store → payment form → link form settings → URL code). */
  formId: string;
  /** The store's application token (the public JWT the widget also uses). Never put the secret in a link. */
  appId: string;
  /** Amount in the smallest unit (JPY: yen). */
  amount: number;
  currency?: string;
  paymentMethods?: LinkPaymentMethod[];
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  /** Pre-fill the customer's email (shown filled in on the form). */
  emailAddress?: string;
  /** Your order reference, always text. Sent as `order_id`: it arrives on the charge as metadata `order_id`
   *  (createCharge.99) (SDK: `charge.metadata.orderId`) and on the success/failure redirect as `order_id`. */
  orderId?: string;
  /** Other metadata, sent as plain `key=value` parameters (the console's URL-code builder adds metadata the same way). */
  extra?: Record<string, string>;
};

/** Build the link URL. Values are URL-encoded; a single payment method uses the `paymentMethods[]` form the docs require. */
export function buildPaymentLink(input: PaymentLinkInput): string {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("amount must be a positive integer in the smallest currency unit");
  if (input.appId.includes(".") && input.appId.split(".").length > 3) throw new Error("appId looks like secret.jwt: never put the secret in a link");
  const q = new URLSearchParams();
  q.set("appId", input.appId);
  q.set("amount", String(input.amount));
  if (input.currency) q.set("currency", input.currency.toLowerCase());
  const pm = input.paymentMethods ?? [];
  if (pm.length === 1) q.set("paymentMethods[]", pm[0]!); else if (pm.length > 1) q.set("paymentMethods", pm.join(","));
  if (input.successRedirectUrl) q.set("successRedirectUrl", input.successRedirectUrl);
  if (input.failureRedirectUrl) q.set("failureRedirectUrl", input.failureRedirectUrl);
  if (input.emailAddress) q.set("emailAddress", input.emailAddress);
  if (input.orderId) q.set("order_id", input.orderId);
  for (const [k, v] of Object.entries(input.extra ?? {})) q.set(k, v);
  return `https://checkout.univapay.com/forms/${encodeURIComponent(input.formId)}?${q.toString()}`;
}

export type OrderToMatch = { amount: number; currency: string };
export type LinkPaymentCheck = { outcome: ChargeOutcome; matchesOrder: boolean; problems: string[] };

/** Read the charge from UnivaPay (never from the redirect) and check it really pays THIS order. Mark paid only if
 *  outcome === "paid" && matchesOrder. */
export async function checkLinkPayment(client: Client, storeId: string, chargeId: string, order: OrderToMatch): Promise<LinkPaymentCheck> {
  const ch = (await client.charges.getCharge(storeId, chargeId)).result;
  const problems: string[] = [];
  if (ch.requestedAmount !== order.amount) problems.push(`amount ${String(ch.requestedAmount)} ≠ order ${order.amount}`);
  if ((ch.requestedCurrency ?? "").toUpperCase() !== order.currency.toUpperCase()) problems.push(`currency ${String(ch.requestedCurrency)} ≠ order ${order.currency}`);
  return { outcome: chargeOutcome(ch.status), matchesOrder: problems.length === 0, problems };
}
