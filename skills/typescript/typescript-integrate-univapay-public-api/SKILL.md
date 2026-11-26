---
name: "typescript-integrate-univapay-public-api"
description: "MANDATORY FIRST STEP for Univapay Public API TypeScript SDK (`univapay-client-sdk`, UnivaPay's own APIMatic v3 SDK) work in a TypeScript or JavaScript project: load before writing any code — integrating Univapay Public API (capture charge, create charge, create customs declaration), or when the SDK errors, fails to compile or behaves unexpectedly. Sets the plan-first workflow, the contract sheet and which companion skills to load. TypeScript/JavaScript only; never load it for another language."
---

# Univapay Public API TypeScript SDK — Integration workflow (lookup layer + contract sheet)

## Your lookup layer

- **`typescript-getting-started`** is the entry point for every SDK need: identity, install, imports, environments, auth, the **SDK map** that ships with this plugin, and a table of the source files that own what the map does not carry. Load it first, always.
- **`typescript-univapay-payments`** is the UnivaPay payments layer: a recipe for each payment job (checkout, payment links, holds and capture, refunds, subscriptions, saved cards, 3-D Secure on server charges, konbini, bank transfer and PayPay), the webhook receiver, recovery runbooks, a review checklist and tested templates. It says what to build, in which order, and which business-rule ids govern each step. Use it together with this lookup layer: signatures, argument order, wire names and error rows still come from the map onto the sheet, and every SDK call in its templates gets a sheet row and passes the type check like any other code.
- **The SDK map is your lookup surface.** It ships **with this plugin**, not with the SDK: `<plugin-root>/sdk-map/sdk-map.md` and `<plugin-root>/sdk-map/map/` (the plugin root is the directory holding `skills/`). It documents `univapay-client-sdk@1.2.3`. `typescript-getting-started` tells you how to traverse it: read `sdk-map.md` once, then the one operation page your operations live on.
- **The installed package is the ground truth; the map is the locator.** Install it pinned — `npm install --save-exact univapay-client-sdk@1.2.3` — and confirm what resolved before you rely on a lookup: `npm ls univapay-client-sdk` must show `1.2.3`. **Any other version means the map describes a different SDK**: say so, confirm each fact in `node_modules/univapay-client-sdk/src/`, and mark a fact `UNVERIFIED` where the source does not settle it. The SDK's source repository is <https://github.com/univapay/univapay-client-js-sdk>, tag `1.2.3`.
- **Write a contract sheet with no open lookups** before you implement: exact signatures with every positional argument in order, every request field with where it goes (path, query, header or JSON body) and its wire name, required-vs-optional-vs-nullable members, the error rows per operation (status → class thrown), which lists the task walks and the bound each walk takes, enum members for the operations in scope, and **the business-rule ids that govern each function**, from `business-rules/` and the recipe step it implements, on that function's row, so the code is written and checked against them. `typescript-getting-started` carries a checklist of what a sheet for this SDK is incomplete without (*What a contract sheet must carry for this SDK*) — treat that as the checklist for your own sheet, and collect every in-scope operation in ONE pass rather than re-opening a map page per field.

## The planner agent

`univapay-public-api-planner` ships with this plugin. It writes `univapay-public-api-plan.md` — the plan and its contract sheet — and revises it in place; it writes no project code. Start it the first of these ways your host allows:

1. **Your subagent tool lists it.** Some hosts list a plugin's agents under the plugin's name, as `univapay:univapay-public-api-planner`; start it by whichever of the two names your subagent tool lists.
2. **It isn't listed, or you can't start a subagent.** Tell the user in one line that you are writing the plan yourself, then do so as *Step 1* describes. Don't stop to ask.

However you start it:

- **Start it on the same model you are running on.** If your subagent tool takes a model, pass your own model; if it has no model option, leave its default. Tell the user in one line which model you started it on.
- **Start it once per integration.** A plan revision is a follow-up message to that same agent; re-start it, carrying the clarification and the plan path, only where your host cannot message it. Never start a second one for the same integration.

## Workflow

**If the user opens with a reported SDK error, a compile failure, or unexpected Univapay Public API behaviour** (not new feature work), skip the plan-first flow: load `typescript-getting-started` and `typescript-error-handling`, look the failing symbol up on the map page or in the file the table names, and fix from what you find. **When a UnivaPay call fails or behaves unexpectedly** — a refusal, an error code, a payment error number, a status the code did not expect, a webhook that gets 401 or stops arriving — **search `<plugin-root>/business-rules/` for the error code or the field, and check `review-checklist.md` in `typescript-univapay-payments`, before changing code** (the plugin root is the directory holding `skills/`). Fix from the rule's **Do:** and the recipe step for that flow, name the rule id in your answer, and if data is already wrong, finish with that skill's `recovery-runbooks.md`. Otherwise, for implementation work:

### Step 1 — Plan first (always, for any implementation work)

**If the request is UnivaPay payment work** — checkout, payment links, holds and capture, refunds, subscriptions, saved cards, 3-D Secure, konbini, bank transfer, PayPay, webhooks, or going live — load **`typescript-univapay-payments`** in this same first pass and pick the recipe or recipes from its job map that match the request, and name them to the planner along with the request. Each recipe's steps, in their order, become the plan's scope, and the plan names the recipe each part comes from; the operations those steps call are the in-scope operations of the contract sheet. The recipes feed `univapay-public-api-plan.md`: it stays the one plan.

Your FIRST action, once the SDK is installed (installing it is a prerequisite the gate allows, below, and it follows the toolchain check and the baseline), is to start **`univapay-public-api-planner`**, as *The planner agent* says, once, with the user's full request — all features in scope; one plan covers the whole implementation — and the name of this skill, `typescript-integrate-univapay-public-api`. Dictate in its task the absolute project root and the absolute path it must write to — `<project repo root>/univapay-public-api-plan.md`, that absolute path, not a location you pick later. It loads `typescript-getting-started` and `typescript-error-handling` — table 1b.4 is decided from it — writes the plan and its contract sheet as Steps 1 to 1c describe, and returns the file's path.

**If you couldn't start the planner** (case 2 in *The planner agent*), load both skills yourself, work through the request, and write the file at that path.

**Consult `<plugin-root>/business-rules/` for business knowledge the map does not carry** (the plugin root is the directory holding `skills/`): every business rule Univapay Public API's own spec and docs state, as Markdown. Open `rules.md`, its index; read `every-request.md`, `background.md` where the scope relies on something Univapay Public API does on its own (renewals, retries, webhooks), and, under `operations/`, the section for every operation in scope, headed with its route. Plan for each rule that applies to the scope where it changes the plan (a step in the plan, the fields a request must carry, or a Blocker in the plan's **Assumptions & Blockers** where the plan makes a call Univapay Public API would refuse) and name the rule's id there. The rules are the source for how Univapay Public API behaves; the map stays the source for SDK contracts.

**Do these two read-only prerequisites before you install the SDK — the install changes the tree they read:**

- **establish the toolchain before you need it**: the package manager, whether `univapay-client-sdk` is already a dependency and at what version (the map documents `1.2.3`), the `tsconfig` flags that change what compiles here (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `strict`), and the exact commands that run the project's build, type check, lint and tests. Getting this wrong later costs a broken install mid-implementation — and an uninstalled package leaves the map pointing into source you cannot read;
- a baseline run of the project's checks (`tsc --noEmit`, the test runner, the linter — whatever it has) on the UNTOUCHED tree, so later failures are attributable to your changes.

**Do the rest while the planner works — they need no SDK knowledge and touch no project file:**

- the repo survey (read-only exploration of conventions, layering, **module format — ESM or CJS: a plain Node ESM `import` of this SDK fails, so how the project loads it (`require`, `createRequire`, `tsx` or a bundler) is a decision for the sheet** (`sdk-map.md` § *Runtime & packaging*), and the runtime: Node, a bundled browser app, or an edge runtime) — capture each convention as *pattern + the ONE exemplar file path to imitate*, NOT inline code snippets: you will read the exemplar at edit time anyway, so a snippet dump gets paid for twice;
- credentials/environment verification (per the task's secret-handling rules) — **including which host this deployment will actually talk to**: this SDK has one environment, the host is the `baseUrl` option (`directDebitBaseUrl` for direct debit), and **test or live mode comes from the app token, not from any setting**;
- setting up your task tracking.

**HARD GATE — no project-file creation or edits until:** the planner has RETURNED, `univapay-public-api-plan.md` EXISTS at the repo root (check it — a helper can misreport where it saved), its contract sheet has **no open lookups**, and you have read it. If you wrote the plan yourself, the gate is the same without the return. **Creating or editing ANY project file before then is a defect**, however obvious the code seems; the read-only prerequisite work above is allowed meanwhile.

**What the gate does not cover:** installing `univapay-client-sdk` into the project, installing the toolchain, and the files those writes produce (`node_modules/`, a lockfile the installer updates) are **prerequisites, not project-file edits** — the source the map points into lives in the installed package — and they are the only writes permitted before the gate.

**One read-only prerequisite waits for the signatures: a smoke of each in-scope operation against the real credential**, run from your scratchpad, not the project, once the planner has returned and you have read the sheet, with the signatures it records, and before your first project edit — or, if you are writing the plan yourself, once the map has given you the signatures and before you finalise the sheet. A plan-, region- or entitlement-gated endpoint answers `403` here — the map presents every operation uniformly and cannot know which ones your credential may call — and learning that now reorders the plan rather than the build. Send each `403` to the SAME planner as a revision, as *Step 1c* sends a blocker, and implement from its reply; if you wrote the plan yourself, revise the sheet in place. Skip only operations whose side effects you cannot reverse.

### Step 1b — The tables the contract sheet must carry (fill these in before you write any code)

The per-operation rows describe **what each operation is**. The tables below carry what those rows cannot: a write that may reach the provider twice or whose outcome you may not learn, a rule that spans two operations, and a field nobody asked for. Fill in every one that applies.

#### 1b.1 — DURABLE WRITES

One row in each table below per operation in scope that creates, sends or changes something on the provider's side; `none` if the scope has no such write. Every row follows one order: **claim → SDK call → record the result**. The claim is a row of its own, committed to a store this application owns *before* the call — not a field filled in afterwards on the record the write is about — so a second caller is stopped before it reaches the provider, and a lost answer leaves something to settle. A test that reads the store from inside the faked HTTP layer (`typescript-testing`) shows the claim was there when the request left.

**DUPLICATE CLAIMS** — what stops the same operation reaching the provider twice.

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |

⚠⚠ **What rejects the second one**: the store refusing the second claim — a unique constraint or a conditional write on a value every caller doing the same operation computes the same (the order being paid, the signup being welcomed), never on a value minted per attempt, which is unique by construction and refuses nothing. A read before the write, an in-process lock, or an assumption that one process runs lets both callers through. Release the claim when the provider refuses the call, so a later attempt is not blocked.

**Where that rejection is caught**: the `catch` for what the store raises on the second claim, recognised by the driver's error code rather than its message; the losing caller then uses the record the winner wrote.

When you pass no key, the SDK sends a new random `Idempotency-Key` on every call (`sdk-map.md`, *Headers sent*), so it goes beside the claim, never in place of it; where the operation takes an `idempotencyKey` argument, pass the reference stored on the claim.

**UNKNOWN OUTCOMES** — what settles a write the provider may have acted on without your code learning the answer.

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |

⚠⚠ An axios error on a write (`error.isAxiosError`: a timeout, `ECONNABORTED`, or a dropped connection) is *unknown*, not *failed*: the provider may already have acted. Reporting a failure is not a legal entry, and neither is leaving the caller to check or retry. Settle it in that write's own `catch`: re-read by the reference you sent — found, settle from what the provider holds; not found, or the re-read itself fails, still unknown, never failed. Telling the caller the outcome is unknown comes after the re-read, never instead of it. If the provider offers no way to find the write, that is a **Blocker** in Assumptions & Blockers, not a row.

A write that never left — no credentials configured (a plain `Error`), an argument that does not fit its type (`ArgumentsValidationError`), a client shortcut whose app token has no `store_id` claim (a plain `Error`), or a connection refused (`ECONNREFUSED`, nothing listening) — has nothing to re-read and gets its own outcome. **The test that fails the connection** asserts the re-read request was made; a second test, a never-sent failure on the same write, asserts it was not.

Write `TBD` in **Where in the code** and **The test that fails the connection** while you plan — every row. Once the code compiles, replace each `TBD` individually: the claim write, then the SDK call it precedes; the `catch`, then the re-read it makes. ⚠⚠ A `TBD` left behind, a name that is not in the code, or one note covering several rows is **not addressed**; if the code does not do what the row says, fix the code, then the cell.

#### 1b.2 — CROSS-OPERATION INVARIANTS

**CROSS-OPERATION INVARIANTS** — copy this header into the contract sheet and add one row per value a caller supplies (an identifier, a code, a reference) whose legal set something other than that call defines: a list the provider returns, or records this application keeps. `none` if the task restricts no such value. ⚠⚠ The map never states these rules; derive them from the task.

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |

⚠⚠ **The legal set is the one this task offers, not everything the account holds.** Asking the provider whether a value exists is not this check: the provider already rejects what exists nowhere, so a lookup of one record by its id enforces nothing new — internal records, test records and records meant for something else all exist, and all pass it. Check membership of the offered set itself, read in full (every page). If neither the provider nor this application can name that set, that is a **Blocker** in Assumptions & Blockers, not a row.

The check runs before the write is attempted and before its **DUPLICATE CLAIMS** claim is inserted — a value rejected after the claim exists leaves the claim behind to block a later, legitimate attempt. **The test that proves it** asserts a value outside the set is rejected **and** the write is never called.

#### 1b.3 — OPTIONAL REQUEST FIELDS

For every write operation in scope, the contract sheet carries an **OPTIONAL FIELDS** table: one row per optional field on the request, and what **requires** it.

| Field | What requires it | Set it? |
| --- | --- | --- |
| `{optionalField}` | nothing | ❌ leave it out |
| `{optionalField}` | the words in the task that supply it | ✅ set it from those words |
| `{optionalField}` | a named row of this sheet — e.g. the idempotency key a DUPLICATE CLAIMS row sends, or the reference an UNKNOWN OUTCOMES row searches by | ✅ set it, and name that row here |
| `{optionalField}` | a step of the `typescript-univapay-payments` recipe this plan follows — e.g. `metadata: { orderId }` so a webhook can find the order, or an explicit `threeDs.mode` | ✅ set it, and name the recipe and step here |

⚠⚠ **A field nothing requires is not yours to choose** — and "something requires it" means the task's own words, a row of this sheet, or a step of the `typescript-univapay-payments` recipe the plan follows, never your own sense that it looks sensible. Leaving it out *is* the decision: the provider's own default then applies, whether that is the account's configuration or the API's documented behaviour, and neither is yours to replace with a value you invented.

⚠⚠ **This rule never removes a field another row requires.** An idempotency key, and the reference you look an unknown outcome up by, are required by the DUPLICATE CLAIMS and UNKNOWN OUTCOMES rows rather than by the task — the task will never mention either. Dropping one to satisfy this table is a defect, not compliance. And because on this SDK a header such as `idempotencyKey` is just another positional argument beside the query parameters and the body, "it is only a header" is not a reason to leave a field off the table.

⚠⚠ **The map does not state defaults, and its silence is not permission to pick one.** A member typed `field?: T` tells you the field may be omitted. It tells you nothing about what omitting it does. If you cannot state what the provider will apply when the field is absent, that is a reason to leave it absent, not a reason to fill it.

**The test that proves it:** assert the request the SDK sent carries **no key your own code set without a row that requires it** — headers and query parameters included, not only the body. The SDK adds its own (`authorization`, `user-agent`, `accept`, `content-type`, and a random `Idempotency-Key` when you pass none); those are not yours and need no row. A test that only checks the fields you meant to send cannot see an invented one.

#### 1b.4 — WHEN THE API SAYS NO

Add one table per operation that uses the caller's data — what they typed, IDs they supply, and data your app stores for them (their email, their name). An empty request body does not make a refusal yours: when the API refuses the data you sent for them, only its reason tells them what to change. An operation with no typed arms still gets one.

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason: `code` and `errors` from `error.result` on an `ExternalApiError`, or parsed from `error.body` on an `ApiError` (its `result` is always `undefined`) — the body can be empty | fake it with a reason; assert the reason is in your response |
| 401 / 403 | 502 | a fixed message — our credentials | fake a 401; assert 502 and the fixed message |
| 429 | 503 | a fixed message — our quota | — |
| 5xx | 502 | a fixed message | — |
| no response, on a write | per UNKNOWN OUTCOMES | unknown — never "failed" | — |
| no response, on a read | 502 | a fixed message | — |

Logging the reason is not returning it: log it **and** put it in the response.

### Step 1c — Required reading (do this before you write any code)

End the contract sheet with a **REQUIRED READING** block whose rows carry inline `MUST load <skill>` pointers. **Load every `typescript-*` skill the sheet names, now, before you start implementing** — not lazily at the step that needs it. The sheet deliberately does *not* carry the how-to: it names the hazard and hands you the skill that resolves it, so an unloaded pointer is a gap in what you know, not a formality.

**A fixed floor applies regardless of what the sheet says** — the sheet can add to it, never remove from it: `typescript-error-handling` always (every integration writes an error boundary); `typescript-client-initialization` before the client is constructed; `typescript-testing` before the first test file you create or edit, *including* a throwaway verification script that fakes the HTTP layer.

These are API-agnostic usage skills; loading them is not a substitute for the lookup layer, and reading a file in the installed package does not remove the need to load the skill for that step.

Before implementing, check the plan's **Assumptions & Blockers** section:

- Blocker or major assumption → surface it to the user in plain language, get their answer, and send it to the SAME planner as a follow-up message (re-start it, carrying the clarification and the plan path, only where your host cannot message it). It revises `univapay-public-api-plan.md` in place and replies with the changed rows verbatim: work from that reply, not a re-read of the file. If you wrote the plan yourself, revise it in place.
- Minor assumptions only → proceed.

Full re-planning only on genuine scope change; for a single missing fact mid-implementation, do the lookup, never guess.

### Step 2 — Implement from the contract sheet

1. Read `univapay-public-api-plan.md` once and treat its contracts as authoritative. When a lookup revises a row, update the file so the sheet and the code never disagree.
2. **Decide which host and which app token this deployment uses, explicitly, before the first call.** Nothing in the configuration records **which** deployment a `baseUrl` is, and test or live mode comes from the app token, so bind both to configuration and fail startup if the (host, app token) pair is not the one this deployment intends.
3. **Build the client once and hold it.** Its controller getters (`client.charges`, `client.refunds`, …) return one instance per client, so rebuilding the client per request throws that away.
4. **Read what comes back deliberately.** Every operation returns `Promise<ApiResponse<T>>`: `await` it and a non-2xx status throws; on success `result` is the parsed model and `statusCode`, `headers` and the raw `body` sit beside it. A list returns `{ items, hasMore }` and is walked by hand with `cursor` (*What a contract sheet must carry for this SDK*). `typescript-calling-endpoints` has the mechanics.
5. Implement sequentially, following the repo's own conventions and layering and the companion skill that governs each step.
6. After every change: run the project's **type checker** (`tsc --noEmit`) as well as its tests. The package ships its own types, so a type error against it is a real contract violation, not noise — it is the compile-time backstop the whole map-first discipline leans on. **Treat a clean type check as the gate you do not skip.** If the project has no type check configured, run `tsc --noEmit` over the files you touched; if you genuinely cannot, say so in your final report rather than silently substituting a smoke run. Fix non-SDK errors yourself.
7. **Any error involving an SDK type or member** — `TS2339` (property does not exist), `TS2345`/`TS2322` (argument or assignment mismatch), `TS2551` (did you mean), `TS2307` (cannot find module — usually a deep import), `TS2739`/`TS2741` (missing required members), or an unexpected rejection at runtime — → go back to `typescript-getting-started`'s map section and file table, and read the one page or file that owns the fact. Do not attempt more than one self-fix of an SDK-name error before doing that lookup: rewriting from the same knowledge that produced the error is guessing. A failure that is not an `ApiError` — `ResponseValidationError`, `ArgumentsValidationError`, `AbortError`, an axios error or a plain `Error` — is told apart as `sdk-map.md` § *Error model* shows (`typescript-error-handling`).
8. Once the code is complete, open each member the **DUPLICATE CLAIMS** and **UNKNOWN OUTCOMES** rows name and confirm it runs when that write runs. Where the code falls short of a row, fix the code, not the row.
9. **Observability and sensitive data.** Logging is **off by default** and is configured through `logging` on `Configuration`; any `logging` object turns it on, and `logLevel` labels lines without filtering them. Say whether the integration turns it on. If the scope carries card or bank-account data, follow the **Sensitive data** rules in `typescript-getting-started`.
10. Run the project's tests; verify the integration end to end the way the task demands. Retrying is **off by default**; if the task needs it, set `httpClientOptions.retryConfig`, and read the *Retry trap* in `sdk-map.md` first — once retries are on, statuses such as 400, 401 and 404 are retried too. `Configuration` has no hook option (`sdk-map.md` lists every field), so code that must run on every request — a trace or tenant header, a metric — is yours to put around the client, or to deliberately omit. Say which you did for both.

### Step 3 — Answering pure questions

A standalone Univapay Public API question with no code change: look it up in `typescript-getting-started` (and the map page or file its table names), then give the grounded answer, citing where it came from. When several questions arrive batched, answer them in one pass.

### Step 4 — Reviewing UnivaPay code

When asked to review, audit or check code that calls UnivaPay, no plan file is needed, but the rules are. Load `typescript-univapay-payments` and go through its `shared/review-checklist.md`, every section the code touches. Then open `<plugin-root>/business-rules/`: `every-request.md`, `background.md` when the code receives webhooks or relies on renewals and retries, and the `operations/` section of every operation the code calls, and check the code against each rule that applies. Name the rule id or the checklist line for each finding. The mistakes these files list compile and pass happy-path tests, so a review that reads only the code misses them.

## Anti-patterns — never do these

- **Never create or edit a project file while `univapay-public-api-planner` is running**, and never start a second one for the same integration.
- **Never write or state any Univapay Public API or SDK fact from memory** — every signature, field name, wire header, enum member, and error arm must come from the contract sheet or a fresh lookup, never from recall or from a companion skill. And **never write a call from memory "to fix later".**
- **Never assume one error class per status across operations.** Which class a status throws is set **per operation**, in its error table: a 404 is a plain `ApiError` on `createCharge` and an `ExternalApiError` with `result` on `getCharge`. A shared handler that reads `error.result` without checking the class is a bug. Read the status from `error.statusCode`, read `result` only on an `ExternalApiError`, and fall back to `error.body`.
- **Never leave a list walk unbounded.** This SDK has no pager: a list is walked by hand, each next call carrying `cursor` set to the last item's id, and a walk ends only when `hasMore` is false — so it carries a bound of your own: a page cap, an item cap or a deadline.
- **Don't web-search Univapay Public API topics to find an implementation detail** — this plugin's SDK map and the installed package's source are the ground truth, and the map tells you where to look. Public Univapay Public API docs describe the HTTP API, not this SDK's generated surface, and the two disagree on names, on which fields are required, and on what the SDK sends by default.
- **Never introspect the SDK at run time to discover its shape.** `Object.keys`, logging a client instance, or a REPL poke is the TypeScript-flavoured version of decompiling the package: it answers what exists, never what is *supported*, and it invites `#`-private fields and unexported engine types into your code. Read the map, then the file it names.
- **Don't grep the package to *locate* a type, deep-import from it (`univapay-client-sdk/dist/…` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`), or vendor its `src/`** — the map's model index locates every type, and `typescript-getting-started`'s *Install* section says what to do instead.
- **Don't assume a name is a global.** The package root exports the client, the controllers, the models and the error classes, so an unaliased import shadows any same-named global for the rest of the file — check the name against the map before importing it plain.

