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
import express, { type Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { UnivapayPublicApiClient } from "univapay-public-api";

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
  /** Your processing. Re-read the resource with a GET here before changing an order (see payment-status.ts). */
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

/** Turn a stopped webhook back on. Returns whether it was active before and after.
 *  Careful: a DELETED webhook reads exactly like a switched-off one (`active: false`, deleteWebhook.1, and it is
 *  missing from the default list, listWebhooks.2), and switching it on brings it back. So call this only for the webhook id your
 *  app uses now, and pass `expectedUrl` (your receiver's URL): a webhook pointing anywhere else is left alone. */
export async function ensureWebhookActive(client: UnivapayPublicApiClient, storeId: string, webhookId: string, opts: { expectedUrl?: string } = {}) {
  const w = await client.webhooks.getWebhook({ storeId, id: webhookId });
  if (opts.expectedUrl !== undefined && w.url !== opts.expectedUrl) return { wasActive: w.active !== false, nowActive: w.active !== false, skipped: "url-mismatch" as const };
  if (w.active !== false) return { wasActive: true, nowActive: true };
  const u = await client.webhooks.updateWebhook({ storeId, id: webhookId, body: { active: true } });
  return { wasActive: false, nowActive: u.active === true };
}

/** Catch-up after an outage: every charge created since `since`, newest first, following has_more and the cursor. */
export async function* chargesCreatedSince(client: UnivapayPublicApiClient, storeId: string, since: Date, pageSize = 100) {
  let cursor: string | undefined;
  for (;;) {
    const page = await client.charges.listStoreCharges({ storeId, limit: pageSize, ...(cursor ? { cursor } : {}) });
    const items = page.items ?? [];
    for (const c of items) { if (c.createdOn && new Date(c.createdOn) < since) return; yield c; }
    if (!page.hasMore || items.length === 0) return;
    cursor = items[items.length - 1]!.id;
  }
}
