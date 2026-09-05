// ==UserScript==
// @name         ChatGPT Autopilot Live Diagnostics
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0-diag.1
// @description  Non-mutating structural diagnostics for Auto-Chat live Firefox/Tampermonkey validation.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_ID = 'chatgpt-autopilot-live-diagnostics';
  const OWNED_ATTR = 'data-chatgpt-autopilot-owned';

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute('hidden')) return false;
      if (current.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };

  const summarizeElement = (element) => {
    if (!(element instanceof HTMLElement)) return null;
    return {
      tag: element.tagName,
      id: element.id || null,
      testid: element.getAttribute('data-testid'),
      role: element.getAttribute('role'),
      contenteditable: element.getAttribute('contenteditable'),
      visible: isVisible(element),
      disabled: 'disabled' in element ? Boolean(element.disabled) : null,
      ariaBusy: element.getAttribute('aria-busy'),
      ariaHidden: element.getAttribute('aria-hidden'),
    };
  };

  const collect = () => {
    const composer = document.querySelector('#prompt-textarea');
    const send = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
    const stop = document.querySelector('button[data-testid="stop-button"]');
    const busyAssistants = [...document.querySelectorAll('[data-message-author-role="assistant"][aria-busy="true"]')]
      .filter(isVisible).length;
    const safetySignals = [...document.querySelectorAll('[data-streaming-response-status]')]
      .filter(isVisible).length;
    const projectLinks = [...document.querySelectorAll('a[href*="/g/g-p-"][href$="/project"]')]
      .filter(isVisible).length;

    let insertTextSupported = false;
    try {
      insertTextSupported =
        typeof document.execCommand === 'function' &&
        (typeof document.queryCommandSupported !== 'function' || document.queryCommandSupported('insertText'));
    } catch {
      insertTextSupported = false;
    }

    return {
      diagVersion: '0.1.0-diag.1',
      timestamp: new Date().toISOString(),
      hrefPath: location.pathname,
      topFrame: window.top === window,
      readyState: document.readyState,
      online: navigator.onLine,
      gm: {
        getValue: typeof GM_getValue,
        setValue: typeof GM_setValue,
        registerMenuCommand: typeof GM_registerMenuCommand,
      },
      coreControlPresent: Boolean(document.getElementById('chatgpt-autopilot-control')),
      composer: summarizeElement(composer),
      send: summarizeElement(send),
      stop: summarizeElement(stop),
      busyAssistants,
      safetySignals,
      visibleProjectHomeLinks: projectLinks,
      execCommandInsertTextSupported: insertTextSupported,
    };
  };

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute(OWNED_ATTR, 'true');
  root.style.cssText = [
    'position:fixed',
    'right:16px',
    'top:16px',
    'z-index:2147483647',
    'width:min(92vw,460px)',
    'max-height:70vh',
    'overflow:auto',
    'padding:12px',
    'border:2px solid #ffb020',
    'border-radius:12px',
    'background:#151515',
    'color:#f5f5f5',
    'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'box-shadow:0 10px 35px rgba(0,0,0,.4)',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'AUTO-CHAT LIVE DIAG · READ ONLY';
  title.style.cssText = 'font-weight:800;margin-bottom:8px;color:#ffcc66';

  const hint = document.createElement('div');
  hint.textContent = 'Не читает текст сообщений и ничего не отправляет. Если эта панель не появилась — проблема до Auto-Chat core (Tampermonkey injection/permissions).';
  hint.style.cssText = 'margin-bottom:8px;white-space:normal';

  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';

  const makeButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'padding:6px 9px;border:1px solid #666;border-radius:7px;background:#262626;color:#fff;cursor:pointer';
    button.addEventListener('click', onClick);
    return button;
  };

  let lastSnapshot = collect();
  const render = () => {
    lastSnapshot = collect();
    pre.textContent = JSON.stringify(lastSnapshot, null, 2);
  };

  const copy = makeButton('Copy diagnostics', async () => {
    const text = JSON.stringify(lastSnapshot, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy diagnostics'), 1200);
    } catch {
      console.log('[AUTO-CHAT DIAG]', text);
      copy.textContent = 'Copy failed → console';
    }
  });

  const refresh = makeButton('Refresh', render);
  const close = makeButton('Close', () => root.remove());
  controls.append(copy, refresh, close);
  root.append(title, hint, pre, controls);
  document.body.append(root);

  render();
  const timer = setInterval(() => {
    if (!document.contains(root)) {
      clearInterval(timer);
      return;
    }
    render();
  }, 500);

  try {
    GM_registerMenuCommand('Auto-Chat diagnostics: print structural snapshot', () => {
      console.log('[AUTO-CHAT DIAG]', collect());
    });
  } catch (error) {
    console.error('[AUTO-CHAT DIAG] menu command unavailable', error);
  }
})();
