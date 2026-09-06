# Changelog

All notable changes to Auto-Chat will be documented in this file.

The project follows semantic versioning once releases are published.

## [Unreleased]

### Added

- One-shot same-path reload-resume marker carrying only technical session identity, rollover index, request time, and bounded reload history.
- Reload circuit-breaker history restoration across an automated page reload.
- Structural recovery UI signal classification for visible system alerts/dialogs without parsing assistant message text.
- `aria-busy="true"` assistant-turn streaming fallback for current ChatGPT DOM variants.
- Permanent non-required Firefox + Tampermonkey smoke workflow that builds the exact current userscript, installs pinned Tampermonkey in headless Firefox, installs the userscript through Tampermonkey's real install UI, opens `chatgpt.com`, and requires exactly one `AUTO · off` control.

### Changed

- Recovery now runs only while Auto is explicitly enabled and not paused.
- Repeated identical visible recovery errors are idempotent instead of incrementing failure counters on every DOM mutation.
- Explicit user Stop clears stale generation/recovery state while preserving the reload circuit-breaker history.
- Autopilot-owned controls/settings DOM is excluded from relevant-activity tracking.
- Visibility checks now reject streaming, recovery, and retry controls hidden by ancestor containers.
- Continuations are inserted before submit readiness is required, with a bounded two-second wait for ChatGPT to mount or enable the Send control.
- A pending continuation must still match the text inserted by Auto-Chat before automated submission; manual edits pause automation instead of being sent.
- Submit-button detection supports both the legacy `#composer-submit-button` id and the current `[data-testid="send-button"]` structural selector.
- Same-project rollover now revalidates the pending `[AUTOPILOT_RESUME]` text before clicking Send, so manual edits fail closed instead of being auto-submitted.
- Network recovery now preserves whether Auto was active before an offline pause and re-arms only after the configured online settle window; Stop, Safe Mode, and manual pause cancel that automatic resume.
- Same-project rollover proof now ignores project links hidden by `hidden`, `aria-hidden`, `display:none`, or `visibility:hidden`, preventing stale hidden navigation DOM from being clicked.
- Userscript execution now explicitly uses Tampermonkey `@sandbox DOM`, avoiding unnecessary MAIN_WORLD execution while preserving DOM access and the three declared GM APIs.

### Validation

- Automated Firefox + Tampermonkey installation/injection/mount smoke passes against the current `chatgpt.com` page using the exact current build, pinned Tampermonkey 5.5.0, and Firefox 154.0.1 on the GitHub runner.
- The same real-browser smoke now also exercises the normal AUTO lifecycle against a synthetic visible-DOM fixture on the real `chatgpt.com` origin: idle enable stays armed without submission, one generation with delayed Send produces exactly one input and one click, an existing manual draft fails closed and remains unsent, and editing a pending continuation pauses before Send with zero clicks.
- Full signed-in Firefox/Tampermonkey validation of the current live ChatGPT generation UI, recovery, offline handling, and same-project rollover is still pending.
- v0.1.0 must not be described as stable until the manual checklist in the README / release-gate issue is completed.

## [0.1.0] - 2026-09-05

### Added

- Privacy-first standalone Tampermonkey userscript architecture for `https://chatgpt.com/*`.
- Deterministic normal autopilot state machine with `DISABLED`, `ARMED`, `GENERATING`, `SETTLING`, `READY`, `SUBMITTING`, `COOLDOWN`, `PAUSED`, and `ERROR` states.
- Generation epoch tracking and exactly-once continuation lock.
- Completion debounce, post-submit guard, manual-input protection, and conversation-navigation pause.
- ChatGPT DOM adapter with structural composer/submit/generation/safety signals and synthetic fixtures.
- Local validated settings and debug-off-by-default technical logger.
- Bounded recovery supervisor with soft/hard stall detection, safety-check immunity, finite stop/regenerate/reload flow, offline settling, and circuit breakers.
- Conservative project navigation foundation with same-project validation and rollover index.
- `AUTOPILOT_CHECKPOINT_V1` and `[AUTOPILOT_RESUME]` continuity protocol without assistant-output parsing.
- Floating technical control with toggle, pause, emergency stop, Safe Mode, recovery reset, settings access, and `Alt+Shift+A` hotkey.
- Standalone esbuild output targeting Firefox 115+.
- Narrow userscript metadata with only `GM_getValue`, `GM_setValue`, and `GM_registerMenuCommand` grants.
- CI checks for formatting, linting, type safety, unit/integration tests, bundle build, userscript metadata, and fixture privacy.
- README, security policy, contribution guide, MIT license, architecture spec, and implementation plan.

### Security

- No backend ChatGPT API use, token/cookie access, telemetry, external runtime code, `unsafeWindow`, `GM_xmlhttpRequest`, or wildcard site permission.
- Service restrictions and safety/verification states are terminal for automation rather than targets for bypass behavior.
- Raw private ChatGPT HTML snapshot excluded from the repository; committed fixtures are synthetic.
