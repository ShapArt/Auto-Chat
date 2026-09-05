# Firefox + Tampermonkey live setup

Auto-Chat v0.1.0 is still a release candidate until the live checklist in issue #2 passes.

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

The diagnostic script does not submit messages or read conversation text. It only reports structural DOM/GM availability. It also runs with `@sandbox DOM` so it does not depend on MAIN_WORLD injection.

## What to report

If the diagnostic panel appears, copy its structural JSON and attach only that sanitized output to issue #2. It intentionally contains no conversation text.

If the diagnostic panel does not appear either, record:

- Firefox version;
- Tampermonkey version;
- selected Content Script API mode;
- whether Tampermonkey shows the script as matched for `chatgpt.com`;
- whether Tampermonkey has site access for `chatgpt.com`.

Do not attach cookies, tokens, account identifiers, raw private ChatGPT HTML, or conversation content.
