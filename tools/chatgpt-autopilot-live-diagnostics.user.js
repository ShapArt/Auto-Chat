// ==UserScript==
// @name         ChatGPT Autopilot Live Diagnostics
// @namespace    https://github.com/ShapArt/Auto-Chat
// @version      0.1.0-diag.5
// @description  Guided read-only structural recorder for Auto-Chat live Firefox/Tampermonkey release validation.
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
  const CHECK_NAMES = [
    'oneTurn',
    'manualProtection',
    'reconnect',
    'sameProjectRollover',
    'safetyHold',
  ];
  const FIRST_GATE_EVENT_TYPES = new Set([
    'live_gate_start',
    'auto_state',
    'generation_start',
    'generation_end',
    'composer_state',
    'composer_input',
    'send_click',
  ]);

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
      diagVersion: '0.1.0-diag.5',
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

  const eventIndexesAfter = (type, afterIndex, predicate = () => true) =>
    timeline.reduce((indexes, entry, index) => {
      if (index > afterIndex && entry.type === type && predicate(entry)) indexes.push(index);
      return indexes;
    }, []);

  const getOneTurnProgress = () => {
    const generationStartIndex = eventIndex('generation_start');
    const generationEndIndex = eventIndexAfter('generation_end', generationStartIndex);
    const composerFilledIndex = eventIndexAfter(
      'composer_state',
      generationEndIndex,
      (entry) => entry.nonEmpty === true,
    );
    const continuationSendIndexes = eventIndexesAfter('send_click', composerFilledIndex);

    return {
      generationStartIndex,
      generationEndIndex,
      composerFilledIndex,
      continuationSendIndexes,
    };
  };

  const evaluateChecks = () => {
    const {
      generationStartIndex,
      generationEndIndex,
      composerFilledIndex,
      continuationSendIndexes,
    } = getOneTurnProgress();

    let oneTurn = 'not_exercised';
    if (
      generationStartIndex >= 0 &&
      generationEndIndex >= 0 &&
      composerFilledIndex >= 0 &&
      continuationSendIndexes.length > 1
    ) {
      oneTurn = 'fail';
    } else if (
      generationStartIndex >= 0 &&
      generationEndIndex >= 0 &&
      composerFilledIndex >= 0 &&
      continuationSendIndexes.length === 1
    ) {
      oneTurn = 'pass';
    }

    const trustedInputIndex = eventIndex(
      'composer_input',
      (entry) => entry.trusted === true,
    );
    let manualProtection = 'not_exercised';
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

    let reconnect = 'not_exercised';
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

    let sameProjectRollover = 'not_exercised';
    if (projectMismatchEvents > 0) sameProjectRollover = 'fail';
    else if (rolloverEvents > 0) sameProjectRollover = 'pass';

    let safetyHold = 'not_exercised';
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

  const buildVerdict = (checks) => {
    const passed = CHECK_NAMES.filter((name) => checks[name] === 'pass');
    const failed = CHECK_NAMES.filter((name) => checks[name] === 'fail');
    const notExercised = CHECK_NAMES.filter((name) => checks[name] === 'not_exercised');
    const status = failed.length > 0 ? 'fail' : notExercised.length > 0 ? 'incomplete' : 'pass';
    const firstGateStatus =
      checks.oneTurn === 'pass' ? 'pass' : checks.oneTurn === 'fail' ? 'fail' : 'incomplete';
    const reasons = [
      ...failed.map((name) => `failed:${name}`),
      ...notExercised.map((name) => `not_exercised:${name}`),
    ];

    return {
      status,
      firstGateStatus,
      passed,
      failed,
      notExercised,
      reasons,
    };
  };

  const buildCounters = () => ({
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
  });

  const buildFirstGate = (checks, snapshot) => {
    if (!recording) {
      return {
        status: 'waiting',
        step: 'start',
        instruction: 'Start live gate, then run one harmless real ChatGPT turn.',
        reason: null,
      };
    }

    if (checks.oneTurn === 'fail') {
      return {
        status: 'fail',
        step: 'failed',
        instruction: 'Stop here and copy the first-gate report for debugging.',
        reason: 'duplicate_continuation_send',
      };
    }

    if (checks.oneTurn === 'pass') {
      return {
        status: 'pass',
        step: 'complete',
        instruction: 'First live turn passed. Copy the first-gate report.',
        reason: null,
      };
    }

    if (!snapshot.coreControlPresent) {
      return {
        status: 'waiting',
        step: 'await_core',
        instruction: 'Wait for the Auto-Chat control to appear. Do not change selectors yet.',
        reason: null,
      };
    }

    if (!snapshot.composerPresent || !snapshot.composerVisible) {
      return {
        status: 'waiting',
        step: 'await_composer',
        instruction: 'Open a normal signed-in ChatGPT conversation with a visible composer.',
        reason: null,
      };
    }

    const autoState = (snapshot.autoState || '').toLowerCase();
    if (
      !autoState ||
      autoState.includes('off') ||
      autoState.includes('paused') ||
      autoState.includes('safe mode')
    ) {
      return {
        status: 'waiting',
        step: 'enable_auto',
        instruction: 'Enable Auto-Chat. The helper will not click or type anything for you.',
        reason: null,
      };
    }

    const {
      generationStartIndex,
      generationEndIndex,
      composerFilledIndex,
      continuationSendIndexes,
    } = getOneTurnProgress();

    if (generationStartIndex < 0) {
      return {
        status: 'waiting',
        step: 'send_prompt',
        instruction: 'Send one harmless prompt manually and keep this panel open.',
        reason: null,
      };
    }

    if (generationEndIndex < 0) {
      return {
        status: 'waiting',
        step: 'wait_generation',
        instruction: 'Wait: generation is running. Do not type into the composer.',
        reason: null,
      };
    }

    if (composerFilledIndex < 0) {
      return {
        status: 'waiting',
        step: 'wait_auto_insert',
        instruction: 'Generation ended. Wait for Auto to insert exactly one continuation.',
        reason: null,
      };
    }

    if (continuationSendIndexes.length === 0) {
      return {
        status: 'waiting',
        step: 'wait_auto_send',
        instruction: 'Auto inserted a continuation. Wait for exactly one automatic Send.',
        reason: null,
      };
    }

    return {
      status: 'waiting',
      step: 'evaluate',
      instruction: 'Evaluating the first live turn.',
      reason: null,
    };
  };

  const buildReport = () => {
    const snapshot = getStructuralState();
    const checks = evaluateChecks();
    const firstGate = buildFirstGate(checks, snapshot);
    return {
      diagVersion: '0.1.0-diag.5',
      recording,
      startedAt,
      snapshot,
      counters: buildCounters(),
      checks,
      firstGate,
      verdict: buildVerdict(checks),
      timeline: [...timeline],
    };
  };

  const buildFirstGateReport = (report) => ({
    diagVersion: report.diagVersion,
    startedAt: report.startedAt,
    firstGate: report.firstGate,
    oneTurn: report.checks.oneTurn,
    counters: {
      sendClicks: report.counters.sendClicks,
      generationStarts: report.counters.generationStarts,
      generationEnds: report.counters.generationEnds,
      composerInputEvents: report.counters.composerInputEvents,
      trustedComposerInputs: report.counters.trustedComposerInputs,
    },
    snapshot: {
      coreControlPresent: report.snapshot.coreControlPresent,
      autoState: report.snapshot.autoState,
      composerPresent: report.snapshot.composerPresent,
      composerVisible: report.snapshot.composerVisible,
      sendPresent: report.snapshot.sendPresent,
      sendVisible: report.snapshot.sendVisible,
      generating: report.snapshot.generating,
    },
    timeline: report.timeline.filter((entry) => FIRST_GATE_EVENT_TYPES.has(entry.type)),
  });

  const buildCompactVerdict = (report) => ({
    diagVersion: report.diagVersion,
    firstGate: report.firstGate,
    verdict: report.verdict,
    checks: report.checks,
    counters: report.counters,
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
  title.textContent = 'AUTO-CHAT LIVE GATE · DIAG.5 · READ ONLY';
  title.style.cssText = 'font-weight:800;margin-bottom:8px;color:#ffcc66';

  const hint = document.createElement('div');
  hint.textContent =
    'Записывает только структурные события: состояния Auto/DOM, boolean composer empty/non-empty, Send/Stop, сеть, safety и тип маршрута. Текст сообщений, URL/ID проекта и аккаунтные данные в отчёт не попадают.';
  hint.style.cssText = 'margin-bottom:8px;white-space:normal';

  const firstGateBanner = document.createElement('div');
  firstGateBanner.setAttribute('data-first-gate-banner', 'true');
  firstGateBanner.style.cssText =
    'margin:8px 0 4px;padding:10px 11px;border:2px solid #777;border-radius:9px;font-size:14px;font-weight:900;white-space:normal';

  const nextStep = document.createElement('div');
  nextStep.setAttribute('data-first-gate-next-step', 'true');
  nextStep.style.cssText =
    'margin:0 0 8px;padding:8px 10px;border:1px solid #555;border-radius:8px;white-space:normal';

  const verdictBanner = document.createElement('div');
  verdictBanner.style.cssText =
    'margin:8px 0;padding:7px 9px;border:1px solid #666;border-radius:8px;font-weight:700;white-space:normal';

  const details = document.createElement('details');
  details.style.cssText = 'margin-top:8px';
  const summary = document.createElement('summary');
  summary.textContent = 'Full structural report';
  summary.style.cssText = 'cursor:pointer;font-weight:700';
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;word-break:break-word';
  details.append(summary, pre);

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

  const copyJson = async (button, value, successLabel, resetLabel, consoleLabel) => {
    const text = JSON.stringify(value, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = successLabel;
      setTimeout(() => (button.textContent = resetLabel), 1200);
    } catch {
      console.log(consoleLabel, text);
      button.textContent = 'Copy failed → console';
      setTimeout(() => (button.textContent = resetLabel), 1600);
    }
  };

  let lastReport = buildReport();
  const render = () => {
    lastReport = buildReport();
    const verdict = lastReport.verdict;
    const firstGate = lastReport.firstGate;
    firstGateBanner.textContent =
      `FIRST LIVE TURN: ${firstGate.status.toUpperCase()} · ${firstGate.step.toUpperCase()}` +
      (firstGate.reason ? ` · ${firstGate.reason}` : '');
    nextStep.textContent = `NEXT: ${firstGate.instruction}`;
    verdictBanner.textContent =
      `LIVE GATE: ${verdict.status.toUpperCase()} · FIRST TURN: ${verdict.firstGateStatus.toUpperCase()} · ` +
      `passed ${verdict.passed.length} · failed ${verdict.failed.length} · not exercised ${verdict.notExercised.length}`;
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

  const copyFirstGate = makeButton('Copy first-gate report', async () => {
    sample();
    lastReport = buildReport();
    await copyJson(
      copyFirstGate,
      buildFirstGateReport(lastReport),
      'Copied first-gate report',
      'Copy first-gate report',
      '[AUTO-CHAT FIRST LIVE GATE]',
    );
  });

  const copy = makeButton('Copy report', async () => {
    sample();
    lastReport = buildReport();
    await copyJson(
      copy,
      lastReport,
      'Copied',
      'Copy report',
      '[AUTO-CHAT LIVE GATE]',
    );
  });

  const copyCompact = makeButton('Copy compact verdict', async () => {
    sample();
    lastReport = buildReport();
    await copyJson(
      copyCompact,
      buildCompactVerdict(lastReport),
      'Copied compact verdict',
      'Copy compact verdict',
      '[AUTO-CHAT LIVE GATE VERDICT]',
    );
  });

  let closed = false;
  const close = makeButton('Close', () => {
    closed = true;
    observer.disconnect();
    root.remove();
  });

  controls.append(start, reset, copyFirstGate, copy, copyCompact, close);
  root.append(title, hint, firstGateBanner, nextStep, verdictBanner, details, controls);
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