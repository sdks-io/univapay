---
name: 'typescript-getting-started'
description: 'Entry point for integrating the Univapay Public API TypeScript/Node SDK (APIMatic-generated, built on the @apimatic/* runtime packages). Carries the SDK''s identity — npm package, `Client` class, `Configuration`, environments, the `ApiError` base — the package layout, the SDK map that ships with this plugin (sdk-map/, next to skills/), and where to read the source. Load this first, before any other typescript-* skill.'
---

# Getting started with an APIMatic-generated TypeScript SDK

This is the **SDK-specific** reference and grounding layer, and the entry into the companion
`typescript-*` skills. The SDK is built on the shared `@apimatic/*` runtime packages — always `@apimatic/core`, `@apimatic/schema`,
`@apimatic/axios-client-adapter`, `@apimatic/authentication-adapters` and `tslib`, plus feature-gated
ones such as `@apimatic/oauth-adapters` and `@apimatic/pagination`. **`package.json` `dependencies` is
the authoritative list — read it rather than assuming.** For the general patterns that apply to *any* such SDK (client setup, auth, calling endpoints, models, error
handling, retries, testing), see the companion API-agnostic skills: `typescript-client-initialization`,
`typescript-authentication`, `typescript-calling-endpoints`, `typescript-models`,
`typescript-error-handling`, `typescript-configuration-resilience`, `typescript-testing`.

> **Before writing any integration code, open the SDK map** (see *The SDK map — look up first* below).
> It carries every signature, argument order, wire name, model field, enum value and error row of this
> SDK. Read the SDK source (the *SDK source* section) for what the map does not carry. The
> source is obtained exactly as that section describes. Do **not** vendor or edit it inside your project;
> regenerate the SDK instead if something needs to change.

## SDK identity

| | |
| --- | --- |
| API | `Univapay Public API` |
| Runtime dependencies | always `@apimatic/core`, `@apimatic/schema`, `@apimatic/axios-client-adapter`, `@apimatic/authentication-adapters` and `tslib`; plus feature-gated ones — `@apimatic/oauth-adapters` (OAuth), `@apimatic/pagination` (paginated endpoints), `@apimatic/sse` (`text/event-stream` endpoints), `@apimatic/xml-adapter` (XML APIs). **`package.json` `dependencies` is authoritative — read it rather than assuming this list is complete.** |
| npm package id | `univapay-client-sdk` (version `1.2.3`) — the `"name"` in `package.json` |
| Install | `npm install univapay-client-sdk` |
| Client | a single exported `Client` class, constructed with `new Client(config?: Partial<Configuration>)` |
| Configuration | a plain `Configuration` **options object** (interface in `src/configuration.ts`), passed to the constructor; all fields optional via `Partial` |
| Auth | **this API declares at least one scheme**, so the `Configuration` carries one nested credential **object** per scheme, named `...Credentials` — **read the property name off `src/configuration.ts`; do not derive it from the scheme name in the spec.** The generator often names it after the auth *type* instead (a scheme named `APIKeyHeader` becomes `customHeaderAuthenticationCredentials`), and only sometimes after the scheme (`basicAuth` → `basicAuthCredentials`). Set it as an object literal; a deprecated top-level bare-string field may also exist alongside it. Here it is `bearerAuthCredentials: { secretKey, jwtToken }`. See **typescript-authentication** |
| Environment | an `enum Environment` in `src/configuration.ts` — here only `Production`. Hosts come from the `baseUrl` / `directDebitBaseUrl` options; test or live mode comes from the app token |
| Controllers | one class per resource group, named for the group plus this SDK's controller postfix — read the whole name off the `export class` lines in `src/controllers/`; reach it as a client getter (`client.charges`, `client.refunds`, …; built once per client) or construct it, `new {Controller}(client)`. The client also has store-scoped shortcuts such as `client.getCharge(chargeId)` |
| Return type | every operation returns `Promise<ApiResponse<T>>` |
| Base error | `ApiError<T>` (from `@apimatic/core`, re-exported by the SDK) — thrown on non-2xx; see **typescript-error-handling** |

Both were recorded with this SDK, so they are the coordinates a consumer installs rather than whatever this build happened to produce. Pin them as they stand.

## Package layout

APIMatic TypeScript SDKs live under `src/`, with everything re-exported from `src/index.ts`:

- `src/client.ts` — the `Client` class (`constructor(config?: Partial<Configuration>)`, `withConfiguration`,
  static `fromJsonConfig` / `fromEnvironment`, and the `getBaseUri` base-URL resolver). OAuth-using SDKs
  expose a public manager property here, whose generated name need not match the scheme name in the spec —
  grep `public .*Manager` for the real name.
- `src/configuration.ts` — the `Configuration` interface (timeout, environment, credential objects,
  `httpClientOptions`), the `Environment` enum, and the env/JSON config readers.
- `src/defaultConfiguration.ts` — `DEFAULT_CONFIGURATION` and `DEFAULT_RETRY_CONFIG` (the actual defaults).
- `src/controllers/` — one controller class per API resource group, all extending the generated base
  controller. Its name is `Base` + the SDK's controller postfix (e.g. `BaseApi` in
  `src/controllers/baseApi.ts` when the postfix is `Api`); the postfix is fixed at generation time, so
  read the real class names off the `export class` lines in `src/controllers/` rather than assuming
  either postfix.
- `src/models/` — request/response **interfaces**, each paired with a `{name}Schema` for runtime
  (de)serialization; `src/models/containers/` for oneOf/anyOf union types. **This is where field names,
  optionality, and enum values live.**
- `src/errors/` — typed error subclasses, one per error response model
  (`class {Name}Error extends ApiError<{Payload}>`), each re-exported from `src/index.ts`.
- `src/core.ts` and `src/clientAdapter.ts` — thin re-exports of the runtime (`@apimatic/core`,
  `@apimatic/axios-client-adapter`); this is where `ApiError`, `ApiResponse`, `RetryConfiguration`,
  `HttpClientOptions`, `RequestOptions` actually come from.
- `src/schema.ts` — re-export of `@apimatic/schema` (the `object`/`optional`/`oneOf`/… combinators).
- `src/extensions.ts` — **hand-written by UnivaPay, not generated**: the `Idempotency-Key` interceptor, the `poll*` helpers added to `ChargesApi`, `RefundsApi`, `CancelsApi` and `SubscriptionsApi`, and the app-token decoding behind the store shortcuts.
- `src/events/webhooks/` — webhook parsers (`ChargeHandler`, `TokenHandler`, …), exported from the root.

## Install

This SDK is published out of `https://github.com/univapay/univapay-client-js-sdk`, tag `1.2.3` (there is no `1.2.3` branch) — take that tag explicitly rather than the repository default, which is not necessarily where this SDK is released from. Which registry that pipeline pushes to is a property of the pipeline rather than of the SDK. Try the install command below as-is first: if it resolves, the package is on the public registry and there is nothing further to configure. Only if it 404s do you need the feed — take it from the repository's publish workflow, or from whoever owns the pipeline, and configure that registry before retrying.

```bash
npm install univapay-client-sdk
```

It lands in `package.json` as an ordinary dependency. Pin the exact version:
regenerating the SDK publishes a new one, and a caret range would move the surface under you without
saying so.

```json
"dependencies": {
  "univapay-client-sdk": "1.2.3"
}
```

Confirm what actually resolved — npm keeps serving the copy already in `node_modules/` until you ask
for the new version by name:

```bash
npm ls univapay-client-sdk
```

The SDK's own `@apimatic/*` dependencies use `^` ranges, so a fresh install can pick newer ones (1.2.3 asks for `@apimatic/axios-client-adapter ^0.3.20`; a fresh install got 0.3.21). Commit your lockfile.

```ts
import { Client, Environment, ApiError } from 'univapay-client-sdk';
// controllers and model types are also exported from the package root:
import { {Controller} } from 'univapay-client-sdk';
```

> **Plain Node ESM cannot load 1.2.3.** `import` from an `.mjs` file (or a `"type": "module"` package) run by `node` fails with `ERR_MODULE_NOT_FOUND` (`dist/esm/.../jsonBigInt`). `require()`, `createRequire(import.meta.url)` and `tsx` load it.

Everything public is re-exported from `src/index.ts`, so import names come from the **package root** — you
don't import from subpaths. `npm install` pulls the `@apimatic/*` runtime packages transitively.

> **The root barrel exports some names as values and others as types, and the split is not obvious from
> the name.** `src/index.ts` emits `export { X }` for a model that is an **enum** or that **has child
> types** (a union base other models extend), and `export type { X }` for every other model. So a plain
> model interface exists only at compile time, while an enum or a union base is a real runtime binding.
>
> That matters because a single `import { A, B } from 'univapay-client-sdk'` mixing the two **fails under
> `verbatimModuleSyntax`** (TS1484; `isolatedModules` alone accepts it) — increasingly the default — and the error names the
> type-only import rather than explaining the rule. Split it:
>
> ```ts
> import { {EnumOrUnionBase} } from 'univapay-client-sdk';        // value: usable at runtime
> import type { {Model} } from 'univapay-client-sdk';             // type only
> ```
>
> **Read `src/index.ts` to see which kind a name is** — grep it for the name and look at whether its
> line says `export` or `export type`. Do not infer it from whether the thing "sounds like" a type.

## The SDK map — look up first, open the source second

This plugin ships a map of this SDK, `univapay-client-sdk@1.2.3`, at **`<plugin-root>/sdk-map/`**. The plugin root is the directory that holds `skills/` and `business-rules/`. The map is not in the npm package.

- **`sdk-map.md`**: read it once. It covers:
  - building a client: every `Configuration` field and its default, and the retry trap;
  - how to call an operation: positional arguments, what comes back, the headers sent, the `Idempotency-Key`;
  - the error model, and how every model behaves;
  - the poll helpers, the client shortcuts and the webhook handlers;
  - runtime and packaging;
  - the index of operation pages and model pages.
- **`map/operations/<resource>.md`**: one block per operation.
  - **Call**, **Signature**, **Wire** (method and path), **Request body**, **Headers sent**, **Idempotency-Key**, **Returns**, **Client shortcut** and **Types**.
  - A parameter table: position, SDK name, wire name, where it goes, type, required.
  - An error table: status, class thrown, `result`, message.
- **`map/models/<page>.md`**: one table per model.
  - Objects: SDK field, wire name, type, optional.
  - Enums: members with their wire values.
  - Unions: arms with their type guards.

**Read `sdk-map.md` before any other page.** Then open only the operation page you need, and the model tables it links to.

**The map is the lookup surface; the source is the backstop.** If `npm ls univapay-client-sdk` shows a version other than `1.2.3`, the map describes a different SDK: say so, and confirm each fact in the source.

**What the map does not carry, and where to find it.** Paths start at the package root, `node_modules/univapay-client-sdk/`:

| Question | File |
| --- | --- |
| An operation's method body: the request it builds and the errors it maps | `src/controllers/<resource>Api.ts` |
| A model's schema | the **Source** file named above the model's table |
| Client getters, client shortcuts, `withConfiguration` | `src/client.ts` |
| `Configuration`, `Environment`, `fromEnvironment` | `src/configuration.ts` |
| The defaults (timeout, retry) | `src/defaultConfiguration.ts` |
| How the `Authorization` value is built | `src/authProvider.ts` |
| The `Idempotency-Key` interceptor and the poll helpers | `src/extensions.ts`, hand-written by UnivaPay |
| `ExternalApiError` | `src/errors/externalApiError.ts`. `ApiError` and `ApiResponse` come from `@apimatic/core`, re-exported through `src/core.ts` |
| Webhook handlers and their guards | `src/events/webhooks/` |

**The map carries shapes. What an operation *means* lives in the business rules**, in `<plugin-root>/business-rules/`: which values a field accepts beyond its type, a rule that couples two fields, what the API does on its own. A value you "know" for a field that the map types as a plain `string` is a lookup, not something to recall.

**Keep lookups cheap:**
- Collect the contracts for every in-scope operation in one pass, onto the contract sheet.
- Open a model's fields only where the task sets them.
- Never grep the package to *find* a type: the map's model index names its page.

## SDK source — read it in place

You will constantly need to confirm real constructor/method signatures, model interfaces, schemas, enum
values, and error types, and the **only reliable way** is to read the SDK source.

Clone it and read the clone — it is the source this pack documents:

```bash
git clone --filter=blob:none --branch 1.2.3 https://github.com/univapay/univapay-client-js-sdk
```

**`--branch 1.2.3` checks out the tag (detached HEAD); your install is pinned.** Check out the tag matching `1.2.3`, the version installed above before you read anything from it — a branch keeps moving after a release is cut, so the default checkout can be a different SDK than the one you compile against, and nothing in the tree will tell you. `git ls-remote --tags` lists what the repository offers; if no tag matches, treat every signature you read as unconfirmed rather than assuming it carried over. Clone it outside your project directory and treat it as read-only. It is a reference, not a dependency: what you build against is the package installed above, never this checkout.

An existing copy, if you already have one, is in whichever of these applies:

- the **unpacked SDK directory** you were given (the one containing `package.json` and `src/`); or
- **`node_modules/univapay-client-sdk/`** in your project, once installed.

Treat it as a read-only reference and grep it locally.

Layout — grep here first:

- `package.json` — the npm `name`, `version`, `engines.node`, and the `@apimatic/*` `dependencies`.
- `src/configuration.ts` — the `Configuration` fields, the `Environment` enum, and the env-var names in
  `fromEnvironment`.
- `src/client.ts` — the `Client` constructor and (for OAuth) the manager properties.
- `src/controllers/*.ts` — operation methods and their `Promise<ApiResponse<T>>` signatures.
- `src/models/` — request/response interfaces, enums, and `containers/` unions; **this is where field
  names live**.
- `src/errors/` — the typed error subclasses this build emits, one per error response model.
- `README.md` and `doc/` — a generated, human-readable index: `doc/client.md`, `doc/auth/*.md`,
  `doc/controllers/*.md`, `doc/models/*.md`, `doc/http-client-options.md`, `doc/retry-configuration.md`,
  `doc/api-response.md`, `doc/api-error.md`, `doc/environment-based-client-initialization.md`,
  `doc/configuration-based-client-initialization.md`. In the repository it is the fastest way to find
  an operation, its parameters and a copy-pasteable snippet, then open the `.ts` file for the exact
  signature. **It is not in the installed package** — everything else listed above ships in
  `node_modules/univapay-client-sdk/`; `doc/` does not, because npm publishes only what the `files`
  field names. With only the package, `src/controllers/*.ts` is the equivalent starting point.

## Placeholder legend

Samples across these skills write `{...}` for a name that differs per API. **They are never literal** —
resolve each one from this SDK's source before you write code. Anything already concrete for this SDK
(package id, API name, install command) is spelled out for you; if it is still in braces, it is yours to
look up.

| Placeholder | Stands for | Resolve it from |
| --- | --- | --- |
| `{Controller}` | a controller class — the whole name, postfix included, as in `new {Controller}(client)` | the `export class` lines in `src/controllers/`. The postfix (`Api`, `Controller`, …) is this SDK's controller-naming setting, fixed at generation time — read the real names rather than assuming either |
| `{group}`, `{apiGroup}` | the resource group a controller covers | the file names under `doc/controllers/` |
| `{operation}` | an operation method on a controller | the controller class body, or the operation list in `doc/controllers/{group}.md` |
| `{RequestType}`, `{Payload}` | a request or response model interface | `src/models/` — one file per model, each paired with a `{name}Schema` |
| `{Name}`, `{field}` | a model interface and one of its properties | the interface declaration in `src/models/` |
| `{optionalParam}`, `{requiredParam}`, `{pathOrQueryParam}` | one parameter of the operation you are calling | the operation's signature in `src/controllers/` |
| `{EnumType}`, `{enumType}`, `{enumProp}` | a generated enum and a property typed by it | the enum declarations in `src/models/` |
| `{Union}`, `{Variant}`, `{V}` | a oneOf/anyOf union and one of its variants | `src/models/containers/` |
| `{ItemType}`, `{Collection}` | the element type of an array property | the property's declared type in `src/models/` |
| `{ErrorModel}`, `{ErrorResponse}` | a generated error class | `src/errors/`. Named after the error **response model**, never after the operation — see **typescript-error-handling** |
| `{scheme}` | an auth scheme, as it names the client's manager property | grep `public .*Manager` in `src/client.ts` |
| `{basicAuthProperty}`, `{bearerAuthProperty}`, `{apiKeyProperty}`, `{oAuthProperty}` | the credentials property for one scheme on `Configuration` | the credential fields in `src/configuration.ts` |
| `{keyName}` | the literal header or query parameter an API key is sent as | the API-key credentials type in `src/configuration.ts` |
| `{ScopeEnum}` | the generated OAuth scope enum — emitted only for a grant whose spec declares scopes, so an SDK can have none | the `### Scopes` table in that grant's `doc/auth/*.md` (usually the authorization-code one); if the grant's credentials object in `src/configuration.ts` has no `oAuthScopes`, there is no enum |
| `{id}`, `{placeholder}` | a stand-in value in an example | nothing to look up — substitute your own |

Any other `{...}` you meet is a local example; the sentence around it says what belongs there.

## Sensitive data

Two kinds of request carry data that must never be logged:
- `TokenCreateCardData`: `cardNumber`, `expMonth`, `expYear` and `cvv` (wire names `card_number`, `exp_month`, `exp_year`, `cvv`);
- the direct debit bank-account requests: `bankAccountNumber`.

The SDK logs the request body exactly as sent, card data included, whenever `logging.logRequest.logBody` is on. So on these paths:
- pass no `logging` option, or one without `logBody`;
- keep `maskSensitiveHeaders` at its default, `true`. With `false`, logged headers include the full `Authorization` value, which is the app secret plus the token;
- don't log `error.message` from `createTransactionToken` as it is. An `ArgumentsValidationError` message repeats the value you passed, card number and CVV included;
- don't use a `Client.fromEnvironment` client as it comes, because it logs every request line. Remove its logging first: `.withConfiguration({ logging: undefined })`;
- never let your own diagnostics echo a request body.

## What a contract sheet must carry for this SDK

Beyond signatures and model fields, a contract sheet for this SDK needs the items below. Each is a decision the signature alone can't settle. The details are in `sdk-map.md`.

1. **The host, and where it is set.** It's `baseUrl` (default `https://api.univapay.com`), plus `directDebitBaseUrl` for the 14 direct debit operations. Test or live mode comes from the app token, not from a setting.
2. **The exact argument order for each operation**, from its **Signature**.
   - Arguments are positional; pass `undefined` to skip an optional one.
   - `idempotencyKey` comes **before** `body` in the 11 operations whose body is optional, and after it in the 14 whose body is required.
3. **Every request field, with its wire name and where it goes** (path, query, header or JSON body).
   - Metadata keys other than `orderId`, `univapayName` and `univapayPhoneNumber` go in `metadata.additionalProperties`.
   - Metadata values must be a string, number, boolean, `null`, or an array of those. A value that is an object, or an array holding an object, is dropped with no error. On transaction tokens it fails the whole read instead.
   - A key that isn't part of the model is sent exactly as written. It is not converted to snake_case.
4. **Your own `Idempotency-Key` on every write.** If you leave the argument out, the SDK sends a new random key on every call; only the SDK's own retries reuse it. So when your code repeats a call, nothing protects it. Pass the key that the DUPLICATE CLAIMS row stores.
5. **Required, optional or nullable**, for every model field the task sets: `f: T`, `f?: T` or `f: T | null`.
6. **The error rows for each operation in scope: status → class.** The same status can throw a different class on different operations.
   - `ExternalApiError` carries `result`, the parsed body. It is `undefined` when the body is empty; for example, the API answers an unknown charge id with an empty 404.
   - `ApiError` never has `result`, so read `JSON.parse(error.body).code`. 409 and 429 are always a plain `ApiError`, so `IDEMPOTENCY_KEY_CONFLICT` and rate limits only reach you through the body.
   - `createSubscription`, `listAllSubscriptions` and `listStoreSubscriptions` have no error rows: every non-2xx status throws a plain `ApiError`.
7. **A 2xx body that doesn't fit its model throws `ResponseValidationError`, not `ApiError`.**
   - Every enum is closed, so a value the SDK doesn't list (a new status, say) fails the whole response.
   - So does a number where the model has a string, such as a numeric `metadata.order_id`.
   - Say what the code does when this happens.
8. **"No answer" failures are axios errors** (`error.isAxiosError`, with `error.code` set to `ECONNABORTED` after a timeout or `ECONNREFUSED` when nothing is listening). They are not `ApiError`s, and their class isn't exported.
9. **The retry policy.** Retries are off by default. If the task turns them on:
   - no retry happens while `maximumRetryWaitTime` is `0`;
   - while `retryOnTimeout` is `true`, every status with an error row is retried, 400, 401, 404 and 409 included. See *Retry trap* in `sdk-map.md`;
   - the 3 subscription operations without error rows follow only `httpStatusCodesToRetry`.
10. **The logging.** It is off by default. Any `logging` object turns it on, and `logBody` writes card data (see *Sensitive data* above).
11. **List walks.**
    - Every list except `listBankTransferLedgers` returns `{ items, hasMore }` and takes `limit`, `cursor` and `cursorDirection`. To get the next page, make the same call with the same `limit` and `cursor` set to the last item's id. Stop when `hasMore` is `false`.
    - Give each walk a bound of its own.
    - The `cardBrand` filter on transaction history doesn't work through this SDK.
12. **The module format.** A plain Node ESM `import` of this SDK fails, so state how this project loads it: `require`, `createRequire`, `tsx` or a bundler.
13. **Webhooks.** The SDK's handlers return real deliveries as unknown events, so the receiver parses the raw JSON and switches on `event` (see `typescript-univapay-payments`).
14. **Poll helpers, if used.**
    - They are missing from the published types, so use the client shortcuts instead (`client.pollCharge(...)` and so on).
    - When the attempts run out, they resolve with the last response instead of throwing, so check `result.status`.
15. **A REQUIRED READING block** naming the `typescript-*` companions that govern the steps, with inline `MUST load` pointers.

## Integration workflow — load the companion skill at each step

**Load the skill named for a step before you write that step's code, even where you have already read
the source.** The generated source is authoritative for the SDK's *surface*; these skills carry the
usage rules a signature cannot show, and each one names the trap that surface hides.

1. **typescript-client-initialization** — before you construct the client.
2. **typescript-authentication** — before you set credentials, and when a call returns 401 or 403.
3. **typescript-calling-endpoints** — before the first operation call.
4. **typescript-models** — as soon as a request or response field is not a plain string or number.
5. **typescript-error-handling** — before your first `try`/`catch` around a call.
6. **typescript-configuration-resilience** — before you ship. Its subject is the client's *defaults*, which apply whether or not you set anything, so this step is not conditional on changing one.
7. **typescript-testing** — before you stub the SDK.

## Next

- Step 1, construct the client → **typescript-client-initialization**

Every skill below ends with the step after it, so the footers walk the workflow above in order rather than offering a menu beside it.
