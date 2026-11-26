// UnivaPay webhook receiver for Express: authenticate, store, reply fast, then process; plus recovery helpers.
//
// Rules this encodes (see `business-rules/`):
// - The `Authorization` header is EXACTLY the webhook's auth_token: no "Bearer " prefix, no signature (background.9).
// - The body has only `event` and `data`: there is no delivery id (background.10), and the same event can arrive more
//   than once (background.18). So duplicates are detected from the body itself (a hash of the raw bytes).
// - Reply 2xx within 3 seconds or the delivery counts as failed and is sent again (background.11, background.13).
// - A 3xx stops the webhook at once (background.14); 4xx/500/501/502 replies are retried up to 10 times and then the
//   webhook is switched off (background.15); timeouts alone don't switch it off (background.16). So: only a wrong
//   password gets an error reply; everything authenticated gets 200, even events the app ignores.
// - A stopped webhook stays stopped until re-enabled (background.17): `ensureWebhookActive` turns it back on.
// - Webhooks are best effort (background.19): re-read the resource with a GET before acting, and catch up with GET/list
//   calls after an outage (`chargesCreatedSince`, or re-read each order still waiting).
//
// SDK 1.2.3 notes (SDK, tested: test/webhook-receiver.test.ts, test/sdk-1.2.3-bugs.test.ts):
// - (SDK 1.2.3 bug M1) The SDK's webhook handlers (ChargeHandler, TokenHandler, …) need `id` and `created_on` in the
//   body, which real deliveries don't have, so every real delivery parses as an UnknownEvent. Don't use them: this
//   receiver reads the raw JSON, and your `handle` switches on the `event` string.
// - (SDK 1.2.3 bug S6) The handlers' `isXxxEvent()` guards check the shape only, so several are true for one event
//   (a `subscription_payment` is also "created", "failure", "canceled", …). Don't use them either.
// - (SDK 1.2.3 bug H3) The SDK spells the trigger `token_three_ds_updated` as `token_three_d_s_updated`: createWebhook
//   with the real name is refused before sending, and getWebhook and listWebhooks fail on any webhook (or list page) that has it. So the webhook
//   calls below (`listWebhooksRaw`, `createWebhookRaw`, `getWebhookRaw`, `updateWebhookRaw`, `ensureWebhookActive`) send plain HTTPS
//   requests with the same secret and app token as the SDK client.
// - (SDK 1.2.3 bugs H1, N1) One charge with a number in `metadata.order_id`, or with a value outside the SDK's lists,
//   makes the SDK fail the whole listStoreCharges page; `chargesCreatedSince` then reads that page from the raw reply.
import express, { type Router } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Charge, Client } from "univapay-client-sdk";
import { readUnivapayError } from "./univapay-errors.js";

export type UnivapayEvent = { event: string; data: Record<string, unknown> };
export type StoredEvent = { key: string; event: UnivapayEvent; receivedAt: string; processedAt?: string; error?: string };

/** Durable storage for received events. In production, back this with a table that has a UNIQUE key column. */
export interface EventStore {
  /** Save the event if its key is new. Returns false for a duplicate. Must be fast (it runs before the reply). */
  saveIfNew(key: string, event: UnivapayEvent): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;
  /** Events not yet processed (new, or failed earlier), oldest first. */
  unprocessed(): Promise<StoredEvent[]>;
}

/** A simple in-memory store for tests and examples. Not for production (lost on restart). */
export class InMemoryEventStore implements EventStore {
  readonly events = new Map<string, StoredEvent>();
  async saveIfNew(key: string, event: UnivapayEvent) { if (this.events.has(key)) return false; this.events.set(key, { key, event, receivedAt: new Date().toISOString() }); return true; }
  async markProcessed(key: string) { const e = this.events.get(key); if (e) { e.processedAt = new Date().toISOString(); delete e.error; } }
  async markFailed(key: string, error: string) { const e = this.events.get(key); if (e) e.error = error; }
  async unprocessed() { return [...this.events.values()].filter((e) => !e.processedAt); }
}

/** Constant-time check that the header is exactly the auth token (no "Bearer " prefix). */
export function isUnivapayAuthorization(header: string | undefined, authToken: string): boolean {
  if (typeof header !== "string" || authToken.length === 0) return false;
  const a = Buffer.from(header, "utf8"), b = Buffer.from(authToken, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The duplicate-detection key: a hash of the raw body (retries resend the same body; a new event differs). */
export function eventKey(rawBody: Buffer | string): string { return createHash("sha256").update(rawBody).digest("hex"); }

export type ReceiverOptions = {
  /** The auth_token set on the webhook (keep it in an environment variable). */
  authToken: string;
  store: EventStore;
  /** Your processing: switch on `event.event` (the raw name). Re-read the resource with a GET here before changing an
   *  order (see payment-status.ts). */
  handle: (event: UnivapayEvent) => Promise<void>;
  path?: string;
  log?: (message: string) => void;
};

/** Process one stored event and record the result. Failures stay "unprocessed" for `processPending` to retry. */
async function processOne(opts: ReceiverOptions, key: string, event: UnivapayEvent) {
  try { await opts.handle(event); await opts.store.markProcessed(key); }
  catch (e) { await opts.store.markFailed(key, e instanceof Error ? e.message : String(e)); opts.log?.(`univapay webhook: processing failed for ${event.event}; will retry`); }
}

/** An Express router with the webhook endpoint. Mount it BEFORE any global `express.json()` (it needs the raw body). */
export function univapayWebhookRouter(opts: ReceiverOptions): Router {
  const router = express.Router();
  router.post(opts.path ?? "/webhooks/univapay", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    if (!isUnivapayAuthorization(req.headers.authorization, opts.authToken)) { res.status(401).end(); return; }
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    let event: UnivapayEvent | null = null;
    try { const j = JSON.parse(raw.toString("utf8")) as Partial<UnivapayEvent>; if (typeof j.event === "string" && j.data && typeof j.data === "object") event = j as UnivapayEvent; } catch { /* not JSON */ }
    if (event === null) { opts.log?.("univapay webhook: authenticated delivery without a readable {event, data} body; acknowledged"); res.status(200).end(); return; }
    const key = eventKey(raw);
    let isNew: boolean;
    try { isNew = await opts.store.saveIfNew(key, event); }
    catch { res.status(503).end(); return; } // storage down: let UnivaPay retry (a 5xx other than 500-502 never switches the webhook off)
    res.status(200).end(); // reply first, well within 3 seconds
    if (isNew) setImmediate(() => { void processOne(opts, key, event!); });
  });
  return router;
}

/** Re-run events that failed or were never processed (call on a timer and at startup). */
export async function processPending(opts: Pick<ReceiverOptions, "store" | "handle" | "log">): Promise<number> {
  const pending = await opts.store.unprocessed();
  for (const e of pending) await processOne(opts as ReceiverOptions, e.key, e.event);
  return pending.length;
}

// ---- Webhook administration over plain HTTPS (SDK 1.2.3 bug H3) ----

/** The same credentials the SDK client uses: `Authorization: Bearer {secret}.{jwt}`. Server only. */
export type UnivapayHttpAuth = { secretKey: string; jwtToken: string; baseUrl?: string };
/** A webhook as UnivaPay sends it (API names). Never log it: it holds the auth token (createWebhook.8). */
export type WebhookWire = { id: string; url: string; triggers: string[]; active: boolean; auth_token?: string | null; [k: string]: unknown };

/** An error status from a plain HTTPS call. `readUnivapayError` reads it like an SDK error (refused / refused-empty-body). */
export class UnivapayHttpError extends Error {
  override name = "UnivapayHttpError";
  constructor(readonly statusCode: number, readonly body: string) { super(`HTTP ${statusCode}`); }
}

async function univapayHttp<T>(auth: UnivapayHttpAuth, method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${auth.secretKey}.${auth.jwtToken}`, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = idempotencyKey ?? randomUUID();
  const r = await fetch(`${auth.baseUrl ?? "https://api.univapay.com"}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  if (!r.ok) throw new UnivapayHttpError(r.status, text);
  return JSON.parse(text) as T;
}

/** Every webhook of the store, page by page (has_more + cursor). (SDK 1.2.3 bug H3) The SDK's listWebhooks fails on a
 *  whole page when one webhook on it has the trigger `token_three_ds_updated`; this reads them all. (SDK 1.2.3 bug S7)
 *  It also takes the API's `active` values: "active" (the default list), "inactive" or "all" (listWebhooks.1). */
export async function* listWebhooksRaw(auth: UnivapayHttpAuth, storeId: string, opts: { active?: "active" | "inactive" | "all"; pageSize?: number } = {}): AsyncGenerator<WebhookWire> {
  let cursor: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ limit: String(opts.pageSize ?? 100), ...(opts.active ? { active: opts.active } : {}), ...(cursor ? { cursor } : {}) });
    const page = await univapayHttp<{ items?: WebhookWire[]; has_more?: boolean }>(auth, "GET", `/stores/${encodeURIComponent(storeId)}/webhooks?${q}`);
    const items = page.items ?? [];
    for (const w of items) yield w;
    if (page.has_more !== true || items.length === 0) return;
    cursor = items[items.length - 1]!.id;
  }
}

/** GET a webhook by id (works for webhooks that have the `token_three_ds_updated` trigger). */
export function getWebhookRaw(auth: UnivapayHttpAuth, storeId: string, webhookId: string): Promise<WebhookWire> {
  return univapayHttp<WebhookWire>(auth, "GET", `/stores/${encodeURIComponent(storeId)}/webhooks/${encodeURIComponent(webhookId)}`);
}

/** Create a webhook with any trigger names, `token_three_ds_updated` included. Store the returned id in your config.
 *  `idempotencyKey`: e.g. idempotencyKey("webhook", url). */
export function createWebhookRaw(auth: UnivapayHttpAuth, storeId: string, w: { url: string; authToken: string; triggers: string[] }, idempotencyKey: string): Promise<WebhookWire> {
  return univapayHttp<WebhookWire>(auth, "POST", `/stores/${encodeURIComponent(storeId)}/webhooks`, { url: w.url, auth_token: w.authToken, triggers: w.triggers }, idempotencyKey);
}

/** Change a webhook. `triggers` replaces the whole list (updateWebhook.2), so always send the full list. */
export function updateWebhookRaw(auth: UnivapayHttpAuth, storeId: string, webhookId: string, patch: { url?: string; authToken?: string; triggers?: string[]; active?: boolean }, idempotencyKey: string): Promise<WebhookWire> {
  const body = { ...(patch.url !== undefined ? { url: patch.url } : {}), ...(patch.authToken !== undefined ? { auth_token: patch.authToken } : {}), ...(patch.triggers !== undefined ? { triggers: patch.triggers } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) };
  return univapayHttp<WebhookWire>(auth, "PATCH", `/stores/${encodeURIComponent(storeId)}/webhooks/${encodeURIComponent(webhookId)}`, body, idempotencyKey);
}

/** Turn a stopped webhook back on. Returns whether it was active before and after.
 *  Careful: a DELETED webhook reads exactly like a switched-off one (`active: false`, deleteWebhook.1, and it is
 *  missing from the default list, listWebhooks.2), and switching it on brings it back. So call this only for the webhook id your
 *  app uses now, and pass `expectedUrl` (your receiver's URL): a webhook pointing anywhere else is left alone. */
export async function ensureWebhookActive(auth: UnivapayHttpAuth, storeId: string, webhookId: string, opts: { expectedUrl?: string } = {}) {
  const w = await getWebhookRaw(auth, storeId, webhookId);
  if (opts.expectedUrl !== undefined && w.url !== opts.expectedUrl) return { wasActive: w.active !== false, nowActive: w.active !== false, skipped: "url-mismatch" as const };
  if (w.active !== false) return { wasActive: true, nowActive: true };
  const u = await updateWebhookRaw(auth, storeId, webhookId, { active: true }, randomUUID());
  return { wasActive: false, nowActive: u.active === true };
}

// ---- Catch-up after an outage ----

/** What catch-up needs from a charge. Read from the SDK model, or from the raw reply for a page the SDK can't read. */
export type ChargeRef = { id: string; createdOn: string | undefined; status: string | undefined; orderId: string | undefined; readBy: "sdk" | "raw" };
type RawCharge = { id?: unknown; created_on?: unknown; status?: unknown; metadata?: { order_id?: unknown } | null };
const fromSdk = (c: Charge): ChargeRef => ({ id: c.id!, createdOn: c.createdOn, status: c.status, orderId: c.metadata?.orderId, readBy: "sdk" });
const fromRaw = (c: RawCharge): ChargeRef => ({
  id: String(c.id), createdOn: typeof c.created_on === "string" ? c.created_on : undefined, status: typeof c.status === "string" ? c.status : undefined,
  // A number here is someone else's mistake (SDK 1.2.3 bug H1); your own order ids are always text.
  orderId: c.metadata?.order_id === undefined || c.metadata?.order_id === null ? undefined : String(c.metadata.order_id), readBy: "raw",
});

/** Catch-up after an outage: every charge created since `since`, newest first, following has_more and the cursor.
 *  Match `orderId` with your orders, then GET each charge before acting (lists lag: listAllCharges.5). */
export async function* chargesCreatedSince(client: Client, storeId: string, since: Date, pageSize = 100): AsyncGenerator<ChargeRef> {
  let cursor: string | undefined;
  for (;;) {
    let items: ChargeRef[]; let hasMore: boolean;
    try {
      const { result: page } = await client.charges.listStoreCharges(storeId, pageSize, cursor);
      items = (page.items ?? []).map(fromSdk); hasMore = page.hasMore === true;
    } catch (e) {
      const f = readUnivapayError(e);
      const raw = f?.kind === "succeeded-unreadable" ? (f.rawBody as { items?: RawCharge[]; has_more?: unknown } | undefined) : undefined;
      if (!raw || !Array.isArray(raw.items)) throw e;
      items = raw.items.map(fromRaw); hasMore = raw.has_more === true;
    }
    for (const c of items) { if (c.createdOn && new Date(c.createdOn) < since) return; yield c; }
    if (!hasMore || items.length === 0) return;
    cursor = items[items.length - 1]!.id;
  }
}
