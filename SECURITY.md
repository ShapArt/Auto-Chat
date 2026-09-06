# Security Policy

## Supported status

Auto-Chat is currently a **v0.1.0 MVP**. Automated verification exists, but live Firefox/Tampermonkey validation against the current ChatGPT UI is still pending. There is no stable release support promise yet.

## Security and privacy boundary

The project is intentionally limited to the visible `chatgpt.com` page DOM plus narrowly scoped userscript persistence for local settings and technical recovery state.

The one-shot reload-resume marker may persist only:

- the current `chatgpt.com` path;
- the recovery request timestamp;
- Auto-Chat's generated technical session ID;
- the rollover index;
- recent reload timestamps used by the reload circuit breaker.

The marker must not contain prompts, assistant output, cookies, authentication/session tokens, account identifiers, copied ChatGPT storage, or other conversation content. It is consumed on the next bootstrap whether valid or invalid, is accepted only for the exact same path within a short freshness window, and is also cleared by explicit Stop or Safe Mode.

The following are considered security-sensitive regressions:

- reading or storing ChatGPT cookies, authentication/session tokens, localStorage, IndexedDB, or account data;
- calling hidden/private ChatGPT backend APIs or intercepting page fetch/XHR traffic;
- adding telemetry, analytics, external servers, remote code loading, `eval`, or obfuscation;
- adding broad userscript permissions such as `unsafeWindow`, `GM_xmlhttpRequest`, cookie/tab access, or wildcard site matching without an approved redesign;
- persisting or logging conversation text;
- expanding the reload-resume marker beyond narrowly scoped technical recovery state;
- automatically bypassing or attempting to evade safety, usage/rate, login, CAPTCHA, or verification restrictions;
- making recovery unbounded so it can enter retry/reload loops, including by resetting reload history across an automated page reload;
- allowing automation to overwrite or submit an existing manual composer draft;
- allowing one generation epoch to trigger multiple continuation submissions.

## Reporting a vulnerability

Please do not paste real conversation content, private ChatGPT HTML, cookies, tokens, account identifiers, email addresses, or other personal data into a public report.

If the repository offers GitHub's private **Report a vulnerability** flow, use it for security-sensitive details. Otherwise, open a minimal public issue containing only a redacted reproduction and enough technical information to identify the affected component. Maintainers can arrange a safer channel if additional private detail is genuinely necessary.

Useful reports include:

- affected Auto-Chat version/commit;
- Firefox and Tampermonkey versions;
- whether Safe Mode was enabled;
- the technical state shown by the control;
- a synthetic/minimal DOM reproduction where possible;
- exact steps to reproduce without account secrets or conversation content.

## Response priorities

Issues involving unintended submission, manual-draft modification, unexpected persistence, secret exposure, service-restriction bypass, or infinite recovery loops should be treated as release-blocking for the MVP.

Until investigated, users can disable the userscript in Tampermonkey or use Auto-Chat's emergency **Stop** / **Safe Mode** controls when the UI remains responsive.
