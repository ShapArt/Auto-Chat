# Auto-Chat

Privacy-first Firefox/Tampermonkey userscript for continuing long-running ChatGPT workflows one turn at a time through the visible `chatgpt.com` UI.

> **Status: v0.1.0 MVP.** Automated tests, build checks, and a real Firefox + Tampermonkey installation/behavior smoke are in place, but the full signed-in live checklist against the current ChatGPT UI is still pending. Treat this branch as a release candidate, not a stable release.

## What it does

Auto-Chat adds a small floating control to ChatGPT. After you explicitly enable it, the script observes a real response generation cycle and, only after that response has finished and the composer is still empty, sends one configurable continuation prompt.

The core is deliberately conservative:

- enabling on an idle page does **not** submit anything;
- one generation epoch can produce at most one continuation;
- existing composer text is never cleared, overwritten, or submitted;
- changing conversations pauses normal automation;
- safety/extended-processing states are not interrupted automatically;
- recovery attempts are finite and circuit-breakered;
- rate, usage, login, verification, and similar service restrictions are terminal for automation rather than something to bypass;
- the userscript does not read tokens, cookies, ChatGPT storage, hidden React internals, or backend APIs;
- no telemetry, external server, remote code, or runtime dependency is used.

## Current features

- Deterministic autopilot state machine: `DISABLED → ARMED → GENERATING → SETTLING → READY → SUBMITTING → COOLDOWN` plus `PAUSED` and `ERROR`.
- ChatGPT DOM adapter using structural selectors such as `#prompt-textarea`, legacy `#composer-submit-button`, current `button[data-testid="send-button"]`, and `[data-testid="stop-button"]`.
- `MutationObserver`-driven activity tracking with a low-frequency watchdog fallback.
- Exactly-once generation epoch locking and completion debounce.
- Manual-input and conversation-navigation guards.
- Bounded Send-readiness polling after continuation insertion, with pending-composer revalidation before automated submission.
- Configurable continuation prompt, checkpoint interval, and session turn limit.
- `AUTOPILOT_CHECKPOINT_V1` request protocol for project-context continuity without parsing assistant output.
- Conservative same-project rollover foundation using visible `/g/g-p-…/project` navigation only.
- `[AUTOPILOT_RESUME]` prompt containing technical session identifiers only.
- Bounded recovery supervisor for stalls and recoverable UI failures.
- One-shot same-path reload-resume marker that preserves only technical session identity and bounded reload history.
- Safe Mode, emergency stop, pause, recovery reset, settings dialog, and `Alt+Shift+A` toggle hotkey.
- Offline/online settling and recovery circuit breakers.
- Standalone `.user.js` bundle with no runtime dependencies.
- Metadata and committed-fixture privacy checks in CI.
- Permanent Firefox + Tampermonkey smoke that installs the exact current build through Tampermonkey's real install UI and exercises mount plus key AUTO safety/submit scenarios in a real Firefox engine.

## What it intentionally does not do

Auto-Chat does **not**:

- bypass usage/rate/safety/login/CAPTCHA/verification restrictions;
- intercept `fetch`/XHR or call private ChatGPT endpoints;
- read authentication tokens, cookies, localStorage, IndexedDB, or account data;
- scrape or programmatically extract assistant responses;
- use `unsafeWindow`, `GM_xmlhttpRequest`, tab/cookie APIs, or remote `@require` code;
- switch accounts, networks, models, or VPNs to evade service restrictions;
- retry or reload forever;
- claim that a completely frozen browser main thread can be recovered by JavaScript.

## Installation for testing

Requirements:

- Firefox;
- Tampermonkey;
- Node.js 22+ for building from source.

Build the userscript:

```bash
npm ci
npm run build
```

The generated file is:

```text
dist/chatgpt-autopilot.user.js
```

Open Tampermonkey's dashboard, create/import a userscript from that file, save it, then open `https://chatgpt.com/`.

The generated metadata is intentionally narrow:

```text
@match https://chatgpt.com/*
@run-at document-idle
@sandbox DOM
@grant GM_getValue
@grant GM_setValue
@grant GM_registerMenuCommand
```

There is no `@require` and no network-capable userscript grant.

## Controls

The floating control exposes:

- **AUTO** — enable/disable the normal autopilot loop;
- **Pause** — pause automation without trying recovery actions;
- **Stop** — emergency disable;
- **Safe** — toggle Safe Mode, which disables automated mutation/recovery/navigation actions;
- **Reset** — reset the recovery circuit breaker when Safe Mode is off;
- **Settings** — edit continuation prompt, checkpoint cadence, and optional session turn limit.

Default hotkey: `Alt+Shift+A`.

The control tooltip contains only technical state such as session ID, state, rollover part, successful-turn count, and generation epoch. It does not display conversation text.

## How continuation works

Enabling Auto-Chat while nothing is happening leaves the state at `ARMED`. Nothing is submitted.

A normal cycle is:

1. ChatGPT visibly starts generating.
2. Auto-Chat records a new generation epoch.
3. Generation visibly stops.
4. A completion debounce expires with no new generation activity.
5. The script re-checks the conversation path and confirms the composer is still empty.
6. The epoch is locked as submitted before any composer mutation occurs.
7. The continuation prompt is inserted into the empty composer.
8. For at most two seconds, Auto-Chat waits for the visible Send control to become available while repeatedly confirming that the composer still matches the text it inserted.
9. If the pending composer is manually edited, automation pauses instead of sending it; otherwise the visible Send button is clicked once when ready.
10. A post-submit guard waits for the next real generation to begin.

Repeated DOM mutations cannot cause a second submission for the same epoch.

## Checkpoints and project rollover

At `checkpointEvery` successful cycles, the next continuation also asks ChatGPT to append a concise `AUTOPILOT_CHECKPOINT_V1` to its response. The userscript never parses that checkpoint. Its purpose is to leave continuity information inside the Project context itself.

For a validated rollover, Auto-Chat only proceeds when it can prove from a visible link and the current URL that it remains inside the same ChatGPT Project. It does not use the global root **New chat** action as a shortcut.

The resume prompt contains only technical data such as:

```text
[AUTOPILOT_RESUME]
sessionId: auto-YYYYMMDD-xxxxxx
rolloverIndex: N
```

and tells ChatGPT to use Project context and the latest checkpoint if available.

If same-project navigation cannot be proven, the script fails closed and pauses instead of guessing.

## Recovery model

Long generation by itself is not treated as failure. Recovery distinguishes active work from a suspected stall using generation state, relevant DOM activity, safety/extended-processing state, and soft/hard timers.

The recovery ladder is bounded:

1. wait;
2. safe stop after a confirmed stall;
3. at most one normal regenerate/retry where the visible UI supports it;
4. bounded reload governed by a circuit breaker;
5. same-project rollover only when it can be validated;
6. otherwise pause for a human.

Before an automated reload, Auto-Chat writes a one-shot recovery marker through Tampermonkey storage. The marker contains only the current `chatgpt.com` path, request timestamp, Auto-Chat session ID, rollover index, and recent reload timestamps. On the next bootstrap it is consumed immediately whether valid or invalid. It is accepted only on the exact same path and only for 60 seconds; a valid marker restores the technical session and reload circuit-breaker history, then re-arms automation without submitting a continuation merely because the page loaded.

Safety checks and service restrictions are outside this ladder and are never automatically "pushed through".

## Privacy model

Auto-Chat's intended persistence contains settings and technical state only. Conversation text is not intentionally logged or persisted by the userscript.

The reload-resume marker is deliberately content-free: it does not contain prompts, assistant output, cookies, tokens, account identifiers, or copied ChatGPT storage. It is one-shot and is cleared on bootstrap, Stop, or Safe Mode.

During the bounded Send-readiness wait, the current composer is compared in memory with the continuation text that Auto-Chat itself just inserted. That comparison is used only to detect a manual edit before submission; the compared text is not added to logs or persistent state.

Debug logging is off by default and is designed for technical state transitions, not prompts or outputs.

Committed DOM fixtures are synthetic. CI scans those fixtures for obvious email addresses, canonical UUIDs, and private/raw snapshot markers. The raw ChatGPT snapshot used during initial selector research is not part of the repository.

## Development

Install exact dependencies from the lockfile:

```bash
npm ci
```

Run the complete local verification sequence:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run check:metadata
npm run check:privacy
```

Useful source areas:

```text
src/core/         normal autopilot state machine and orchestration
src/chatgpt/      visible DOM adapter
src/recovery/     classifier, bounded recovery supervisor, and reload-resume state
src/navigation/   project context / rollover helpers
src/settings/     local settings validation and persistence
src/ui/           floating control
src/main.ts       runtime wiring and Tampermonkey bootstrap
scripts/          build, metadata, and privacy gates
tests/            unit/integration tests and synthetic fixtures
tools/            real-browser Firefox/Tampermonkey smoke harness
```

The Firefox/Tampermonkey smoke builds the exact checked-out userscript, installs pinned Tampermonkey in headless Firefox, installs the userscript through Tampermonkey's real UI, verifies a single `AUTO · off` mount on `chatgpt.com`, and then uses a synthetic visible-DOM fixture on that real origin to exercise:

- idle enable → `armed`, zero submission;
- one generation with delayed Send → exactly one input and exactly one Send click;
- existing manual draft on enable → immediate fail-closed pause, draft preserved, zero Send clicks;
- manual edit during the pending-Send window → pause before Send, zero Send clicks.

This browser smoke does not authenticate to ChatGPT and does not access account/session data.

See the design and implementation plan under `docs/superpowers/` for the detailed safety invariants and rationale.

## Live Firefox validation checklist

Before calling v0.1.0 stable, test on a harmless dedicated ChatGPT conversation/project in Firefox + Tampermonkey:

- the control mounts once and does not affect normal manual use while disabled;
- enabling on idle submits nothing;
- one completed generation triggers exactly one continuation;
- Send appearing only after continuation insertion is handled within the bounded readiness wait;
- manually editing a pending continuation before Send becomes ready pauses instead of submitting the changed draft;
- typing in the composer before submission pauses and preserves the draft;
- Stop and Safe Mode cancel pending automation;
- extended/safety processing is not interrupted;
- offline/online transitions settle safely;
- ordinary conversation navigation pauses;
- same-project rollover, if available in the live DOM, remains in the same project;
- a bounded recovery reload re-arms the same technical session without an immediate continuation submission;
- stale or wrong-path reload markers fail closed and are consumed;
- reload/recovery circuit breakers remain bounded across page reloads and do not loop;
- contenteditable insertion is accepted by the live ProseMirror composer;
- no unexpected browser-console errors occur.

Automated CI now covers installation, mount, exact-once delayed-Send behavior, and the two key manual-input guards in a real Firefox/Tampermonkey environment. The remaining manual gate is specifically for the current signed-in ChatGPT UI, real Project navigation/recovery surfaces, network transitions, and live ProseMirror acceptance.

Until that checklist has been completed, compatibility should be described as **designed for Firefox/Tampermonkey; automated real-browser smoke green; full signed-in live validation pending**.

## Security

See [SECURITY.md](SECURITY.md). Please never include real conversation text, account identifiers, cookies, tokens, or raw private ChatGPT HTML in a public bug report.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes that weaken the privacy boundary, introduce hidden/backend APIs, make recovery unbounded, or bypass service restrictions are out of scope.

## License

MIT — see [LICENSE](LICENSE).
