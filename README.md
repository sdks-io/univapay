# Univapay Public API SDK Plugin

A plugin whose skills teach a coding agent to install and use the APIMatic-generated **Univapay Public API SDK**, in TypeScript. Every SDK fact the skills state is grounded in the SDK's own source and generated documentation, not in what a model remembers about this API.

## What's inside

One skill set per language. The entry point is that language's getting-started skill, which carries what is specific to this SDK; the rest are API-agnostic and describe how to use any SDK the same generator produces.

| Language | Skill prefix | Skills |
| --- | --- | --- |
| TypeScript | `typescript-` | `typescript-authentication`, `typescript-calling-endpoints`, `typescript-client-initialization`, `typescript-configuration-resilience`, `typescript-error-handling`, `typescript-getting-started`, `typescript-integrate-univapay-public-api`, `typescript-models`, `typescript-testing`, `typescript-univapay-payments` |

The SDK is UnivaPay's own TypeScript SDK, `univapay-client-sdk`, pinned to version `1.2.3`.

- `typescript-integrate-univapay-public-api` is the first skill to load for any integration. It sets the plan-first workflow and the contract sheet.
- `typescript-univapay-payments` holds the UnivaPay payment recipes, with tested templates. It covers checkout, payment links, holds and capture, refunds, subscriptions, saved cards, 3-D Secure, konbini, bank transfer and PayPay, plus webhooks and recovery.

## Also inside

| Folder | What it holds |
| --- | --- |
| `business-rules/` | The business rules that UnivaPay's own API definition and docs state but the schema can't express, filed by operation. Start at `rules.md`. |
| `sdk-map/` | A map of `univapay-client-sdk@1.2.3`: every operation's call, argument order, wire names, headers and error classes, and every model's fields with their wire names. Every line was checked against that SDK version. Start at `sdk-map.md`. |

## Agents

| Agent | What it does |
| --- | --- |
| `univapay-public-api-planner` | Writes `univapay-public-api-plan.md` (the plan and its contract sheet) before any project code is written, and revises it in place. `typescript-integrate-univapay-public-api` starts it once the SDK is installed, on the main agent's own model. |

How each host gets it:

- **Claude Code** loads it from `scoped/agents/` with the plugin and lists it as `univapay:univapay-public-api-planner`. Its file sets `model: inherit`, so it runs on the main agent's model.
- **Where no subagent tool lists it** (a host that doesn't load a plugin's agents, or has subagents turned off), the main agent says so in one line and writes the plan itself before any code.

## Install

This plugin was **generated for you, not published to a shared plugin marketplace** — so you install it from a local path rather than by name. Point your coding agent at the directory holding this plugin, then install it:

```
/plugin marketplace add <path to the directory containing this plugin>
/plugin install univapay
```

In Codex the same two steps are CLI commands:

```
codex plugin marketplace add <path to the directory containing this plugin>
codex plugin add univapay@<marketplace>
```

`<marketplace>` is the name the directory you just added registers under — `codex plugin marketplace list` prints it.

Once your team publishes it to a plugin marketplace, add that marketplace in place of the local path and install `univapay` from it by name.

Then ask a usage question (e.g. *"how do I authenticate this SDK with an API key?"*) to trigger the relevant skill.

