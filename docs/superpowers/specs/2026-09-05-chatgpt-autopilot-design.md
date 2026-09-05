# ChatGPT Autopilot Userscript — Design

Date: 2026-09-05
Status: Approved for implementation (user explicitly requested implementation of the supplied master prompt + recovery addendum)

## 1. Goal

Build a privacy-first Firefox/Tampermonkey userscript for `https://chatgpt.com/*` that, while explicitly enabled by the user, safely continues a long-running ChatGPT workflow one turn at a time.

The script operates only on visible page DOM. It must not use ChatGPT backend APIs, tokens, cookies, account storage, telemetry, external servers, hidden React internals, or automated Output extraction.

The project also includes a bounded recovery supervisor for stalled/error states and a project-preserving rollover path for conversations that cannot safely continue.

## 2. Key design decisions

### 2.1 Event-driven core

Primary UI observation uses `MutationObserver`; a low-frequency watchdog is only a fallback for timers, stale states, and stall detection. There is no high-frequency whole-document polling loop.

### 2.2 Stable selectors are centralized

A single ChatGPT DOM adapter owns selectors and DOM actions. Current research/snapshot evidence supports:

- composer: `#prompt-textarea` (ProseMirror/contenteditable)
- submit: `#composer-submit-button`
- streaming/stop: `[data-testid="stop-button"]`
- extended processing structural signal: `[data-streaming-response-status]`

In the September 2026 snapshot, the submit button becomes the stop button while generation is active, so generation detection must prefer `data-testid="stop-button"` over English aria text.

ARIA/text selectors may be fallbacks only. The adapter must fail closed when required DOM is missing or contradictory.

### 2.3 No external runtime dependency

The userscript will not depend on `chatgpt.js` at runtime. The task needs a small number of audited DOM operations and the dependency would increase supply-chain and update coupling. Existing projects are references only.

### 2.4 Explicit deterministic state machines

Normal-cycle states:

`DISABLED → ARMED → GENERATING → SETTLING → READY → SUBMITTING → COOLDOWN`

Additional safe stops:

`PAUSED`, `ERROR`.

Recovery states are modeled separately by `RecoverySupervisor`:

`NORMAL`, `GENERATING`, `SAFETY_CHECK_WAIT`, `SUSPECT_STALL`, `STALLED`, `STOPPING`, `REGENERATING`, `RECOVERY_WAIT`, `RELOADING`, `RESTORING_AFTER_RELOAD`, `GENERATION_ERROR`, `SERVICE_RESTRICTION`, `CONVERSATION_EXHAUSTED`, `ROLLOVER_PREP`, `CREATING_NEW_CHAT`, `RESUMING_PROJECT_CONTEXT`, `ROLLOVER_VALIDATION`, `PAUSED`, `FATAL`.

Normal autopilot orchestration never directly performs recovery actions; recovery is delegated to `RecoverySupervisor`.

## 3. Core safety invariants

1. Enabling while the page is idle never immediately sends a continuation. A full `generation started → generation finished` cycle must first be observed.
2. One generation epoch can trigger at most one continuation submission.
3. Existing composer text is never cleared, replaced, or submitted. Manual input immediately wins and pauses automation.
4. Changing conversation/project context pauses automation and requires explicit re-enable unless the transition is a deliberate validated rollover performed by `ProjectNavigator`.
5. Restrictions such as rate/usage/login/verification/safety blocks are terminal for automation; no retry/reload/model-switch workaround is attempted.
6. Recovery is finite. Circuit breakers prevent retry/reload loops.
7. Safety/extended-processing UI is never interrupted automatically.
8. Raw assistant Output is not parsed to drive the core or rollover logic.
9. The supplied raw ChatGPT HTML snapshot is research-only and must never be committed.
10. Technical persistence contains only script/session state and settings, never conversation text.

## 4. Components

### `src/core/state-machine.ts`
Pure transition logic for the normal autopilot cycle. No DOM access and no timers. Fully unit tested.

### `src/chatgpt/dom-adapter.ts`
Owns all ChatGPT selectors and DOM interactions:

- find composer/submit/stop controls
- determine idle/generating/extended-processing state
- determine composer emptiness and submit availability
- insert text into ProseMirror via browser input semantics
- submit prompt through visible UI
- observe relevant DOM state changes
- expose safe structural signals to the classifier

No React internals or private APIs.

### `src/core/autopilot.ts`
Normal orchestration, generation epochs, completion debounce, cooldown/post-submit guard, manual-input detection, navigation guard, and session turn/checkpoint scheduling.

### `src/recovery/error-classifier.ts`
Classifies visible UI states only: generation/network failure, websocket error, stall, safety check, rate/usage limit, login/verification, conversation limit, unavailable composer, broken page, script incompatibility, unknown.

### `src/recovery/recovery-supervisor.ts`
Finite recovery ladder:

0. wait
1. safe stop
2. at most one normal regenerate/retry for the failed turn
3. bounded normal reload
4. project-preserving rollover
5. human pause

Tracks soft/hard stall timers, activity timestamps, recovery attempts, reload windows, and circuit-breaker counters.

### `src/navigation/project-navigator.ts`
Detects current conversation/project context, validates that navigation remains within the same project, creates a new project chat when safely possible, advances `rolloverIndex` once, and submits the resume prompt.

If project identity/navigation cannot be determined confidently, it pauses rather than guessing.

### `src/settings/settings.ts`
Tampermonkey-backed settings with defaults and reset. Expected grants are limited to `GM_getValue`, `GM_setValue`, and `GM_registerMenuCommand` (or their compatible equivalents used by the final build).

### `src/ui/control.ts`
Small fixed control/status badge, settings dialog, emergency stop/pause/safe-mode actions, state/elapsed-time display, and configurable toggle hotkey. It never shows conversation text.

### `src/utils/logger.ts`
Debug logging off by default. Technical state transitions only; no prompt/output/account data.

### `src/main.ts`
Bootstrap only.

## 5. Continuation and checkpoint protocol

Normal continuation prompt is configurable and persisted locally.

At a configurable interval (default design target: every 10 successful cycles), the next continuation becomes a checkpoint instruction asking ChatGPT to append a concise `AUTOPILOT_CHECKPOINT_V1` to its own response. The userscript never parses that checkpoint.

For rollover, a new chat in the same Project receives an `[AUTOPILOT_RESUME]` prompt containing only technical identifiers (`sessionId`, `rolloverIndex`) plus instructions to use Project context and the latest checkpoint if available.

Project memory is the primary continuity mechanism; `handoff.md` is a manual fallback, not an automatically accumulated file stream.

## 6. Recovery behavior

### Stall detection

Long generation is not itself a stall. `SUSPECT_STALL` requires all of:

- generation still appears active;
- no safety/extended-processing state;
- no relevant DOM/state activity for `softStallTimeout`;
- page event loop remains responsive.

If activity resumes during grace, return to normal generation. Hard recovery occurs only after confirmed stall/hard timeout rules.

Initial implementation defaults are conservative and configurable; manual Firefox testing may tune them before a stable release.

### Reload restore

Before reload, persist only technical state (enabled/session/conversation/project marker/recovery counters/timestamps/settings). After reload, enter `RESTORING_AFTER_RELOAD`, settle, then re-evaluate composer, generation, errors, manual text, and URL before taking any action.

### Safe Mode

Safe Mode disables submit/recovery/navigation mutations and leaves only minimal observation/status UI. Internal incompatibility or repeated DOM contradictions should recommend/enter Safe Mode rather than escalating DOM manipulation.

## 7. Testing strategy

Use TypeScript + Vitest + jsdom synthetic fixtures. Unit tests never depend on the live ChatGPT site.

Fixtures:

- idle
- streaming
- manual input
- generic error
- safety check
- conversation/project navigation states as needed

State-machine tests cover all critical transitions and exactly-once behavior. DOM-adapter tests cover selectors, generation detection, ProseMirror insertion, non-overwrite behavior, and submit gating. Recovery tests cover long normal generation, safety-check immunity, stall grace, one-stop/one-regenerate limits, terminal restrictions, reload breaker, offline/online behavior, and reset on successful completion. Navigation tests cover project preservation, abort on unknown/wrong project, session identity, and rollover index.

Use fake timers for debounce/cooldown/stall tests.

A privacy/fixture scan must fail CI if obvious email addresses, real chat UUID-like identifiers, or known snapshot-specific strings appear in committed fixtures.

## 8. Build and repository

Source is modular TypeScript; build output is one standalone `dist/chatgpt-autopilot.user.js` with zero runtime dependencies.

Tooling target:

- npm with lockfile
- TypeScript
- esbuild (build only)
- Vitest + jsdom
- ESLint + Prettier
- GitHub Actions on push/PR: install, format/lint, typecheck, test, build, userscript metadata/privacy checks

Repository also includes README, MIT LICENSE, SECURITY, CONTRIBUTING, CHANGELOG, `.gitignore`, and `.editorconfig`.

## 9. Out of scope / forbidden

- bypassing rate/usage/safety/login/CAPTCHA/verification restrictions
- scraping or programmatically extracting ChatGPT Output
- reading tokens/cookies/ChatGPT localStorage/IndexedDB
- intercepting fetch/XHR or using hidden backend endpoints
- telemetry/analytics/external servers
- remote code loading/eval/obfuscation
- infinite retry/reload loops
- automatic account/network/VPN changes
- claiming recovery during a completely frozen browser main thread

## 10. Release gate

Initial target is `v0.1.0` MVP, not `v1.0.0`.

A stable release must not be claimed until automated verification passes and the Firefox/Tampermonkey manual checklist has been performed on a harmless dedicated ChatGPT test conversation. Until that manual step is completed, compatibility is documented as "designed for Firefox/Tampermonkey; manual live validation pending".
