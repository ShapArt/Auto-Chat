// @ts-expect-error Node built-in intentionally used by Vitest runtime only.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/chatgpt-autopilot-live-diagnostics.user.js', 'utf8');

const settleDom = () => new Promise((resolve) => setTimeout(resolve, 10));

const findButton = (root: Element, label: string) => {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
};

const readReport = (root: Element) => {
  const pre = root.querySelector('pre');
  if (!pre) throw new Error('Missing diagnostic report');
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
    expect(source).toContain('reasons');
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
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div id="chatgpt-autopilot-control"><button type="button">AUTO · armed</button></div>
        <div id="prompt-textarea" contenteditable="true"></div>
        <button id="composer-submit-button" type="button">Send</button>
      </body></html>`,
      {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
        url: 'https://chatgpt.com/c/live-gate-test',
      },
    );

    Object.assign(dom.window, {
      GM_getValue: () => undefined,
      GM_setValue: () => undefined,
      GM_registerMenuCommand: () => undefined,
    });

    dom.window.eval(source);
    const root = dom.window.document.getElementById('chatgpt-autopilot-live-diagnostics');
    if (!root) throw new Error('Diagnostic helper did not mount');

    const composer = dom.window.document.getElementById('prompt-textarea');
    if (!composer) throw new Error('Missing composer');
    const send = dom.window.document.getElementById('composer-submit-button');
    if (!(send instanceof dom.window.HTMLButtonElement)) throw new Error('Missing Send');

    findButton(root, 'Start live gate').click();

    // Real validation starts with one user Send that triggers the generation under test.
    composer.textContent = 'manual-start-placeholder';
    await settleDom();
    send.click();
    composer.textContent = '';
    await settleDom();

    const assistant = dom.window.document.createElement('div');
    assistant.setAttribute('data-message-author-role', 'assistant');
    assistant.setAttribute('aria-busy', 'true');
    dom.window.document.body.append(assistant);
    await settleDom();
    assistant.setAttribute('aria-busy', 'false');
    await settleDom();

    composer.textContent = 'structural-only-placeholder';
    await settleDom();
    send.click();
    await settleDom();

    let report = readReport(root);
    expect(report.counters.sendClicks).toBe(2);
    expect(report.checks.oneTurn).toBe('pass');
    expect(report.checks.safetyHold).toBe('not_exercised');
    expect(report.verdict.status).toBe('incomplete');
    expect(report.verdict.firstGateStatus).toBe('pass');
    expect(report.verdict.passed).toContain('oneTurn');
    expect(report.verdict.notExercised).toContain('safetyHold');
    expect(report.verdict.failed).toEqual([]);

    findButton(root, 'Reset').click();
    dom.window.history.replaceState({}, '', '/c/duplicate-send-test');
    composer.textContent = '';
    await settleDom();
    findButton(root, 'Start live gate').click();

    composer.textContent = 'manual-start-placeholder';
    await settleDom();
    send.click();
    composer.textContent = '';
    await settleDom();
    assistant.setAttribute('aria-busy', 'true');
    await settleDom();
    assistant.setAttribute('aria-busy', 'false');
    await settleDom();
    composer.textContent = 'structural-only-placeholder';
    await settleDom();
    send.click();
    send.click();
    await settleDom();

    report = readReport(root);
    expect(report.counters.sendClicks).toBe(3);
    expect(report.checks.oneTurn).toBe('fail');
    expect(report.verdict.status).toBe('fail');
    expect(report.verdict.firstGateStatus).toBe('fail');
    expect(report.verdict.failed).toContain('oneTurn');

    findButton(root, 'Reset').click();
    dom.window.history.replaceState({}, '', '/g/g-p-alpha/c/first');
    findButton(root, 'Start live gate').click();
    dom.window.history.replaceState({}, '', '/g/g-p-beta/c/second');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    await settleDom();

    report = readReport(root);
    expect(report.checks.sameProjectRollover).toBe('fail');
    expect(report.verdict.status).toBe('fail');
    expect(report.verdict.failed).toContain('sameProjectRollover');

    findButton(root, 'Close').click();
    dom.window.close();
  });
});
