# Firefox + Tampermonkey live setup

Auto-Chat v0.1.0 is still a release candidate until the signed-in live checklist in issue #2 passes.

## Current candidate

Use the userscript built from `feat/autopilot-mvp` after the live Firefox injection hardening change.

The userscript metadata explicitly declares:

```text
@match https://chatgpt.com/*
@run-at document-idle
@sandbox DOM
@grant GM_getValue
@grant GM_setValue
@grant GM_registerMenuCommand
```

`@sandbox DOM` is intentional. Auto-Chat only needs DOM access plus the three declared Tampermonkey APIs; it does not need page-world JavaScript or `unsafeWindow`.

## Automated Firefox + Tampermonkey smoke

The repository now has a permanent non-required workflow at:

```text
.github/workflows/firefox-tampermonkey-smoke.yml
```

It runs for pull requests into `main`, pushes to `rc/**`, and manual `workflow_dispatch` runs. The workflow:

1. builds `dist/chatgpt-autopilot.user.js` from the exact checked-out commit;
2. downloads the pinned Tampermonkey 5.5.0 Firefox XPI and verifies its pinned SHA-256 before use;
3. serves the exact current userscript locally;
4. launches headless Firefox and installs the signed Tampermonkey XPI;
5. installs the userscript through Tampermonkey's real userscript installation UI;
6. opens the real `https://chatgpt.com/` origin and verifies that exactly one Auto-Chat control mounts in the default `AUTO · off` state;
7. exercises browser-level visible-DOM fixtures for exact-once continuation and fail-closed guards, including manual-draft protection, pending-Send cancellation, ordinary navigation, offline/reconnect behavior, visible service/conversation restrictions, and reconnect cancellation by Stop, Safe Mode, or manual Pause.

The browser smoke deliberately uses no ChatGPT login, account cookies, tokens, private APIs, conversation text, or CAPTCHA/verification bypass. The synthetic behavior fixtures run on the real `chatgpt.com` origin with the exact Tampermonkey-installed userscript, but they are still fixtures rather than a signed-in production conversation.

The workflow is intentionally **not a required merge check yet**. It depends on external AMO and `chatgpt.com` availability, so an external outage should not masquerade as a product regression while the smoke is still proving its long-term CI stability.

### What the automated smoke does not prove

Passing Firefox + Tampermonkey CI does **not** close the live release gate. It does not prove:

- current signed-in ChatGPT/ProseMirror composer mutation in a real conversation;
- the real production Send lifecycle for an authenticated account;
- actual extended-processing and safety surfaces;
- actual recovery controls on real service failures;
- same-project rollover inside a real ChatGPT Project;
- every local Firefox/Tampermonkey Content Script API configuration used on end-user machines.

Those checks remain in issue #2 and must be green before PR #1 is merged or v0.1.0 is tagged stable.

## Tampermonkey checks

Before treating a missing Auto-Chat control as an application bug:

1. Confirm the script is enabled in the Tampermonkey dashboard.
2. Confirm Tampermonkey has permission to run on `https://chatgpt.com/*`.
3. Open Tampermonkey settings and check **Security → Content Script API**.
4. Prefer the normal **Content Script** mode first. **UserScripts API** is also a valid Firefox mode.
5. If **UserScripts API Dynamic** shows unreliable injection, switch away from Dynamic and reload the page. Tampermonkey has had Firefox-specific Dynamic injection fixes and known reports of scripts not running in that mode.
6. Reload `https://chatgpt.com/` with a normal page reload after changing extension settings.

Do not weaken Firefox or ChatGPT CSP settings just to make Auto-Chat run. The DOM sandbox exists specifically to avoid requiring MAIN_WORLD page injection.

## Expected bootstrap

With the userscript enabled, a small floating control should appear near the lower-right area of ChatGPT and initially read:

```text
AUTO · off
```

Nothing should be submitted merely because the page loaded or because Auto is enabled while the page is idle.

If the control does not appear at all, first use the read-only diagnostic userscript from branch `diag/live-firefox-smoke`:

```text
tools/chatgpt-autopilot-live-diagnostics.user.js
```

The diagnostic script does not submit messages or read conversation text. It only reports structural DOM/GM availability and live-gate state transitions. It also runs with `@sandbox DOM` so it does not depend on MAIN_WORLD injection.

For the remaining signed-in release gate, use the latest verified diagnostic revision from that branch, click **Start live gate**, exercise the harmless scenario being tested, then click **Copy report**. The exported report is structural only and is designed to avoid conversation text, cookies, tokens, account identifiers, and raw ChatGPT HTML.

## What to report

If the diagnostic panel appears, attach only its sanitized structural JSON to issue #2.

If the diagnostic panel does not appear either, record:

- Firefox version;
- Tampermonkey version;
- selected Content Script API mode;
- whether Tampermonkey shows the script as matched for `chatgpt.com`;
- whether Tampermonkey has site access for `chatgpt.com`.

Do not attach cookies, tokens, account identifiers, raw private ChatGPT HTML, or conversation content.
