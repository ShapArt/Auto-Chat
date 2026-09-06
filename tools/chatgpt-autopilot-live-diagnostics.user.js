// ==UserScript==
// @name         ChatGPT Autopilot Live Diagnostics
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0-diag.3
// @description  Read-only structural recorder for Auto-Chat live Firefox/Tampermonkey release validation.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_ID = 'chatgpt-autopilot-live-diagnostics';
  const OWNED_ATTR = 'data-chatgpt-autopilot-owned';
  const SEND_SELECTOR = '#composer-submit-button, button[data-testid="send-button"]';
  const STOP_SELECTOR = 'button[data-testid="stop-button"]';
  const COMPOSER_SELECTOR = '#prompt-textarea';
  const MAX_TIMELINE_EVENTS = 500;

  const existingRoot = document.getElementById(ROOT_ID);
  if (existingRoot) existingRoot.remove();

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

  const getRouteKind = (path) => {
    if (/^\/g\/g-p-[^/]+\/project\/?$/.test(path)) return 'project_home';
    if (/^\/g\/g-p-[^/]+\/(?:project\/)?c\/[^/]+/.test(path)) return 'project_chat';
    if (/^\/c\/[^/]+/.test(path)) return 'chat';
    return 'other';
  };

  const getProjectKey = (path) => path.match(/^\/g\/(g-p-[^/]+)/)?.[1] ?? null;

  const getAutoState = () => {
    const control = document.getElementById('chatgpt-autopilot-control');
    if (!(control instanceof HTMLElement)) return null;
    const autoButton = [...control.querySelectorAll('button')].find((button) =>
      (button.textContent || '').trim().startsWith('AUTO'),
    );
    if (!(autoButton instanceof HTMLElement)) return null;
    return (autoButton.textContent || '').trim().split('\n')[0] || null;
  };

  const getComposerNonEmpty = () => {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    return composer instanceof HTMLElement ? Boolean((composer.textContent || '').trim()) : false;
  };

  const getInsertTextSupport = () => {
    try {
      return (
        typeof document.execCommand === 'function' &&
        (typeof document.queryCommandSupported !== 'function' ||
          document.queryCommandSupported('insertText'))
      );
    } catch {
      return false;
    }
  };

  let recording = false;
  let startedAt = null;
  let startedAtPerf = 0;
  let baselineProjectKey = null;
  let privatePath = location.pathname;
  let timeline = [];
  let lastState = null;
  let sendClicks = 0;
  let sendClicksWhileSafety = 0;
  let sendMounts = 0;
  let generationStarts = 0;
  let generationEnds = 0;
  let composerInputEvents = 0;
  let trustedComposerInputs = 0;
  let offlineEvents = 0;
  let onlineEvents = 0;
  let rolloverEvents = 0;
  let projectMismatchEvents = 0;
  let safetyStarts = 0;
  let safetyEnds = 0;

  const getStructuralState = () => {
    const path = location.pathname;
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const send = document.querySelector(SEND_SELECTOR);
    const stop = document.querySelector(STOP_SELECTOR);
    const busyAssistants = [
      ...document.querySelectorAll(
        '[data-message-author-role="assistant"][aria-busy="true"]',
      ),
    ].filter(isVisible).length;
    const safetySignals = [
      ...document.querySelectorAll('[data-streaming-response-status]'),
    ].filter(isVisible).length;
    const visibleProjectHomeLinks = [
      ...document.querySelectorAll('a[href*="/g/g-p-"][href$="/project"]'),
    ].filter(isVisible).length;
    const currentProjectKey = getProjectKey(path);

    return {
      diagVersion: '0.1.0-diag.3',
      timestamp: new Date().toISOString(),
      routeKind: getRouteKind(path),
      sameProject:
        baselineProjectKey === null || currentProjectKey === null
          ? null
          : baselineProjectKey === currentProjectKey,
      topFrame: window.top === window,
      readyState: document.readyState,
      online: navigator.onLine,
      gm: {
        getValue: typeof GM_getValue,
        setValue: typeof GM_setValue,
        registerMenuCommand: typeof GM_registerMenuCommand,
      },
      coreControlPresent: Boolean(document.getElementById('chatgpt-autopilot-control')),
      autoState: getAutoState(),
      composerPresent: composer instanceof HTMLElement,
      composerVisible: isVisible(composer),
      composerNonEmpty: getComposerNonEmpty(),
      sendPresent: send instanceof HTMLElement,
      sendVisible: isVisible(send),
      sendEnabled:
        send instanceof HTMLButtonElement
          ? !send.disabled && send.getAttribute('aria-disabled') !== 'true'
          : false,
      stopPresent: stop instanceof HTMLElement,
      stopVisible: isVisible(stop),
      busyAssistants,
      generating: busyAssistants > 0 || isVisible(stop),
      safetySignals,
      safetyActive: safetySignals > 0,
      visibleProjectHomeLinks,
      execCommandInsertTextSupported: getInsertTextSupport(),
      sendClicks,
    };
  };

  const pushEvent = (type, detail = {}) => {
    if (!recording) return;
    const tMs = Math.max(0, Math.round(performance.now() - startedAtPerf));
    timeline.push({ tMs, type, ...detail });
    if (timeline.length > MAX_TIMELINE_EVENTS) {
      timeline = timeline.slice(-MAX_TIMELINE_EVENTS);
    }
  };

  const resetCounters = () => {
    timeline = [];
    sendClicks = 0;
    sendClicksWhileSafety = 0;
    sendMounts = 0;
    generationStarts = 0;
    generationEnds = 0;
    composerInputEvents = 0;
    trustedComposerInputs = 0;
    offlineEvents = 0;
    onlineEvents = 0;
    rolloverEvents = 0;
    projectMismatchEvents = 0;
    safetyStarts = 0;
    safetyEnds = 0;
  };

  const eventIndex = (type, predicate = () => true) =>
    timeline.findIndex((entry) => entry.type === type && predicate(entry));

  const eventIndexAfter = (type, afterIndex, predicate = () => true) =>
    timeline.findIndex(
      (entry, index) => index > afterIndex && entry.type === type && predicate(entry),
    );

  const evaluateChecks = () => {
    const generationStartIndex = eventIndex('generation_start');
    const generationEndIndex = eventIndexAfter('generation_end', generationStartIndex);
    const composerFilledIndex = eventIndexAfter(
      'composer_state',
      generationEndIndex,
      (entry) => entry.nonEmpty === true,
    );
    const sendClickIndex = eventIndexAfter('send_click', composerFilledIndex);

    let oneTurn = 'pending';
    if (sendClicks > 1) oneTurn = 'fail';
    else if (
      generationStartIndex >= 0 &&
      generationEndIndex >= 0 &&
      composerFilledIndex >= 0 &&
      sendClickIndex >= 0 &&
      sendClicks === 1
    ) {
      oneTurn = 'pass';
    }

    const trustedInputIndex = eventIndex(
      'composer_input',
      (entry) => entry.trusted === true,
    );
    let manualProtection = 'pending';
    if (trustedInputIndex >= 0) {
      const pauseIndex = eventIndexAfter(
        'auto_state',
        trustedInputIndex,
        (entry) => typeof entry.state === 'string' && entry.state.includes('paused'),
      );
      const laterSend = eventIndexAfter('send_click', trustedInputIndex);
      if (laterSend >= 0) manualProtection = 'fail';
      else if (pauseIndex >= 0) manualProtection = 'pass';
    }

    let reconnect = 'pending';
    const offlineIndex = eventIndex('network_offline');
    const onlineIndex = eventIndexAfter('network_online', offlineIndex);
    if (offlineIndex >= 0 && onlineIndex >= 0) {
      const rearmIndex = eventIndexAfter(
        'auto_state',
        onlineIndex,
        (entry) => typeof entry.state === 'string' && entry.state.includes('armed'),
      );
      if (rearmIndex >= 0) reconnect = 'pass';
    }

    let sameProjectRollover = 'pending';
    if (projectMismatchEvents > 0) sameProjectRollover = 'fail';
    else if (rolloverEvents > 0) sameProjectRollover = 'pass';

    let safetyHold = 'pending';
    if (sendClicksWhileSafety > 0) safetyHold = 'fail';
    else if (safetyStarts > 0 && safetyEnds > 0) safetyHold = 'pass';

    return {
      oneTurn,
      manualProtection,
      reconnect,
      sameProjectRollover,
      safetyHold,
    };
  };

  const buildReport = () => ({
    diagVersion: '0.1.0-diag.3',
    recording,
    startedAt,
    snapshot: getStructuralState(),
    counters: {
      sendClicks,
      sendClicksWhileSafety,
      sendMounts,
      generationStarts,
      generationEnds,
      composerInputEvents,
      trustedComposerInputs,
      offlineEvents,
      onlineEvents,
      rolloverEvents,
      projectMismatchEvents,
      safetyStarts,
      safetyEnds,
    },
    checks: evaluateChecks(),
    timeline: [...timeline],
  });

  const sample = () => {
    const next = getStructuralState();
    const nextPath = location.pathname;

    if (!recording) {
      lastState = next;
      privatePath = nextPath;
      return next;
    }

    if (lastState) {
      if (!lastState.generating && next.generating) {
        generationStarts += 1;
        pushEvent('generation_start', { routeKind: next.routeKind });
      } else if (lastState.generating && !next.generating) {
        generationEnds += 1;
        pushEvent('generation_end', { routeKind: next.routeKind });
      }

      if (!lastState.sendPresent && next.sendPresent) {
        sendMounts += 1;
        pushEvent('send_mount', { enabled: next.sendEnabled });
      }

      if (lastState.composerNonEmpty !== next.composerNonEmpty) {
        pushEvent('composer_state', { nonEmpty: next.composerNonEmpty });
      }

      if (lastState.autoState !== next.autoState) {
        pushEvent('auto_state', { state: next.autoState });
      }

      if (!lastState.safetyActive && next.safetyActive) {
        safetyStarts += 1;
        pushEvent('safety_start');
      } else if (lastState.safetyActive && !next.safetyActive) {
        safetyEnds += 1;
        pushEvent('safety_end');
      }

      if (lastState.online !== next.online) {
        pushEvent(next.online ? 'network_online_state' : 'network_offline_state');
      }
    }

    if (nextPath !== privatePath) {
      const previousRouteKind = getRouteKind(privatePath);
      const currentProjectKey = getProjectKey(nextPath);
      const sameProject =
        baselineProjectKey !== null && currentProjectKey !== null
          ? baselineProjectKey === currentProjectKey
          : null;
      const routeDetail = { routeKind: next.routeKind, sameProject };

      if (previousRouteKind === 'project_chat' && next.routeKind === 'project_chat') {
        if (sameProject === true) {
          rolloverEvents += 1;
          pushEvent('project_rollover', routeDetail);
        } else if (sameProject === false) {
          projectMismatchEvents += 1;
          pushEvent('project_mismatch', routeDetail);
        } else {
          pushEvent('route_change', routeDetail);
        }
      } else {
        pushEvent('route_change', routeDetail);
      }
      privatePath = nextPath;
    }

    lastState = next;
    return next;
  };

  const startRecording = () => {
    resetCounters();
    recording = true;
    startedAt = new Date().toISOString();
    startedAtPerf = performance.now();
    baselineProjectKey = getProjectKey(location.pathname);
    privatePath = location.pathname;
    lastState = getStructuralState();
    pushEvent('live_gate_start', {
      routeKind: lastState.routeKind,
      sameProject: lastState.sameProject,
      autoState: lastState.autoState,
      composerNonEmpty: lastState.composerNonEmpty,
    });
  };

  const resetRecording = () => {
    recording = false;
    startedAt = null;
    startedAtPerf = 0;
    baselineProjectKey = null;
    privatePath = location.pathname;
    resetCounters();
    lastState = getStructuralState();
  };

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute(OWNED_ATTR, 'true');
  root.style.cssText = [
    'position:fixed',
    'right:16px',
    'top:16px',
    'z-index:2147483647',
    'width:min(94vw,540px)',
    'max-height:78vh',
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
  title.textContent = 'AUTO-CHAT LIVE GATE · DIAG.3 · READ ONLY';
  title.style.cssText = 'font-weight:800;margin-bottom:8px;color:#ffcc66';

  const hint = document.createElement('div');
  hint.textContent =
    'Записывает только структурные события: состояния Auto/DOM, boolean composer empty/non-empty, Send/Stop, сеть, safety и тип маршрута. Текст сообщений, URL/ID проекта и аккаунтные данные в отчёт не попадают.';
  hint.style.cssText = 'margin-bottom:8px;white-space:normal';

  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap';

  const makeButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText =
      'padding:6px 9px;border:1px solid #666;border-radius:7px;background:#262626;color:#fff;cursor:pointer';
    button.addEventListener('click', onClick);
    return button;
  };

  let lastReport = buildReport();
  const render = () => {
    lastReport = buildReport();
    pre.textContent = JSON.stringify(lastReport, null, 2);
  };

  const start = makeButton('Start live gate', () => {
    startRecording();
    render();
  });

  const reset = makeButton('Reset', () => {
    resetRecording();
    render();
  });

  const copy = makeButton('Copy report', async () => {
    sample();
    lastReport = buildReport();
    const text = JSON.stringify(lastReport, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy report'), 1200);
    } catch {
      console.log('[AUTO-CHAT LIVE GATE]', text);
      copy.textContent = 'Copy failed → console';
      setTimeout(() => (copy.textContent = 'Copy report'), 1600);
    }
  });

  let closed = false;
  const close = makeButton('Close', () => {
    closed = true;
    observer.disconnect();
    root.remove();
  });

  controls.append(start, reset, copy, close);
  root.append(title, hint, pre, controls);
  document.body.append(root);

  const observer = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => root.contains(mutation.target))) return;
    sample();
    render();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'aria-disabled', 'aria-hidden', 'disabled'],
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!recording) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const send = target.closest(SEND_SELECTOR);
      if (!(send instanceof HTMLElement) || !isVisible(send)) return;
      sendClicks += 1;
      if (lastState?.safetyActive) sendClicksWhileSafety += 1;
      pushEvent('send_click', {
        count: sendClicks,
        whileSafety: Boolean(lastState?.safetyActive),
      });
      sample();
      render();
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      if (!recording) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(COMPOSER_SELECTOR)) return;
      composerInputEvents += 1;
      if (event.isTrusted) trustedComposerInputs += 1;
      pushEvent('composer_input', {
        trusted: Boolean(event.isTrusted),
        composerNonEmpty: getComposerNonEmpty(),
      });
      sample();
      render();
    },
    true,
  );

  window.addEventListener('offline', () => {
    if (recording) {
      offlineEvents += 1;
      pushEvent('network_offline');
    }
    sample();
    render();
  });

  window.addEventListener('online', () => {
    if (recording) {
      onlineEvents += 1;
      pushEvent('network_online');
    }
    sample();
    render();
  });

  window.addEventListener('popstate', () => {
    sample();
    render();
  });

  lastState = getStructuralState();
  render();

  const timer = setInterval(() => {
    if (closed || !document.contains(root)) {
      clearInterval(timer);
      observer.disconnect();
      return;
    }
    sample();
    render();
  }, 500);

  try {
    GM_registerMenuCommand('Auto-Chat live gate: print sanitized report', () => {
      sample();
      console.log('[AUTO-CHAT LIVE GATE]', buildReport());
    });
  } catch (error) {
    console.error('[AUTO-CHAT LIVE GATE] menu command unavailable', error);
  }
})();
