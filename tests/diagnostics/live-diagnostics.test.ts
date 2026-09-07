// @ts-expect-error Node built-in intentionally used by Vitest runtime only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/chatgpt-autopilot-live-diagnostics.user.js', 'utf8');

const settleDom = () => new Promise((resolve) => setTimeout(resolve, 10));

const findButton = (root: HTMLElement, label: string) => {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
};

const readReport = (root: HTMLElement) => {
  const pre = root.querySelector('pre');
  if (!(pre instanceof HTMLPreElement)) throw new Error('Missing diagnostic report');
  return JSON.parse(pre.textContent || '{}');
};

describe('live diagnostics recorder contract', () => {
  it('exposes diag.4 verdict controls and sanitized timeline fields', () => {
    expect(source).toContain('@version      0.1.0-diag.4');
    expect(source).toContain("diagVersion: '0.1.0-diag.4'");
    expect(source).toContain("'Start live gate'");
    expect(source).toContain("'Reset'");
    expect(source).toContain("'Copy report'");
    expect(source).toContain("'Copy compact verdict'");
    expect(source).toContain('firstGateStatus');
    expect(source).toContain('notExercised');
    expect(source).toContain('timeline');
    expect(source).toContain('routeKind');
    expect(source).toContain('sameProject');
    expect(source).toContain('sendClicks');
    expect(source).toContain('composerNonEmpty');
  });

  it('keeps the exported report structural and free of private account/session surfaces', () => {
    expect(source).not.toContain('hrefPath:');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
    expect(source).not.toContain('unsafeWindow');
    expect(source).not.toContain('GM_xmlhttpRequest');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('WebSocket');
  });

  it('ignores diagnostic panel mutations so rendering cannot self-trigger the observer', () => {
    expect(source).toContain('root.contains(mutation.target)');
  });

  it('classifies exercised live-gate scenarios without treating untouched groups as failures', async () => {
    document.body.innerHTML = `
      <div id="chatgpt-autopilot-control"><button type="button">AUTO · armed</button></div>
      <div id="prompt-textarea" contenteditable="true"></div>
      <button id="composer-submit-button" type="button">Send</button>
    `;
    window.history.replaceState({}, '', '/c/live-gate-test');
    Object.assign(window, {
      GM_getValue: () => undefined,
      GM_setValue: () => undefined,
      GM_registerMenuCommand: () => undefined,
    });

    window.eval(source);
    const root = document.getElementById('chatgpt-autopilot-live-diagnostics');
    if (!(root instanceof HTMLElement)) throw new Error('Diagnostic helper did not mount');

    findButton(root, 'Start live gate').click();

    const assistant = document.createElement('div');
    assistant.setAttribute('data-message-author-role', 'assistant');
    assistant.setAttribute('aria-busy', 'true');
    document.body.append(assistant);
    await settleDom();
    assistant.setAttribute('aria-busy', 'false');
    await settleDom();

    const composer = document.getElementById('prompt-textarea');
    if (!(composer instanceof HTMLElement)) throw new Error('Missing composer');
    composer.textContent = 'structural-only-placeholder';
    await settleDom();

    const send = document.getElementById('composer-submit-button');
    if (!(send instanceof HTMLButtonElement)) throw new Error('Missing Send');
    send.click();
    await settleDom();

    let report = readReport(root);
    expect(report.checks.oneTurn).toBe('pass');
    expect(report.checks.safetyHold).toBe('not_exercised');
    expect(report.verdict.status).toBe('incomplete');
    expect(report.verdict.firstGateStatus).toBe('pass');
    expect(report.verdict.passed).toContain('oneTurn');
    expect(report.verdict.notExercised).toContain('safetyHold');
    expect(report.verdict.failed).toEqual([]);

    findButton(root, 'Reset').click();
    window.history.replaceState({}, '', '/c/duplicate-send-test');
    findButton(root, 'Start live gate').click();
    send.click();
    send.click();
    await settleDom();

    report = readReport(root);
    expect(report.checks.oneTurn).toBe('fail');
    expect(report.verdict.status).toBe('fail');
    expect(report.verdict.firstGateStatus).toBe('fail');
    expect(report.verdict.failed).toContain('oneTurn');

    findButton(root, 'Reset').click();
    window.history.replaceState({}, '', '/g/g-p-alpha/c/first');
    findButton(root, 'Start live gate').click();
    window.history.replaceState({}, '', '/g/g-p-beta/c/second');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settleDom();

    report = readReport(root);
    expect(report.checks.sameProjectRollover).toBe('fail');
    expect(report.verdict.status).toBe('fail');
    expect(report.verdict.failed).toContain('sameProjectRollover');

    findButton(root, 'Close').click();
  });
});
