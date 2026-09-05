# Security Policy

## Supported status

Auto-Chat is currently a **v0.1.0 MVP**. Automated verification exists, but live Firefox/Tampermonkey validation against the current ChatGPT UI is still pending. There is no stable release support promise yet.

## Security and privacy boundary

The project is intentionally limited to the visible `chatgpt.com` page DOM and local userscript settings.

The following are considered security-sensitive regressions:

- reading or storing ChatGPT cookies, authentication/session tokens, localStorage, IndexedDB, or account data;
- calling hidden/private ChatGPT backend APIs or intercepting page fetch/XHR traffic;
- adding telemetry, analytics, external servers, remote code loading, `eval`, or obfuscation;
- adding broad userscript permissions such as `unsafeWindow`, `GM_xmlhttpRequest`, cookie/tab access, or wildcard site matching without an approved redesign;
- persisting or logging conversation text;
- automatically bypassing or attempting to evade safety, usage/rate, login, CAPTCHA, or verification restrictions;
- making recovery unbounded so it can enter retry/reload loops;
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
