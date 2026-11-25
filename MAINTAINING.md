# Maintaining the UnivaPay plugin

This plugin has two layers:

| Layer | Where | Made by |
|---|---|---|
| SDK skills, the integrate skill, the planner agent | `skills/typescript/typescript-*` (except the one below), `scoped/` | **generated** by the APIMatic CLI (`apimatic plugin generate`) |
| Business rules | `business-rules/` | **generated** from the API definition, the docs and the tested-behaviour page (`apimatic-business-rules` skill) |
| The deep skill `typescript-univapay-payments` (recipes, guides, templates) and 7 small edits to the integrate skill | `skills/typescript/typescript-univapay-payments/`, `skills/typescript/typescript-integrate-univapay-public-api/SKILL.md` | **hand-written**, kept in the deep-skill source workspace and copied in by `assemble.mjs` |

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
- `node scripts/check-no-behaviour.mjs` (no behaviour sentence without a rule id or a "verified live" tag).

## Releasing a new plugin version

1. Set `pluginVersion` in the build project's `src/apimatic.json`.
2. Generate on Node 24, in the build project: `apimatic plugin generate --force`.
3. **Regenerating wipes the hand-written layer**: the deep skill folder is gone and the integrate skill is back to its generated text. Put it back with:
   `node <deep-skill workspace>/dev/scripts/assemble.mjs <build project>/plugin`
   It copies the deep skill, re-applies the 7 integrate-skill edits (each anchored on exact text), and refuses to run if the skill contains private data (emails, hosts, ids). Running it twice changes nothing. If an anchor is not found exactly once (the generator changed that text), it stops without writing: update the anchor in `assemble.mjs` and run it again.
4. Check: `check-rule-ids.mjs` against the new `business-rules/`, `check-no-behaviour.mjs`, and a short headless smoke session with the plugin loaded (a review prompt should open the deep skill, then the checklist, then `business-rules/`).
5. Copy the plugin into this repository and make one commit for the version.

## Where the sources are

The build project (API definition, docs, tested page, `rules-work/`, `src/apimatic.json`) and the deep-skill workspace (skill source, `dev/` with the example apps, tests, scripts and `verification/` logs) are kept outside this repository. Keep both: the rules can only be re-run from `rules-work/`, and the deep skill can only be re-assembled from its workspace.
