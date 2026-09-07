// @ts-expect-error Node built-in intentionally used by Vitest runtime only.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error jsdom is an existing runtime devDependency without bundled declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const diag6Path = 'tools/chatgpt-autopilot-live-diagnostics-diag6.user.js';
const diag5Path = 'tools/chatgpt-autopilot-live-diagnostics.user.js';
const source = readFileSync(existsSync(diag6Path) ? diag6Path : diag5Path, 'utf8');

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

describe('diag.6 release wizard contract', () => {
  it('declares the guided release sequence and remains read-only/private', () => {
    expect(source).toContain('@version      0.1.0-diag.6');
    expect(source).toContain("diagVersion: '0.1.0-diag.6'");
    expect(source).toContain('RELEASE_CHECK_ORDER');
    expect(source).toContain('buildReleaseGate');
    expect(source).toContain('buildReleaseGateReport');
    expect(source).toContain("'Copy release-gate report'");
    expect(source).toContain('data-release-gate-banner');
    expect(source).toContain('data-release-gate-next-step');

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

  it('advances from oneTurn to manualProtection and preserves the pass across Reset', async () => {
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div id="chatgpt-autopilot-control"><button type="button">AUTO · armed</button></div>
        <div id="prompt-textarea" contenteditable="true"></div>
        <button id="composer-submit-button" type="button">Send</button>
      </body></html>`,
      {
        pretendToBeVisual: true,
        runScripts: 'outside-only',
        url: 'https://chatgpt.com/c/release-wizard-test',
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
    const send = dom.window.document.getElementById('composer-submit-button');
    if (!composer) throw new Error('Missing composer');
    if (!(send instanceof dom.window.HTMLButtonElement)) throw new Error('Missing Send');

    findButton(root, 'Start live gate').click();
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
    expect(report.diagVersion).toBe('0.1.0-diag.6');
    expect(report.releaseGate.results.oneTurn).toBe('pass');
    expect(report.releaseGate.currentCheck).toBe('manualProtection');
    expect(report.releaseGate.status).toBe('incomplete');

    findButton(root, 'Reset').click();
    await settleDom();
    report = readReport(root);
    expect(report.releaseGate.results.oneTurn).toBe('pass');
    expect(report.releaseGate.currentCheck).toBe('manualProtection');

    const banner = root.querySelector('[data-release-gate-banner]');
    const next = root.querySelector('[data-release-gate-next-step]');
    expect(banner?.textContent).toContain('MANUAL PROTECTION');
    expect(next?.textContent).toContain('NEXT:');

    findButton(root, 'Close').click();
    dom.window.close();
  });
});
