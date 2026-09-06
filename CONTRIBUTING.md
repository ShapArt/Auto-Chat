# Contributing

Thanks for helping improve Auto-Chat. The project is intentionally small, conservative, and privacy-first; contributions should preserve those constraints rather than optimize for maximum automation at any cost.

## Prerequisites

- Node.js 22+
- npm 11.6.0 is the CI baseline for the current MVP toolchain
- Firefox + Tampermonkey for live manual validation

Install exact dependencies:

```bash
npm ci
```

## Development workflow

For behavior changes, prefer test-driven development:

1. add or update a focused test that demonstrates the desired behavior;
2. verify the test fails for the intended reason;
3. implement the smallest safe change;
4. run the complete verification suite;
5. update documentation if behavior, settings, selectors, permissions, or recovery semantics changed.

Complete verification:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run check:metadata
npm run check:privacy
```

## Architecture boundaries

Keep responsibilities separated:

- `src/core/` — pure state transitions and normal autopilot orchestration;
- `src/chatgpt/` — visible ChatGPT DOM selectors and mutations;
- `src/recovery/` — classification and bounded recovery;
- `src/navigation/` — project context and validated rollover;
- `src/settings/` — validated local settings;
- `src/ui/` — Auto-Chat-owned controls only;
- `src/main.ts` — dependency wiring/bootstrap, not a second business-logic layer.

Centralize ChatGPT selectors in the DOM adapter where possible. Do not spread ad-hoc selectors through the codebase without a strong reason.

## Required safety invariants

Changes must preserve all of the following unless the design is explicitly revised and reviewed:

- idle enable never immediately sends a continuation;
- exactly one continuation at most per generation epoch;
- existing composer text is never cleared, replaced, or submitted;
- manual input pauses automation;
- ordinary conversation/project navigation pauses automation;
- safety/extended-processing UI is not automatically interrupted;
- rate/usage/login/verification/safety restrictions are not bypassed;
- recovery is finite and circuit-breakered;
- core behavior does not parse assistant output;
- persistence contains no conversation text;
- raw private ChatGPT HTML is never committed.

## Privacy rules for tests and bug fixtures

Use synthetic fixtures only. Never commit:

- real conversation text;
- email addresses or personal identifiers;
- real ChatGPT conversation/project UUIDs or copied private HTML;
- tokens, cookies, request headers, account data, or local-storage dumps.

The privacy scanner is intentionally narrow and is not a substitute for human review.

## Userscript permissions

The MVP metadata surface is intentionally restricted to:

```text
@match https://chatgpt.com/*
@grant GM_getValue
@grant GM_setValue
@grant GM_registerMenuCommand
```

Adding `@require`, `unsafeWindow`, network-capable grants, cookie/tab APIs, wildcard site access, or external runtime dependencies requires an explicit security/design review and is expected to be rejected for normal feature work.

## DOM changes

ChatGPT's DOM changes over time. When updating selectors:

- prefer stable IDs, `data-testid`, and structural attributes;
- avoid localized English text as the primary signal;
- fail closed when signals are missing or contradictory;
- add synthetic tests for the new shape;
- never commit a raw authenticated page dump.

Live selectors must still be manually validated in Firefox/Tampermonkey before claiming stable compatibility.

## Recovery changes

Recovery should distinguish a long-running response from a confirmed stall. Time alone is not sufficient evidence.

Do not add infinite loops, repeated model/account/network switching, or retry behavior intended to evade service restrictions. Safety checks and service restrictions remain outside the normal recovery ladder.

## Pull requests

A useful PR description should state:

- what behavior changed;
- which safety invariant is relevant;
- automated verification performed;
- whether live Firefox/Tampermonkey validation was performed;
- any current-DOM assumptions that may be brittle.

If live validation was not performed, say so explicitly.
