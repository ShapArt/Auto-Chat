# ChatGPT Autopilot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable `v0.1.0` Firefox/Tampermonkey userscript that safely auto-continues completed ChatGPT turns, pauses on manual/navigation/restriction states, and includes bounded stall/reload/project-rollover recovery foundations.

**Architecture:** A zero-runtime-dependency TypeScript userscript uses a centralized ChatGPT DOM adapter plus pure state machines. `Autopilot` owns the normal generation/completion/continuation loop; `RecoverySupervisor` owns exceptional states and finite recovery; `ProjectNavigator` owns deliberate same-project rollover. The production build is one standalone `.user.js` bundle.

**Tech Stack:** TypeScript 5.x, esbuild, Vitest, jsdom, ESLint 9, Prettier, npm lockfile, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-chatgpt-autopilot-design.md`

## Global Constraints

- Runtime dependencies = 0.
- `@match` is only `https://chatgpt.com/*`.
- Allowed Tampermonkey storage/menu capabilities: `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`.
- No backend ChatGPT API, fetch/XHR interception, tokens, cookies, ChatGPT localStorage/IndexedDB, telemetry, remote code, `eval`, React internals, or Output scraping.
- Raw user HTML snapshots never enter Git; fixtures are synthetic.
- One generation epoch may cause at most one continuation submission.
- Manual composer text always pauses automation and is never overwritten/submitted.
- Rate/usage/login/verification/safety restrictions are terminal for automation.
- Recovery actions are finite and protected by circuit breakers.
- Live Firefox compatibility is not claimed until the manual checklist is actually run.

---

## File map

- `package.json` — scripts/tooling metadata.
- `tsconfig.json` — strict browser TypeScript configuration.
- `eslint.config.js`, `.prettierrc.json`, `.editorconfig`, `.gitignore` — source quality.
- `scripts/build.mjs` — esbuild userscript build with metadata banner.
- `scripts/check-metadata.mjs` — verifies required userscript header fields/grants/match.
- `scripts/privacy-scan.mjs` — rejects obvious real emails/chat UUIDs/snapshot strings in fixtures.
- `src/core/state-machine.ts` — pure normal-cycle transitions.
- `src/core/types.ts` — shared technical state/types only.
- `src/core/autopilot.ts` — normal loop orchestration and exactly-once epoch lock.
- `src/chatgpt/dom-adapter.ts` — all ChatGPT selectors and visible DOM actions.
- `src/recovery/error-classifier.ts` — visible UI classification.
- `src/recovery/recovery-supervisor.ts` — finite recovery ladder/circuit breaker.
- `src/navigation/project-navigator.ts` — conversation/project identity and deliberate rollover.
- `src/settings/settings.ts` — defaults + GM persistence adapter.
- `src/ui/control.ts` — floating control, settings, status and emergency controls.
- `src/utils/logger.ts` — redaction-safe technical logger.
- `src/main.ts` — bootstrap.
- `tests/fixtures/*.html` — synthetic UI states.
- `tests/**/*.test.ts` — unit/integration tests.
- `.github/workflows/ci.yml` — deterministic checks.
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` — publication quality.

---

### Task 1: Tooling foundation and pure state machine

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `src/core/types.ts`
- Create: `src/core/state-machine.ts`
- Create: `tests/core/state-machine.test.ts`

**Interfaces:**
- Produces `AutopilotState = 'DISABLED' | 'ARMED' | 'GENERATING' | 'SETTLING' | 'READY' | 'SUBMITTING' | 'COOLDOWN' | 'PAUSED' | 'ERROR'`.
- Produces `AutopilotEvent` discriminated union with `ENABLE`, `DISABLE`, `GENERATION_STARTED`, `GENERATION_STOPPED`, `SETTLED`, `SUBMIT_STARTED`, `SUBMIT_SUCCEEDED`, `NEXT_GENERATION_STARTED`, `MANUAL_INPUT`, `CONVERSATION_CHANGED`, `FAIL`.
- Produces `transition(state, event): AutopilotState`.

- [ ] **Step 1: Add the failing state-machine tests**

```ts
import { describe, expect, it } from 'vitest';
import { transition } from '../../src/core/state-machine';

describe('transition', () => {
  it('arms when enabled and never treats idle as completion', () => {
    expect(transition('DISABLED', { type: 'ENABLE' })).toBe('ARMED');
    expect(transition('ARMED', { type: 'SETTLED' })).toBe('ARMED');
  });

  it('requires a real generation cycle before READY', () => {
    let state = transition('DISABLED', { type: 'ENABLE' });
    state = transition(state, { type: 'GENERATION_STARTED' });
    expect(state).toBe('GENERATING');
    state = transition(state, { type: 'GENERATION_STOPPED' });
    expect(state).toBe('SETTLING');
    state = transition(state, { type: 'SETTLED' });
    expect(state).toBe('READY');
  });

  it('manual input and conversation changes pause from active states', () => {
    expect(transition('GENERATING', { type: 'MANUAL_INPUT' })).toBe('PAUSED');
    expect(transition('COOLDOWN', { type: 'CONVERSATION_CHANGED' })).toBe('PAUSED');
  });

  it('disable wins from every state', () => {
    for (const state of ['ARMED','GENERATING','SETTLING','READY','SUBMITTING','COOLDOWN','PAUSED','ERROR'] as const) {
      expect(transition(state, { type: 'DISABLE' })).toBe('DISABLED');
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- --run tests/core/state-machine.test.ts`

Expected: module-not-found / missing implementation failure.

- [ ] **Step 3: Implement the minimal pure transition function**

Use a total `switch` over events. `SETTLED` changes only `SETTLING → READY`; it is ignored in `ARMED`. `GENERATION_STARTED` changes `ARMED|COOLDOWN → GENERATING`. `DISABLE` always returns `DISABLED`; `MANUAL_INPUT` and `CONVERSATION_CHANGED` return `PAUSED` unless already disabled.

- [ ] **Step 4: Run the state-machine test and typecheck**

Run: `npm test -- --run tests/core/state-machine.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add autopilot state machine foundation`

---

### Task 2: Synthetic fixtures and ChatGPT DOM adapter

**Files:**
- Create: `tests/fixtures/chatgpt-idle.html`
- Create: `tests/fixtures/chatgpt-streaming.html`
- Create: `tests/fixtures/chatgpt-manual-input.html`
- Create: `tests/fixtures/chatgpt-error.html`
- Create: `tests/fixtures/chatgpt-safety-check.html`
- Create: `src/chatgpt/dom-adapter.ts`
- Create: `tests/chatgpt/dom-adapter.test.ts`

**Interfaces:**
- Produces class `ChatGptDomAdapter` with:
  - `findComposer(): HTMLElement | null`
  - `findSubmitButton(): HTMLButtonElement | null`
  - `findStopButton(): HTMLButtonElement | null`
  - `isGenerating(): boolean`
  - `isSafetyCheckActive(): boolean`
  - `isComposerEmpty(): boolean`
  - `canSubmit(): boolean`
  - `insertComposerText(text: string): boolean`
  - `submitPrompt(): boolean`
  - `observeRelevantActivity(callback: () => void): () => void`

- [ ] **Step 1: Write RED tests against synthetic DOM**

Tests must prove:

```ts
expect(adapter.findComposer()?.id).toBe('prompt-textarea');
expect(adapter.findSubmitButton()?.id).toBe('composer-submit-button');
expect(adapter.isGenerating()).toBe(true); // fixture has data-testid="stop-button"
expect(adapter.isSafetyCheckActive()).toBe(true); // fixture has data-streaming-response-status
expect(adapter.isComposerEmpty()).toBe(false); // manual-input fixture
```

Also test that `insertComposerText('Continue')` returns `false` for a non-empty composer and does not alter its text.

For an empty composer, attach an `input` listener, call `insertComposerText`, and assert both DOM text and an `input` event are observed. Do not set `innerHTML` directly in production code.

- [ ] **Step 2: Run adapter tests and confirm RED**

Run: `npm test -- --run tests/chatgpt/dom-adapter.test.ts`

Expected: missing adapter failure.

- [ ] **Step 3: Implement stable selectors and safe insertion**

Primary selectors are constants:

```ts
const COMPOSER = '#prompt-textarea';
const SUBMIT = '#composer-submit-button';
const STOP = '[data-testid="stop-button"]';
const SAFETY_CHECK = '[data-streaming-response-status]';
```

`insertComposerText` must:

1. reject blank input;
2. reject missing/non-empty composer;
3. focus the contenteditable;
4. select its contents with `Range`/`Selection`;
5. prefer `document.execCommand('insertText', false, text)` when supported for browser editor compatibility;
6. otherwise use `textContent = text` followed by a bubbling `InputEvent('input', { inputType: 'insertText', data: text })`;
7. verify the resulting visible text equals the requested text.

`submitPrompt` clicks only an enabled submit button that is not currently the stop button.

- [ ] **Step 4: Run adapter tests**

Run: `npm test -- --run tests/chatgpt/dom-adapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add sanitized ChatGPT DOM adapter`

---

### Task 3: Settings, logger, normal Autopilot orchestration

**Files:**
- Create: `src/settings/settings.ts`
- Create: `src/utils/logger.ts`
- Create: `src/core/autopilot.ts`
- Create: `tests/core/autopilot.test.ts`

**Interfaces:**
- `AutopilotSettings` includes `continuationPrompt`, `completionDebounceMs`, `postSubmitGuardMs`, `watchdogMs`, `softStallTimeoutMs`, `hardStallTimeoutMs`, `checkpointEvery`, `sessionTurnLimit`, `hotkey`, `debug`.
- `SettingsStore.load(): Promise<AutopilotSettings>` and `save(settings): Promise<void>` support sync or Promise-returning GM implementations through `await Promise.resolve(...)`.
- `Autopilot` public methods: `enable()`, `disable()`, `pause(reason)`, `start()`, `stop()`, `getSnapshot()`.

- [ ] **Step 1: Write fake-timer RED tests**

Cover:

- enable enters `ARMED` and idle does not submit;
- streaming mutation enters `GENERATING`;
- stop disappearance enters `SETTLING`;
- debounce causes exactly one continuation;
- duplicate observer callbacks do not double-submit;
- disabling during debounce cancels submission;
- non-empty composer pauses without changes;
- URL/path change pauses;
- session turn limit pauses when non-zero.

Use a fake adapter with explicit `generating`, `composerEmpty`, `canSubmit`, and counters for insert/submit.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- --run tests/core/autopilot.test.ts`

- [ ] **Step 3: Implement generation epochs and timers**

Core fields must include:

```ts
private generationEpoch = 0;
private submittedEpoch = -1;
private settleTimer: ReturnType<typeof setTimeout> | null = null;
private postSubmitTimer: ReturnType<typeof setTimeout> | null = null;
private enabled = false;
private conversationKey = location.pathname;
```

On generation start increment epoch only when entering a new generation cycle. On completion, schedule settle. Before submitting, re-check enabled/state/conversation/composer empty/canSubmit and ensure `submittedEpoch !== generationEpoch`; set the lock before performing the visible click.

- [ ] **Step 4: Run tests/typecheck**

Run: `npm test -- --run tests/core/autopilot.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: implement exactly-once autopilot loop`

---

### Task 4: Error classifier and finite RecoverySupervisor

**Files:**
- Create: `src/recovery/error-classifier.ts`
- Create: `src/recovery/recovery-supervisor.ts`
- Create: `tests/recovery/error-classifier.test.ts`
- Create: `tests/recovery/recovery-supervisor.test.ts`

**Interfaces:**
- `UiErrorKind = 'UNKNOWN' | 'GENERATION_FAILED' | 'NETWORK_ERROR' | 'WEBSOCKET_ERROR' | 'STALLED' | 'SAFETY_CHECK' | 'RATE_LIMIT' | 'USAGE_LIMIT' | 'LOGIN_REQUIRED' | 'VERIFICATION_REQUIRED' | 'CONVERSATION_LIMIT' | 'COMPOSER_UNAVAILABLE' | 'PAGE_BROKEN' | 'SCRIPT_INCOMPATIBLE'`.
- `ErrorClassifier.classify(): UiErrorKind | null` uses only structural/visible UI signals exposed by the adapter; text matching is fallback and isolated.
- `RecoverySupervisor.onGenerationStarted(now)`, `onRelevantActivity(now)`, `onGenerationFinished(now)`, `tick(now)`, `resetRecovery()`, `getSnapshot()`.
- Recovery actions are injected callbacks: `stopGeneration`, `regenerate`, `reload`, `rollover`, `pause`.

- [ ] **Step 1: Add RED tests for restrictions and stall handling**

Prove:

- 4-minute generation with periodic activity never stalls;
- safety check never invokes stop/regenerate/reload;
- soft timeout enters suspect stall;
- new activity cancels suspect stall;
- confirmed stall invokes Stop once;
- regenerate count per turn never exceeds 1;
- rate/usage/login/verification invoke `pause` and no recovery action;
- offline pauses recovery;
- returning online only re-evaluates after a settle delay;
- more than two reloads in a 15-minute window trips the breaker;
- successful completion resets per-turn regenerate/failure counters.

- [ ] **Step 2: Run recovery tests and confirm RED**

Run: `npm test -- --run tests/recovery`

- [ ] **Step 3: Implement conservative timers/circuit breaker**

Initial defaults:

- `softStallTimeoutMs = 180_000`
- `hardStallTimeoutMs = 600_000`
- `maxRegeneratesPerTurn = 1`
- `maxReloadsPerWindow = 2`
- `reloadWindowMs = 900_000`
- `maxRecoveryFailures = 3`

Never recover from `SAFETY_CHECK`, `RATE_LIMIT`, `USAGE_LIMIT`, `LOGIN_REQUIRED`, or `VERIFICATION_REQUIRED`.

- [ ] **Step 4: Run recovery tests/typecheck**

Run: `npm test -- --run tests/recovery && npm run typecheck`

- [ ] **Step 5: Commit**

Commit message: `feat: add bounded recovery supervisor`

---

### Task 5: Project navigation, session identity, checkpoints and rollover

**Files:**
- Create: `src/navigation/project-navigator.ts`
- Create: `tests/navigation/project-navigator.test.ts`
- Modify: `src/core/autopilot.ts`
- Modify: `src/settings/settings.ts`

**Interfaces:**
- `SessionIdentity { sessionId: string; rolloverIndex: number }`.
- `ProjectContext { projectKey: string | null; conversationKey: string; path: string }`.
- `ProjectNavigator.captureContext(): ProjectContext`.
- `ProjectNavigator.contextChanged(previous): boolean`.
- `ProjectNavigator.canRollover(previous): boolean`.
- `ProjectNavigator.createNewChatInSameProject(): Promise<boolean>`.
- `buildResumePrompt(identity): string`.
- `buildContinuationPrompt(settings, successfulTurns, identity): string` emits a checkpoint instruction only when `checkpointEvery > 0 && successfulTurns > 0 && successfulTurns % checkpointEvery === 0`.

- [ ] **Step 1: Write RED navigation/protocol tests**

Assert:

- ordinary URL change is detected;
- inability to determine same-project destination makes `canRollover` false;
- session id format starts with `auto-YYYYMMDD-` and random suffix;
- rollover increments index exactly once after confirmed new-chat navigation;
- resume prompt contains only session id/index and protocol instructions, not prior conversation text;
- checkpoint instruction occurs exactly every configured N successful cycles and is never parsed by the userscript.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- --run tests/navigation`

- [ ] **Step 3: Implement same-project conservative navigation**

Do not infer undocumented backend project IDs. Capture URL/visible project navigation markers only. The first implementation may support automatic rollover only when a stable visible same-project “new chat” control and project URL prefix can be identified; otherwise return `false` and pause. This is a safe functional outcome, not a retry path.

- [ ] **Step 4: Run navigation/core tests**

Run: `npm test -- --run tests/navigation tests/core/autopilot.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: add project-safe rollover protocol`

---

### Task 6: Floating UI, emergency controls, hotkey and Tampermonkey menu

**Files:**
- Create: `src/ui/control.ts`
- Create: `tests/ui/control.test.ts`
- Modify: `src/settings/settings.ts`

**Interfaces:**
- `AutopilotControl.mount()` and `unmount()`.
- `render(snapshot)` updates only technical state text.
- callbacks: `onToggle`, `onPause`, `onStop`, `onSafeMode`, `onResetRecovery`, `onOpenSettings`.

- [ ] **Step 1: Write RED UI tests**

Assert the control:

- mounts once;
- renders `AUTO · off`, `AUTO · armed`, `AUTO · generating`, `AUTO · safety check`, `AUTO · paused` states;
- click toggles;
- emergency stop works from every rendered state;
- `Alt+Shift+A` toggles unless `event.isComposing`;
- Safe Mode does not expose any submit/recovery callback;
- status tooltip contains session id/state/part/counters but no conversation text.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- --run tests/ui/control.test.ts`

- [ ] **Step 3: Implement isolated styled UI**

Use a single fixed root with high z-index, bottom/right offsets that avoid the composer, a small button/status chip, and a lightweight settings `<dialog>`/panel. No OpenAI logo/trademark artwork.

- [ ] **Step 4: Run UI tests**

Run: `npm test -- --run tests/ui/control.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: add autopilot controls and safe mode`

---

### Task 7: Bootstrap and standalone userscript build

**Files:**
- Create: `src/main.ts`
- Create: `scripts/build.mjs`
- Create: `scripts/check-metadata.mjs`
- Create: `scripts/privacy-scan.mjs`
- Create: `tests/integration/bootstrap.test.ts`
- Modify: `package.json`

**Interfaces:**
- Production bundle: `dist/chatgpt-autopilot.user.js`.
- Header includes `@name`, `@namespace`, `@version 0.1.0`, `@description`, `@author ShapArt`, `@license MIT`, `@match https://chatgpt.com/*`, `@run-at document-idle`, and only required GM grants.

- [ ] **Step 1: Write RED integration/metadata tests**

Bootstrap fixture test confirms mounting on `chatgpt.com` synthetic DOM without immediate submission. Metadata checker must reject `@match *://*/*`, `unsafeWindow`, `GM_xmlhttpRequest`, or missing license/version.

Privacy scanner targets only committed fixtures and rejects patterns matching email addresses and canonical UUIDs plus the known private snapshot filename string.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- --run tests/integration/bootstrap.test.ts && npm run check:metadata && npm run check:privacy`

- [ ] **Step 3: Implement bootstrap/build/check scripts**

Bundle via esbuild IIFE, target Firefox ESR-compatible modern JavaScript (`firefox115` baseline), no runtime external imports, no sourcemap in release artifact by default.

- [ ] **Step 4: Run full code verification**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test -- --run && npm run build && npm run check:metadata && npm run check:privacy`

Expected: all commands exit 0 and `dist/chatgpt-autopilot.user.js` exists.

- [ ] **Step 5: Commit**

Commit message: `build: produce standalone Tampermonkey userscript`

---

### Task 8: Publication docs, CI and pre-PR verification

**Files:**
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- CI runs `npm ci`, format check, lint, typecheck, tests, build, metadata check and privacy scan on push/PR.

- [ ] **Step 1: Add docs and CI**

README must clearly state:

- independent/unofficial project, not affiliated with OpenAI;
- install Tampermonkey on Firefox then install `dist/chatgpt-autopilot.user.js`;
- how normal/paused/recovery/safe-mode states work;
- default hotkey and settings;
- privacy model and forbidden access;
- troubleshooting, including disabling the userscript because browser extensions can themselves cause ChatGPT issues;
- current known limitation: live Firefox/ChatGPT manual validation is still required before claiming stable compatibility;
- project rollover depends on safely identifying same-project navigation and otherwise pauses.

SECURITY documents no telemetry/tokens/backend access and a vulnerability-reporting path via GitHub issues without posting secrets.

CHANGELOG starts `0.1.0 - Unreleased`.

- [ ] **Step 2: Run full verification again**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test -- --run && npm run build && npm run check:metadata && npm run check:privacy`

- [ ] **Step 3: Inspect generated artifact for forbidden strings**

Run:

```bash
! grep -E 'GM_xmlhttpRequest|unsafeWindow|access[_-]?token|sessionToken|api/conversation|fetch\(' dist/chatgpt-autopilot.user.js
```

Expected: exit 0 (none found).

- [ ] **Step 4: Commit**

Commit message: `docs: prepare v0.1.0 MVP for review`

- [ ] **Step 5: Open a pull request**

Base: `main`

Head: `feat/autopilot-mvp`

PR title: `feat: build ChatGPT Autopilot userscript MVP`

PR body must list automated verification results and explicitly mark Firefox live/manual recovery validation as pending rather than claiming it passed.
