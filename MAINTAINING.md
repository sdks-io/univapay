# Maintaining the UnivaPay plugin (0.2.0 and later: UnivaPay's own v3 SDK)

Since 0.2.0 the plugin targets **UnivaPay's own TypeScript SDK**, npm `univapay-client-sdk`, pinned to exactly `1.2.3` (GitHub `univapay/univapay-client-js-sdk`, tag `1.2.3`). That SDK was generated with APIMatic **v3**. Up to 0.1.1 the plugin targeted our own v4 SDK (`sdks-io/univapay-apimatic-ts-sdk`); the 0.1.1 release recipe no longer applies.

The plugin has these layers:

| Layer | Where in the plugin | Made by |
|---|---|---|
| 8 base SDK skills (v3) | `skills/typescript/typescript-*` (except the two below) | **generated** by APIMatic CLI **1.5.0** with `codegenVersion: "v3"` (CLI 2.x can only make v4 skills) |
| Fixes to the generated skills (audit fixes, lookup layer, README) | edits inside the files above | **anchored edits** in `v3/overlay/edits/*.json`, applied by `assemble-v3.mjs` |
| The integrate skill and the planner agent | `skills/typescript/typescript-integrate-univapay-public-api/`, `scoped/agents/` | **hand-written** in `v3/overlay/` (the v3 generator doesn't make them) |
| The SDK map (every operation, model and enum of SDK 1.2.3, verified) | `sdk-map/` | **hand-made and checked** in `v3/map/` (`VERIFY.md`) |
| Business rules | `business-rules/` | **generated** from the API definition, the docs and the tested-behaviour page (`apimatic-business-rules` skill) |
| The deep skill `typescript-univapay-payments` (recipes, guides, templates) | `skills/typescript/typescript-univapay-payments/` | **hand-written** in `v3/deep-skill/skill/` |

All of these are put together by `v3/scripts/assemble-v3.mjs`.

Trust order for agents: the rules say how UnivaPay behaves; the deep skill says what to build.

## When something changes

### The API definition or the docs changed
1. Re-apply the spec fixes (`spec-fixes/apply-fixes-*.cjs`, in order) to the new definition, or retire the ones UnivaPay fixed.
2. Re-run the business rules: the `apimatic-business-rules` skill, section "Running it again". Keep the `rules-work/` folder of the build project: it holds the records, the run state and every past update log, and the re-run only redoes the operations whose inputs changed. `rules.mjs` needs Node 24. Never renumber or remove a rule id; the deep skill cites them.
3. Run `rules.mjs check`.
4. Regenerate the SDK and the plugin (below).

### UnivaPay behaves differently from what the rules say
1. Test it in **test mode** and keep the raw output.
2. Add a dated line to the tested-behaviour page (`content/tested/sandbox-api-behaviour.md` in the build project), with where the evidence is.
3. Re-run the rules for the affected operations, then `rules.mjs check`.
4. If the deep skill relied on the old behaviour, fix the recipe or template, and test the change live (below).

### A recipe, guide or template changes
Hard rule: nothing goes into the deep skill until it is **tested and verified**:
- an example app in the dev workspace runs the step live in test mode, end to end;
- unit tests pass (`npm test`) and strict `tsc` is clean (`npm run typecheck`);
- steps that test mode can't show are marked as such in the recipe;
- a verification log is written (`verification/`).

For UnivaPay behaviour, a recipe line cites a rule id; it never restates the fact. Run both checkers:
- `node scripts/check-rule-ids.mjs <plugin>/business-rules` (every cited rule id exists);
- `node scripts/check-no-behaviour.mjs`: every behaviour sentence must cite a rule id, or be tagged `(SDK, tested)` (a fact about the SDK) or `(app rule)`. A "verified live" note alone is not accepted.

## Releasing a new plugin version

1. Set `pluginVersion` in `v3/plugin-build/src/plugin-config.json`. Keep `codegenVersion: "v3"` and the SDK pin (`source.branch` and `package.version`) in step with the SDK the deep skill is tested against.
2. Generate the base plugin with APIMatic **CLI 1.5.0** in `v3/plugin-build/` (`apimatic plugin generate`; the server builds it from `src/`). Don't use CLI 2.x: it always makes v4 skills.
3. Add everything else: `node v3/scripts/assemble-v3.mjs v3/plugin-build/plugin`. By default it takes the rules from the build project's `src/rules`; `--rules <dir>` sets another folder, and `--dry-run` writes nothing. What it does:
   - a publish check first (emails, JWTs, tunnel hosts, ids, unknown hosts);
   - the anchored edits from `v3/overlay/edits/*.json`; if an anchor is not found exactly once (the generator changed that text), it stops without writing, so fix the anchor and run it again;
   - mirrors the overlay, `sdk-map/`, the deep skill and `business-rules/`, and patches the manifests.

   A second run changes nothing.
4. Check:
   - `node v3/deep-skill/dev/scripts/check-rule-ids.mjs v3/plugin-build/plugin/business-rules` (every cited rule id exists);
   - `node v3/deep-skill/dev/scripts/check-no-behaviour.mjs`;
   - in `v3/deep-skill/dev`: `npm test` and `npm run typecheck`;
   - a short headless smoke session with the plugin loaded (`claude -p --plugin-dir <plugin>`): a build prompt should open the integrate skill, the deep skill, `sdk-map/` and `business-rules/`.
5. Copy the plugin into this repository and make one commit for the version. After pushing, install the plugin from GitHub in a clean session and run one short prompt.

## Where the sources are

The sources are kept outside this repository:
- **the build project:** API definition, docs, tested page, `rules-work/`;
- **the `v3/` workspace:** `plugin-build/` with `plugin-config.json`, `scripts/assemble-v3.mjs`, `overlay/`, `map/`, and `deep-skill/`. The last holds the skill source plus `dev/`, with the example apps, tests, scripts and `verification/` logs.

A private copy is in `sdks-io/univapay-plugin-sources`. Keep all of it: the rules can only be re-run from `rules-work/`, and the plugin can only be re-assembled from `v3/`.

## Bugs in the SDK

UnivaPay's SDK 1.2.3 has 19 verified bugs. The plain-English report for UnivaPay and APIMatic is `v3/deep-skill/verification/BUG-REPORT-UNIVAPAY.md`; the full technical list, with every workaround, is `BUG-HANDLING.md`.

## The SDK this deep skill is built on (v3 port)

- The deep skill, its templates, examples and tests use UnivaPay's own SDK, npm `univapay-client-sdk`, pinned to exactly `1.2.3` in `dev/package.json` (with the lockfile).
- Run scripts with `tsx` (`npx tsx examples/r3-authorize-capture/run-live.ts`): plain Node can't load the SDK as an ES module (SDK 1.2.3 bug N2). `vitest.config.ts` inlines the package for the same reason.
- `npm test` runs the unit tests (UnivaPay's real SDK against a local fake server, `test/fake-univapay.ts`); `npm run typecheck` is strict `tsc`.
- Live runs (test mode only) read the keys from the `.env` file inside the scripts. Webhook-delivery checks need a public tunnel: set `TUNNEL=https://…` (pointing at `live/hub.ts` on :8080); without it they are skipped and say so.
- Every object a live run creates is recorded in `live/out/created.jsonl`; `npx tsx live/cleanup.ts` refunds, cancels or deletes whatever is still open.
- `test/sdk-1.2.3-bugs.test.ts` and `live/check-sdk-bugs.ts` prove each SDK problem the skill works around. Every note and safe-code comment for one is tagged `(SDK 1.2.3 bug X)`.

### When UnivaPay releases a new SDK version
The SDK map in the plugin (`sdk-map/`) is ours, not the SDK's, so it does **not** update itself; in v4 the generator shipped the map inside the SDK package. The map, the skills and the plugin's pin all name exactly `1.2.3`, and the getting-started skill tells agents to distrust the map when `npm ls` shows another version. So a new SDK version needs all of these steps:
1. **Refresh the map.** In `v3/work/map-agent/checks/`, pin the new version in `package.json`, then `npm install` and `node run-all.mjs --live --selftest` (see `v3/map/VERIFY.md`, "How to re-run"). This rebuilds the map from the new source and re-runs every check (compile, wire, models, docs, live). Fix every failing check, and replace `1.2.3` in the map's header and pages.
2. **Find the fixed bugs.** Pin the new version in `dev/package.json` and run `npm test`: each test in `test/sdk-1.2.3-bugs.test.ts` and `test/sdk-1.2.3-map-bugs.test.ts` that now FAILS is a bug that was fixed. Also run `npx tsx live/check-sdk-bugs.ts`.
3. **Remove the old workarounds.** For each fixed bug, search the skill and the dev workspace for its tag (e.g. `grep -rn "SDK 1.2.3 bug N1"`) and remove the note and its safe code, as listed in `verification/BUG-HANDLING.md`.
4. **Move the pin everywhere.** Update `v3/plugin-build/src/plugin-config.json` (`source.branch`, `package.version`), the anchored edits in `v3/overlay/edits/` that name the version, the integrate skill in `v3/overlay/`, and the deep skill.
5. **Re-run everything:** `npm run typecheck`, `npm test`, both checkers, the live runs, then `live/cleanup.ts`. Then release a new plugin version (above).
